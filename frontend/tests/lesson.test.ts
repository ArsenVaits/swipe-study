import assert from "node:assert/strict";
import { test } from "node:test";
import { makeLocalLesson, verifyLesson } from "../lib/lesson";
import { sampleLesson, samplePages } from "../lib/sample";

test("local lessons quote only the selected passage and preserve its page number", () => {
  const text = "A weekly review starts by listing completed tasks. Group unfinished items by priority and assign a next action.";
  const lesson = makeLocalLesson({ documentName: "Review.pdf", sourcePage: 4, text });
  assert.equal(lesson.source.page, 4);
  assert.ok(text.includes(lesson.source.quote));
  assert.equal(lesson.quiz.options.length, 3);
  assert.ok(text.includes(lesson.quiz.options[lesson.quiz.correctIndex]));
});

test("lesson citations are verified against the passage and page", () => {
  const source = { documentName: "Sample.pdf", sourcePage: 1, text: samplePages[0].text };
  assert.doesNotThrow(() => verifyLesson(sampleLesson, source));
  assert.throws(() => verifyLesson({ ...sampleLesson, source: { page: 1, quote: "This phrase is absent." } }, source));
  assert.throws(() => verifyLesson({ ...sampleLesson, source: { ...sampleLesson.source, page: 2 } }, source));
});
