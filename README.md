# ScrollEd

B2C app for busy adults: turns fragments of a PDF into short lessons with video, captions and a quiz, in a vertical feed.

## Structure

```
frontend/   Next.js app: PDF upload, page selection, lesson feed, quiz   (port 3000)
backend/    Express API: lesson generation with Claude Opus, video jobs  (port 3001)
docs/       FRONTEND_API.md — API contract between frontend and backend
```

Each part has its own `package.json`, dependencies and README.

## Run locally

Backend (terminal 1):

```sh
cd backend
npm ci
cp .env.example .env   # set ANTHROPIC_API_KEY
npm run dev
```

Frontend (terminal 2):

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. The frontend proxies `/api` and `/demo` to the backend.

Details: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md), [docs/FRONTEND_API.md](docs/FRONTEND_API.md).

## Contributors

- [ArsenVaits](https://github.com/ArsenVaits)
- [lackoftalentt](https://github.com/lackoftalentt)
