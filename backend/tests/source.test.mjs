import { test } from "node:test";
import assert from "node:assert/strict";
import { fragmentOf, toParagraphs } from "../src/lessons/source.ts";

const long = "Предложение о том, как работает система и зачем она нужна. ".repeat(60);

test("splits pages into numbered paragraphs that keep their page", () => {
  const ps = toParagraphs({
    pages: [
      { page: 3, text: "Глава 1\n\n" + "Первый абзац о сути системы, достаточно длинный для урока. ".repeat(5) },
      { page: 4, text: long },
    ],
  });
  assert.ok(ps.length >= 3);
  assert.deepEqual(ps.map((p) => p.n), ps.map((_, i) => i + 1));
  assert.equal(ps[0].page, 3);
  assert.match(ps[0].text, /^Глава 1 Первый абзац/); // short heading merged into the next block
  assert.ok(ps.every((p) => p.text.length <= 2700));
  assert.equal(ps[ps.length - 1].page, 4);
});

test("a single text block is page firstPage", () => {
  const ps = toParagraphs({ sourceText: "Текст конспекта. ".repeat(30), firstPage: 7 });
  assert.equal(ps.length, 1);
  assert.equal(ps[0].page, 7);
});

test("fragmentOf keeps document order, drops unknown numbers and respects the cap", () => {
  const ps = toParagraphs({ pages: [{ page: 1, text: long }, { page: 2, text: long }] });
  const frag = fragmentOf(ps, [ps.length, 1, 999], 100000);
  assert.equal(frag.page, 1);
  assert.ok(frag.text.startsWith(ps[0].text));
  const capped = fragmentOf(ps, ps.map((p) => p.n), 2500);
  assert.ok(capped.text.length <= 2500);
});
