import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { countJobsForSession, getSet, insertJob, insertSet, jobIdsForSet, updateSet, type SetRecord } from "../db.ts";
import { ApiError } from "../http/errors.ts";
import { planLessons } from "../lessons/plan.ts";
import type { CreateLessonSetBody } from "../lessons/schema.ts";
import { toParagraphs } from "../lessons/source.ts";
import { getLessonJob, runLessonJob } from "./service.ts";

// A lesson series: one upload (notes or a whole book) → the planner picks 1..N lessons → each lesson
// is generated in order and its video starts right away, so the frontend can show lessons one by one.

export async function createLessonSet(body: CreateLessonSetBody) {
  if (!config.ANTHROPIC_API_KEY) {
    throw new ApiError(503, "AI_NOT_CONFIGURED", "Lesson generation is not configured on the server (ANTHROPIC_API_KEY is not set).");
  }
  const remaining = config.MAX_LESSON_JOBS_PER_SESSION - countJobsForSession(body.sessionId);
  if (remaining <= 0) {
    throw new ApiError(429, "SESSION_LIMIT_REACHED", `This session has reached the limit of ${config.MAX_LESSON_JOBS_PER_SESSION} lessons.`);
  }
  const paragraphs = toParagraphs({ pages: body.pages, sourceText: body.sourceText, firstPage: body.firstPage });
  const chars = paragraphs.reduce((n, p) => n + p.text.length, 0);
  if (chars < 80) throw new ApiError(400, "VALIDATION_ERROR", "The material has too little text for a lesson.");

  const id = randomUUID();
  insertSet({ id, sessionId: body.sessionId, sourceTitle: body.sourceTitle, sourceChars: chars });
  const max = Math.min(config.MAX_LESSONS_PER_SET, remaining);
  void processSet(id, body, paragraphs, max).catch((err) => console.error(`[set] ${id} crashed:`, err));
  return toSetDto(getSet(id)!, []);
}

async function processSet(
  id: string,
  body: CreateLessonSetBody,
  paragraphs: ReturnType<typeof toParagraphs>,
  max: number,
): Promise<void> {
  const t0 = Date.now();
  let plan;
  try {
    plan = await planLessons(body.sourceTitle, paragraphs, max);
  } catch (err) {
    const e = err instanceof ApiError ? err : new ApiError(502, "LESSON_GENERATION_FAILED", "Could not plan lessons for this material.");
    if (!(err instanceof ApiError)) console.error(`[set] ${id} planning failed:`, err);
    updateSet(id, { status: "failed", error: { code: e.code, message: e.message } });
    return;
  }
  const titles = plan.map((l) => l.title);
  updateSet(id, { status: "generating", planned: plan.length, titles });
  console.log(`[set] ${id} planned ${plan.length} lesson(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Lessons in order: the first one reaches the frontend first; each video starts as soon as its lesson exists.
  for (const [i, l] of plan.entries()) {
    const jobId = randomUUID();
    insertJob({ id: jobId, sessionId: body.sessionId, sourceTitle: body.sourceTitle, sourcePage: l.page, sourceChars: l.text.length, setId: id, setIndex: i });
    await runLessonJob(jobId, {
      sourceTitle: body.sourceTitle,
      sourcePage: l.page,
      sourceText: l.text,
      sessionId: body.sessionId,
      focus: { title: l.title, question: l.question, otherLessons: titles.filter((_, j) => j !== i) },
    });
  }
  updateSet(id, { status: "done" });
  console.log(`[set] ${id} all ${plan.length} lesson(s) written in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

export async function getLessonSet(id: string) {
  const set = getSet(id);
  if (!set) throw new ApiError(404, "NOT_FOUND", "Lesson set not found.");
  const lessons = [];
  for (const jobId of jobIdsForSet(id)) lessons.push(await getLessonJob(jobId));
  return toSetDto(set, lessons);
}

function toSetDto(set: SetRecord, lessons: Awaited<ReturnType<typeof getLessonJob>>[]) {
  const settled = lessons.every((l) => l.status === "ready" || l.status === "failed");
  return {
    setId: set.id,
    // planning → generating (lessons appear one by one) → done (all lessons written) | failed
    status: set.status,
    planned: set.planned, // number of lessons in the plan, null while planning
    titles: set.titles, // planned lesson titles, in order
    lessons, // same shape as GET /api/lesson-jobs/:id, in plan order; grows while status is "generating"
    complete: (set.status === "done" || set.status === "failed") && settled,
    error: set.error,
  };
}
