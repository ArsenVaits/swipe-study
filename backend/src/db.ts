import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import type { Lesson } from "./lessons/schema.ts";

// Single-file SQLite (built into Node, no native deps). Fine for a single-instance demo;
// not suitable for several server replicas writing to the same file.

mkdirSync(path.dirname(path.resolve(config.DATABASE_PATH)), { recursive: true });
const db = new DatabaseSync(config.DATABASE_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS lesson_jobs (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    status              TEXT NOT NULL,
    source_title        TEXT NOT NULL,
    source_page         INTEGER NOT NULL,
    source_chars        INTEGER NOT NULL,
    lesson_json         TEXT,
    video_provider      TEXT,
    provider_job_id     TEXT,
    video_url           TEXT,
    error_stage         TEXT,
    error_code          TEXT,
    error_message       TEXT,
    provider_checked_at INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lesson_jobs_session ON lesson_jobs(session_id);
  CREATE TABLE IF NOT EXISTS published_videos (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL UNIQUE,
    topic TEXT NOT NULL,
    published_at INTEGER NOT NULL
  );
`);

export type JobStatus = "generating_lesson" | "rendering_video" | "ready" | "failed";
export type ErrorStage = "lesson" | "video";

export interface JobRecord {
  id: string;
  sessionId: string;
  status: JobStatus;
  sourceTitle: string;
  sourcePage: number;
  sourceChars: number;
  lesson: Lesson | null;
  videoProvider: string | null;
  providerJobId: string | null;
  videoUrl: string | null;
  error: { stage: ErrorStage; code: string; message: string } | null;
  providerCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

type Row = Record<string, string | number | null>;

function fromRow(r: Row): JobRecord {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    status: r.status as JobStatus,
    sourceTitle: r.source_title as string,
    sourcePage: r.source_page as number,
    sourceChars: r.source_chars as number,
    lesson: r.lesson_json ? (JSON.parse(r.lesson_json as string) as Lesson) : null,
    videoProvider: (r.video_provider as string) ?? null,
    providerJobId: (r.provider_job_id as string) ?? null,
    videoUrl: (r.video_url as string) ?? null,
    error: r.error_code
      ? { stage: r.error_stage as ErrorStage, code: r.error_code as string, message: (r.error_message as string) ?? "" }
      : null,
    providerCheckedAt: (r.provider_checked_at as number) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export function insertJob(job: {
  id: string;
  sessionId: string;
  sourceTitle: string;
  sourcePage: number;
  sourceChars: number;
}): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO lesson_jobs (id, session_id, status, source_title, source_page, source_chars, created_at, updated_at)
     VALUES (?, ?, 'generating_lesson', ?, ?, ?, ?, ?)`,
  ).run(job.id, job.sessionId, job.sourceTitle, job.sourcePage, job.sourceChars, now, now);
}

export function getJob(id: string): JobRecord | null {
  const row = db.prepare("SELECT * FROM lesson_jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

const publishedVideoQuery = `
  SELECT p.id, p.topic, p.published_at AS publishedAt,
         json_extract(j.lesson_json, '$.title') AS title, j.video_url AS video
  FROM published_videos p JOIN lesson_jobs j ON j.id = p.job_id
  WHERE j.status = 'ready' AND j.video_url IS NOT NULL
`;

export function listPublishedVideos() {
  return db.prepare(publishedVideoQuery + " ORDER BY p.published_at DESC LIMIT 120").all();
}

export function getPublishedVideo(id: string) {
  return db.prepare(publishedVideoQuery + " AND p.id = ?").get(id);
}

export function setVideoPublication(jobId: string, sessionId: string, publicationId: string, topic: string | null) {
  const job = getJob(jobId);
  if (!job || job.sessionId !== sessionId) return false;
  if (topic === null) {
    db.prepare("DELETE FROM published_videos WHERE job_id = ?").run(jobId);
    return true;
  }
  if (job.status !== "ready" || !job.videoUrl || !job.lesson) return false;
  db.prepare(`
    INSERT INTO published_videos (id, job_id, topic, published_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET topic = excluded.topic
  `).run(publicationId, jobId, topic, Date.now());
  return true;
}

export function getVideoPublication(jobId: string, sessionId: string) {
  return db.prepare(`
    SELECT p.topic FROM published_videos p JOIN lesson_jobs j ON j.id = p.job_id
    WHERE p.job_id = ? AND j.session_id = ?
  `).get(jobId, sessionId)?.topic ?? null;
}

export interface JobPatch {
  status?: JobStatus;
  lesson?: Lesson;
  videoProvider?: string;
  providerJobId?: string;
  videoUrl?: string | null;
  error?: { stage: ErrorStage; code: string; message: string } | null;
  providerCheckedAt?: number;
}

export function updateJob(id: string, patch: JobPatch): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.lesson !== undefined) set("lesson_json", JSON.stringify(patch.lesson));
  if (patch.videoProvider !== undefined) set("video_provider", patch.videoProvider);
  if (patch.providerJobId !== undefined) set("provider_job_id", patch.providerJobId);
  if (patch.videoUrl !== undefined) set("video_url", patch.videoUrl);
  if (patch.providerCheckedAt !== undefined) set("provider_checked_at", patch.providerCheckedAt);
  if (patch.error !== undefined) {
    set("error_stage", patch.error?.stage ?? null);
    set("error_code", patch.error?.code ?? null);
    set("error_message", patch.error?.message ?? null);
  }
  set("updated_at", Date.now());
  values.push(id);
  db.prepare(`UPDATE lesson_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function countJobsForSession(sessionId: string): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM lesson_jobs WHERE session_id = ?").get(sessionId) as Row;
  return r.n as number;
}

export function countVideoStartsForSession(sessionId: string): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM lesson_jobs WHERE session_id = ? AND provider_job_id IS NOT NULL")
    .get(sessionId) as Row;
  return r.n as number;
}

export function countVideoStartsForProvider(provider: string): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM lesson_jobs WHERE video_provider = ? AND provider_job_id IS NOT NULL")
    .get(provider) as Row;
  return r.n as number;
}
