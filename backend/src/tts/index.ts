import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { config } from "../config.ts";

// Voiceover for generated videos. Every provider returns raw PCM (24 kHz, 16-bit, mono),
// so lines can be glued together with exact timings and written as one WAV.

const SAMPLE_RATE = 24_000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
/** Silence before the first line: frame 0 is the thumbnail, the title is already on screen. */
const LEAD_IN_S = 0.6;
const GAP_S = 0.25;
/** Hold after the last line so the final frame can be read. */
const TAIL_S = 1.6;
/** Reading speed used for timings when there is no voice. */
const SILENT_CHARS_PER_S = 14;

export interface VoiceLine {
  text: string;
  /** Seconds from the start of the video. */
  start: number;
  end: number;
}

export interface Voiceover {
  /** WAV file name inside the project's assets dir, or null for a silent video. */
  file: string | null;
  lines: VoiceLine[];
  /** Total video length in seconds, including lead-in and tail. */
  duration: number;
}

export class TtsError extends Error {}

export function ttsProviderName(): string {
  return config.TTS_PROVIDER;
}

/** Problems that make the configured TTS unusable (shown at startup). */
export function ttsConfigProblem(): string | null {
  if (config.TTS_PROVIDER === "openai" && !config.OPENAI_API_KEY) return "TTS_PROVIDER=openai but OPENAI_API_KEY is not set.";
  if (config.TTS_PROVIDER === "elevenlabs" && (!config.ELEVENLABS_API_KEY || !config.ELEVENLABS_VOICE_ID)) {
    return "TTS_PROVIDER=elevenlabs needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.";
  }
  if (config.TTS_PROVIDER === "piper" && (!config.PIPER_MODEL || !existsSync(config.PIPER_MODEL))) {
    return "TTS_PROVIDER=piper needs PIPER_MODEL pointing to an existing .onnx voice.";
  }
  return null;
}

/**
 * Splits the narration into lines, voices each one and writes `<assetsDir>/voice.wav`.
 * Falls back to a silent timeline (reading-speed timings) when TTS is off or fails,
 * so a voice problem never costs the user the video.
 */
export async function buildVoiceover(narration: string, assetsDir: string): Promise<Voiceover> {
  const texts = splitIntoLines(narration);
  if (config.TTS_PROVIDER === "none" || ttsConfigProblem()) return silentTimeline(texts);

  try {
    const clips = await mapLimit(texts, 3, (t) => synthesize(t));
    const lines: VoiceLine[] = [];
    const parts: Buffer[] = [silence(LEAD_IN_S)];
    let t = LEAD_IN_S;
    clips.forEach((pcm, i) => {
      const len = pcm.length / BYTES_PER_SECOND;
      lines.push({ text: texts[i]!, start: round(t), end: round(t + len) });
      parts.push(pcm, silence(GAP_S));
      t += len + GAP_S;
    });
    parts.push(silence(TAIL_S));
    await writeFile(`${assetsDir}/voice.wav`, pcmToWav(Buffer.concat(parts)));
    return { file: "voice.wav", lines, duration: round(t + TAIL_S) };
  } catch (err) {
    console.warn("[tts] voiceover failed, rendering a silent video:", err instanceof Error ? err.message : err);
    return silentTimeline(texts);
  }
}

function silentTimeline(texts: string[]): Voiceover {
  const lines: VoiceLine[] = [];
  let t = LEAD_IN_S;
  for (const text of texts) {
    const len = Math.max(1.4, text.length / SILENT_CHARS_PER_S);
    lines.push({ text, start: round(t), end: round(t + len) });
    t += len + GAP_S;
  }
  return { file: null, lines, duration: round(t + TAIL_S) };
}

async function synthesize(text: string): Promise<Buffer> {
  if (config.TTS_PROVIDER === "openai") return openAiSpeech(text);
  if (config.TTS_PROVIDER === "piper") return piperSpeech(text);
  return elevenLabsSpeech(text);
}

// Piper writes raw 16-bit mono PCM at the voice's own rate (22050 Hz for "medium" voices);
// FFmpeg resamples it to our 24 kHz.
async function piperSpeech(text: string): Promise<Buffer> {
  const model = config.PIPER_MODEL!;
  const pcm = await pipeThrough(
    config.PIPER_BIN,
    ["-m", model, "--output-raw", "--length-scale", String(config.PIPER_LENGTH_SCALE)],
    Buffer.from(text, "utf8"),
  );
  const rate = piperSampleRate(model);
  if (rate === SAMPLE_RATE) return pcm;
  return pipeThrough(
    config.FFMPEG_PATH,
    ["-v", "error", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0", "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", "1", "pipe:1"],
    pcm,
  );
}

const piperRates = new Map<string, number>();
function piperSampleRate(model: string): number {
  let rate = piperRates.get(model);
  if (!rate) {
    try {
      rate = Number(JSON.parse(readFileSync(`${model}.json`, "utf8"))?.audio?.sample_rate) || 22050;
    } catch {
      rate = 22050;
    }
    piperRates.set(model, rate);
  }
  return rate;
}

/** Runs a command with `input` on stdin and returns its stdout as bytes. */
function pipeThrough(cmd: string, args: string[], input: Buffer, timeoutMs = 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 2000) err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new TtsError(`${cmd}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (code === 0 && buf.length > 0) resolve(buf);
      else reject(new TtsError(`${cmd} exited with ${code}: ${err.trim().slice(0, 300)}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

// https://platform.openai.com/docs/api-reference/audio/createSpeech — "pcm" = 24 kHz 16-bit LE mono.
async function openAiSpeech(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.OPENAI_TTS_MODEL,
      voice: config.OPENAI_TTS_VOICE,
      input: text,
      response_format: "pcm",
      instructions: "An engaging teacher explaining one idea in a short vertical video: warm, clear, upbeat pace.",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new TtsError(`OpenAI TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// https://elevenlabs.io/docs/api-reference/text-to-speech/convert — pcm_24000 = 24 kHz 16-bit LE mono.
async function elevenLabsSpeech(text: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.ELEVENLABS_VOICE_ID!)}?output_format=pcm_24000`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": config.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: config.ELEVENLABS_MODEL }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new TtsError(`ElevenLabs TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Sentences, with very short ones merged into the next, at most 14 lines. */
export function splitIntoLines(narration: string): string[] {
  const sentences = narration
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  for (const s of sentences) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last.length < 30 || lines.length >= 14)) lines[lines.length - 1] = `${last} ${s}`;
    else lines.push(s);
  }
  return lines.length ? lines : [narration.trim()];
}

function silence(seconds: number): Buffer {
  return Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2);
}

function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
