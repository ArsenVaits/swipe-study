import { z } from "zod";

// All configuration is read from server-side env vars only.
// Nothing here is ever sent to the browser.

const intFromEnv = (def: number) => z.coerce.number().int().positive().default(def);

const EnvSchema = z.object({
  PORT: intFromEnv(3001),
  DATABASE_PATH: z.string().default("./data/scrolled.db"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPUS_MODEL: z.string().default("claude-opus-5-5"),
  OPUS_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  // true: Opus calls the start_video_generation tool; false: backend starts video from scenePrompt.
  OPUS_TOOL_CALLING: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  VIDEO_PROVIDER: z.enum(["mock", "ltx"]).default("mock"),
  MOCK_VIDEO_URL: z.string().default("/demo/lesson.mp4"),
  MOCK_VIDEO_DELAY_MS: z.coerce.number().int().nonnegative().default(8000),
  LTX_API_KEY: z.string().optional(),

  MAX_SOURCE_CHARS: intFromEnv(12000),
  MAX_LESSON_JOBS_PER_SESSION: intFromEnv(20),
  MAX_VIDEO_JOBS_PER_SESSION: intFromEnv(5),
  MAX_VIDEO_JOBS_TOTAL: intFromEnv(50),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
