import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** backend/public — served as static files (demo video lives in public/demo). */
export const PUBLIC_DIR = path.resolve(here, "..", "public");
