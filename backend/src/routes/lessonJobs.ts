import { Router } from "express";
import { z } from "zod";
import { config } from "../config.ts";
import { ApiError } from "../http/errors.ts";
import { createLessonJob, getLessonJob } from "../jobs/service.ts";
import { createLessonJobBody } from "../lessons/schema.ts";

export const lessonJobsRouter = Router();
const bodySchema = createLessonJobBody(config.MAX_SOURCE_CHARS);

// POST /api/lesson-jobs — generates the lesson with Opus (synchronously, ~10-40 s),
// starts the video render, and returns immediately without waiting for the video.
lessonJobsRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.path[0] === "sourceText" && i.code === "too_big");
    throw new ApiError(
      tooLong ? 413 : 400,
      tooLong ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
      tooLong ? `sourceText is longer than ${config.MAX_SOURCE_CHARS} characters. Select fewer pages.` : "Invalid request body.",
      { details: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) },
    );
  }
  res.status(201).json(await createLessonJob(parsed.data));
});

// GET /api/lesson-jobs/:jobId — current status; refreshes video status from the provider (rate-limited).
lessonJobsRouter.get("/:jobId", async (req, res) => {
  const jobId = z.uuid().safeParse(req.params.jobId);
  if (!jobId.success) throw new ApiError(404, "NOT_FOUND", "Lesson job not found.");
  res.json(await getLessonJob(jobId.data));
});
