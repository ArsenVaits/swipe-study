// Builds the ready-made catalog videos from hand-written lessons (backend/catalog/<track>.json).
// No model is called: voice is the server's TTS (Piper), the picture is one of the six templates.
//
//   node --env-file=<env> scripts/catalog/build.ts --out <dir> [--track ai] [--limit 2] [--parallel 2] [--keep]
//
// Writes <out>/<id>.mp4 and <out>/<id>.json (lesson + track + duration); already built ids are skipped.

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { TRACKS } from "../../src/catalog/tracks.ts";
import { LessonSchema, type Lesson } from "../../src/lessons/schema.ts";
import { BACKEND_DIR } from "../../src/paths.ts";
import { buildVoiceover } from "../../src/tts/index.ts";
import { addFinishingLayer } from "../../src/video/hyperframes/finish.ts";
import { inlineIcons } from "../../src/video/hyperframes/icons.ts";
import { addFontFaces, copyKit } from "../../src/video/hyperframes/kit.ts";
import { finish, render, verify } from "../../src/video/hyperframes/render.ts";
import { compose, STYLES, type CatalogItem } from "./templates.ts";

const CONTENT_DIR = path.join(BACKEND_DIR, "catalog");
const GSAP_FILE = path.join(BACKEND_DIR, "node_modules", "gsap", "dist", "gsap.min.js");

interface Entry {
  t: string; // title
  h: string; // hook
  n: string; // narration
  k: string[]; // key points (3-4)
  i: string; // lucide icon
  b: string; // big accent value
  bl: string; // caption under the big value
  q: string; // quiz question
  o: string[]; // options
  a: number; // answer index
  e: string; // quiz explanation
}

export interface CatalogMeta {
  id: string;
  track: string;
  position: number;
  style: string;
  durationSeconds: number;
  lesson: Lesson;
}

export function toLesson(e: Entry): Lesson {
  return LessonSchema.parse({
    title: e.t,
    hook: e.h,
    explanation: e.n,
    narration: e.n,
    captions: e.k,
    scenePrompt: `Catalog video: ${e.t}`,
    quiz: { question: e.q, options: e.o, answerIndex: e.a, explanation: e.e },
    sourceQuote: e.h,
    sourcePage: 1,
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      track: { type: "string" },
      limit: { type: "string" },
      parallel: { type: "string", default: "2" },
      keep: { type: "boolean", default: false },
      "html-only": { type: "boolean", default: false },
    },
  });
  if (!values.out) throw new Error("--out is required");
  const out = path.resolve(values.out);
  await mkdir(out, { recursive: true });

  const jobs: Array<{ id: string; track: (typeof TRACKS)[number]; trackIndex: number; position: number; entry: Entry; lesson: Lesson }> = [];
  const files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith(".json"));
  for (const [trackIndex, track] of TRACKS.entries()) {
    if (values.track && values.track !== track.id) continue;
    if (!files.includes(`${track.id}.json`)) continue;
    const entries = JSON.parse(await readFile(path.join(CONTENT_DIR, `${track.id}.json`), "utf8")) as Entry[];
    const limit = values.limit ? Number(values.limit) : entries.length;
    entries.slice(0, limit).forEach((entry, i) => {
      const id = `${track.id}-${String(i + 1).padStart(2, "0")}`;
      try {
        jobs.push({ id, track, trackIndex, position: i + 1, entry, lesson: toLesson(entry) });
      } catch (err) {
        console.error(`[catalog] ${id}: invalid lesson`, err instanceof Error ? err.message : err);
      }
    });
  }
  console.log(`[catalog] ${jobs.length} lesson(s) to check`);

  let next = 0;
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const mp4 = path.join(out, `${job.id}.mp4`);
      if (!values["html-only"] && (await stat(mp4).catch(() => null))?.size) continue;
      const started = Date.now();
      const workDir = path.join(out, "work", job.id);
      try {
        await rm(workDir, { recursive: true, force: true });
        const assets = path.join(workDir, "assets");
        await mkdir(assets, { recursive: true });
        await copyFile(GSAP_FILE, path.join(assets, "gsap.min.js"));
        await copyKit(assets);
        const voice = await buildVoiceover(job.lesson.narration, assets);
        // Every track gets all six styles; neighbouring tracks start on different ones.
        const style = STYLES[(job.trackIndex * 2 + job.position - 1) % STYLES.length]!;
        const item: CatalogItem = { title: job.entry.t, hook: job.entry.h, points: job.entry.k, icon: job.entry.i, big: job.entry.b, bigLabel: job.entry.bl };
        const raw = compose(style, { item, voice, accent: job.track.color, trackName: job.track.title, number: job.position });
        const { html, missing } = inlineIcons(raw);
        if (missing.length) console.warn(`[catalog] ${job.id}: unknown icon(s) ${missing.join(", ")}`);
        await writeFile(path.join(workDir, "index.html"), addFontFaces(addFinishingLayer(html, voice.duration)));
        if (values["html-only"]) {
          console.log(`[catalog] ${job.id}: html ready (${style}, ${voice.duration.toFixed(1)} s) ${workDir}`);
          continue;
        }
        const rawMp4 = path.join(workDir, "render.mp4");
        if (!(await render(workDir, rawMp4))) throw new Error("render failed");
        const finalMp4 = path.join(workDir, "final.mp4");
        await finish(rawMp4, finalMp4, !!voice.file);
        await verify(finalMp4, voice.duration);
        await copyFile(finalMp4, mp4);
        const meta: CatalogMeta = { id: job.id, track: job.track.id, position: job.position, style, durationSeconds: voice.duration, lesson: job.lesson };
        await writeFile(path.join(out, `${job.id}.json`), JSON.stringify(meta, null, 2));
        if (!values.keep) await rm(workDir, { recursive: true, force: true });
        done++;
        console.log(`[catalog] ${job.id}: ok (${style}, ${voice.duration.toFixed(1)} s video, built in ${((Date.now() - started) / 1000).toFixed(0)} s) — ${done} done`);
      } catch (err) {
        failed++;
        console.error(`[catalog] ${job.id}: FAILED`, err instanceof Error ? err.message : err, `(work dir kept: ${workDir})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(values.parallel)) }, worker));
  console.log(`[catalog] finished: ${done} built, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
