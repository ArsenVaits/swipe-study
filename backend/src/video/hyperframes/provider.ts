import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.ts";
import { BACKEND_DIR } from "../../paths.ts";
import { ttsConfigProblem } from "../../tts/index.ts";
import { VideoProviderError, type VideoProvider, type VideoStartInput, type VideoStatus } from "../types.ts";
import { PipelineError, runPipeline, type Stage } from "./pipeline.ts";

/** Public URL prefix for finished videos (proxied by the Next.js frontend like the rest of /api). */
export const MEDIA_URL_PREFIX = "/api/media";

const JOB_ID = /^hf_[0-9a-f-]{36}$/;

interface StatusFile {
  stage: Stage;
  error?: string;
  updatedAt: number;
}

/**
 * HyperFrames provider: voiceover (TTS) → Opus writes an HTML+GSAP composition → `hyperframes check`
 * with fix rounds → `hyperframes render` (headless Chrome + FFmpeg) → loudness pass → MP4 served by us.
 * Runs inside this server process; status is kept in small JSON files so it survives restarts.
 */
export class HyperframesVideoProvider implements VideoProvider {
  readonly name = "hyperframes" as const;
  readonly minPollIntervalMs = 0;
  readonly needsLesson = true;
  readonly maxRenderMs = 30 * 60_000;
  private readonly workRoot = path.resolve(config.HYPERFRAMES_WORK_DIR);
  /** Jobs running in this process. A non-final job not in here was cut off by a restart. */
  private readonly running = new Set<string>();

  async start(input: VideoStartInput) {
    if (!input.lesson) throw new VideoProviderError("VIDEO_START_FAILED", "Video needs a finished lesson.");
    const id = `hf_${randomUUID()}`;
    const workDir = path.join(this.workRoot, id);
    await mkdir(workDir, { recursive: true });
    await this.writeStatus(id, { stage: "queued", updatedAt: Date.now() });

    this.running.add(id);
    const lesson = input.lesson;
    const t0 = Date.now();
    let last = t0;
    let lastStage = "queued";
    const stage = async (next: Stage) => {
      const now = Date.now();
      console.log(`[hyperframes] ${id} ${lastStage} ${((now - last) / 1000).toFixed(1)}s -> ${next} (total ${((now - t0) / 1000).toFixed(1)}s)`);
      last = now;
      lastStage = next;
      await this.writeStatus(id, { stage: next, updatedAt: now });
    };
    void runPipeline(id, lesson, workDir, { stage })
      .then(async ({ usedFallback }) => {
        await stage("ready");
        // A fallback render keeps its work dir (Opus's HTML, check/render logs) for debugging.
        if (!config.HYPERFRAMES_KEEP_WORK_DIRS && !usedFallback) await rm(workDir, { recursive: true, force: true });
      })
      .catch(async (err) => {
        const message = err instanceof PipelineError ? err.message : "Video rendering failed.";
        if (!(err instanceof PipelineError)) console.error(`[hyperframes] ${id} failed:`, err);
        await this.writeStatus(id, { stage: "failed", error: message, updatedAt: Date.now() }).catch(() => {});
      })
      .finally(() => this.running.delete(id));

    return { providerJobId: id };
  }

  async getStatus(providerJobId: string): Promise<VideoStatus> {
    if (!JOB_ID.test(providerJobId)) return { status: "failed", error: "Unknown video job." };
    const s = await this.readStatus(providerJobId);
    if (!s) return { status: "failed", error: "Video job was not found on the server." };
    if (s.stage === "ready") return { status: "ready", videoUrl: `${MEDIA_URL_PREFIX}/${providerJobId}.mp4` };
    if (s.stage === "failed") return { status: "failed", error: s.error ?? "Video rendering failed." };
    if (!this.running.has(providerJobId)) return { status: "failed", error: "Video rendering was interrupted by a server restart." };
    return { status: "processing" };
  }

  /** Setup problems worth a startup warning. */
  configProblems(): string[] {
    const problems: string[] = [];
    if (!existsSync(path.join(BACKEND_DIR, "node_modules", "hyperframes"))) problems.push("hyperframes package is not installed (npm install).");
    if (spawnSync(config.FFMPEG_PATH, ["-version"]).status !== 0) problems.push(`FFmpeg not found at "${config.FFMPEG_PATH}" (brew install ffmpeg / apt install ffmpeg).`);
    if (!config.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is not set: videos will use the fallback template.");
    const tts = ttsConfigProblem();
    if (tts) problems.push(`${tts} Videos will be silent.`);
    return problems;
  }

  private statusPath(id: string) {
    return path.join(this.workRoot, `${id}.json`);
  }

  private async writeStatus(id: string, s: StatusFile) {
    const file = this.statusPath(id);
    await writeFile(`${file}.tmp`, JSON.stringify(s));
    await rename(`${file}.tmp`, file);
  }

  private async readStatus(id: string): Promise<StatusFile | null> {
    try {
      return JSON.parse(await readFile(this.statusPath(id), "utf8")) as StatusFile;
    } catch {
      return null;
    }
  }
}
