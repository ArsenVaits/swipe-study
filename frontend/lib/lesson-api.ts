import type { Lesson } from "./lesson";

export type CreateLessonRequest = {
  sourceTitle: string;
  sourcePage: number;
  sourceText: string;
  sessionId: string;
};

type ApiLesson = Omit<Lesson, "source" | "quiz"> & {
  hook: string;
  scenePrompt: string;
  sourceQuote: string;
  sourcePage: number;
  quiz: Omit<Lesson["quiz"], "correctIndex" | "cloze"> & { answerIndex: number };
};

export type LessonJob = {
  jobId: string;
  status: "generating_lesson" | "rendering_video" | "ready" | "failed";
  lesson: ApiLesson | null;
  videoUrl: string | null;
  error: { stage: "lesson" | "video"; code: string; message: string } | null;
};

const sessionKey = "scrolled.sessionId";
let sessionId: string | undefined;

export function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const saved = localStorage.getItem(sessionKey);
    if (saved && /^[\w-]{8,128}$/.test(saved)) return sessionId = saved;
    sessionId = crypto.randomUUID();
    localStorage.setItem(sessionKey, sessionId);
  } catch {
    sessionId ??= crypto.randomUUID();
  }
  return sessionId;
}

export class LessonApiError extends Error {
  constructor(public readonly status: number, public readonly code?: string) {
    super(`Lesson API returned HTTP ${status}`);
  }
}

async function request(path: string, init: RequestInit, signal: AbortSignal, timeout: number) {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LessonApiError(response.status, body?.error?.code);
  if (!body?.jobId || !["generating_lesson", "rendering_video", "ready", "failed"].includes(body.status)) {
    throw new Error("Invalid lesson job response");
  }
  return body as LessonJob;
}

export function createLessonJob(input: CreateLessonRequest, signal: AbortSignal) {
  return request("/api/lesson-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, signal, 120_000);
}

export function getLessonJob(jobId: string, signal: AbortSignal) {
  return request("/api/lesson-jobs/" + encodeURIComponent(jobId), {}, signal, 10_000);
}

export function isPending(job: LessonJob) {
  return job.status === "rendering_video" || job.status === "generating_lesson";
}

export async function pollLessonJob(job: LessonJob, signal: AbortSignal) {
  const deadline = Date.now() + 17 * 60_000;
  let current = job;
  while (isPending(current) && Date.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 4000));
    signal.throwIfAborted();
    try {
      current = await getLessonJob(current.jobId, signal);
    } catch (cause) {
      signal.throwIfAborted();
      if (cause instanceof LessonApiError && cause.status < 500 && cause.status !== 429) throw cause;
    }
  }
  if (isPending(current)) throw new Error("Video status timed out");
  return current;
}

export type LessonSetPage = { page: number; text: string };

export type CreateLessonSetRequest = {
  sourceTitle: string;
  sessionId: string;
  pages: LessonSetPage[];
};

/** One upload → the server plans 1..10 lessons and adds them one by one (see docs/FRONTEND_API.md §3.3). */
export type LessonSet = {
  setId: string;
  status: "planning" | "generating" | "done" | "failed";
  planned: number | null;
  titles: string[];
  lessons: LessonJob[];
  complete: boolean;
  error: { code: string; message: string } | null;
};

async function requestSet(path: string, init: RequestInit, signal: AbortSignal, timeout: number) {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LessonApiError(response.status, body?.error?.code);
  if (!body?.setId || !["planning", "generating", "done", "failed"].includes(body.status) || !Array.isArray(body.lessons)) {
    throw new Error("Invalid lesson set response");
  }
  return body as LessonSet;
}

export function createLessonSet(input: CreateLessonSetRequest, signal: AbortSignal) {
  return requestSet("/api/lesson-sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, signal, 60_000);
}

export function getLessonSet(setId: string, signal: AbortSignal) {
  return requestSet("/api/lesson-sets/" + encodeURIComponent(setId), {}, signal, 15_000);
}

/** Polls a series until every planned lesson exists and every video is ready or failed. */
export async function pollLessonSet(set: LessonSet, signal: AbortSignal, onUpdate: (set: LessonSet) => void) {
  const deadline = Date.now() + 45 * 60_000;
  let current = set;
  while (!current.complete && Date.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
    signal.throwIfAborted();
    try {
      current = await getLessonSet(current.setId, signal);
      onUpdate(current);
    } catch (cause) {
      signal.throwIfAborted();
      if (cause instanceof LessonApiError && cause.status < 500 && cause.status !== 429) throw cause;
    }
  }
  return current;
}

export type SessionLesson = LessonJob & { sourceTitle: string; setId: string | null; createdAt: number };

/** Everything this browser session made (newest first), so a reloaded page can rebuild its feed. */
export async function listSessionLessons(sessionId: string, signal: AbortSignal) {
  const response = await fetch("/api/lessons?sessionId=" + encodeURIComponent(sessionId), {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LessonApiError(response.status, body?.error?.code);
  if (!Array.isArray(body?.lessons) || !Array.isArray(body?.sets)) throw new Error("Invalid lesson list response");
  return body as { lessons: SessionLesson[]; sets: LessonSet[] };
}

export function toLesson(data: ApiLesson): Lesson {
  return {
    title: data.title,
    explanation: data.explanation,
    narration: data.narration,
    captions: data.captions,
    quiz: {
      question: data.quiz.question,
      options: data.quiz.options,
      correctIndex: data.quiz.answerIndex,
      explanation: data.quiz.explanation,
    },
    source: { page: data.sourcePage, quote: data.sourceQuote },
  };
}

export function lessonErrorMessage(code?: string, status?: number) {
  switch (code) {
    case "VALIDATION_ERROR": return "This passage could not be processed. Check the selection.";
    case "PAYLOAD_TOO_LARGE": return "This PDF is too long. Try a shorter document or a few chapters.";
    case "SESSION_LIMIT_REACHED": return "You have reached the lesson limit for this demo.";
    case "INSUFFICIENT_SOURCE": return "There is not enough material here. Select a longer passage.";
    case "LESSON_REFUSED": return "A lesson could not be created from this passage. Choose another.";
    case "AI_NOT_CONFIGURED": return "Lesson generation is unavailable. Ask the server operator to check the AI configuration.";
    case "INTERRUPTED": return "The server restarted while making these lessons. The lessons already made are kept.";
    case "LESSON_GENERATION_FAILED":
      return status === 503 ? "Lesson generation is busy. Try again in a minute." : "Lesson generation failed. Try again.";
    default:
      return "Could not create a lesson. Check that the lesson server is running and try again.";
  }
}
