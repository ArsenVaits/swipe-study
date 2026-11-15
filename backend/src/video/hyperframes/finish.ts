// Finishing layer added by the backend (not the model), so every video gets the same restrained
// film treatment: a soft vignette and moving grain. Grain also hides gradient banding in H.264.

const NOISE =
  "data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const GRAIN_STEP_S = 0.12;

export function addFinishingLayer(html: string, duration: number): string {
  if (html.includes('id="hf-finish"')) return html;
  const iterations = Math.max(1, Math.ceil(duration / GRAIN_STEP_S));
  const layer = `
<div id="hf-finish" class="clip" data-start="0" data-duration="${duration}" data-layout-ignore aria-hidden="true"
     style="position:absolute;inset:0;pointer-events:none;z-index:9000;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 85% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.16) 100%)"></div>
  <div id="hf-grain" style="position:absolute;left:-25%;top:-25%;width:150%;height:150%;opacity:0.075;mix-blend-mode:overlay;
       background:url(&quot;${NOISE}&quot;);background-size:256px 256px;
       animation:hf-grain ${GRAIN_STEP_S * 4}s steps(1) ${Math.ceil(iterations / 4)} both"></div>
</div>
<style>
  @keyframes hf-grain { 0% { transform: translate(0,0) } 25% { transform: translate(-7%,4%) } 50% { transform: translate(5%,-6%) } 75% { transform: translate(-3%,-8%) } 100% { transform: translate(0,0) } }
</style>`;
  const root = /<div\b[^>]*data-composition-id=["']main["'][^>]*>/i;
  return root.test(html) ? html.replace(root, (m) => m + layer) : html;
}
