import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.ts";
import type { Voiceover } from "../../tts/index.ts";
import { hyperframes, parseJsonOutput, run } from "./cli.ts";

export interface ReviewFrame {
  time: number;
  /** JPEG, phone size (450x800), base64. */
  data: string;
}

/** Thumbnail, the middle of each voice line (at most 7), and the last beat. */
export function reviewTimes(voice: Voiceover): number[] {
  const lines = voice.lines;
  const step = Math.max(1, Math.ceil(lines.length / 7));
  const mids = lines.filter((_, i) => i % step === 0).map((l) => (l.start + l.end) / 2);
  const times = [0.4, ...mids, Math.max(0.5, voice.duration - 1)];
  return [...new Set(times.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b);
}

/** Captures the frames with `hyperframes snapshot` and shrinks them to what a phone shows. */
export async function captureFrames(workDir: string, times: number[]): Promise<ReviewFrame[]> {
  const outDir = path.join(workDir, "review");
  await rm(outDir, { recursive: true, force: true });
  const res = await hyperframes(
    ["snapshot", workDir, "--at", times.join(","), "--no-end", "-o", outDir, "--json"],
    { timeoutMs: 2 * 60_000, logFile: path.join(workDir, "review.log") },
  );
  const report = parseJsonOutput<{ ok?: boolean; frames?: Array<{ path: string; time: number }> }>(res.stdout);
  const frames: ReviewFrame[] = [];
  for (const f of report?.frames ?? []) {
    const jpg = f.path.replace(/\.png$/i, ".jpg");
    const conv = await run(config.FFMPEG_PATH, ["-v", "error", "-y", "-i", f.path, "-vf", "scale=450:-2", "-q:v", "4", jpg], { timeoutMs: 30_000 });
    if (conv.code !== 0) continue;
    frames.push({ time: f.time, data: (await readFile(jpg)).toString("base64") });
  }
  return frames;
}
