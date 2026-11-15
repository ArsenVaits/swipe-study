# swipe study — frontend

Next.js, TypeScript, and Tailwind web app with a vertical feed of short lessons. Open a text PDF and select Create my lessons. swipe study reads every page (up to 300,000 characters) and sends the text by page, the document title, and an anonymous browser session ID to `POST /api/lesson-sets`. The server decides how many lessons the material deserves (one for single-topic notes, up to ten for a book) and the feed adds them one by one as they are written; each video follows when its render finishes.

The API contract is described in [../docs/FRONTEND_API.md](../docs/FRONTEND_API.md).

## Run locally

Start the backend first (see [../backend/README.md](../backend/README.md)), then in this `frontend/` folder:

```sh
npm ci
npm run dev
```

Open http://localhost:3000 for the homepage or http://localhost:3000/studio for the lesson feed. Next.js proxies `/api` and `/demo` to `http://127.0.0.1:3001`. To use another backend, set `SCROLLED_API_ORIGIN` in `.env.local` and restart Next.js. The backend owns the Opus and LTX keys. The bundled sample lessons are available without a backend.

The backend status is available at http://localhost:3000/api/health. Its `lessonAi` field must be `configured` for new lessons. The `videoProvider` field reports `mock` or `ltx`.

## Build

```sh
npm run build
npm start
```

The build uses the Next.js server for the proxy and bundles the matching PDF.js worker. Use a PDF with selectable text, up to 20 MB. Saved lessons stay in this browser and can refresh their video through the saved job ID. Links to uploaded PDFs work while the original browser tab remains open.

The homepage uses selected visual assets from [MotionSmith](https://motionsmith.miftahul.com/).
