import type { Lesson } from "../lessons/schema.ts";

export interface VideoStatus {
  status: "processing" | "ready" | "failed";
  videoUrl?: string;
  error?: string;
}

export interface VideoStartInput {
  /** Cinematic prompt for text-to-video providers (mock, ltx). */
  scenePrompt: string;
  /** The finished lesson, for providers that build the video from it (hyperframes). */
  lesson?: Lesson;
}

export interface VideoProvider {
  readonly name: "mock" | "ltx" | "hyperframes";
  /** Minimum time between status checks against the upstream service. */
  readonly minPollIntervalMs: number;
  /** true: start() needs the finished lesson, so Opus's start_video_generation tool is not offered. */
  readonly needsLesson: boolean;
  /** A job still rendering after this long is marked failed (VIDEO_TIMEOUT). */
  readonly maxRenderMs: number;
  start(input: VideoStartInput): Promise<{ providerJobId: string }>;
  getStatus(providerJobId: string): Promise<VideoStatus>;
}

/** Provider failure whose message is safe to show to the frontend. */
export class VideoProviderError extends Error {
  readonly code: string;
  /** true = the job is definitely dead; false = transient, try again on a later poll. */
  readonly terminal: boolean;

  constructor(code: string, message: string, terminal = true) {
    super(message);
    this.code = code;
    this.terminal = terminal;
  }
}
