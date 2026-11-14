import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { VideoProvider, VideoStartInput, VideoStatus } from "./types.ts";

/**
 * Mock provider: same lifecycle as a real render (start -> processing -> ready),
 * but "renders" by waiting `delayMs` and then returning a pre-made demo clip.
 * Start time is encoded into the job id, so status survives server restarts.
 */
export class MockVideoProvider implements VideoProvider {
  readonly name = "mock" as const;
  readonly minPollIntervalMs = 0;
  readonly needsLesson = false;
  readonly maxRenderMs = 15 * 60_000;
  private readonly videoUrl: string;
  private readonly delayMs: number;
  private readonly publicDir: string;

  constructor(opts: { videoUrl: string; delayMs: number; publicDir: string }) {
    this.videoUrl = opts.videoUrl.trim();
    this.delayMs = opts.delayMs;
    this.publicDir = opts.publicDir;
  }

  async start(_input: VideoStartInput) {
    return { providerJobId: `mock_${Date.now()}_${randomUUID().slice(0, 8)}` };
  }

  async getStatus(providerJobId: string): Promise<VideoStatus> {
    const startedAt = Number(providerJobId.split("_")[1]);
    if (!Number.isFinite(startedAt)) return { status: "failed", error: "Unknown mock video job." };
    if (Date.now() - startedAt < this.delayMs) return { status: "processing" };

    const problem = this.configProblem();
    if (problem) return { status: "failed", error: problem };
    return { status: "ready", videoUrl: this.videoUrl };
  }

  /** Human-readable reason why the mock cannot return a video, or null if it can. */
  configProblem(): string | null {
    if (!this.videoUrl) return "Demo video is not configured (MOCK_VIDEO_URL is empty).";
    if (this.videoUrl.startsWith("/")) {
      const file = path.join(this.publicDir, this.videoUrl);
      if (!existsSync(file)) {
        return `Demo video file is missing. Put an MP4 at backend/public${this.videoUrl}.`;
      }
    }
    return null;
  }
}
