export interface VideoStatus {
  status: "processing" | "ready" | "failed";
  videoUrl?: string;
  error?: string;
}

export interface VideoProvider {
  readonly name: "mock" | "ltx";
  /** Minimum time between status checks against the upstream service. */
  readonly minPollIntervalMs: number;
  start(prompt: string): Promise<{ providerJobId: string }>;
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
