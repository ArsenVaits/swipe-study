// Loads built catalog videos into the database and the media folder.
//   node --env-file=<backend env> scripts/catalog/import.ts <build-out-dir>
// Copies <id>.mp4 to <VIDEO_OUTPUT_DIR>/catalog/ and upserts the lesson with its track id.

import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { TRACKS } from "../../src/catalog/tracks.ts";
import { config } from "../../src/config.ts";
import { upsertCatalogLesson } from "../../src/db.ts";
import { LessonSchema } from "../../src/lessons/schema.ts";
import { MEDIA_URL_PREFIX } from "../../src/video/hyperframes/provider.ts";
import type { CatalogMeta } from "./build.ts";

const src = process.argv[2];
if (!src) throw new Error("usage: import.ts <build-out-dir>");
const outDir = path.join(config.VIDEO_OUTPUT_DIR, "catalog");
await mkdir(outDir, { recursive: true });
const rank = new Map(TRACKS.map((t, i) => [t.id, i]));

let imported = 0;
for (const f of (await readdir(src)).filter((n) => n.endsWith(".json")).sort()) {
  const meta = JSON.parse(await readFile(path.join(src, f), "utf8")) as CatalogMeta;
  const mp4 = path.join(src, `${meta.id}.mp4`);
  const size = (await stat(mp4).catch(() => null))?.size;
  if (!size || !rank.has(meta.track)) {
    console.warn(`[import] skip ${meta.id}: ${size ? "unknown track" : "no video"}`);
    continue;
  }
  const target = path.join(outDir, `${meta.id}.mp4`);
  if ((await stat(target).catch(() => null))?.size !== size) await copyFile(mp4, target);
  upsertCatalogLesson({
    id: meta.id,
    track: meta.track,
    trackRank: rank.get(meta.track)!,
    position: meta.position,
    lesson: LessonSchema.parse(meta.lesson),
    videoUrl: `${MEDIA_URL_PREFIX}/catalog/${meta.id}.mp4`,
    durationSeconds: meta.durationSeconds,
  });
  imported++;
}
console.log(`[import] ${imported} catalog lesson(s) in the database, videos in ${outDir}`);
