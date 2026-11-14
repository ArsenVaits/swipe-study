# ScrollEd

ScrollEd is an English-language, client-only Next.js, TypeScript and Tailwind app. It opens on a scroll-snapping feed with two sample shorts. Upload a text PDF, pick a page or highlight at least 12 words, then select Create my lesson. The browser shows an extractive summary and a quiz while it renders a six-second typographic recap with Canvas and MediaRecorder. The PDF source tab and quiz feedback link to the original page for the current session. Read aloud uses the browser's speech synthesis.

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:3000. No API keys or server-side services are required.

## Verify and export

```sh
npm test
npm run build
```

The static website is exported to `out/`. Serve that folder over HTTP from the root of a static host. The build copies the version-matched PDF.js worker into the site. Text PDFs up to 20 MB are supported. For password-protected PDFs, use an unlocked copy. Scanned pages require a text layer. Saved lesson text persists in the browser. Uploaded files and recap videos remain available for the current tab session. A saved lesson can render its recap again after reload.

## Contributors

- [ArsenVaits](https://github.com/ArsenVaits)
- [lackoftalentt](https://github.com/lackoftalentt)
