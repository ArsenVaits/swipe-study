import { Router } from "express";
import { z } from "zod";
import { TRACK_IDS, TRACKS } from "../catalog/tracks.ts";
import { catalogCounts, listCatalog } from "../db.ts";
import { ApiError } from "../http/errors.ts";

// Ready-made lessons with videos, grouped by topic track. Public and the same for every visitor.

export const tracksRouter = Router();
export const catalogRouter = Router();

// GET /api/tracks — the track list with lesson counts (ids are what /api/catalog?track= takes).
tracksRouter.get("/", (_req, res) => {
  const counts = catalogCounts();
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ tracks: TRACKS.map((t) => ({ ...t, count: counts.get(t.id) ?? 0 })) });
});

const Query = z.object({
  track: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

// GET /api/catalog?track=ai,devops&limit=20&offset=0 — lessons of the given tracks (all tracks if omitted).
catalogRouter.get("/", (req, res) => {
  const q = Query.safeParse(req.query);
  if (!q.success) throw new ApiError(400, "VALIDATION_ERROR", "Invalid catalog query.", { details: q.error.issues });
  const tracks = [...new Set((q.data.track ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  const unknown = tracks.filter((t) => !TRACK_IDS.has(t));
  if (unknown.length) throw new ApiError(400, "VALIDATION_ERROR", `Unknown track: ${unknown.join(", ")}.`, { details: { knownTracks: [...TRACK_IDS] } });
  const { items, total } = listCatalog(tracks, q.data.limit, q.data.offset);
  const titles = new Map(TRACKS.map((t) => [t.id, t.title]));
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    lessons: items.map((i) => ({
      // Same fields as GET /api/lesson-jobs/:id, so the feed can render both the same way.
      jobId: i.id,
      status: "ready",
      lesson: i.lesson,
      videoUrl: i.videoUrl,
      posterUrl: i.videoUrl.replace(/\.mp4$/, ".webp"),
      error: null,
      track: i.track,
      trackTitle: titles.get(i.track),
      position: i.position,
      durationSeconds: i.durationSeconds,
    })),
    total,
    limit: q.data.limit,
    offset: q.data.offset,
  });
});
