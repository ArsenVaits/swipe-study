import { z } from "zod";

// ---------- Request ----------

export const createLessonJobBody = (maxSourceChars: number) =>
  z.object({
    sourceTitle: z.string().trim().min(1).max(200),
    sourcePage: z.number().int().min(1).max(100000),
    sourceText: z.string().trim().min(80, "Select at least a couple of sentences.").max(maxSourceChars),
    sessionId: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/, "sessionId may contain only letters, digits, '_' and '-'."),
  });

export type CreateLessonJobBody = z.infer<ReturnType<typeof createLessonJobBody>>;

/** A whole upload (notes or a book), as one text or per page; the server plans 1..N lessons from it. */
export const createLessonSetBody = (maxChars: number) =>
  z
    .object({
      sourceTitle: z.string().trim().min(1).max(200),
      sessionId: z
        .string()
        .min(8)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/, "sessionId may contain only letters, digits, '_' and '-'."),
      sourceText: z.string().max(maxChars).optional(),
      firstPage: z.number().int().min(1).max(100000).optional(),
      pages: z
        .array(z.object({ page: z.number().int().min(1).max(100000), text: z.string().max(maxChars) }))
        .max(5000)
        .optional(),
    })
    .refine((b) => (b.sourceText?.trim().length ?? 0) > 0 || (b.pages?.length ?? 0) > 0, {
      message: "Send sourceText or pages.",
      path: ["sourceText"],
    })
    .refine((b) => (b.sourceText?.length ?? 0) + (b.pages ?? []).reduce((n, p) => n + p.text.length, 0) <= maxChars, {
      message: `The material is longer than ${maxChars} characters.`,
      path: ["pages"],
    });

export type CreateLessonSetBody = z.infer<ReturnType<typeof createLessonSetBody>>;

// ---------- What Opus returns (structured output) ----------
// Kept to plain types: JSON-schema constraints are enforced afterwards by LessonSchema.

export const LessonDraftSchema = z.object({
  title: z.string(),
  hook: z.string(),
  explanation: z.string(),
  narration: z.string(),
  captions: z.array(z.string()),
  scenePrompt: z.string(),
  quiz: z.object({
    question: z.string(),
    options: z.array(z.string()),
    answerIndex: z.number().int(),
    explanation: z.string(),
  }),
  sourceQuote: z.string(),
});

export const LessonOutputSchema = z.object({
  sourceIsSufficient: z.boolean(),
  insufficientReason: z.string().nullable(),
  lesson: LessonDraftSchema.nullable(),
});

// ---------- Strict validation of the lesson we store and return ----------

export const LessonSchema = z
  .object({
    title: z.string().trim().min(3).max(90),
    hook: z.string().trim().min(5).max(200),
    explanation: z.string().trim().min(40).max(1500),
    narration: z.string().trim().min(20).max(1200),
    captions: z.array(z.string().trim().min(1).max(100)).min(2).max(8),
    scenePrompt: z.string().trim().min(15).max(600),
    quiz: z.object({
      question: z.string().trim().min(5).max(300),
      options: z.array(z.string().trim().min(1).max(200)).min(3).max(4),
      answerIndex: z.number().int().min(0),
      explanation: z.string().trim().min(5).max(500),
    }),
    sourceQuote: z.string().trim().min(1).max(300),
    sourcePage: z.number().int().min(1),
  })
  .refine((l) => l.quiz.answerIndex < l.quiz.options.length, {
    message: "quiz.answerIndex must point to an existing option",
    path: ["quiz", "answerIndex"],
  })
  .refine((l) => new Set(l.quiz.options.map((o) => o.toLowerCase())).size === l.quiz.options.length, {
    message: "quiz.options must be distinct",
    path: ["quiz", "options"],
  });

export type Lesson = z.infer<typeof LessonSchema>;

// ---------- start_video_generation tool input ----------

export const StartVideoInputSchema = z.object({
  scenePrompt: z.string().trim().min(15).max(600),
});
