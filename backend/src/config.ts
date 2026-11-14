import { z } from "zod";

// All configuration is read from server-side env vars only.
// Nothing here is ever sent to the browser.

const intFromEnv = (def: number) => z.coerce.number().int().positive().default(def);

const EnvSchema = z.object({
  PORT: intFromEnv(3001),
  DATABASE_PATH: z.string().default("./data/scrolled.db"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPUS_MODEL: z.string().default("claude-opus-5-5"),
  OPUS_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  // true: Opus calls the start_video_generation tool; false: backend starts video from scenePrompt.
  OPUS_TOOL_CALLING: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  VIDEO_PROVIDER: z.enum(["mock", "ltx", "hyperframes"]).default("mock"),
  MOCK_VIDEO_URL: z.string().default("/demo/lesson.mp4"),
  MOCK_VIDEO_DELAY_MS: z.coerce.number().int().nonnegative().default(8000),
  LTX_API_KEY: z.string().optional(),

  // HyperFrames: Opus writes an HTML+GSAP composition, the HyperFrames CLI renders it to MP4.
  HYPERFRAMES_MODEL: z.string().default("claude-opus-5-5"),
  HYPERFRAMES_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  HYPERFRAMES_FPS: z.coerce.number().int().min(24).max(60).default(30),
  HYPERFRAMES_QUALITY: z.enum(["draft", "standard", "high"]).default("standard"),
  HYPERFRAMES_MAX_PARALLEL_RENDERS: intFromEnv(1),
  HYPERFRAMES_RENDER_TIMEOUT_MS: intFromEnv(10 * 60 * 1000),
  // 0..2 rounds where Opus fixes what `hyperframes check` found.
  HYPERFRAMES_FIX_ROUNDS: z.coerce.number().int().min(0).max(2).default(1),
  HYPERFRAMES_KEEP_WORK_DIRS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  HYPERFRAMES_WORK_DIR: z.string().default("./data/hyperframes"),
  VIDEO_OUTPUT_DIR: z.string().default("./data/videos"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),

  // Voiceover for HyperFrames videos.
  TTS_PROVIDER: z.enum(["none", "openai", "elevenlabs"]).default("none"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: z.string().default("coral"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_MODEL: z.string().default("eleven_multilingual_v2"),

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
