// Find/replace edit blocks: the model fixes its composition with small targeted edits
// instead of re-typing the whole document (5-14k output tokens → a few hundred).
//
//   <<<<<<< FIND
//   exact text from the current document
//   =======
//   replacement text
//   >>>>>>> REPLACE

export interface Edit {
  find: string;
  replace: string;
}

export const EDIT_FORMAT_HELP = `Reply with edit blocks, not the full document:
<<<<<<< FIND
(exact text copied from your current HTML: a few complete lines, unique in the document)
=======
(the replacement text)
>>>>>>> REPLACE
Use as many blocks as needed. Your current HTML is your last complete document with every edit you sent since then applied. Each FIND must match exactly one place. To add something, FIND a nearby line and REPLACE it with that line plus the addition. Only if the change rewrites most of the document, reply with the complete HTML document instead.`;

const BLOCK = /<{7} FIND[ \t]*\r?\n([\s\S]*?)\r?\n={7}[ \t]*\r?\n([\s\S]*?)\r?\n?>{7} REPLACE/g;

export function parseEdits(text: string): Edit[] {
  const edits: Edit[] = [];
  for (const m of text.matchAll(BLOCK)) {
    const find = m[1] ?? "";
    if (find.trim()) edits.push({ find, replace: m[2] ?? "" });
  }
  return edits;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Applies edits in order. An edit applies when its FIND matches exactly once, first verbatim,
 * then ignoring differences in whitespace. Ambiguous or missing matches are reported, not guessed.
 */
export function applyEdits(doc: string, edits: Edit[]): { doc: string; applied: number; failed: string[] } {
  let out = doc;
  let applied = 0;
  const failed: string[] = [];
  for (const e of edits) {
    const exact = out.split(e.find).length - 1;
    if (exact === 1) {
      out = out.replace(e.find, () => e.replace);
      applied++;
      continue;
    }
    if (exact === 0) {
      const loose = new RegExp(
        e.find
          .trim()
          .split(/\s+/)
          .map(escapeRe)
          .join("\\s+"),
        "g",
      );
      const hits = [...out.matchAll(loose)];
      if (hits.length === 1) {
        out = out.replace(loose, () => e.replace.trim());
        applied++;
        continue;
      }
    }
    failed.push(e.find.trim().split("\n")[0]!.slice(0, 80));
  }
  return { doc: out, applied, failed };
}
