import express from "express";
import { config } from "./config.ts";
import { errorHandler } from "./http/errors.ts";
import { PUBLIC_DIR } from "./paths.ts";
import { lessonJobsRouter } from "./routes/lessonJobs.ts";
import { videoConfigWarnings, videoProvider } from "./video/index.ts";

const app = express();
app.disable("x-powered-by");

// CORS for the separately served frontend (comma-separated origins, or "*").
const allowedOrigins = config.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    videoProvider: videoProvider.name,
    lessonAi: config.ANTHROPIC_API_KEY ? "configured" : "missing_key",
  });
});
app.use("/api/lesson-jobs", lessonJobsRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown API route.", details: null }, jobId: null });
});

// Demo video and other static assets: backend/public/demo/lesson.mp4 -> /demo/lesson.mp4
app.use(express.static(PUBLIC_DIR, { index: false }));

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`ScrollEd backend on http://localhost:${config.PORT} (video provider: ${videoProvider.name})`);
  if (!config.ANTHROPIC_API_KEY) console.warn("[opus] ANTHROPIC_API_KEY is not set: POST /api/lesson-jobs will return AI_NOT_CONFIGURED.");
  for (const w of videoConfigWarnings()) console.warn(w);
});
