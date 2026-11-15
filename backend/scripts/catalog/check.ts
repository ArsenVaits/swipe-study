// Validates the hand-written catalog content: lesson schema, icons, lengths that fit the templates.
//   node scripts/catalog/check.ts

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TRACKS } from "../../src/catalog/tracks.ts";
import { BACKEND_DIR } from "../../src/paths.ts";
import { toLesson } from "./build.ts";

const dir = path.join(BACKEND_DIR, "catalog");
const icons = path.join(BACKEND_DIR, "node_modules", "lucide-static", "icons");
let problems = 0;
let total = 0;
const report = (id: string, msg: string) => {
  problems++;
  console.log(`${id}: ${msg}`);
};

for (const track of TRACKS) {
  const file = path.join(dir, `${track.id}.json`);
  if (!existsSync(file)) {
    console.log(`${track.id}: no content yet`);
    continue;
  }
  const entries = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
  if (entries.length !== 20) report(track.id, `${entries.length} lessons, expected 20`);
  const titles = new Set<string>();
  entries.forEach((e, i) => {
    total++;
    const id = `${track.id}-${String(i + 1).padStart(2, "0")}`;
    try {
      toLesson(e as never);
    } catch (err) {
      report(id, `schema: ${err instanceof Error ? err.message.slice(0, 300) : err}`);
      return;
    }
    if (titles.has(e.t as string)) report(id, "duplicate title");
    titles.add(e.t as string);
    if (!existsSync(path.join(icons, `${e.i}.svg`))) report(id, `unknown icon "${e.i}"`);
    const words = (e.n as string).split(/\s+/).length;
    if (words < 65 || words > 135) report(id, `narration has ${words} words`);
    const pts = e.k as string[];
    if (pts.length < 3 || pts.length > 4) report(id, `${pts.length} points`);
    for (const p of pts) if (p.length > 60) report(id, `point too long (${p.length}): ${p}`);
    if ((e.b as string).length > 9) report(id, `big value too long: ${e.b}`);
    if ((e.bl as string).length > 70) report(id, `big label too long: ${e.bl}`);
    if ((e.t as string).length > 48) report(id, `title long (${(e.t as string).length})`);
    if ((e.h as string).length > 90) report(id, `hook long (${(e.h as string).length})`);
  });
}
console.log(`${total} lessons checked, ${problems} problem(s)`);
if (problems) process.exitCode = 1;
