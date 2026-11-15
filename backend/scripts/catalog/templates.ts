import type { Voiceover } from "../../src/tts/index.ts";

// Hand-written HyperFrames compositions for the ready-made catalog: six visual styles, no model involved.
// Every video: title → key points (with a big accent beat in the middle) → recap, timed to the voiceover.

export interface CatalogItem {
  title: string;
  hook: string;
  points: string[];
  icon: string;
  big: string;
  bigLabel: string;
}

export interface TemplateInput {
  item: CatalogItem;
  voice: Voiceover;
  accent: string;
  trackName: string;
  /** 1-based position inside the track. */
  number: number;
}

export const STYLES = ["terminal", "editorial", "poster", "grid", "soft", "condensed"] as const;
export type Style = (typeof STYLES)[number];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f2 = (n: number) => n.toFixed(2);
const pad = (n: number) => String(n).padStart(2, "0");
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

function words(id: string, text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => `<span class="w" id="${id}-w${i}">${esc(w)}</span>`)
    .join(" ");
}

function chars(id: string, text: string): string {
  let i = 0;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `<span class="wd">${[...w].map((c) => `<span class="c" id="${id}-c${i++}">${esc(c)}</span>`).join("")}</span>`)
    .join(" ");
}

/** Font size that fits `text` on about `lines` lines of `width` px, between min and max. */
function fit(text: string, max: number, min: number, width = 880, lines = 3, charW = 0.55): number {
  const perLine = text.length / lines;
  const size = Math.floor(width / Math.max(1, perLine * charW));
  return Math.max(min, Math.min(max, size));
}

function bigSize(text: string, max: number, charW: number, width = 880): number {
  return Math.min(max, Math.floor(width / Math.max(1, text.length * charW)));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(hex: string, other: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return "#" + a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}
const rgba = (hex: string, a: number) => `rgba(${hexToRgb(hex).join(",")},${a})`;

type BeatKind = "point" | "big" | "recap";
interface Beat {
  kind: BeatKind;
  start: number;
  end: number;
  /** Index into points for "point" beats. */
  index: number;
}

/** Title until the first line ends; then points, a big accent beat after the second point, and a recap. */
function plan(item: CatalogItem, voice: Voiceover): { titleEnd: number; beats: Beat[] } {
  const D = voice.duration;
  const lines = voice.lines;
  const titleEnd = Math.min(Math.max(lines[0]?.end ?? 3, 3), D - 8);
  const order: Array<{ kind: BeatKind; index: number }> = [];
  item.points.forEach((_, i) => {
    order.push({ kind: "point", index: i });
    if (i === 1) order.push({ kind: "big", index: -1 });
  });
  order.push({ kind: "recap", index: -1 });

  const spokenEnd = lines[lines.length - 1]?.end ?? D;
  const recapStart = Math.min(Math.max(spokenEnd - 6, titleEnd + 1), D - 5);
  const span = recapStart - titleEnd;
  const n = order.length - 1;
  const starts: number[] = [];
  for (let j = 0; j < n; j++) {
    let t = titleEnd + (span * j) / n;
    // Snap to the nearest voice line start, so a beat changes with a sentence.
    const near = lines.map((l) => l.start).filter((s) => Math.abs(s - t) < 1.6 && s > (starts[j - 1] ?? titleEnd - 0.01) + 1.8 && s < recapStart - 1.8);
    if (j > 0 && near.length) t = near.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
    if (j === 0) t = titleEnd;
    starts.push(t);
  }
  starts.push(recapStart);
  const beats = order.map((o, j) => ({ ...o, start: starts[j]!, end: j + 1 < order.length ? starts[j + 1]! : D }));
  return { titleEnd, beats };
}

interface Built {
  css: string;
  bg: string;
  title: string;
  titleTweens: string[];
  beat(b: Beat, id: string): { html: string; tweens: string[] };
  persistent?: string[];
}

function page(input: TemplateInput, built: Built, bodyBg: string): string {
  const { voice } = input;
  const D = voice.duration;
  const { titleEnd, beats } = plan(input.item, voice);
  const scenes: string[] = [];
  const tweens: string[] = [...built.titleTweens];
  scenes.push(`<div id="s0" class="scene clip" data-start="0" data-duration="${f2(titleEnd)}">${built.title}</div>`);
  tweens.push(`tl.to("#s0 > *", {opacity: 0, y: -30, duration: 0.25, ease: "power2.in"}, ${f2(titleEnd - 0.27)});`);
  beats.forEach((b, i) => {
    const id = `s${i + 1}`;
    const { html, tweens: t } = built.beat(b, id);
    scenes.push(`<div id="${id}" class="scene clip" data-start="${f2(b.start)}" data-duration="${f2(b.end - b.start)}">${html}</div>`);
    tweens.push(...t);
    if (i + 1 < beats.length) tweens.push(`tl.to("#${id} > *", {opacity: 0, duration: 0.22, ease: "power2.in"}, ${f2(b.end - 0.24)});`);
  });
  tweens.push(...(built.persistent ?? []));
  const audio = voice.file
    ? `<audio id="voice" class="clip" src="assets/${voice.file}" data-start="0" data-duration="${D}" data-volume="1"></audio>`
    : "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="assets/gsap.min.js"></script>
<style>
  html, body { margin: 0; background: ${bodyBg}; }
  #root { position: relative; width: 1080px; height: 1920px; overflow: hidden; }
  .scene { position: absolute; inset: 0; }
  .w, .c { display: inline-block; }
  .wd { display: inline-block; white-space: nowrap; }
  svg[data-icon] { display: block; }
${built.css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="1080" data-height="1920">
${built.bg}
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

const icon = (name: string, size: number, color: string, extra = "") =>
  `<i data-icon="${esc(name)}" ${extra} style="width:${size}px;height:${size}px;color:${color}"></i>`;

// ---------------------------------------------------------------- 1. terminal

function terminal(input: TemplateInput): string {
  const { item, accent, voice } = input;
  const D = voice.duration;
  const a = mix(accent, "#ffffff", 0.15);
  const css = `
  #root { background: #060c0a; font-family: "JetBrains Mono", monospace; color: #e8fff2; }
  #scan { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 2px, transparent 2px 6px); }
  #halo { position: absolute; left: -200px; top: 300px; width: 1100px; height: 1100px; border-radius: 50%; background: radial-gradient(circle, ${rgba(accent, 0.22)} 0%, ${rgba(accent, 0)} 65%); }
  #frame { position: absolute; left: 70px; right: 70px; top: 230px; bottom: 380px; border: 2px solid ${rgba(accent, 0.35)}; border-radius: 28px; }
  #bar { position: absolute; left: 70px; right: 70px; top: 230px; height: 70px; border-bottom: 2px solid ${rgba(accent, 0.35)}; }
  .dot { position: absolute; top: 24px; width: 22px; height: 22px; border-radius: 50%; }
  #path { position: absolute; left: 190px; top: 18px; font-size: 28px; color: ${rgba(accent, 0.8)}; }
  #prog { position: absolute; left: 70px; right: 70px; bottom: 380px; height: 6px; background: ${a}; transform-origin: 0 50%; border-radius: 3px; }
  .t-title { position: absolute; left: 130px; right: 130px; top: 640px; font-family: Unbounded, sans-serif; font-weight: 800; line-height: 1.08; color: #ffffff; }
  .t-hook { position: absolute; left: 130px; right: 130px; top: 1160px; font-size: 40px; line-height: 1.45; color: ${a}; }
  .t-icon { position: absolute; left: 130px; top: 400px; }
  .prompt { position: absolute; left: 130px; top: 560px; font-size: 46px; color: ${a}; }
  .line { position: absolute; left: 130px; right: 130px; top: 670px; font-weight: 700; line-height: 1.28; color: #ffffff; }
  .cursor { display: inline-block; width: 0.55em; height: 1em; margin-left: 8px; vertical-align: -0.12em; background: ${a}; }
  .big { position: absolute; left: 100px; right: 100px; top: 640px; text-align: center; font-weight: 800; color: ${a}; text-shadow: 0 0 40px ${rgba(accent, 0.6)}; }
  .big-label { position: absolute; left: 130px; right: 130px; top: 1120px; text-align: center; font-size: 42px; color: #cfeedd; }
  .rc-head { position: absolute; left: 130px; top: 480px; font-size: 40px; color: ${a}; }
  .rc { position: absolute; left: 130px; right: 130px; font-size: 44px; line-height: 1.3; color: #ffffff; }
  .rc b { color: ${a}; font-weight: 700; }`;
  const bg = `<div id="halo"></div><div id="scan"></div><div id="frame"></div>
  <div id="bar"><div class="dot" style="left:30px;background:#ff5f57"></div><div class="dot" style="left:66px;background:#febc2e"></div><div class="dot" style="left:102px;background:#28c840"></div>
  <div id="path">~/${esc(input.trackName.toLowerCase())}/${pad(input.number)}.md</div></div><div id="prog"></div>`;
  const ts = fit(item.title, 96, 64, 820, 3, 0.75);
  const title = `<div class="t-icon" id="s0-icon">${icon(item.icon, 150, a)}</div>
  <div class="t-title" id="s0-title" style="font-size:${ts}px">${words("s0-title", item.title)}</div>
  <div class="t-hook" id="s0-hook">// ${esc(item.hook)}</div>`;
  const titleTweens = [
    `tl.fromTo("#s0-icon", {opacity: 0, scale: 0.6, rotation: -20}, {opacity: 1, scale: 1, rotation: 0, duration: 0.7, ease: "back.out(1.8)"}, 0);`,
    `tl.fromTo("#s0-title .w", {opacity: 0.2, y: 30}, {opacity: 1, y: 0, duration: 0.4, stagger: 0.06, ease: "power3.out"}, 0);`,
    `tl.fromTo("#s0-hook", {opacity: 0, x: -30}, {opacity: 1, x: 0, duration: 0.6, ease: "expo.out"}, 0.6);`,
  ];
  const beat = (b: Beat, id: string) => {
    if (b.kind === "point") {
      const text = item.points[b.index]!;
      const size = fit(text, 74, 50, 820, 4, 0.62);
      const typing = Math.min(1.6, (b.end - b.start) * 0.4);
      return {
        html: `<div class="prompt" id="${id}-p">&gt; step_${pad(b.index + 1)}</div>
        <div class="line" id="${id}-l" style="font-size:${size}px">${chars(`${id}-l`, text)}<span class="cursor" id="${id}-cur"></span></div>`,
        tweens: [
          `tl.fromTo("#${id}-p", {opacity: 0}, {opacity: 1, duration: 0.3}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-l .c", {opacity: 0}, {opacity: 1, duration: 0.01, stagger: ${(typing / Math.max(1, text.length)).toFixed(4)}, ease: "none"}, ${f2(b.start + 0.15)});`,
          `tl.set("#${id}-cur", {opacity: 0}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-cur", {opacity: 1}, {opacity: 0, duration: 0.45, repeat: ${Math.max(1, Math.floor((b.end - b.start - typing - 0.2) / 0.45) - 1)}, yoyo: true, ease: "steps(1)"}, ${f2(b.start + 0.2 + typing)});`,
        ],
      };
    }
    if (b.kind === "big") {
      return {
        html: `<div class="big" id="${id}-b" style="font-size:${bigSize(item.big, 230, 0.62)}px">${esc(item.big)}</div>
        <div class="big-label" id="${id}-lb">${esc(item.bigLabel)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-b", {opacity: 0, scale: 1.25, filter: "blur(12px)"}, {opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.7, ease: "expo.out"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-lb", {opacity: 0, y: 20}, {opacity: 1, y: 0, duration: 0.5, ease: "power3.out"}, ${f2(b.start + 0.4)});`,
        ],
      };
    }
    const rows = item.points
      .map((p, i) => `<div class="rc" id="${id}-r${i}" style="top:${600 + i * 170}px"><b>✓</b> ${esc(p)}</div>`)
      .join("");
    return {
      html: `<div class="rc-head" id="${id}-h">$ summary --${esc(input.trackName.toLowerCase())}</div>${rows}`,
      tweens: [
        `tl.fromTo("#${id}-h", {opacity: 0}, {opacity: 1, duration: 0.3}, ${f2(b.start)});`,
        `tl.fromTo("#${id} .rc", {opacity: 0, x: -40}, {opacity: 1, x: 0, duration: 0.45, stagger: 0.35, ease: "power3.out"}, ${f2(b.start + 0.2)});`,
      ],
    };
  };
  return page(input, {
    css, bg, title, titleTweens, beat,
    persistent: [
      `tl.fromTo("#prog", {scaleX: 0}, {scaleX: 1, duration: ${f2(D)}, ease: "none"}, 0);`,
      `tl.fromTo("#halo", {x: 0, y: 0}, {x: 260, y: 240, duration: ${f2(D)}, ease: "sine.inOut"}, 0);`,
    ],
  }, "#060c0a");
}

// ---------------------------------------------------------------- 2. editorial

function editorial(input: TemplateInput): string {
  const { item, accent, voice } = input;
  const D = voice.duration;
  const ink = "#1c1915";
  const a = mix(accent, "#000000", 0.45);
  const css = `
  #root { background: #f3ece0; font-family: Lora, serif; color: ${ink}; }
  #paper { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 60% at 50% 40%, #faf5ec 0%, #efe6d6 100%); }
  .rule { position: absolute; left: 90px; right: 90px; height: 2px; background: ${ink}; transform-origin: 0 50%; }
  #mast { position: absolute; left: 90px; right: 90px; top: 268px; display: flex; justify-content: space-between; font-family: Manrope, sans-serif; font-size: 28px; letter-spacing: 6px; text-transform: uppercase; }
  #prog { position: absolute; left: 90px; top: 1560px; height: 6px; width: 900px; background: ${a}; transform-origin: 0 50%; }
  .t-kicker { position: absolute; left: 90px; top: 420px; font-family: Manrope, sans-serif; font-size: 30px; letter-spacing: 8px; color: ${a}; text-transform: uppercase; }
  .t-title { position: absolute; left: 90px; right: 120px; top: 500px; font-family: Prata, serif; line-height: 1.08; }
  .t-hook { position: absolute; left: 90px; right: 160px; top: 1120px; font-size: 46px; line-height: 1.4; font-style: italic; color: #4a4236; }
  .t-icon { position: absolute; right: 90px; top: 1330px; width: 170px; height: 170px; border-radius: 50%; border: 2px solid ${ink}; display: flex; align-items: center; justify-content: center; }
  .num { position: absolute; left: 70px; top: 440px; font-family: "Yeseva One", serif; font-size: 300px; line-height: 1; color: ${rgba(a, 0.18)}; }
  .ptxt { position: absolute; left: 90px; right: 140px; top: 800px; font-family: Prata, serif; line-height: 1.2; }
  .pline { width: 240px; height: 8px; margin-top: 56px; background: ${a}; transform-origin: 0 50%; }
  .big { position: absolute; left: 60px; right: 60px; top: 560px; text-align: center; font-family: "Yeseva One", serif; color: ${a}; line-height: 1; }
  .big-label { position: absolute; left: 140px; right: 140px; top: 1090px; text-align: center; font-size: 44px; font-style: italic; line-height: 1.4; }
  .orn { position: absolute; left: 340px; width: 400px; height: 2px; background: ${ink}; }
  .rc-head { position: absolute; left: 90px; top: 480px; font-family: Prata, serif; font-size: 64px; }
  .rc { position: absolute; left: 90px; right: 140px; font-size: 44px; line-height: 1.35; padding-left: 90px; }
  .rc span { position: absolute; left: 0; top: -4px; font-family: "Yeseva One", serif; font-size: 52px; color: ${a}; }`;
  const bg = `<div id="paper"></div><div class="rule" id="r1" style="top:240px"></div><div class="rule" id="r2" style="top:330px;height:1px"></div>
  <div id="mast"><span>${esc(input.trackName)}</span><span>№ ${pad(input.number)}</span></div><div id="prog"></div>`;
  const ts = fit(item.title, 110, 70, 870, 3, 0.62);
  const title = `<div class="t-kicker" id="s0-k">Урок ${pad(input.number)}</div>
  <div class="t-title" id="s0-title" style="font-size:${ts}px">${words("s0-title", item.title)}</div>
  <div class="t-hook" id="s0-hook">${esc(item.hook)}</div>
  <div class="t-icon" id="s0-icon">${icon(item.icon, 90, ink)}</div>`;
  const titleTweens = [
    `tl.fromTo("#s0-k", {opacity: 0, x: -20}, {opacity: 1, x: 0, duration: 0.6, ease: "power2.out"}, 0);`,
    `tl.fromTo("#s0-title .w", {opacity: 0.15, y: 18}, {opacity: 1, y: 0, duration: 0.5, stagger: 0.07, ease: "power2.out"}, 0);`,
    `tl.fromTo("#s0-hook", {opacity: 0}, {opacity: 1, duration: 0.9, ease: "power1.out"}, 0.7);`,
    `tl.fromTo("#s0-icon", {opacity: 0, scale: 0.8}, {opacity: 1, scale: 1, duration: 0.8, ease: "power2.out"}, 0.9);`,
  ];
  const beat = (b: Beat, id: string) => {
    if (b.kind === "point") {
      const text = item.points[b.index]!;
      const size = fit(text, 82, 56, 850, 4, 0.58);
      return {
        html: `<div class="num" id="${id}-n">${ROMAN[b.index] ?? b.index + 1}</div>
        <div class="ptxt" style="font-size:${size}px"><div id="${id}-t">${words(`${id}-t`, text)}</div><div class="pline" id="${id}-u"></div></div>`,
        tweens: [
          `tl.fromTo("#${id}-n", {opacity: 0, y: 40}, {opacity: 1, y: 0, duration: 0.9, ease: "power2.out"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-t .w", {opacity: 0, y: 14}, {opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power2.out"}, ${f2(b.start + 0.1)});`,
          `tl.fromTo("#${id}-u", {scaleX: 0}, {scaleX: 1, duration: 0.8, ease: "power3.inOut"}, ${f2(b.start + 0.6)});`,
        ],
      };
    }
    if (b.kind === "big") {
      const s = bigSize(item.big, 300, 0.62, 940);
      return {
        html: `<div class="orn" id="${id}-o1" style="top:500px"></div>
        <div class="big" id="${id}-b" style="font-size:${s}px">${esc(item.big)}</div>
        <div class="orn" id="${id}-o2" style="top:1050px"></div>
        <div class="big-label" id="${id}-lb">${esc(item.bigLabel)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-o1, #${id}-o2", {scaleX: 0}, {scaleX: 1, duration: 0.8, ease: "power3.inOut"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-b", {opacity: 0, letterSpacing: "30px"}, {opacity: 1, letterSpacing: "0px", duration: 1.1, ease: "power3.out"}, ${f2(b.start + 0.1)});`,
          `tl.fromTo("#${id}-lb", {opacity: 0}, {opacity: 1, duration: 0.8}, ${f2(b.start + 0.6)});`,
        ],
      };
    }
    const rows = item.points
      .map((p, i) => `<div class="rc" id="${id}-r${i}" style="top:${660 + i * 200}px"><span>${ROMAN[i]}</span>${esc(p)}</div>`)
      .join("");
    return {
      html: `<div class="rc-head" id="${id}-h">Коротко</div>${rows}`,
      tweens: [
        `tl.fromTo("#${id}-h", {opacity: 0, y: 20}, {opacity: 1, y: 0, duration: 0.6, ease: "power2.out"}, ${f2(b.start)});`,
        `tl.fromTo("#${id} .rc", {opacity: 0, y: 24}, {opacity: 1, y: 0, duration: 0.6, stagger: 0.35, ease: "power2.out"}, ${f2(b.start + 0.3)});`,
      ],
    };
  };
  return page(input, {
    css, bg, title, titleTweens, beat,
    persistent: [
      `tl.fromTo("#r1, #r2", {scaleX: 0}, {scaleX: 1, duration: 1.0, ease: "power3.inOut"}, 0);`,
      `tl.fromTo("#prog", {scaleX: 0}, {scaleX: 1, duration: ${f2(D)}, ease: "none"}, 0);`,
    ],
  }, "#f3ece0");
}

// ---------------------------------------------------------------- 3. poster

function poster(input: TemplateInput): string {
  const { item, accent, voice } = input;
  const D = voice.duration;
  const ink = "#121212";
  const css = `
  #root { background: ${accent}; font-family: Manrope, sans-serif; color: ${ink}; }
  #circle { position: absolute; right: -260px; top: 120px; width: 760px; height: 760px; border-radius: 50%; background: ${mix(accent, "#ffffff", 0.35)}; }
  #slab { position: absolute; left: -120px; bottom: 260px; width: 700px; height: 260px; background: ${ink}; transform: rotate(-8deg); }
  #stripes { position: absolute; left: 0; right: 0; top: 0; height: 26px; background: repeating-linear-gradient(90deg, ${ink} 0 40px, transparent 40px 80px); }
  #prog { position: absolute; left: 0; top: 26px; height: 14px; width: 1080px; background: #ffffff; transform-origin: 0 50%; }
  .t-tag { position: absolute; left: 90px; top: 300px; padding: 14px 30px; background: ${ink}; color: ${accent}; font-weight: 800; font-size: 32px; letter-spacing: 4px; text-transform: uppercase; border-radius: 999px; }
  .t-title { position: absolute; left: 90px; right: 110px; top: 470px; font-family: "Dela Gothic One", sans-serif; line-height: 1.02; text-transform: uppercase; }
  .t-title .m { display: inline-block; overflow: hidden; vertical-align: top; }
  .t-hook { position: absolute; left: 90px; right: 180px; top: 1120px; font-size: 46px; font-weight: 700; line-height: 1.35; }
  .t-icon { position: absolute; right: 120px; top: 1330px; width: 220px; height: 220px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; box-shadow: 14px 14px 0 ${ink}; }
  .pill { position: absolute; left: 90px; top: 540px; padding: 16px 36px; background: ${ink}; color: #ffffff; font-family: "Dela Gothic One", sans-serif; font-size: 54px; border-radius: 999px; }
  .ptxt { position: absolute; left: 90px; right: 120px; top: 720px; font-family: "Dela Gothic One", sans-serif; line-height: 1.12; }
  .big { position: absolute; left: 40px; right: 40px; top: 560px; text-align: center; font-family: "Dela Gothic One", sans-serif; color: #ffffff; line-height: 1; text-shadow: 16px 16px 0 ${ink}; }
  .big-label { position: absolute; left: 120px; right: 120px; top: 1080px; text-align: center; font-size: 48px; font-weight: 800; line-height: 1.3; }
  .rc { position: absolute; left: 90px; right: 140px; padding: 26px 36px; background: ${ink}; color: #ffffff; font-size: 40px; font-weight: 700; line-height: 1.3; border-radius: 26px; }
  .rc-head { position: absolute; left: 90px; top: 440px; font-family: "Dela Gothic One", sans-serif; font-size: 90px; text-transform: uppercase; }`;
  const bg = `<div id="circle"></div><div id="slab"></div><div id="stripes"></div><div id="prog"></div>`;
  const ts = fit(item.title, 112, 66, 880, 4, 0.82);
  const titleWords = item.title
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => `<span class="m"><span class="w" id="s0-title-w${i}">${esc(w)}</span></span>`)
    .join(" ");
  const title = `<div class="t-tag" id="s0-tag">${esc(input.trackName)} · ${pad(input.number)}</div>
  <div class="t-title" id="s0-title" style="font-size:${ts}px">${titleWords}</div>
  <div class="t-hook" id="s0-hook">${esc(item.hook)}</div>
  <div class="t-icon" id="s0-icon">${icon(item.icon, 120, ink, 'data-stroke="2.2"')}</div>`;
  const titleTweens = [
    `tl.fromTo("#s0-tag", {opacity: 0, x: -60}, {opacity: 1, x: 0, duration: 0.5, ease: "expo.out"}, 0);`,
    `tl.fromTo("#s0-title .w", {yPercent: 105}, {yPercent: 0, duration: 0.6, stagger: 0.08, ease: "expo.out"}, 0);`,
    `tl.fromTo("#s0-hook", {opacity: 0, y: 30}, {opacity: 1, y: 0, duration: 0.6, ease: "power3.out"}, 0.6);`,
    `tl.fromTo("#s0-icon", {scale: 0, rotation: -90}, {scale: 1, rotation: 0, duration: 0.8, ease: "back.out(2)"}, 0.5);`,
  ];
  const beat = (b: Beat, id: string) => {
    if (b.kind === "point") {
      const text = item.points[b.index]!;
      const size = fit(text, 92, 58, 870, 5, 0.75);
      return {
        html: `<div class="pill" id="${id}-p">${pad(b.index + 1)}</div>
        <div class="ptxt" id="${id}-t" style="font-size:${size}px">${words(`${id}-t`, text)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-p", {scale: 0}, {scale: 1, duration: 0.5, ease: "back.out(2.4)"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-t .w", {opacity: 0, x: 80}, {opacity: 1, x: 0, duration: 0.45, stagger: 0.06, ease: "expo.out"}, ${f2(b.start + 0.15)});`,
        ],
      };
    }
    if (b.kind === "big") {
      return {
        html: `<div class="big" id="${id}-b" style="font-size:${bigSize(item.big, 300, 0.78, 960)}px">${esc(item.big)}</div>
        <div class="big-label" id="${id}-lb">${esc(item.bigLabel)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-b", {scale: 0.3, rotation: -12, opacity: 0}, {scale: 1, rotation: 0, opacity: 1, duration: 0.8, ease: "elastic.out(1, 0.6)"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-lb", {opacity: 0, y: 30}, {opacity: 1, y: 0, duration: 0.5, ease: "power3.out"}, ${f2(b.start + 0.4)});`,
        ],
      };
    }
    const rows = item.points.map((p, i) => `<div class="rc" id="${id}-r${i}" style="top:${640 + i * 210}px">${esc(p)}</div>`).join("");
    return {
      html: `<div class="rc-head" id="${id}-h">Итог</div>${rows}`,
      tweens: [
        `tl.fromTo("#${id}-h", {yPercent: 60, opacity: 0}, {yPercent: 0, opacity: 1, duration: 0.5, ease: "expo.out"}, ${f2(b.start)});`,
        `tl.fromTo("#${id} .rc", {x: -1000}, {x: 0, duration: 0.6, stagger: 0.3, ease: "expo.out"}, ${f2(b.start + 0.2)});`,
      ],
    };
  };
  return page(input, {
    css, bg, title, titleTweens, beat,
    persistent: [
      `tl.fromTo("#prog", {scaleX: 0}, {scaleX: 1, duration: ${f2(D)}, ease: "none"}, 0);`,
      `tl.fromTo("#circle", {x: 0, y: 0, scale: 1}, {x: -180, y: 520, scale: 0.8, duration: ${f2(D)}, ease: "sine.inOut"}, 0);`,
      `tl.fromTo("#slab", {rotation: -8, x: 0}, {rotation: 4, x: 220, duration: ${f2(D)}, ease: "sine.inOut"}, 0);`,
    ],
  }, accent);
}

// ---------------------------------------------------------------- 4. grid

function grid(input: TemplateInput): string {
  const { item, accent, voice } = input;
  const D = voice.duration;
  const a = mix(accent, "#ffffff", 0.1);
  const R = 300;
  const C = Math.round(2 * Math.PI * R);
  const css = `
  #root { background: #070b18; font-family: Geologica, sans-serif; color: #eef3ff; }
  #grid { position: absolute; inset: -100px; background-image: linear-gradient(${rgba(accent, 0.09)} 2px, transparent 2px), linear-gradient(90deg, ${rgba(accent, 0.09)} 2px, transparent 2px); background-size: 90px 90px; }
  #fade { position: absolute; inset: 0; background: radial-gradient(ellipse 70% 55% at 50% 45%, rgba(7,11,24,0) 0%, rgba(7,11,24,0.92) 100%); }
  #hud { position: absolute; left: 90px; right: 90px; top: 250px; display: flex; justify-content: space-between; font-size: 28px; letter-spacing: 5px; color: ${rgba(accent, 0.85)}; text-transform: uppercase; }
  #prog { position: absolute; left: 90px; right: 90px; top: 300px; height: 4px; background: ${a}; transform-origin: 0 50%; }
  .t-ring { position: absolute; left: 240px; top: 400px; width: 600px; height: 600px; }
  .t-icon { position: absolute; left: 440px; top: 600px; }
  .t-title { position: absolute; left: 90px; right: 90px; top: 1080px; text-align: center; font-weight: 800; line-height: 1.08; }
  .t-hook { position: absolute; left: 130px; right: 130px; top: 1400px; text-align: center; font-size: 40px; line-height: 1.4; color: #aab6d6; }
  .card { position: absolute; left: 90px; right: 90px; top: 720px; padding: 60px 60px 66px 80px; background: ${rgba(accent, 0.08)}; border: 2px solid ${rgba(accent, 0.35)}; border-radius: 34px; }
  .card:before { content: ""; position: absolute; left: 0; top: 40px; bottom: 40px; width: 10px; background: ${a}; border-radius: 0 6px 6px 0; }
  .lab { font-size: 30px; letter-spacing: 6px; color: ${a}; text-transform: uppercase; margin-bottom: 30px; }
  .ptxt { font-weight: 700; line-height: 1.22; }
  .big-ring { position: absolute; left: 190px; top: 460px; width: 700px; height: 700px; }
  .big { position: absolute; left: 190px; width: 700px; top: 460px; height: 700px; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #ffffff; }
  .big-label { position: absolute; left: 130px; right: 130px; top: 1230px; text-align: center; font-size: 42px; line-height: 1.4; color: #c5d0ee; }
  .mini { position: absolute; left: 90px; right: 90px; padding: 30px 40px 30px 110px; background: ${rgba(accent, 0.07)}; border: 2px solid ${rgba(accent, 0.25)}; border-radius: 24px; font-size: 38px; line-height: 1.3; }
  .mini b { position: absolute; left: 36px; top: 30px; color: ${a}; }
  .rc-head { position: absolute; left: 90px; top: 520px; font-size: 34px; letter-spacing: 6px; color: ${a}; text-transform: uppercase; }`;
  const bg = `<div id="grid"></div><div id="fade"></div><div id="hud"><span>${esc(input.trackName)}</span><span>LAB ${pad(input.number)}</span></div><div id="prog"></div>`;
  const ring = (cls: string, rid: string, size: number) =>
    `<svg class="${cls}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${R}" fill="none" stroke="${rgba(accent, 0.15)}" stroke-width="6"/><circle id="${rid}" cx="${size / 2}" cy="${size / 2}" r="${R}" fill="none" stroke="${a}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  const ts = fit(item.title, 92, 60, 900, 3, 0.62);
  const title = `${ring("t-ring", "s0-ring", 600)}
  <div class="t-icon" id="s0-icon">${icon(item.icon, 200, a)}</div>
  <div class="t-title" id="s0-title" style="font-size:${ts}px">${words("s0-title", item.title)}</div>
  <div class="t-hook" id="s0-hook">${esc(item.hook)}</div>`;
  const titleTweens = [
    `tl.fromTo("#s0-ring", {attr: {"stroke-dashoffset": ${C}}}, {attr: {"stroke-dashoffset": ${Math.round(C * 0.25)}}, duration: 1.6, ease: "power2.inOut"}, 0);`,
    `tl.fromTo("#s0-icon", {opacity: 0, scale: 0.7}, {opacity: 1, scale: 1, duration: 0.8, ease: "expo.out"}, 0);`,
    `tl.fromTo("#s0-title .w", {opacity: 0.15, filter: "blur(8px)"}, {opacity: 1, filter: "blur(0px)", duration: 0.4, stagger: 0.07, ease: "power3.out"}, 0);`,
    `tl.fromTo("#s0-hook", {opacity: 0, y: 20}, {opacity: 1, y: 0, duration: 0.6, ease: "power3.out"}, 0.7);`,
  ];
  const beat = (b: Beat, id: string) => {
    if (b.kind === "point") {
      const text = item.points[b.index]!;
      const size = fit(text, 76, 52, 760, 4, 0.6);
      return {
        html: `<div class="card" id="${id}-c"><div class="lab">Факт ${pad(b.index + 1)}</div><div class="ptxt" id="${id}-t" style="font-size:${size}px">${words(`${id}-t`, text)}</div></div>`,
        tweens: [
          `tl.fromTo("#${id}-c", {opacity: 0, x: 140, filter: "blur(10px)"}, {opacity: 1, x: 0, filter: "blur(0px)", duration: 0.7, ease: "expo.out"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-t .w", {opacity: 0.2}, {opacity: 1, duration: 0.3, stagger: 0.05, ease: "power2.out"}, ${f2(b.start + 0.3)});`,
        ],
      };
    }
    if (b.kind === "big") {
      return {
        html: `${ring("big-ring", `${id}-ring`, 700)}<div class="big" id="${id}-b" style="font-size:${bigSize(item.big, 200, 0.62, 560)}px">${esc(item.big)}</div>
        <div class="big-label" id="${id}-lb">${esc(item.bigLabel)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-ring", {attr: {"stroke-dashoffset": ${C}}}, {attr: {"stroke-dashoffset": 0}, duration: 1.4, ease: "power2.inOut"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-b", {opacity: 0, scale: 0.85}, {opacity: 1, scale: 1, duration: 0.7, ease: "expo.out"}, ${f2(b.start + 0.2)});`,
          `tl.fromTo("#${id}-lb", {opacity: 0}, {opacity: 1, duration: 0.6}, ${f2(b.start + 0.6)});`,
        ],
      };
    }
    const rows = item.points.map((p, i) => `<div class="mini" id="${id}-r${i}" style="top:${600 + i * 190}px"><b>${pad(i + 1)}</b>${esc(p)}</div>`).join("");
    return {
      html: `<div class="rc-head" id="${id}-h">Результат</div>${rows}`,
      tweens: [
        `tl.fromTo("#${id}-h", {opacity: 0}, {opacity: 1, duration: 0.4}, ${f2(b.start)});`,
        `tl.fromTo("#${id} .mini", {opacity: 0, y: 40, scale: 0.96}, {opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.3, ease: "expo.out"}, ${f2(b.start + 0.2)});`,
      ],
    };
  };
  return page(input, {
    css, bg, title, titleTweens, beat,
    persistent: [
      `tl.fromTo("#prog", {scaleX: 0}, {scaleX: 1, duration: ${f2(D)}, ease: "none"}, 0);`,
      `tl.fromTo("#grid", {x: 0, y: 0}, {x: -90, y: -180, duration: ${f2(D)}, ease: "none"}, 0);`,
    ],
  }, "#070b18");
}

// ---------------------------------------------------------------- 5. soft

function soft(input: TemplateInput): string {
  const { item, accent, voice } = input;
  const D = voice.duration;
  const ink = "#1f2340";
  const deep = mix(accent, "#000000", 0.35);
  const css = `
  #root { background: ${mix(accent, "#ffffff", 0.86)}; font-family: Rubik, sans-serif; color: ${ink}; }
  #wash { position: absolute; inset: 0; background: linear-gradient(170deg, ${mix(accent, "#ffffff", 0.9)} 0%, ${mix(accent, "#ffffff", 0.72)} 100%); }
  .blob { position: absolute; border-radius: 50%; filter: blur(6px); }
  #prog-wrap { position: absolute; left: 90px; right: 90px; top: 250px; height: 18px; border-radius: 9px; background: rgba(255,255,255,0.7); }
  #prog { position: absolute; inset: 0; border-radius: 9px; background: ${deep}; transform-origin: 0 50%; }
  .t-badge { position: absolute; left: 90px; top: 360px; width: 230px; height: 230px; border-radius: 70px; background: ${deep}; display: flex; align-items: center; justify-content: center; box-shadow: 0 30px 60px ${rgba(deep, 0.35)}; }
  .t-title { position: absolute; left: 90px; right: 110px; top: 680px; font-weight: 800; line-height: 1.08; }
  .t-hook { position: absolute; left: 90px; right: 150px; top: 1180px; padding: 36px 44px; background: #ffffff; border-radius: 36px; font-size: 42px; line-height: 1.4; box-shadow: 0 20px 50px rgba(31,35,64,0.1); }
  .card { position: absolute; left: 90px; right: 110px; top: 720px; padding: 70px 64px; background: #ffffff; border-radius: 50px; box-shadow: 0 30px 70px rgba(31,35,64,0.12); }
  .chip { position: absolute; left: 64px; top: -44px; width: 88px; height: 88px; border-radius: 50%; background: ${deep}; color: #ffffff; font-weight: 800; font-size: 40px; display: flex; align-items: center; justify-content: center; }
  .ptxt { font-weight: 700; line-height: 1.24; }
  .bubble { position: absolute; left: 165px; top: 470px; width: 750px; height: 750px; border-radius: 50%; background: ${deep}; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 900; box-shadow: 0 40px 90px ${rgba(deep, 0.4)}; }
  .big-label { position: absolute; left: 130px; right: 130px; top: 1290px; text-align: center; font-size: 44px; font-weight: 600; line-height: 1.35; }
  .rc-head { position: absolute; left: 90px; top: 460px; font-size: 72px; font-weight: 800; }
  .rc { position: absolute; left: 90px; right: 110px; padding: 30px 40px 30px 120px; background: #ffffff; border-radius: 34px; font-size: 40px; font-weight: 600; line-height: 1.3; box-shadow: 0 16px 40px rgba(31,35,64,0.08); }
  .rc i, .rc svg { position: absolute; left: 36px; top: 30px; }`;
  const bg = `<div id="wash"></div>
  <div class="blob" id="b1" style="left:-160px;top:1250px;width:620px;height:620px;background:${rgba(accent, 0.45)}"></div>
  <div class="blob" id="b2" style="right:-200px;top:180px;width:560px;height:560px;background:${rgba(mix(accent, "#ffffff", 0.3), 0.55)}"></div>
  <div id="prog-wrap"><div id="prog"></div></div>`;
  const ts = fit(item.title, 106, 66, 880, 3, 0.62);
  const title = `<div class="t-badge" id="s0-badge">${icon(item.icon, 130, "#ffffff", 'data-stroke="2"')}</div>
  <div class="t-title" id="s0-title" style="font-size:${ts}px">${words("s0-title", item.title)}</div>
  <div class="t-hook" id="s0-hook">${esc(item.hook)}</div>`;
  const titleTweens = [
    `tl.fromTo("#s0-badge", {scale: 0, rotation: 30}, {scale: 1, rotation: 0, duration: 0.8, ease: "back.out(2.2)"}, 0);`,
    `tl.fromTo("#s0-title .w", {opacity: 0, y: 40, scale: 0.9}, {opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.06, ease: "back.out(1.7)"}, 0);`,
    `tl.fromTo("#s0-hook", {opacity: 0, y: 40}, {opacity: 1, y: 0, duration: 0.7, ease: "back.out(1.5)"}, 0.7);`,
  ];
  const beat = (b: Beat, id: string) => {
    if (b.kind === "point") {
      const text = item.points[b.index]!;
      const size = fit(text, 76, 52, 750, 4, 0.6);
      return {
        html: `<div class="card" id="${id}-c"><div class="chip">${b.index + 1}</div><div class="ptxt" id="${id}-t" style="font-size:${size}px">${words(`${id}-t`, text)}</div></div>`,
        tweens: [
          `tl.fromTo("#${id}-c", {opacity: 0, scale: 0.8, y: 80}, {opacity: 1, scale: 1, y: 0, duration: 0.7, ease: "back.out(1.6)"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-t .w", {opacity: 0, y: 12}, {opacity: 1, y: 0, duration: 0.3, stagger: 0.04, ease: "power2.out"}, ${f2(b.start + 0.3)});`,
        ],
      };
    }
    if (b.kind === "big") {
      return {
        html: `<div class="bubble" id="${id}-b" style="font-size:${bigSize(item.big, 210, 0.62, 600)}px">${esc(item.big)}</div>
        <div class="big-label" id="${id}-lb">${esc(item.bigLabel)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-b", {scale: 0}, {scale: 1, duration: 0.9, ease: "elastic.out(1, 0.55)"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-lb", {opacity: 0, y: 30}, {opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.5)"}, ${f2(b.start + 0.5)});`,
        ],
      };
    }
    const rows = item.points
      .map((p, i) => `<div class="rc" id="${id}-r${i}" style="top:${640 + i * 200}px">${icon("circle-check", 56, deep)}${esc(p)}</div>`)
      .join("");
    return {
      html: `<div class="rc-head" id="${id}-h">Запомним</div>${rows}`,
      tweens: [
        `tl.fromTo("#${id}-h", {opacity: 0, y: 30}, {opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.6)"}, ${f2(b.start)});`,
        `tl.fromTo("#${id} .rc", {opacity: 0, scale: 0.85}, {opacity: 1, scale: 1, duration: 0.5, stagger: 0.3, ease: "back.out(1.8)"}, ${f2(b.start + 0.3)});`,
      ],
    };
  };
  return page(input, {
    css, bg, title, titleTweens, beat,
    persistent: [
      `tl.fromTo("#prog", {scaleX: 0}, {scaleX: 1, duration: ${f2(D)}, ease: "none"}, 0);`,
      `tl.fromTo("#b1", {x: 0, y: 0}, {x: 260, y: -220, duration: ${f2(D)}, ease: "sine.inOut"}, 0);`,
      `tl.fromTo("#b2", {x: 0, y: 0}, {x: -200, y: 300, duration: ${f2(D)}, ease: "sine.inOut"}, 0);`,
    ],
  }, mix(accent, "#ffffff", 0.86));
}

// ---------------------------------------------------------------- 6. condensed

function condensed(input: TemplateInput): string {
  const { item, accent, voice } = input;
  const D = voice.duration;
  const css = `
  #root { background: #0b0b0c; font-family: Onest, sans-serif; color: #f4f4f2; }
  #beam { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; background: linear-gradient(115deg, transparent 0%, ${rgba(accent, 0.13)} 45%, transparent 70%); }
  #side { position: absolute; left: 60px; top: 260px; bottom: 420px; width: 8px; background: ${accent}; transform-origin: 50% 0; }
  #meta { position: absolute; left: 100px; right: 90px; top: 236px; display: flex; justify-content: space-between; font-size: 26px; letter-spacing: 5px; color: #8f8f8a; text-transform: uppercase; }
  #prog { position: absolute; left: 100px; right: 90px; bottom: 420px; height: 4px; background: ${accent}; transform-origin: 0 50%; }
  .t-title { position: absolute; left: 100px; right: 90px; top: 420px; font-family: "Alumni Sans", sans-serif; font-weight: 900; line-height: 0.9; text-transform: uppercase; }
  .t-hook { position: absolute; left: 100px; right: 170px; top: 1180px; font-size: 44px; line-height: 1.4; color: #c9c9c3; }
  .t-icon { position: absolute; right: 90px; top: 1350px; }
  .idx { position: absolute; left: 80px; top: 400px; font-family: "Alumni Sans", sans-serif; font-weight: 900; font-size: 420px; line-height: 1; color: transparent; -webkit-text-stroke: 4px ${accent}; }
  .ptxt { position: absolute; left: 100px; right: 120px; top: 920px; font-weight: 700; line-height: 1.2; }
  .big { position: absolute; left: 60px; right: 60px; top: 440px; text-align: center; font-family: "Alumni Sans", sans-serif; font-weight: 900; color: ${accent}; line-height: 1; }
  .big-label { position: absolute; left: 120px; right: 120px; top: 1130px; text-align: center; font-size: 44px; line-height: 1.4; color: #d9d9d4; }
  .rc { position: absolute; left: 100px; right: 120px; font-family: "Alumni Sans", sans-serif; font-weight: 800; font-size: 76px; line-height: 0.98; text-transform: uppercase; }
  .rc span { color: ${accent}; margin-right: 22px; }
  .rc-head { position: absolute; left: 100px; top: 460px; font-size: 30px; letter-spacing: 6px; color: #8f8f8a; text-transform: uppercase; }`;
  const bg = `<div id="beam"></div><div id="side"></div><div id="meta"><span>${esc(input.trackName)}</span><span>${pad(input.number)} / 20</span></div><div id="prog"></div>`;
  const ts = fit(item.title, 190, 110, 890, 4, 0.42);
  const title = `<div class="t-title" id="s0-title" style="font-size:${ts}px">${words("s0-title", item.title)}</div>
  <div class="t-hook" id="s0-hook">${esc(item.hook)}</div>
  <div class="t-icon" id="s0-icon">${icon(item.icon, 150, accent)}</div>`;
  const titleTweens = [
    `tl.fromTo("#s0-title .w", {opacity: 0, x: -120}, {opacity: 1, x: 0, duration: 0.55, stagger: 0.07, ease: "expo.out"}, 0);`,
    `tl.fromTo("#s0-hook", {opacity: 0}, {opacity: 1, duration: 0.7}, 0.6);`,
    `tl.fromTo("#s0-icon", {opacity: 0, y: 40}, {opacity: 1, y: 0, duration: 0.7, ease: "expo.out"}, 0.8);`,
  ];
  const beat = (b: Beat, id: string) => {
    if (b.kind === "point") {
      const text = item.points[b.index]!;
      const size = fit(text, 76, 52, 860, 4, 0.58);
      return {
        html: `<div class="idx" id="${id}-i">${pad(b.index + 1)}</div><div class="ptxt" id="${id}-t" style="font-size:${size}px">${words(`${id}-t`, text)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-i", {opacity: 0, x: -80}, {opacity: 1, x: 0, duration: 0.7, ease: "expo.out"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-t .w", {opacity: 0, y: 30}, {opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: "expo.out"}, ${f2(b.start + 0.2)});`,
        ],
      };
    }
    if (b.kind === "big") {
      return {
        html: `<div class="big" id="${id}-b" style="font-size:${bigSize(item.big, 440, 0.42, 960)}px">${esc(item.big)}</div>
        <div class="big-label" id="${id}-lb">${esc(item.bigLabel)}</div>`,
        tweens: [
          `tl.fromTo("#${id}-b", {opacity: 0, scaleY: 0.2, transformOrigin: "50% 100%"}, {opacity: 1, scaleY: 1, duration: 0.7, ease: "expo.out"}, ${f2(b.start)});`,
          `tl.fromTo("#${id}-lb", {opacity: 0, y: 20}, {opacity: 1, y: 0, duration: 0.5, ease: "power3.out"}, ${f2(b.start + 0.4)});`,
        ],
      };
    }
    const rows = item.points.map((p, i) => `<div class="rc" id="${id}-r${i}" style="top:${550 + i * 230}px"><span>${pad(i + 1)}</span>${esc(p)}</div>`).join("");
    return {
      html: `<div class="rc-head" id="${id}-h">Главное</div>${rows}`,
      tweens: [
        `tl.fromTo("#${id}-h", {opacity: 0}, {opacity: 1, duration: 0.4}, ${f2(b.start)});`,
        `tl.fromTo("#${id} .rc", {opacity: 0, x: -100}, {opacity: 1, x: 0, duration: 0.5, stagger: 0.3, ease: "expo.out"}, ${f2(b.start + 0.2)});`,
      ],
    };
  };
  return page(input, {
    css, bg, title, titleTweens, beat,
    persistent: [
      `tl.fromTo("#side", {scaleY: 0}, {scaleY: 1, duration: 1.2, ease: "expo.out"}, 0);`,
      `tl.fromTo("#prog", {scaleX: 0}, {scaleX: 1, duration: ${f2(D)}, ease: "none"}, 0);`,
      `tl.fromTo("#beam", {x: -700}, {x: 700, duration: ${f2(D)}, ease: "sine.inOut"}, 0);`,
    ],
  }, "#0b0b0c");
}

const BUILDERS: Record<Style, (input: TemplateInput) => string> = { terminal, editorial, poster, grid, soft, condensed };

export function compose(style: Style, input: TemplateInput): string {
  return BUILDERS[style](input);
}
