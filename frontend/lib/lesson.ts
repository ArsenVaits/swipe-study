export type LessonSource = { documentName: string; sourcePage: number; text: string };

export type Lesson = {
  title: string;
  explanation: string;
  narration: string;
  captions: string[];
  quiz: { cloze?: string; question: string; options: string[]; correctIndex: number; explanation: string };
  source: { page: number; quote: string };
};

export const normalizeText = (text: string) => text.replace(/\s+/gu, " ").trim();

export function verifyLesson(lesson: Lesson, source: LessonSource) {
  const quote = normalizeText(lesson.source.quote);
  if (lesson.source.page !== source.sourcePage || !quote || !normalizeText(source.text).includes(quote)) {
    throw new Error("The lesson citation could not be verified against the selected passage.");
  }
  return lesson;
}

export function makeLocalLesson(source: LessonSource): Lesson {
  const text = normalizeText(source.text);
  const words = (value: string) => value.split(" ").filter(Boolean);
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/gu)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  const excerpt = sentences.find((sentence) => words(sentence).length >= 6) || text;
  const quote = words(excerpt).slice(0, 36).join(" ");
  const quoteWords = words(quote);
  const phraseStart = Math.min(quoteWords.length - 3, Math.max(2, Math.floor(quoteWords.length / 2)));
  const answer = quoteWords.slice(phraseStart, phraseStart + 3).join(" ");
  const template = [...quoteWords.slice(0, phraseStart), "_____", ...quoteWords.slice(phraseStart + 3)].join(" ");
  const distractors = new Set<string>();
  for (let index = quoteWords.length - 3; index >= 0 && distractors.size < 2; index -= 3) {
    const phrase = quoteWords.slice(index, index + 3).join(" ");
    if (phrase !== answer) distractors.add(phrase);
  }
  const correctIndex = source.sourcePage % 3;
  for (const fallback of ["A different phrase", "No phrase is missing"]) {
    if (distractors.size < 2) distractors.add(fallback);
  }
  const options = [...distractors];
  options.splice(correctIndex, 0, answer);
  const captionWords = quoteWords.slice(0, 15);
  const captions = [0, 1, 2].map((index) => {
    const start = Math.floor(index * captionWords.length / 3);
    const end = Math.floor((index + 1) * captionWords.length / 3);
    return captionWords.slice(start, end).join(" ");
  });
  const explanation = (sentences.length > 1
    ? words([quote, ...sentences.filter((sentence) => sentence !== excerpt).slice(0, 1)].join(" ")).slice(0, 77).join(" ")
    : quote);
  return verifyLesson({
    title: "Lesson from page " + source.sourcePage,
    explanation,
    narration: words(text).slice(0, 50).join(" "),
    captions,
    quiz: {
      cloze: template,
      question: "Which phrase completes the passage?",
      options,
      correctIndex,
      explanation: "The PDF uses the phrase “" + answer + "” in this passage.",
    },
    source: { page: source.sourcePage, quote },
  }, source);
}
