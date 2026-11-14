import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { config } from "../../config.ts";
import { BACKEND_DIR } from "../../paths.ts";

const HYPERFRAMES_BIN = path.join(BACKEND_DIR, "node_modules", "hyperframes", "bin", "hyperframes.mjs");

/**
 * Child processes never get the server's secrets: the composition is model-written code
 * running in headless Chrome, and the CLI has its own telemetry, which we switch off.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE/i.test(k)) continue;
    env[k] = v;
  }
  return {
    ...env,
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    // The CLI wants absolute paths here; bare command names are found on PATH anyway.
    ...(path.isAbsolute(config.FFMPEG_PATH) ? { HYPERFRAMES_FFMPEG_PATH: config.FFMPEG_PATH } : {}),
    ...(path.isAbsolute(config.FFPROBE_PATH) ? { HYPERFRAMES_FFPROBE_PATH: config.FFPROBE_PATH } : {}),
  };
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs a command with a hard timeout; stdout is captured, stderr also goes to `logFile` if given. */
export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs: number; logFile?: string }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const log = opts.logFile ? createWriteStream(opts.logFile, { flags: "a" }) : null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      log?.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 200_000) stderr += d.toString();
      log?.write(d);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      log?.end();
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      log?.end();
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export function hyperframes(args: string[], opts: { cwd?: string; timeoutMs: number; logFile?: string }) {
  return run(process.execPath, [HYPERFRAMES_BIN, ...args], opts);
}

/** Parses the last top-level JSON object a CLI printed (logs may precede it). */
export function parseJsonOutput<T>(stdout: string): T | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    return null;
  }
}
