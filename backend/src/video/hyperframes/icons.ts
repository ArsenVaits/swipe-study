import { readFileSync } from "node:fs";
import path from "node:path";
import { BACKEND_DIR } from "../../paths.ts";

// Lucide icons (lucide-static, ISC). The composition writes an empty placeholder such as
//   <i data-icon="server" style="width:120px;height:120px;color:#fff"></i>
// and we replace it with the inline SVG, keeping the placeholder's id/class/style/data-* attributes.

const ICON_DIR = path.join(BACKEND_DIR, "node_modules", "lucide-static", "icons");
const PLACEHOLDER = /<(i|span|div)\b([^>]*?)\bdata-icon\s*=\s*["']([a-z0-9-]+)["']([^>]*)>\s*<\/\1\s*>/gi;
const cache = new Map<string, string | null>();

function iconBody(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  let body: string | null = null;
  try {
    const svg = readFileSync(path.join(ICON_DIR, `${name}.svg`), "utf8");
    body = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)?.[1]?.trim() ?? null;
  } catch {
    body = null;
  }
  cache.set(name, body);
  return body;
}

/** Inlines every data-icon placeholder. Unknown names are dropped and reported for the fix round. */
export function inlineIcons(html: string): { html: string; missing: string[] } {
  const missing = new Set<string>();
  const out = html.replace(PLACEHOLDER, (_m, _tag: string, before: string, name: string, after: string) => {
    const body = iconBody(name);
    if (!body) {
      missing.add(name);
      return "";
    }
    const attrs = `${before} ${after}`.replace(/\s+/g, " ").trim();
    const stroke = attrs.match(/data-stroke\s*=\s*["']([\d.]+)["']/i)?.[1] ?? "1.6";
    return (
      `<svg ${attrs} data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
    );
  });
  return { html: out, missing: [...missing] };
}
