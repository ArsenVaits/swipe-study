import { Router } from "express";
import { z } from "zod";
import { listJobsForSession, openSetIdsForSession } from "../db.ts";
import { ApiError } from "../http/errors.ts";
import { getLessonJob, toDto } from "../jobs/service.ts";
import { getLessonSet } from "../jobs/sets.ts";

export const lessonsRouter = Router();
const SessionId = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
const FEED_LIMIT = 60;

// GET /api/lessons?sessionId=… — everything this browser session made, so a reloaded page can rebuild its feed.
// Lessons still rendering are refreshed like GET /api/lesson-jobs/:id; series still in progress are listed in `sets`.
lessonsRouter.get("/", async (req, res) => {
  const sessionId = SessionId.safeParse(req.query.sessionId);
  if (!sessionId.success) throw new ApiError(400, "VALIDATION_ERROR", "sessionId is required.");
  const lessons = [];
  for (const job of listJobsForSession(sessionId.data, FEED_LIMIT)) {
    const dto = job.status === "rendering_video" ? await getLessonJob(job.id) : toDto(job);
    lessons.push({ ...dto, sourceTitle: job.sourceTitle, setId: job.setId, createdAt: job.createdAt });
  }
  const sets = [];
  for (const id of openSetIdsForSession(sessionId.data)) sets.push(await getLessonSet(id));
  res.setHeader("Cache-Control", "no-store");
  res.json({ lessons, sets });
});
