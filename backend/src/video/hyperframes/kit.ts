import { copyFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BACKEND_DIR } from "../../paths.ts";

// The creative kit every composition can use: GSAP plugins (all free, MIT/GSAP standard license),
// display and text fonts with Cyrillic (SIL OFL, backend/assets/fonts) and the official GSAP
// plugin reference (backend/skills/gsap, MIT) quoted into the prompt.

const GSAP_DIST = path.join(BACKEND_DIR, "node_modules", "gsap", "dist");
const FONTS_DIR = path.join(BACKEND_DIR, "assets", "fonts");
const SKILLS_DIR = path.join(BACKEND_DIR, "skills");

/** Deterministic plugins only (ScrambleText is random per frame, so it is left out). */
export const GSAP_PLUGINS = ["CustomEase", "DrawSVGPlugin", "MorphSVGPlugin", "MotionPathPlugin", "SplitText"] as const;

export function pluginScriptTags(): string {
  return (
    GSAP_PLUGINS.map((p) => `<script src="assets/gsap/${p}.min.js"></script>`).join("\n") +
    `\n<script>gsap.registerPlugin(${GSAP_PLUGINS.join(", ")});</script>`
  );
}

interface FontDef {
  family: string;
  dir: string;
  file: string;
  /** Weight range for variable fonts, or the single weight. */
  weight: string;
  role: string;
}

/** Fonts with Cyrillic that are not bundled with HyperFrames. */
export const KIT_FONTS: FontDef[] = [
  { family: "Unbounded", dir: "unbounded", file: "Unbounded[wght].ttf", weight: "200 900", role: "wide geometric display, futuristic and technical" },
  { family: "Dela Gothic One", dir: "delagothicone", file: "DelaGothicOne-Regular.ttf", weight: "400", role: "ultra-heavy poster display, loud single words" },
  { family: "Yeseva One", dir: "yesevaone", file: "YesevaOne-Regular.ttf", weight: "400", role: "high-contrast display serif, culture and history" },
  { family: "Prata", dir: "prata", file: "Prata-Regular.ttf", weight: "400", role: "elegant didone serif, refined headlines" },
  { family: "Lora", dir: "lora", file: "Lora[wght].ttf", weight: "400 700", role: "warm book serif, readable lines" },
  { family: "Manrope", dir: "manrope", file: "Manrope[wght].ttf", weight: "200 800", role: "modern grotesk, clean UI and labels" },
  { family: "Onest", dir: "onest", file: "Onest[wght].ttf", weight: "100 900", role: "neutral contemporary grotesk, very readable" },
  { family: "Geologica", dir: "geologica", file: "Geologica[CRSV,SHRP,slnt,wght].ttf", weight: "100 900", role: "scientific grotesk with character, data and science" },
  { family: "Alumni Sans", dir: "alumnisans", file: "AlumniSans[wght].ttf", weight: "100 900", role: "tall condensed, big numbers and tight headlines" },
  { family: "Rubik", dir: "rubik", file: "Rubik[wght].ttf", weight: "300 900", role: "soft rounded geometric, friendly and biological" },
];

/** Copies plugins and fonts into the project's assets. */
export async function copyKit(assetsDir: string): Promise<void> {
  await mkdir(path.join(assetsDir, "gsap"), { recursive: true });
  for (const p of GSAP_PLUGINS) await copyFile(path.join(GSAP_DIST, `${p}.min.js`), path.join(assetsDir, "gsap", `${p}.min.js`));
  await mkdir(path.join(assetsDir, "fonts"), { recursive: true });
  for (const f of KIT_FONTS) await copyFile(path.join(FONTS_DIR, f.dir, f.file), path.join(assetsDir, "fonts", f.file));
}

/** @font-face rules for the kit fonts the composition actually uses. */
export function addFontFaces(html: string): string {
  const used = KIT_FONTS.filter((f) => html.includes(f.family));
  if (!used.length || html.includes("/* kit-fonts */")) return html;
  const css =
    "/* kit-fonts */\n" +
    used
      .map(
        (f) =>
          `@font-face { font-family: "${f.family}"; src: url("assets/fonts/${encodeURI(f.file)}") format("truetype"); font-weight: ${f.weight}; font-style: normal; font-display: block; }`,
      )
      .join("\n");
  return html.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
}

/** Official GSAP plugin reference (greensock/gsap-skills, MIT), only the plugins we ship. */
export function gsapPluginReference(): string {
  let md: string;
  try {
    md = readFileSync(path.join(SKILLS_DIR, "gsap", "gsap-plugins.md"), "utf8");
  } catch {
    return "";
  }
  const section = (start: string, end: string) => {
    const a = md.indexOf(start);
    const b = md.indexOf(end, a + start.length);
    return a >= 0 ? md.slice(a, b > a ? b : undefined).trim() : "";
  };
  return [
    section("### SplitText", "### ScrambleText"),
    section("### DrawSVG", "### MotionPathHelper"),
    section("### CustomEase", "### EasePack"),
  ]
    .filter(Boolean)
    .join("\n\n");
}
