import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPublishedVideo, getVideoPublication, listPublishedVideos, setVideoPublication } from "../db.ts";
import { ApiError } from "../http/errors.ts";

const topics = z.enum(["AI", "DevOps", "Productivity", "Communication", "Design"]);
const owner = z.object({
  jobId: z.uuid(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
});

export const discoveryRouter = Router();
discoveryRouter.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(listPublishedVideos());
});
discoveryRouter.post("/publication", (req, res) => {
  const parsed = owner.extend({ topic: topics.nullable().optional() }).safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, "VALIDATION_ERROR", "Invalid publication request.");
  const { jobId, sessionId, topic } = parsed.data;
  if (topic !== undefined && !setVideoPublication(jobId, sessionId, randomUUID(), topic)) {
    throw new ApiError(404, "NOT_FOUND", "This session has no ready video for that lesson.");
  }
  res.json({ topic: getVideoPublication(jobId, sessionId) });
});
discoveryRouter.get("/:id", (req, res) => {
  const parsed = z.uuid().safeParse(req.params.id);
  const video = parsed.success && getPublishedVideo(parsed.data);
  if (!video) throw new ApiError(404, "NOT_FOUND", "This video is no longer published.");
  res.setHeader("Cache-Control", "no-store");
  res.json(video);
});
