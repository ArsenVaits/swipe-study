import { z } from "zod";
import { VideoProviderError, type VideoProvider, type VideoStartInput, type VideoStatus } from "./types.ts";

// LTX async V2 API: https://docs.ltx.io/async-jobs
//   POST /v2/text-to-video        -> 202 { id, created_at }
//   GET  /v2/text-to-video/{id}   -> { status: pending|processing|completed|failed, result?.video_url, error? }
// Docs ask for >= 5 s between polls. result.video_url expires (no fixed TTL documented).

const BASE_URL = "https://api.ltx.io/v2/text-to-video";

// Billing-relevant parameters are fixed on the server and never come from the client.
// ltx-2-5-fast @ 720p supports 24/25 fps and 6..20 s (docs.ltx.io/models/ltx-2-5).
const RENDER_PARAMS = {
  model: "ltx-2-5-fast",
  duration: 6,
  resolution: "720x1280",
  fps: 24,
  generate_audio: false,
} as const;

const SubmitResponse = z.object({ id: z.string().min(1) });
const StatusResponse = z.object({
  status: z.enum(["pending", "processing", "completed", "failed"]),
  result: z.object({ video_url: z.string().url().optional() }).partial().nullish(),
  error: z.object({ type: z.string().optional(), message: z.string().optional() }).nullish(),
});
const ErrorBody = z.object({ error: z.object({ type: z.string().optional(), message: z.string().optional() }) });

export class LtxVideoProvider implements VideoProvider {
  readonly name = "ltx" as const;
  readonly minPollIntervalMs = 5000;
  readonly needsLesson = false;
  readonly maxRenderMs = 15 * 60_000;
  private readonly apiKey: string | undefined;

  constructor(apiKey: string | undefined) {
    this.apiKey = apiKey?.trim() || undefined;
  }

  private key(): string {
    if (!this.apiKey) {
      throw new VideoProviderError("LTX_NOT_CONFIGURED", "Video generation is not configured on the server (LTX_API_KEY is not set).");
    }
    return this.apiKey;
  }

  async start(input: VideoStartInput) {
    const res = await this.request(BASE_URL, {
      method: "POST",
      body: JSON.stringify({ prompt: input.scenePrompt, ...RENDER_PARAMS }),
    });
    if (res.status !== 202 && res.status !== 200) throw await this.httpError(res, "submit");
    const body = SubmitResponse.safeParse(await res.json().catch(() => null));
    if (!body.success) throw new VideoProviderError("LTX_BAD_RESPONSE", "Video service returned an unexpected response.");
    return { providerJobId: body.data.id };
  }

  async getStatus(providerJobId: string): Promise<VideoStatus> {
    const res = await this.request(`${BASE_URL}/${encodeURIComponent(providerJobId)}`, { method: "GET" });
    if (res.status === 404) return { status: "failed", error: "Video job expired or was not found at the video service." };
    if (!res.ok) throw await this.httpError(res, "status");

    const body = StatusResponse.safeParse(await res.json().catch(() => null));
    if (!body.success) throw new VideoProviderError("LTX_BAD_RESPONSE", "Video service returned an unexpected status.", false);

    const { status, result, error } = body.data;
    if (status === "pending" || status === "processing") return { status: "processing" };
    if (status === "failed") return { status: "failed", error: describeJobError(error?.type, error?.message) };
    if (!result?.video_url) return { status: "failed", error: "Video finished but no video URL was returned." };
    return { status: "ready", videoUrl: result.video_url };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${this.key()}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      if (err instanceof VideoProviderError) throw err;
      throw new VideoProviderError("LTX_UNREACHABLE", "Video service is unreachable right now.", false);
    }
  }

  private async httpError(res: Response, phase: "submit" | "status"): Promise<VideoProviderError> {
    const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
    const upstream = parsed.success ? parsed.data.error : undefined;
    console.warn(`[ltx] ${phase} failed: HTTP ${res.status}`, upstream?.type ?? "", upstream?.message ?? "");

    const transient = phase === "status" && (res.status >= 500 || res.status === 429);
    switch (res.status) {
      case 400:
        return new VideoProviderError("LTX_REJECTED", `Video service rejected the request${upstream?.message ? `: ${upstream.message}` : "."}`);
      case 401:
      case 403:
        return new VideoProviderError("LTX_AUTH_FAILED", "Video service rejected the server's API key.");
      case 429:
        return new VideoProviderError("LTX_BUSY", "Video service queue is full. Try again in a minute.", !transient);
      default:
        return new VideoProviderError("LTX_UPSTREAM_ERROR", `Video service error (HTTP ${res.status}).`, !transient);
    }
  }
}

function describeJobError(type?: string, message?: string): string {
  if (type === "content_filtered_error") return "The video scene was blocked by the video service's content policy.";
  if (type === "insufficient_funds_error") return "The video service account has run out of credit.";
  return message ? `Video rendering failed: ${message}` : "Video rendering failed.";
}
