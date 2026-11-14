import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import {
  countJobsForSession,
  countVideoStartsForProvider,
  countVideoStartsForSession,
  getJob,
  insertJob,
  updateJob,
  type JobRecord,
} from "../db.ts";
import { ApiError } from "../http/errors.ts";
import { generateLesson } from "../lessons/generateLesson.ts";
import type { CreateLessonJobBody } from "../lessons/schema.ts";
import { videoProvider } from "../video/index.ts";
import { VideoProviderError, type VideoStartInput } from "../video/types.ts";

/** Public shape returned to the frontend by both POST and GET. */
export function toDto(job: JobRecord) {
  return {
    jobId: job.id,
    status: job.status,
    lesson: job.lesson,
    videoUrl: job.videoUrl,
    error: job.error, // { stage: "lesson" | "video", code, message } | null
  };
}

export async function createLessonJob(body: CreateLessonJobBody) {
  if (!config.ANTHROPIC_API_KEY) {
    throw new ApiError(503, "AI_NOT_CONFIGURED", "Lesson generation is not configured on the server (ANTHROPIC_API_KEY is not set).");
  }
  if (countJobsForSession(body.sessionId) >= config.MAX_LESSON_JOBS_PER_SESSION) {
    throw new ApiError(429, "SESSION_LIMIT_REACHED", `This session has reached the limit of ${config.MAX_LESSON_JOBS_PER_SESSION} lessons.`);
  }

  const jobId = randomUUID();
  insertJob({
    id: jobId,
    sessionId: body.sessionId,
    sourceTitle: body.sourceTitle,
    sourcePage: body.sourcePage,
    sourceChars: body.sourceText.length,
  });

  // At most one video start per job, whether Opus triggers it via tool call or we do it ourselves.
  let videoAttempted = false;
  let videoError: { code: string; message: string } | null = null;

  const startVideo = async (input: VideoStartInput): Promise<{ ok: boolean; message: string }> => {
    if (videoAttempted) return { ok: false, message: "Video generation was already requested." };
    videoAttempted = true;

    if (countVideoStartsForSession(body.sessionId) >= config.MAX_VIDEO_JOBS_PER_SESSION) {
      videoError = { code: "VIDEO_LIMIT_REACHED", message: `Video limit for this session (${config.MAX_VIDEO_JOBS_PER_SESSION}) reached. The lesson is still available.` };
      return { ok: false, message: "Video is not available for this lesson." };
    }
    // Paid providers (LTX credits; Opus + TTS for HyperFrames) share a server-wide budget.
    if (videoProvider.name !== "mock" && countVideoStartsForProvider(videoProvider.name) >= config.MAX_VIDEO_JOBS_TOTAL) {
      videoError = { code: "VIDEO_LIMIT_REACHED", message: "The demo's video budget is used up. The lesson is still available." };
      return { ok: false, message: "Video is not available for this lesson." };
    }

    try {
      const { providerJobId } = await videoProvider.start(input);
      updateJob(jobId, { videoProvider: videoProvider.name, providerJobId });
      return { ok: true, message: "Video rendering started." };
    } catch (err) {
      videoError =
        err instanceof VideoProviderError
          ? { code: err.code, message: err.message }
          : { code: "VIDEO_START_FAILED", message: "Could not start video rendering." };
      if (!(err instanceof VideoProviderError)) console.error("[video] start failed:", err);
      return { ok: false, message: "Video rendering could not be started." };
    }
  };

  let lesson;
  try {
    // Providers that build the video from the finished lesson can't be started mid-generation by a tool call.
    lesson = await generateLesson({
      ...body,
      onStartVideo: videoProvider.needsLesson ? undefined : (scenePrompt) => startVideo({ scenePrompt }),
    });
  } catch (err) {
    const apiErr =
      err instanceof ApiError ? err : new ApiError(502, "LESSON_GENERATION_FAILED", "Lesson generation failed.");
    if (!(err instanceof ApiError)) console.error("[lesson] unexpected error:", err);
    updateJob(jobId, { status: "failed", error: { stage: "lesson", code: apiErr.code, message: apiErr.message } });
    throw new ApiError(apiErr.status, apiErr.code, apiErr.message, { details: apiErr.details, jobId });
  }

  updateJob(jobId, { lesson });
  // Fallback path: tool calling disabled, or Opus skipped the tool → backend starts the render itself.
  if (!videoAttempted) await startVideo({ scenePrompt: lesson.scenePrompt, lesson });

  const err = videoError as { code: string; message: string } | null;
  if (err) {
    // Video failure never discards the lesson and quiz.
    updateJob(jobId, { status: "failed", error: { stage: "video", ...err } });
  } else {
    updateJob(jobId, { status: "rendering_video" });
  }
  return toDto(getJob(jobId)!);
}

// Dedupe concurrent status checks for the same job (several browser tabs polling).
const inFlight = new Map<string, Promise<void>>();

export async function getLessonJob(jobId: string) {
  const job = getJob(jobId);
  if (!job) throw new ApiError(404, "NOT_FOUND", "Lesson job not found.");

  if (job.status === "rendering_video" && job.providerJobId) {
    let p = inFlight.get(jobId);
    if (!p) {
      p = refreshVideo(job).finally(() => inFlight.delete(jobId));
      inFlight.set(jobId, p);
    }
    await p;
  }
  return toDto(getJob(jobId)!);
}

async function refreshVideo(job: JobRecord): Promise<void> {
  if (job.videoProvider !== videoProvider.name) {
    updateJob(job.id, {
      status: "failed",
      error: { stage: "video", code: "VIDEO_PROVIDER_CHANGED", message: "Video provider was switched on the server; this render can't be tracked." },
    });
    return;
  }
  if (Date.now() - job.createdAt > videoProvider.maxRenderMs) {
    updateJob(job.id, { status: "failed", error: { stage: "video", code: "VIDEO_TIMEOUT", message: "Video rendering took too long." } });
    return;
  }
  // Respect provider's polling limits regardless of how often the frontend polls us.
  if (job.providerCheckedAt && Date.now() - job.providerCheckedAt < videoProvider.minPollIntervalMs) return;

  try {
    const s = await videoProvider.getStatus(job.providerJobId!);
    const providerCheckedAt = Date.now();
    if (s.status === "ready" && s.videoUrl) {
      updateJob(job.id, { status: "ready", videoUrl: s.videoUrl, providerCheckedAt });
    } else if (s.status === "failed" || s.status === "ready") {
      updateJob(job.id, {
        status: "failed",
        providerCheckedAt,
        error: { stage: "video", code: "VIDEO_RENDER_FAILED", message: s.error ?? "Video rendering failed." },
      });
    } else {
      updateJob(job.id, { providerCheckedAt });
    }
  } catch (err) {
    const providerCheckedAt = Date.now();
    if (err instanceof VideoProviderError && !err.terminal) {
      console.warn("[video] transient status error:", err.code);
      updateJob(job.id, { providerCheckedAt });
      return;
    }
    const e = err instanceof VideoProviderError ? err : null;
    if (!e) console.error("[video] status check failed:", err);
    updateJob(job.id, {
      status: "failed",
      providerCheckedAt,
      error: { stage: "video", code: e?.code ?? "VIDEO_STATUS_FAILED", message: e?.message ?? "Could not check video status." },
    });
  }
}
