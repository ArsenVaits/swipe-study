import { Router } from "express";
import { z } from "zod";
import { config } from "../config.ts";
import { ApiError } from "../http/errors.ts";
import { createLessonSet, getLessonSet } from "../jobs/sets.ts";
import { createLessonSetBody } from "../lessons/schema.ts";

export const lessonSetsRouter = Router();
const bodySchema = createLessonSetBody(config.MAX_SET_SOURCE_CHARS);

// POST /api/lesson-sets — whole notes or a book. Returns 202 at once; the plan and the lessons follow.
lessonSetsRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.message.includes("longer than") || i.code === "too_big");
    throw new ApiError(
      tooLong ? 413 : 400,
      tooLong ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
      tooLong ? `The material is longer than ${config.MAX_SET_SOURCE_CHARS} characters.` : "Invalid request body.",
      { details: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`) },
    );
  }
  res.status(202).json(await createLessonSet(parsed.data));
});

// GET /api/lesson-sets/:setId — the plan and every lesson made so far (each refreshed like GET /api/lesson-jobs/:id).
lessonSetsRouter.get("/:setId", async (req, res) => {
  const id = z.uuid().safeParse(req.params.setId);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", "Lesson set not found.");
  res.json(await getLessonSet(id.data));
});
