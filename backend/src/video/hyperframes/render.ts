import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.ts";
import { hyperframes, parseJsonOutput, run } from "./cli.ts";
import { HEIGHT, WIDTH } from "./prompt.ts";

// Render → loudness → final check: shared by the lesson pipeline and the catalog builder.

/** Thrown with a message that is safe to show to the frontend. */
export class PipelineError extends Error {}

export async function render(workDir: string, outFile: string): Promise<boolean> {
  await rm(outFile, { force: true });
  const res = await hyperframes(
    [
      "render", workDir, "-o", outFile,
      "--fps", String(config.HYPERFRAMES_FPS),
      "--quality", config.HYPERFRAMES_QUALITY,
      "--workers", String(config.HYPERFRAMES_RENDER_WORKERS),
    ],
    { timeoutMs: config.HYPERFRAMES_RENDER_TIMEOUT_MS, logFile: path.join(workDir, "render.log") },
  );
  const ok = res.code === 0 && !res.timedOut && (await stat(outFile).catch(() => null))?.size;
  if (!ok) console.warn(`[hyperframes] render failed`, res.timedOut ? "(timed out)" : `(exit ${res.code})`, `log: ${workDir}/render.log`);
  return !!ok;
}

/** Loudness to social level (-14 LUFS, -1.5 dBTP) with FFmpeg; video stream is copied, not re-encoded. */
export async function finish(input: string, output: string, hasAudio: boolean): Promise<void> {
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
export async function verify(file: string, expectedSeconds: number): Promise<void> {
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

