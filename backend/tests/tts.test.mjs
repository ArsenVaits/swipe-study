import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PIPER_MODEL = "russian.onnx";
process.env.PIPER_ENGLISH_MODEL = "english.onnx";
const { piperModelForNarration } = await import("../src/tts/index.ts");

test("Piper chooses the English model for English narration", () => {
  assert.equal(piperModelForNarration("A variable lets a program give a value a name. You can reuse that name throughout a function and choose a descriptive name to make the code easier to read."), "english.onnx");
});

test("Piper keeps the existing model for Russian narration with English terms and other languages", () => {
  assert.equal(piperModelForNarration("В JavaScript функция может принять параметры count и limit. Область видимости определяет, где эти переменные можно использовать."), "russian.onnx");
  assert.equal(piperModelForNarration("Una función puede recibir argumentos y devolver un resultado. Elige un nombre descriptivo para que otras personas puedan entender el código."), "russian.onnx");
});
