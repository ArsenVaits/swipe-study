import type { Lesson } from "../../lessons/schema.ts";
import type { Voiceover } from "../../tts/index.ts";

// Deterministic kinetic-type composition used when Opus or its composition fails,
// so a lesson still gets a video. Text comes only from the lesson.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function words(id: string, text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => `<span class="w" id="${id}-w${i}">${esc(w)}</span>`)
    .join(" ");
}

function fontSizeFor(text: string): number {
  if (text.length < 50) return 84;
  if (text.length < 90) return 68;
  if (text.length < 140) return 58;
  return 50;
}

/**
 * `captions` true: every voice line is spelled out as it is spoken.
 * false: only the lesson's short key points, one per beat (the app shows subtitles itself).
 */
export function fallbackComposition(lesson: Lesson, voice: Voiceover, captions: boolean): string {
  const D = voice.duration;
  const lines = voice.lines;
  const firstEnd = lines[0]?.end ?? 3;
  const scenes: string[] = [];
  const tweens: string[] = [];

  // Scene 0: title + hook, on screen at frame 0 (thumbnail).
  const titleEnd = Math.min(Math.max(firstEnd, 2.5), D);
  scenes.push(`
  <div id="s0" class="scene clip" data-start="0" data-duration="${titleEnd.toFixed(2)}">
    <div class="title" id="s0-title">${words("s0-title", lesson.title)}</div>
    <div class="hook" id="s0-hook">${esc(lesson.hook)}</div>
  </div>`);
  tweens.push(
    `tl.fromTo("#s0-title .w", {opacity: 0.25, filter: "blur(6px)"}, {opacity: 1, filter: "blur(0px)", duration: 0.13, stagger: 0.07, ease: "power4.out"}, 0);`,
    `tl.fromTo("#s0-hook", {opacity: 0, y: 24}, {opacity: 1, y: 0, duration: 0.6, ease: "expo.out"}, 0.5);`,
    `tl.to("#s0 > *", {opacity: 0, filter: "blur(8px)", duration: 0.15, ease: "power3.in"}, ${(titleEnd - 0.16).toFixed(2)});`,
  );

  // Beats after the title: voice lines (captions on) or key points pinned to voice-line starts (off).
  const beats: Array<{ text: string; start: number; spokenEnd: number }> = [];
  if (captions) {
    for (const l of lines.slice(1)) beats.push({ text: l.text, start: l.start, spokenEnd: l.end });
  } else {
    const points = lesson.captions;
    points.forEach((text, k) => {
      const idx = lines.length > 1 ? 1 + Math.floor((k * (lines.length - 1)) / points.length) : -1;
      const start = idx > 0 ? lines[idx]!.start : titleEnd + ((D - titleEnd) * k) / points.length;
      if (beats.length && start <= beats[beats.length - 1]!.start) return;
      beats.push({ text, start, spokenEnd: start + 1.2 });
    });
  }

  beats.forEach((beat, i) => {
    const n = i + 1;
    const start = beat.start;
    const end = i + 1 < beats.length ? beats[i + 1]!.start : D;
    const dur = Math.max(0.5, end - start);
    const id = `s${n}`;
    const line = beat;
    const wordCount = line.text.split(/\s+/).filter(Boolean).length;
    const spoken = Math.max(0.4, beat.spokenEnd - beat.start);
    const stagger = Math.min(0.12, (spoken * 0.8) / Math.max(1, wordCount));
    scenes.push(`
  <div id="${id}" class="scene clip" data-start="${start.toFixed(2)}" data-duration="${dur.toFixed(2)}">
    <div class="num" id="${id}-num">${String(n).padStart(2, "0")}</div>
    <div class="line" id="${id}-line" style="font-size:${fontSizeFor(line.text)}px">${words(`${id}-line`, line.text)}</div>
  </div>`);
    tweens.push(
      `tl.fromTo("#${id}-num", {opacity: 0, x: -40}, {opacity: 1, x: 0, duration: 0.5, ease: "expo.out"}, ${start.toFixed(2)});`,
      `tl.fromTo("#${id}-line .w", {opacity: 0.18}, {opacity: 1, duration: 0.12, stagger: ${stagger.toFixed(3)}, ease: "power2.out"}, ${(start + 0.05).toFixed(2)});`,
    );
    if (i + 1 < beats.length) {
      tweens.push(`tl.to("#${id} > *", {opacity: 0, filter: "blur(8px)", duration: 0.15, ease: "power3.in"}, ${(end - 0.16).toFixed(2)});`);
    }
  });

  tweens.push(`tl.fromTo("#bar", {scaleX: 0}, {scaleX: 1, duration: ${D.toFixed(2)}, ease: "none"}, 0);`);
  tweens.push(`tl.fromTo("#glow", {x: -120, y: 0}, {x: 120, y: 160, duration: ${D.toFixed(2)}, ease: "power1.inOut"}, 0);`);

  const audio = voice.file
    ? `<audio id="voice" class="clip" src="assets/${voice.file}" data-start="0" data-duration="${D}" data-volume="1"></audio>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="assets/gsap.min.js"></script>
<style>
  html, body { margin: 0; background: #0b1020; }
  #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; font-family: Inter, sans-serif; color: #f5f7ff; }
  #bg { position: absolute; inset: 0; background: linear-gradient(160deg, #0b1020 0%, #151b46 55%, #0b1020 100%); }
  #glow { position: absolute; left: 140px; top: 420px; width: 800px; height: 800px; border-radius: 50%;
          background: radial-gradient(circle, rgba(124,140,255,0.28) 0%, rgba(124,140,255,0) 70%); }
  #bar-wrap { position: absolute; left: 90px; right: 140px; top: 210px; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.12); }
  #bar { position: absolute; inset: 0; border-radius: 4px; background: #8b9bff; transform-origin: 0 50%; }
  .scene { position: absolute; inset: 0; }
  .title { position: absolute; left: 90px; right: 140px; top: 520px; font-size: 104px; font-weight: 900; line-height: 1.05; letter-spacing: -1px; }
  .hook { position: absolute; left: 90px; right: 140px; top: 980px; font-size: 52px; line-height: 1.3; color: #b9c3ff; }
  .num { position: absolute; left: 90px; top: 430px; font-size: 64px; font-weight: 900; color: #8b9bff; }
  .line { position: absolute; left: 90px; right: 140px; top: 560px; font-weight: 800; line-height: 1.18; }
  .w { display: inline-block; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="1080" data-height="1920">
  <div id="bg"></div>
  <div id="glow"></div>
  <div id="bar-wrap"><div id="bar"></div></div>
${scenes.join("\n")}
  ${audio}
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  ${tweens.join("\n  ")}
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
}
