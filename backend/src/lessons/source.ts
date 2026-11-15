// Splits uploaded material (notes or a whole book) into numbered paragraphs that keep their page,
// so the planner can pick lesson fragments by number and each lesson stays grounded in real text.

export interface Paragraph {
  n: number;
  page: number;
  text: string;
}

const MIN_CHARS = 200;
const MAX_CHARS = 1800;

/** Accepts either per-page text or one block of text (treated as page `firstPage`). */
export function toParagraphs(input: { pages?: Array<{ page: number; text: string }>; sourceText?: string; firstPage?: number }): Paragraph[] {
  const pages = input.pages?.length ? input.pages : [{ page: input.firstPage ?? 1, text: input.sourceText ?? "" }];
  const raw: Array<{ page: number; text: string }> = [];
  for (const p of pages) {
    for (const block of p.text.replace(/\r/g, "").split(/\n\s*\n/)) {
      const text = block.replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (text.length <= MAX_CHARS) raw.push({ page: p.page, text });
      else for (const piece of splitLong(text)) raw.push({ page: p.page, text: piece });
    }
  }
  // Merge short blocks (headings, single lines from PDF extraction) into the next one.
  const merged: Array<{ page: number; text: string }> = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && last.text.length < MIN_CHARS && last.text.length + r.text.length + 1 <= MAX_CHARS) last.text = `${last.text} ${r.text}`;
    else merged.push({ ...r });
  }
  return merged.map((m, i) => ({ n: i + 1, page: m.page, text: m.text }));
}

function splitLong(text: string): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > MAX_CHARS) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  // A single sentence longer than the limit is cut hard.
  return out.flatMap((p) => (p.length <= MAX_CHARS * 1.5 ? [p] : p.match(new RegExp(`.{1,${MAX_CHARS}}`, "g")) ?? []));
}

/** Text of the chosen paragraphs, in document order, capped at `maxChars`. */
export function fragmentOf(paragraphs: Paragraph[], numbers: number[], maxChars: number): { text: string; page: number } {
  const chosen = [...new Set(numbers)]
    .sort((a, b) => a - b)
    .map((n) => paragraphs[n - 1])
    .filter((p): p is Paragraph => !!p);
  let text = "";
  for (const p of chosen) {
    if (text.length + p.text.length + 2 > maxChars) break;
    text = text ? `${text}\n\n${p.text}` : p.text;
  }
  return { text, page: chosen[0]?.page ?? 1 };
}
