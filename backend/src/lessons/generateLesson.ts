import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "../config.ts";
import { ApiError } from "../http/errors.ts";
import { LessonOutputSchema, LessonSchema, StartVideoInputSchema, type Lesson } from "./schema.ts";

/** ~35 s of speech; shorter narrations are sent back once for a longer version. */
const MIN_NARRATION_WORDS = 85;

// API key is read by the SDK from ANTHROPIC_API_KEY (server env only).
const client = new Anthropic({ timeout: 120_000, maxRetries: 1 });

const SYSTEM_PROMPT = `You turn a short excerpt from a document a learner uploaded into one bite-sized micro-lesson for busy adults, plus a one-question quiz.

Grounding rules:
- Use only the information in the <source_text>. Do not add facts, numbers, names, studies or examples that the source does not support. You may rephrase and simplify.
- If the excerpt is too short, fragmentary or off-topic to teach one clear idea, set sourceIsSufficient to false, give a one-sentence insufficientReason, and set lesson to null. Do not call any tool in that case.
- Write the lesson in the same language as the source text.

Lesson fields:
- title: under 70 characters. hook: one sentence, the key takeaway.
- explanation: 2-4 short paragraphs in plain language, under 1200 characters.
- narration: a voiceover script of 40-55 seconds that a narrator reads aloud: 100-130 words, never fewer than 90. It explains the idea step by step, not just the hook.
- captions: 3-6 short on-screen captions (under 90 characters each) that follow the narration.
- scenePrompt: one visual metaphor for the idea, described as a cinematic shot (subject, setting, camera motion, mood). Vertical 9:16 framing, about 6 seconds. No text, letters, logos, brands or real people.
- quiz: one question testing understanding (not trivia), 3 or 4 distinct options, exactly one correct; answerIndex is its 0-based index; explanation says why it is correct, citing the source idea.
- sourceQuote: a verbatim quote from the source text, at most 200 characters, that best supports the lesson.`;

const START_VIDEO_TOOL: Anthropic.Beta.BetaTool = {
  name: "start_video_generation",
  description:
    "Starts rendering the short vertical background video for this lesson. Call it exactly once, as soon as you know the visual scene, before writing the final lesson JSON. Pass the same scene you will put in the lesson's scenePrompt. Rendering runs in the background; the result only tells you whether it started.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      scenePrompt: {
        type: "string",
        description: "Cinematic description of one visual metaphor: subject, setting, camera motion, mood. No text, logos or real people.",
      },
    },
    required: ["scenePrompt"],
    additionalProperties: false,
  },
};

export interface GenerateLessonInput {
  sourceTitle: string;
  sourcePage: number;
  sourceText: string;
  /** Set when the lesson is one of a series planned from larger material. */
  focus?: { title: string; question: string; otherLessons: string[] };
  /** Called when Opus requests video generation. Returns the text for the tool_result. */
  onStartVideo?: (scenePrompt: string) => Promise<{ ok: boolean; message: string }>;
}

export async function generateLesson(input: GenerateLessonInput): Promise<Lesson> {
  if (!config.ANTHROPIC_API_KEY) {
    throw new ApiError(503, "AI_NOT_CONFIGURED", "Lesson generation is not configured on the server (ANTHROPIC_API_KEY is not set).");
  }

  const useTools = config.OPUS_TOOL_CALLING && !!input.onStartVideo;
  // Only the selected fragment and minimal source context are sent — never the whole PDF.
  const userContent =
    `<source_title>${escapeXml(input.sourceTitle)}</source_title>\n` +
    `<source_page>${input.sourcePage}</source_page>\n` +
    `<source_text>\n${escapeXml(input.sourceText)}\n</source_text>\n\n` +
    (input.focus
      ? `This lesson is one of a series made from a larger document. Answer only this question: "${input.focus.question}" ` +
        `(working title: "${input.focus.title}").` +
        (input.focus.otherLessons.length
          ? ` Other lessons in the series cover: ${input.focus.otherLessons.map((t) => `"${t}"`).join(", ")}; do not repeat them.`
          : "") +
        "\n\n"
      : "") +
    (useTools
      ? "Create the micro-lesson. If the source is sufficient, first call start_video_generation with the scene, then return the lesson JSON."
      : "Create the micro-lesson and return it as JSON.");

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userContent }];
  let videoRequested = false;

  // Small manual tool loop: normally 2 requests (tool call, then final JSON). Hard cap avoids runaway cost.
  for (let turn = 0; turn < 3; turn++) {
    const response = await callOpus(messages, useTools);
    logUsage("lesson", response);

    if (response.stop_reason === "refusal") {
      throw new ApiError(422, "LESSON_REFUSED", "The AI declined to create a lesson from this text.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new ApiError(502, "LESSON_GENERATION_FAILED", "The AI response was cut off. Try a shorter selection.");
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        results.push(await runTool(block, videoRequested, input.onStartVideo));
        if (block.name === START_VIDEO_TOOL.name) videoRequested = true;
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const lesson = parseLesson(response, input);
    // Videos must run at least ~35 s, so a too-short narration gets one rewrite (cheap with Haiku).
    const words = lesson.narration.split(/\s+/).filter(Boolean).length;
    if (words >= MIN_NARRATION_WORDS) return lesson;
    console.warn(`[lesson] narration has ${words} words, asking for a longer one`);
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: `The narration has only ${words} words. Return the complete lesson JSON again with a narration of 100-130 words (40-55 seconds), keeping everything grounded in the source.`,
    });
    const retry = await callOpus(messages, false);
    logUsage("lesson-retry", retry);
    if (retry.stop_reason !== "end_turn") return lesson;
    try {
      const longer = parseLesson(retry, input);
      return longer.narration.length > lesson.narration.length ? longer : lesson;
    } catch {
      return lesson;
    }
  }
  throw new ApiError(502, "LESSON_GENERATION_FAILED", "The AI did not finish the lesson. Please try again.");
}

/** Token usage per Opus call, for cost tracking (no content is logged). */
export function logUsage(kind: string, response: Anthropic.Beta.BetaMessage): void {
  const u = response.usage;
  const thinking = (u as { output_tokens_details?: { thinking_tokens?: number } }).output_tokens_details?.thinking_tokens;
  console.log(
    `[opus:usage] ${kind} model=${response.model} stop=${response.stop_reason} in=${u.input_tokens} out=${u.output_tokens}` +
      `${thinking !== undefined ? ` thinking=${thinking}` : ""}` +
      ` cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`,
  );
}

async function callOpus(messages: Anthropic.Beta.BetaMessageParam[], useTools: boolean) {
  try {
    return await client.beta.messages.create({
      model: config.OPUS_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      ...(useTools ? { tools: [START_VIDEO_TOOL] } : {}),
      output_config: { effort: config.OPUS_EFFORT, format: betaZodOutputFormat(LessonOutputSchema) },
      // Server-side refusal fallback: if Opus declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      console.error("[opus] auth error:", err.status);
      throw new ApiError(503, "AI_NOT_CONFIGURED", "The server's AI credentials were rejected.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ApiError(503, "LESSON_GENERATION_FAILED", "The AI service is busy. Try again in a minute.");
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("[opus] bad request:", err.message);
      throw new ApiError(502, "LESSON_GENERATION_FAILED", "Lesson generation failed.");
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ApiError(502, "LESSON_GENERATION_FAILED", "Could not reach the AI service. Try again.");
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[opus] API error:", err.status, err.message);
      throw new ApiError(502, "LESSON_GENERATION_FAILED", "Lesson generation failed.");
    }
    throw err;
  }
}

async function runTool(
  block: Anthropic.Beta.BetaToolUseBlock,
  alreadyRequested: boolean,
  onStartVideo: GenerateLessonInput["onStartVideo"],
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const result = (content: string, isError = false): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content,
    ...(isError ? { is_error: true } : {}),
  });

  if (block.name !== START_VIDEO_TOOL.name || !onStartVideo) return result(`Unknown tool: ${block.name}`, true);
  if (alreadyRequested) return result("Video generation was already started for this lesson. Do not call it again.", true);

  const parsed = StartVideoInputSchema.safeParse(block.input);
  if (!parsed.success) return result("Invalid scenePrompt: it must be 15-600 characters.", true);

  const { ok, message } = await onStartVideo(parsed.data.scenePrompt);
  return result(ok ? message : `${message} Continue and return the lesson JSON anyway.`, !ok);
}

function parseLesson(response: Anthropic.Beta.BetaMessage, input: GenerateLessonInput): Lesson {
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let output;
  try {
    output = LessonOutputSchema.parse(JSON.parse(text));
  } catch {
    console.error("[opus] unparseable output:", text.slice(0, 500));
    throw new ApiError(502, "LESSON_GENERATION_FAILED", "The AI returned a lesson in an unexpected format.");
  }

  if (!output.sourceIsSufficient || !output.lesson) {
    throw new ApiError(
      422,
      "INSUFFICIENT_SOURCE",
      output.insufficientReason?.trim() || "The selected text does not contain enough information for a lesson.",
    );
  }

  const candidate = {
    ...output.lesson,
    sourceQuote: groundQuote(output.lesson.sourceQuote, input.sourceText),
    sourcePage: input.sourcePage, // trust the request, not the model
  };
  const checked = LessonSchema.safeParse(candidate);
  if (!checked.success) {
    console.error("[opus] lesson failed validation:", checked.error.issues);
    throw new ApiError(502, "LESSON_GENERATION_FAILED", "The AI returned an invalid lesson.", {
      details: checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  return checked.data;
}

/** Keep the model's quote only if it really appears in the source; otherwise use the source's opening. */
function groundQuote(quote: string, source: string): string {
  const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
  const q = quote.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (q.length > 0 && q.length <= 300 && norm(source).includes(norm(q))) return q;

  const flat = source.replace(/\s+/g, " ").trim();
  const sentence = flat.match(/^.{20,200}?[.!?](\s|$)/)?.[0].trim();
  return sentence ?? (flat.length > 200 ? `${flat.slice(0, 197)}...` : flat);
}

/** Stop user text from closing our XML-ish delimiters; leave everything else verbatim so quotes still match. */
function escapeXml(s: string): string {
  return s.replace(/<\/?\s*source_(text|title|page)\s*>/gi, " ");
}
