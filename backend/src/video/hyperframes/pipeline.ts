import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.ts";
import type { Lesson } from "../../lessons/schema.ts";
import { AUDIO_LIBRARY_DIR, BACKEND_DIR } from "../../paths.ts";
import { buildVoiceover, type Voiceover } from "../../tts/index.ts";
import { hyperframes, parseJsonOutput, run } from "./cli.ts";
import { CompositionWriter, ComposeError, type AudioAssets } from "./compose.ts";
import { fallbackComposition } from "./fallback.ts";
import { HEIGHT, WIDTH } from "./prompt.ts";
import { addFinishingLayer } from "./finish.ts";
import { inlineIcons } from "./icons.ts";
import { addFontFaces, copyKit } from "./kit.ts";
import { captureFrames, reviewTimes } from "./review.ts";
import { ensureVoiceTrack, sanitizeComposition } from "./sanitize.ts";

export type Stage = "queued" | "voice" | "writing" | "checking" | "reviewing" | "rendering" | "finishing" | "ready" | "failed";

export interface PipelineCallbacks {
  stage(stage: Stage): Promise<void>;
}

/** Thrown with a message that is safe to show to the frontend. */
export class PipelineError extends Error {}

const GSAP_FILE = path.join(BACKEND_DIR, "node_modules", "gsap", "dist", "gsap.min.js");
const CHECK_TIMEOUT_MS = 2 * 60_000;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i;

// Errors that mean the composition itself is broken (JS errors at runtime). Lint errors left after
// the fix rounds are usually cosmetic (one element shown late), so we still render Opus's version;
// if that render fails, the fallback template takes over.
const BLOCKING_SECTIONS = new Set(["runtime"]);
// Findings about Studio editability, not about the picture: not worth a fix round.
const IGNORED_FINDINGS = new Set(["nested_structure_needs_subcomposition", "audio_none", "missing_track_kind"]);

/** Renders are CPU-heavy: only N at a time. Voice and Opus steps run in parallel. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
const renderSlots = new Semaphore(config.HYPERFRAMES_MAX_PARALLEL_RENDERS);

/** Runs the whole job and returns the path of the finished MP4 in VIDEO_OUTPUT_DIR. */
export async function runPipeline(
  jobId: string,
  lesson: Lesson,
  workDir: string,
  cb: PipelineCallbacks,
): Promise<{ file: string; usedFallback: boolean }> {
  const assetsDir = path.join(workDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await copyFile(GSAP_FILE, path.join(assetsDir, "gsap.min.js"));
  await copyKit(assetsDir);

  await cb.stage("voice");
  const voice = await buildVoiceover(lesson.narration, assetsDir);
  const audio = await copyAudioLibrary(assetsDir, jobId);

  await cb.stage("writing");
  let html = await writeWithOpus(workDir, lesson, voice, audio, cb);
  const usedFallback = html === null;
  if (html === null) html = addFinishingLayer(fallbackComposition(lesson, voice, config.HYPERFRAMES_CAPTIONS), voice.duration);
  await writeFile(path.join(workDir, "index.html"), html);

  await cb.stage("rendering");
  const rawMp4 = path.join(workDir, "render.mp4");
  let rendered = await renderSlots.use(() => render(workDir, rawMp4));
  let fellBack = usedFallback;
  if (!rendered && !usedFallback) {
    fellBack = true;
    await copyFile(path.join(workDir, "index.html"), path.join(workDir, "opus-rejected.html"));
    console.warn(`[hyperframes] ${jobId}: Opus composition failed to render, using the fallback template`);
    await writeFile(path.join(workDir, "index.html"), addFinishingLayer(fallbackComposition(lesson, voice, config.HYPERFRAMES_CAPTIONS), voice.duration));
    rendered = await renderSlots.use(() => render(workDir, rawMp4));
  }
  if (!rendered) throw new PipelineError("The video could not be rendered.");

  await cb.stage("finishing");
  const finalMp4 = path.join(workDir, "final.mp4");
  const hasAudio = !!voice.file || !!audio.music || audio.sfx.length > 0;
  await finish(rawMp4, finalMp4, hasAudio);
  await verify(finalMp4, voice.duration);

  const outDir = path.resolve(config.VIDEO_OUTPUT_DIR);
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${jobId}.mp4`);
  await rename(finalMp4, outFile);
  console.log(`[hyperframes] ${jobId}: ready (${fellBack ? "fallback template" : "Opus composition"}, voice: ${voice.file ? "yes" : "no"})`);
  return { file: outFile, usedFallback: fellBack };
}

/** Opus draft → `hyperframes check` → up to N fix rounds. Returns null when no clean composition came out. */
async function writeWithOpus(
  workDir: string,
  lesson: Lesson,
  voice: Voiceover,
  audio: AudioAssets,
  cb: PipelineCallbacks,
): Promise<string | null> {
  if (!config.ANTHROPIC_API_KEY) return null;
  const writer = new CompositionWriter(lesson, voice, audio);
  // Model output → safe, voiced, iconised HTML with the backend's finishing layer.
  const clean = (raw: string) => {
    const { html, missing } = inlineIcons(ensureVoiceTrack(sanitizeComposition(raw), voice.file, voice.duration));
    const iconProblems = missing.map(
      (n) => `[warning] unknown_icon: data-icon="${n}" is not a Lucide icon name, so it was dropped. Use another Lucide name.`,
    );
    return { html: addFontFaces(addFinishingLayer(html, voice.duration)), iconProblems };
  };
  const index = path.join(workDir, "index.html");
  let html: string;
  try {
    let draft = clean(await writer.draft());
    for (let round = 0; ; round++) {
      await writeFile(index, draft.html);
      await cb.stage("checking");
      const result = await check(workDir);
      const problems = [...draft.iconProblems, ...result.problems];
      if (problems.length === 0 || round >= config.HYPERFRAMES_FIX_ROUNDS) {
        // Quality findings (contrast, layout) that survived the fixes are accepted;
        // JS errors at runtime send us to the fallback template.
        if (result.blocking > 0) {
          console.warn("[hyperframes] composition still breaks after fixes:", problems.filter((p) => p.startsWith("[error]")).slice(0, 5));
          await writeFile(path.join(workDir, "opus-rejected.html"), draft.html); // kept for debugging
          return null;
        }
        const left = problems.filter((p) => p.startsWith("[error]"));
        if (left.length) console.warn(`[hyperframes] rendering Opus composition with ${left.length} non-blocking error(s):`, left.slice(0, 3));
        html = draft.html;
        break;
      }
      await cb.stage("writing");
      draft = clean(await writer.fix(problems));
    }
  } catch (err) {
    if (err instanceof ComposeError) console.warn("[hyperframes] composition step failed:", err.message);
    else console.error("[hyperframes] composition step failed:", err);
    return null;
  }

  // Visual review: the model looks at phone-size frames of its own render and fixes what it sees.
  // A revision that breaks (JS errors) is discarded and the checked version is kept.
  if (config.HYPERFRAMES_REVIEW) {
    try {
      await cb.stage("reviewing");
      const frames = await captureFrames(workDir, reviewTimes(voice));
      const revised = frames.length ? await writer.review(frames) : null;
      if (revised) {
        const next = clean(revised);
        await writeFile(index, next.html);
        await cb.stage("checking");
        const result = await check(workDir);
        if (result.blocking === 0) html = next.html;
        else {
          console.warn("[hyperframes] review revision breaks, keeping the checked version");
          await writeFile(index, html);
        }
      } else if (frames.length) {
        console.log("[hyperframes] review: approved as is");
      }
    } catch (err) {
      console.warn("[hyperframes] review step failed, keeping the checked version:", err instanceof Error ? err.message : err);
      await writeFile(index, html);
    }
  }
  return html;
}

interface Finding {
  code?: string;
  severity?: string;
  message?: string;
  fixHint?: string;
  time?: number;
  firstSeen?: number;
}
type CheckReport = Record<string, unknown> & { ok?: boolean };

async function check(workDir: string): Promise<{ blocking: number; problems: string[] }> {
  const res = await hyperframes(["check", workDir, "--json"], { timeoutMs: CHECK_TIMEOUT_MS, logFile: path.join(workDir, "check.log") });
  const report = parseJsonOutput<CheckReport>(res.stdout);
  if (!report) {
    // The checker itself failed: don't block the render on it.
    console.warn("[hyperframes] check produced no report", res.timedOut ? "(timed out)" : `(exit ${res.code})`);
    return { blocking: 0, problems: [] };
  }
  let blocking = 0;
  const problems: string[] = [];
  for (const [name, section] of Object.entries(report)) {
    const findings = (section as { findings?: Finding[] } | null)?.findings;
    if (!Array.isArray(findings)) continue;
    for (const f of findings) {
      if (f.severity !== "error" && f.severity !== "warning") continue;
      if (f.code && IGNORED_FINDINGS.has(f.code)) continue;
      if (f.severity === "error" && BLOCKING_SECTIONS.has(name)) blocking++;
      const at = f.firstSeen ?? f.time;
      problems.push(
        `[${f.severity}] ${f.code ?? "issue"}: ${f.message ?? ""}${f.fixHint ? ` Fix: ${f.fixHint}` : ""}${at ? ` (at ${at.toFixed(2)} s)` : ""}`,
      );
    }
  }
  // Errors first, so the most important ones survive the cap.
  problems.sort((a, b) => Number(b.startsWith("[error]")) - Number(a.startsWith("[error]")));
  return { blocking, problems: problems.slice(0, 25) };
}

async function render(workDir: string, outFile: string): Promise<boolean> {
  await rm(outFile, { force: true });
  const res = await hyperframes(
    ["render", workDir, "-o", outFile, "--fps", String(config.HYPERFRAMES_FPS), "--quality", config.HYPERFRAMES_QUALITY],
    { timeoutMs: config.HYPERFRAMES_RENDER_TIMEOUT_MS, logFile: path.join(workDir, "render.log") },
  );
  const ok = res.code === 0 && !res.timedOut && (await stat(outFile).catch(() => null))?.size;
  if (!ok) console.warn(`[hyperframes] render failed`, res.timedOut ? "(timed out)" : `(exit ${res.code})`, `log: ${workDir}/render.log`);
  return !!ok;
}

/** Loudness to social level (-14 LUFS, -1.5 dBTP) with FFmpeg; video stream is copied, not re-encoded. */
async function finish(input: string, output: string, hasAudio: boolean): Promise<void> {
  if (!hasAudio) {
    await rename(input, output);
    return;
  }
  const res = await run(
    config.FFMPEG_PATH,
    ["-v", "error", "-y", "-i", input, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output],
    { timeoutMs: 2 * 60_000 },
  );
  if (res.code !== 0) {
    console.warn("[hyperframes] loudness pass failed, keeping the rendered mix:", res.stderr.slice(0, 300));
    await rename(input, output);
  }
}

/** ffprobe: H.264, 1080x1920, roughly the planned length. */
async function verify(file: string, expectedSeconds: number): Promise<void> {
  const res = await run(
    config.FFPROBE_PATH,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", file],
    { timeoutMs: 30_000 },
  );
  const info = parseJsonOutput<{ format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }> }>(res.stdout);
  const video = info?.streams?.find((s) => s.codec_type === "video");
  const duration = Number(info?.format?.duration);
  if (!video || video.codec_name !== "h264" || video.width !== WIDTH || video.height !== HEIGHT || !(Math.abs(duration - expectedSeconds) < 2)) {
    console.warn("[hyperframes] output check failed:", JSON.stringify(info));
    throw new PipelineError("The rendered video failed the final check.");
  }
}

/** Copies optional music and SFX from backend/assets/audio/{music,sfx} into the project. */
async function copyAudioLibrary(assetsDir: string, jobId: string): Promise<AudioAssets> {
  const list = async (sub: string) =>
    (await readdir(path.join(AUDIO_LIBRARY_DIR, sub)).catch(() => [] as string[])).filter((f) => AUDIO_EXT.test(f)).sort();
  const musicFiles = await list("music");
  const sfxFiles = (await list("sfx")).slice(0, 12);

  let music: string | null = null;
  if (musicFiles.length) {
    // Deterministic pick per job, so a re-render of the same job sounds the same.
    const pick = musicFiles[[...jobId].reduce((a, c) => a + c.charCodeAt(0), 0) % musicFiles.length]!;
    await mkdir(path.join(assetsDir, "music"), { recursive: true });
    await copyFile(path.join(AUDIO_LIBRARY_DIR, "music", pick), path.join(assetsDir, "music", pick));
    music = `assets/music/${pick}`;
  }
  const sfx: string[] = [];
  if (sfxFiles.length) {
    await mkdir(path.join(assetsDir, "sfx"), { recursive: true });
    for (const f of sfxFiles) {
      await copyFile(path.join(AUDIO_LIBRARY_DIR, "sfx", f), path.join(assetsDir, "sfx", f));
      sfx.push(`assets/sfx/${f}`);
    }
  }
  return { music, sfx };
}
