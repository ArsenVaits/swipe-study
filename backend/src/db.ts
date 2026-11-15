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
  CREATE TABLE IF NOT EXISTS lesson_sets (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    status        TEXT NOT NULL,
    source_title  TEXT NOT NULL,
    source_chars  INTEGER NOT NULL,
    planned       INTEGER,
    titles_json   TEXT,
    error_code    TEXT,
    error_message TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lesson_sets_session ON lesson_sets(session_id);
`);
// Additive migration: lessons that belong to a series.
{
  const cols = (db.prepare("PRAGMA table_info(lesson_jobs)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("set_id")) db.exec("ALTER TABLE lesson_jobs ADD COLUMN set_id TEXT");
  if (!cols.includes("set_index")) db.exec("ALTER TABLE lesson_jobs ADD COLUMN set_index INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_lesson_jobs_set ON lesson_jobs(set_id, set_index)");
}

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
  setId: string | null;
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
    setId: (r.set_id as string) ?? null,
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
  setId?: string;
  setIndex?: number;
}): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO lesson_jobs (id, session_id, status, source_title, source_page, source_chars, set_id, set_index, created_at, updated_at)
     VALUES (?, ?, 'generating_lesson', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(job.id, job.sessionId, job.sourceTitle, job.sourcePage, job.sourceChars, job.setId ?? null, job.setIndex ?? null, now, now);
}

export function getJob(id: string): JobRecord | null {
  const row = db.prepare("SELECT * FROM lesson_jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : null;
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

// ---------- Lesson series (one upload → 1..N lessons) ----------

export type SetStatus = "planning" | "generating" | "done" | "failed";

export interface SetRecord {
  id: string;
  sessionId: string;
  status: SetStatus;
  sourceTitle: string;
  sourceChars: number;
  planned: number | null;
  titles: string[];
  error: { code: string; message: string } | null;
  createdAt: number;
  updatedAt: number;
}

export function insertSet(set: { id: string; sessionId: string; sourceTitle: string; sourceChars: number }): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO lesson_sets (id, session_id, status, source_title, source_chars, created_at, updated_at)
     VALUES (?, ?, 'planning', ?, ?, ?, ?)`,
  ).run(set.id, set.sessionId, set.sourceTitle, set.sourceChars, now, now);
}

export function getSet(id: string): SetRecord | null {
  const r = db.prepare("SELECT * FROM lesson_sets WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    status: r.status as SetStatus,
    sourceTitle: r.source_title as string,
    sourceChars: r.source_chars as number,
    planned: (r.planned as number) ?? null,
    titles: r.titles_json ? (JSON.parse(r.titles_json as string) as string[]) : [],
    error: r.error_code ? { code: r.error_code as string, message: (r.error_message as string) ?? "" } : null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export function updateSet(
  id: string,
  patch: { status?: SetStatus; planned?: number; titles?: string[]; error?: { code: string; message: string } | null },
): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.planned !== undefined) set("planned", patch.planned);
  if (patch.titles !== undefined) set("titles_json", JSON.stringify(patch.titles));
  if (patch.error !== undefined) {
    set("error_code", patch.error?.code ?? null);
    set("error_message", patch.error?.message ?? null);
  }
  set("updated_at", Date.now());
  values.push(id);
  db.prepare(`UPDATE lesson_sets SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function jobIdsForSet(setId: string): string[] {
  return (db.prepare("SELECT id FROM lesson_jobs WHERE set_id = ? ORDER BY set_index").all(setId) as Row[]).map((r) => r.id as string);
}

/** Series still planning or generating when the server starts were cut off by a restart. */
export function failInterruptedSets(): number {
  const r = db
    .prepare(
      `UPDATE lesson_sets SET status = 'failed', error_code = 'INTERRUPTED',
         error_message = 'The server restarted while this series was being generated. Lessons already made are kept.',
         updated_at = ? WHERE status IN ('planning', 'generating')`,
    )
    .run(Date.now());
  return Number(r.changes);
}

/** A browser session's lessons for the feed: newest upload first, a series' lessons in plan order. */
export function listJobsForSession(sessionId: string, limit: number): JobRecord[] {
  const rows = db
    .prepare(
      `SELECT j.* FROM lesson_jobs j LEFT JOIN lesson_sets s ON s.id = j.set_id
       WHERE j.session_id = ?
       ORDER BY COALESCE(s.created_at, j.created_at) DESC, COALESCE(j.set_index, 0) ASC
       LIMIT ?`,
    )
    .all(sessionId, limit) as Row[];
  return rows.map(fromRow);
}

/** Series of a session that are still planning or generating lessons. */
export function openSetIdsForSession(sessionId: string): string[] {
  return (
    db
      .prepare("SELECT id FROM lesson_sets WHERE session_id = ? AND status IN ('planning', 'generating') ORDER BY created_at DESC")
      .all(sessionId) as Row[]
  ).map((r) => r.id as string);
}

// ---------- Ready-made catalog (hand-written lessons with pre-rendered videos, grouped by track) ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS catalog_lessons (
    id               TEXT PRIMARY KEY,
    track            TEXT NOT NULL,
    track_rank       INTEGER NOT NULL,
    position         INTEGER NOT NULL,
    lesson_json      TEXT NOT NULL,
    video_url        TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_catalog_track ON catalog_lessons(track, position);
  CREATE INDEX IF NOT EXISTS idx_catalog_feed ON catalog_lessons(position, track_rank);
`);

export interface CatalogRecord {
  id: string;
  track: string;
  position: number;
  lesson: Lesson;
  videoUrl: string;
  durationSeconds: number;
}

export function upsertCatalogLesson(r: CatalogRecord & { trackRank: number }): void {
  db.prepare(
    `INSERT INTO catalog_lessons (id, track, track_rank, position, lesson_json, video_url, duration_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET track = excluded.track, track_rank = excluded.track_rank, position = excluded.position,
       lesson_json = excluded.lesson_json, video_url = excluded.video_url, duration_seconds = excluded.duration_seconds`,
  ).run(r.id, r.track, r.trackRank, r.position, JSON.stringify(r.lesson), r.videoUrl, r.durationSeconds, Date.now());
}

/**
 * Catalog lessons, optionally limited to some tracks. One track: in lesson order.
 * Several or all tracks: interleaved (lesson 1 of every track, then lesson 2, …) so the feed mixes topics.
 */
export function listCatalog(tracks: string[], limit: number, offset: number): { items: CatalogRecord[]; total: number } {
  const where = tracks.length ? `WHERE track IN (${tracks.map(() => "?").join(", ")})` : "";
  const rows = db
    .prepare(`SELECT * FROM catalog_lessons ${where} ORDER BY position, track_rank LIMIT ? OFFSET ?`)
    .all(...tracks, limit, offset) as Row[];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM catalog_lessons ${where}`).get(...tracks) as Row).n as number;
  return {
    items: rows.map((r) => ({
      id: r.id as string,
      track: r.track as string,
      position: r.position as number,
      lesson: JSON.parse(r.lesson_json as string) as Lesson,
      videoUrl: r.video_url as string,
      durationSeconds: r.duration_seconds as number,
    })),
    total,
  };
}

export function catalogCounts(): Map<string, number> {
  const rows = db.prepare("SELECT track, COUNT(*) AS n FROM catalog_lessons GROUP BY track").all() as Row[];
  return new Map(rows.map((r) => [r.track as string, r.n as number]));
}
