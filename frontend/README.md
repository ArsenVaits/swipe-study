# ScrollEd — frontend

Next.js, TypeScript, and Tailwind web app with a vertical feed of short lessons. Open a text PDF, choose a page or highlight a passage, then select Create my lesson. ScrollEd sends the selected text, document title, page number, and an anonymous browser session ID to the lesson API. The returned lesson and quiz are available while the video renders.

The API contract is described in [../docs/FRONTEND_API.md](../docs/FRONTEND_API.md).

## Run locally

Start the backend first (see [../backend/README.md](../backend/README.md)), then in this `frontend/` folder:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Next.js proxies `/api` and `/demo` to `http://127.0.0.1:3001`. To use another backend, set `SCROLLED_API_ORIGIN` in `.env.local` and restart Next.js. The backend owns the Opus and LTX keys. The bundled sample lessons are available without a backend.

The backend status is available at http://localhost:3000/api/health. Its `lessonAi` field must be `configured` for new lessons. The `videoProvider` field reports `mock` or `ltx`.

## Build

```sh
npm run build
npm start
```

The build uses the Next.js server for the proxy and bundles the matching PDF.js worker. Use a PDF with selectable text, up to 20 MB. The selected passage must have 80–12,000 characters. Saved lessons stay in this browser and can refresh their video through the saved job ID. Links to uploaded PDFs work while the original browser tab remains open.
