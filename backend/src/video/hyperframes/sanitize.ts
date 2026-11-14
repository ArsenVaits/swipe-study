// The composition is model-written code. It runs only inside headless Chrome during the render,
// and this pass makes sure it cannot reach the network or load anything but our local GSAP.

const CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const HEAD_INJECT = `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<script src="assets/gsap.min.js"></script>`;

/** Pulls the HTML document out of a model reply (tolerates code fences and stray text). */
export function extractHtml(reply: string): string | null {
  const m = reply.match(/<!doctype html[\s\S]*<\/html>/i) ?? reply.match(/<html[\s\S]*<\/html>/i);
  return m ? m[0] : null;
}

/** Strips everything that could load remote content and injects the CSP + local GSAP. */
export function sanitizeComposition(html: string): string {
  let out = html
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "")
    .replace(/<(iframe|object|embed|frame|frameset|portal)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, "")
    .replace(/@import\s+[^;]+;/gi, "");

  if (/<meta\s+charset[^>]*>/i.test(out)) out = out.replace(/<meta\s+charset[^>]*>/i, (m) => `${m}\n${HEAD_INJECT}`);
  else if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, (m) => `${m}\n<meta charset="utf-8">\n${HEAD_INJECT}`);
  else out = out.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>\n${HEAD_INJECT}\n</head>`);
  if (!/^\s*<!doctype html/i.test(out)) out = `<!doctype html>\n${out}`;
  return out;
}
