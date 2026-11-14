import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** backend/ */
export const BACKEND_DIR = path.resolve(here, "..");

/** backend/public — served as static files (demo video lives in public/demo). */
export const PUBLIC_DIR = path.join(BACKEND_DIR, "public");

/** backend/assets/audio — optional music and sound effects for HyperFrames videos. */
export const AUDIO_LIBRARY_DIR = path.join(BACKEND_DIR, "assets", "audio");
