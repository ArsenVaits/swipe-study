# ScrollEd backend (MVP)

Production: Node 24.22.3 (pinned in `.node-version`) · TypeScript run natively by Node · Express 5 · Zod · SQLite (`node:sqlite`, a file in `data/`).

## Run

```bash
cd backend
npm ci
cp .env.example .env      # set ANTHROPIC_API_KEY
# put the demo clip at public/demo/lesson.mp4
npm run dev               # http://localhost:3001
npm run typecheck
npm test               # isolated real-server API and SQLite persistence tests
```

Health check: `GET /api/health` → `{ ok, videoProvider, lessonAi }`.

Production auto-deployment runs on every push to `main` through **Deploy backend** in GitHub Actions. `GET /api/health` includes the running `revision`; `GET /api/deployment` returns the exact commit and release identity. Environment files and SQLite stay outside releases. Setup, logs, and rollback commands: [../DEPLOYMENT.md](../DEPLOYMENT.md).

Switch video: `VIDEO_PROVIDER=ltx` + `LTX_API_KEY=...`, or `VIDEO_PROVIDER=hyperframes` (see below), restart. The frontend contract does not change.

## API

All errors: `{ "error": { "code", "message", "details" }, "jobId": string | null }`.

### `POST /api/lesson-jobs`

Body: `{ sourceTitle: string ≤200, sourcePage: int ≥1, sourceText: string 80..MAX_SOURCE_CHARS, sessionId: [A-Za-z0-9_-]{8,128} }`

Takes ~10–40 s (Opus generates the lesson; the video is **not** awaited). `201`:

```json
{
  "jobId": "uuid",
  "status": "rendering_video",
  "lesson": { "title", "hook", "explanation", "narration", "captions": [], "scenePrompt",
              "quiz": { "question", "options": [3-4], "answerIndex", "explanation" },
              "sourceQuote", "sourcePage" },
  "videoUrl": null,
  "error": null
}
```

Errors: `400 VALIDATION_ERROR`, `413 PAYLOAD_TOO_LARGE`, `429 SESSION_LIMIT_REACHED`,
`422 INSUFFICIENT_SOURCE` (message explains why), `422 LESSON_REFUSED`,
`502/503 LESSON_GENERATION_FAILED`, `503 AI_NOT_CONFIGURED`.

### `GET /api/lesson-jobs/:jobId`

Same shape as above. Poll every 3–5 s while `status === "rendering_video"`.

| status | meaning |
|---|---|
| `generating_lesson` | Opus is still working (normally only visible if POST was interrupted) |
| `rendering_video` | lesson is ready, video is rendering |
| `ready` | `videoUrl` is set |
| `failed` | see `error.stage`: `"lesson"` → no lesson; `"video"` → **lesson and quiz are still in `lesson`**, show them without video |

`videoUrl` may be relative (`/demo/lesson.mp4`) — the Next.js frontend already proxies `/api` and `/demo` to the backend; without the proxy, prefix with the backend origin.

## How it works

1. Request validated with Zod; per-session lesson limit checked; job row saved (`generating_lesson`).
2. Opus (`claude-opus-5-5`) gets only the selected text + title/page, with the rule to stay grounded in it.
   It calls the `start_video_generation` tool; the backend handles `tool_use`, starts the render via the
   `VideoProvider` and returns a `tool_result`. Opus then returns the lesson as structured JSON.
   If Opus skips the tool (or `OPUS_TOOL_CALLING=false`), the backend starts the render from `lesson.scenePrompt`.
3. Lesson is re-validated (lengths, 3–4 distinct options, valid `answerIndex`, `sourceQuote` must be
   verbatim from the source, `sourcePage` taken from the request). Job → `rendering_video`.
4. `GET` checks the provider (no more than once per 5 s for LTX) and moves the job to `ready` / `failed`.

Server-side refusal fallback is on (`fallbacks: "default"`): if Opus declines, the API retries on a fallback model in the same call.

## Video providers

- **mock** (default): same lifecycle, “renders” for `MOCK_VIDEO_DELAY_MS`, then returns `MOCK_VIDEO_URL`.
  If the file is missing, the job ends with `failed` / `stage: "video"` and a message where to put it.
- **hyperframes**: see above.
- **ltx**: `POST https://api.ltx.io/v2/text-to-video` → poll `GET /v2/text-to-video/{id}`.
  Fixed on the server: `ltx-2-5-fast`, 6 s, `720x1280`, 24 fps, no audio. The browser can't change them.
  `result.video_url` is a temporary link from LTX (no fixed TTL documented) — fine for a live demo,
  re-host it (S3 etc.) for anything longer.

## HyperFrames videos (`VIDEO_PROVIDER=hyperframes`)

Animated explainer reels (diagrams, charts, kinetic type, optional voice; burned-in subtitles only with
`HYPERFRAMES_CAPTIONS=true`, off by default because the frontend draws captions) built with
[HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0): HTML + CSS + SVG + GSAP rendered frame by
frame in headless Chrome, encoded with FFmpeg.

Setup: `brew install ffmpeg` (or `apt install ffmpeg`), Chrome (system Chrome works, or `npx hyperframes browser`),
then `npx hyperframes doctor`. Optional voice: `TTS_PROVIDER=openai` + `OPENAI_API_KEY`, or `elevenlabs` +
`ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`. Optional music/SFX: drop files into `assets/audio/` (see its README).

Pipeline per lesson (runs in the background after `POST` returns; `GET` reports `rendering_video` until done):

1. **Voice** (`src/tts`): narration split into sentences, each voiced (PCM 24 kHz), glued into `voice.wav` with
   exact per-line timings. TTS off or failing → silent timeline at reading speed; the video is still made.
2. **Composition** (`src/video/hyperframes/compose.ts`): Opus gets the lesson, the timed voice lines and the
   available audio, plus a condensed HyperFrames skill (`prompt.ts`: render contract, 9:16 safe zones, explainer
   devices, motion craft, captions, sound) and writes one `index.html`.
3. **Sanitize** (`sanitize.ts`): the HTML is model-written code, so every external script/stylesheet/iframe is
   stripped, a strict CSP (no network) is injected and GSAP is loaded from a local copy. Render subprocesses get
   no server secrets and HyperFrames telemetry is off.
4. **Check** (`hyperframes check --json`): lint, runtime JS errors, layout/safe zones, contrast. Findings go back to
   Opus for `HYPERFRAMES_FIX_ROUNDS` fix rounds. Code that still breaks (lint/runtime errors) → built-in fallback
   template (`fallback.ts`, kinetic type from the lesson), so a lesson still gets a video.
5. **Render** (`hyperframes render`, at most `HYPERFRAMES_MAX_PARALLEL_RENDERS` at once) → FFmpeg loudness pass
   (−14 LUFS, −1.5 dBTP, video stream copied) → ffprobe check (H.264, 1080×1920, expected length).
6. MP4 lands in `<db dir>/videos/<id>.mp4` (next to `DATABASE_PATH`, so it survives deploys), served at
   `/api/media/<id>.mp4`. Status lives in `<db dir>/hyperframes/<id>.json`; a render cut off by a restart is reported as failed (no auto-retry).

Cost per video: one Opus conversation (draft + fix rounds, prompt-cached system prompt) and the TTS characters
of the narration; rendering is local CPU (~10–60 s per video on an M-series Mac). Not for serverless hosting
(needs Chrome + FFmpeg + local disk): run on a VM/container. `MAX_VIDEO_JOBS_TOTAL` caps the total spend.

## Limitations (deliberate for the MVP)

- SQLite file: one server instance only; jobs survive restarts.
- `sessionId` is client-generated, so per-session limits are soft; `MAX_VIDEO_JOBS_TOTAL` caps total LTX spend.
- No auth, no automatic retries of failed generations, source text is not stored (only its length).
