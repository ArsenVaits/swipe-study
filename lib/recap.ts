const duration = 6_000;

function recapType() {
  if (!("MediaRecorder" in window)) return undefined;
  return ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
}

export async function renderRecap(captions: string[]) {
  const mimeType = recapType();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!mimeType || !context || !canvas.captureStream) {
    throw new Error("Video recording is unavailable in this browser. You can still read and hear the lesson.");
  }
  canvas.width = 720;
  canvas.height = 1280;
  const cx = 360;
  const stream = canvas.captureStream(24);
  try {
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
    const pieces: Blob[] = [];
    const file = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) pieces.push(event.data); };
      recorder.onerror = () => reject(new Error("This browser could not render the recap. Try again."));
      recorder.onstop = () => {
        if (pieces.length) resolve(new Blob(pieces, { type: mimeType }));
        else reject(new Error("This browser could not render the recap. Try again."));
      };
    });
    const palettes = [["#1c1240", "#c9b3ff"], ["#282050", "#c0afff"], ["#302564", "#e2d7ff"]];
    const draw = (fraction: number) => {
      const index = Math.min(captions.length - 1, Math.floor(fraction * captions.length));
      const [background, accent] = palettes[index % palettes.length];
      context.fillStyle = background;
      context.fillRect(0, 0, 720, 1280);
      context.strokeStyle = accent;
      context.globalAlpha = 0.37;
      context.lineWidth = 2;
      for (let ring = 0; ring < 4; ring++) {
        context.beginPath();
        context.ellipse(cx, 555, 166 + ring * 42, 104 + ring * 47, fraction * 2 + ring / 4, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.fillStyle = background;
      context.beginPath();
      context.roundRect(82, 485, 556, 152, 22);
      context.fill();
      context.fillStyle = accent;
      context.font = '700 24px "DM Sans Variable", sans-serif';
      context.textAlign = "center";
      context.fillText("SCROLLED RECAP", cx, 148);
      context.fillStyle = "#fff";
      context.font = '700 55px "Manrope Variable", sans-serif';
      const lines = captions[index].match(/\S+(?:\s+\S+){0,2}/gu) ?? [""];
      lines.slice(0, 6).forEach((line, row) => context.fillText(line, cx, 590 + 60 * (row - (lines.length - 1) / 2), 550));
      context.fillStyle = accent;
      context.fillRect(86, 1090, 548 * fraction, 4);
    };
    draw(0);
    recorder.start();
    const started = performance.now();
    const timer = window.setInterval(() => {
      const fraction = Math.min(1, (performance.now() - started) / duration);
      draw(fraction);
      if (fraction === 1 && recorder.state !== "inactive") recorder.stop();
    }, 1000 / 24);
    try {
      return URL.createObjectURL(await file);
    } finally {
      window.clearInterval(timer);
    }
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
