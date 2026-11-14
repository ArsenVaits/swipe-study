# ScrollEd — API бэкенда для фронтенда

Документ описывает всё, что нужно фронтенду для работы с бэкендом MVP: маршруты, форматы, статусы, ошибки, лимиты и рекомендуемый поток в UI.

- Бэкенд: `backend/` (Node + Express), по умолчанию `http://localhost:3001`
- Все маршруты под префиксом `/api`, формат — JSON (`Content-Type: application/json`)
- Авторизации нет. Секретов на фронте нет и не нужно — ключи Opus и LTX живут только на сервере
- PDF на бэкенд **не отправляется**: фронт сам извлекает текст выбранных страниц и шлёт только его

---

## 1. Быстрый старт для фронта

### Через proxy Next.js (так уже настроено в `frontend/`)

`frontend/next.config.ts` проксирует `/api/*` и `/demo/*` на бэкенд (`SCROLLED_API_ORIGIN`, по умолчанию `http://127.0.0.1:3001`). CORS не нужен, а относительный `videoUrl` вида `/demo/lesson.mp4` работает как есть.

### Без proxy

Ходите напрямую на `http://localhost:3001`. CORS разрешён для `http://localhost:3000` (на бэкенде настраивается `CORS_ORIGIN`, можно несколько через запятую). Относительный `videoUrl` в этом случае нужно префиксовать адресом бэкенда (см. раздел 6).

---

## 2. Общий поток

```
Пользователь выбрал страницы PDF
        │
        ▼
POST /api/lesson-jobs  ──(10–40 с, Opus генерирует урок)──►  201 { jobId, status: "rendering_video", lesson, videoUrl: null }
        │
        │  сразу показываем урок + квиз, на месте видео — прогресс
        ▼
GET /api/lesson-jobs/:jobId  каждые 3–5 с
        │
        ├─ "rendering_video" → продолжаем опрос
        ├─ "ready"           → показываем видео (videoUrl)
        └─ "failed"          → смотрим error.stage (см. раздел 5)
```

Важно:
- `POST` **ждёт генерацию урока**, но **не ждёт видео**. Покажите лоадер на 10–40 секунд.
- Видео рендерится в фоне. С mock-провайдером — ~8 с, с реальным LTX — дольше (минута и более), с HyperFrames — обычно 1–3 минуты (озвучка → Opus пишет анимацию → проверка → рендер).
- Урок и квиз приходят уже в ответе `POST`. Опрос нужен только ради видео.

---

## 3. Маршруты

### 3.1. `POST /api/lesson-jobs` — создать урок

**Тело запроса**

```json
{
  "sourceTitle": "Feedback at Work",
  "sourcePage": 3,
  "sourceText": "Selected text extracted from the PDF",
  "sessionId": "0b7c6f0e-4a1e-4d0a-9c55-2f1a6a3f9e21"
}
```

| Поле | Тип | Правила |
|---|---|---|
| `sourceTitle` | string | 1–200 символов (пробелы по краям обрезаются). Название документа/раздела |
| `sourcePage` | integer | ≥ 1. Номер страницы, с которой взят текст (если выбрано несколько — первая) |
| `sourceText` | string | 80–12 000 символов после обрезки пробелов. Извлечённый текст выбранного фрагмента |
| `sessionId` | string | 8–128 символов, только `A-Z a-z 0-9 _ -`. Анонимный ID сессии (см. раздел 7) |

Общий размер тела — не больше 100 КБ.

**Успешный ответ — `201 Created`**

```json
{
  "jobId": "003f73ef-b5ec-4060-8c3b-0dc8c8973d89",
  "status": "rendering_video",
  "lesson": {
    "title": "Give Feedback People Can Use",
    "hook": "Make feedback specific and actionable.",
    "explanation": "Feedback works when it names a concrete behavior...\n\nVague praise or criticism leaves people guessing.",
    "narration": "Ever got feedback you could not act on? ...",
    "captions": ["Name the behavior", "Show the effect", "Suggest a next step"],
    "scenePrompt": "A gardener gently pruning one branch of a young tree at sunrise, slow dolly in",
    "quiz": {
      "question": "Which feedback is most actionable?",
      "options": ["Great job!", "In the meeting you interrupted twice; try waiting for a pause.", "Be better."],
      "answerIndex": 1,
      "explanation": "It names a behavior and a next step."
    },
    "sourceQuote": "Effective feedback describes a specific behavior",
    "sourcePage": 3
  },
  "videoUrl": null,
  "error": null
}
```

Возможный вариант успешного ответа: `201` со `status: "failed"`, `error.stage: "video"` и **заполненным `lesson`** — урок создан, а видео запустить не удалось (например, исчерпан лимит видео на сессию). Это не ошибка урока: показывайте урок и квиз без видео.

### 3.2. `GET /api/lesson-jobs/:jobId` — статус задачи

Ответ `200` — тот же формат, что у `POST`:

```json
{
  "jobId": "003f73ef-b5ec-4060-8c3b-0dc8c8973d89",
  "status": "ready",
  "lesson": { "...": "..." },
  "videoUrl": "/demo/lesson.mp4",
  "error": null
}
```

- Опрашивайте каждые **3–5 секунд**, пока `status === "rendering_video"`. После `ready` или `failed` опрос прекращайте — статус больше не изменится.
- Чаще опрашивать бессмысленно: бэкенд сам не обращается к LTX чаще раза в 5 секунд.
- Неизвестный или некорректный `jobId` → `404 NOT_FOUND`.
- Задачи хранятся в базе и переживают перезапуск сервера, поэтому `jobId` можно сохранить (например, в `localStorage`) и возобновить опрос после перезагрузки страницы.

### 3.3. `GET /api/health` — проверка сервера

```json
{ "ok": true, "videoProvider": "mock", "lessonAi": "configured", "tts": "none" }
```

`videoProvider`: `"mock"` | `"ltx"` | `"hyperframes"`. `tts`: `"none"` | `"openai"` | `"elevenlabs"` (озвучка роликов HyperFrames). `lessonAi`: `"configured"` | `"missing_key"` (если ключ Opus не задан, `POST` будет возвращать `503 AI_NOT_CONFIGURED`). Удобно для дебаг-панели.

---

## 4. Модели данных (TypeScript)

Можно скопировать во фронт как есть.

```ts
export type JobStatus = "generating_lesson" | "rendering_video" | "ready" | "failed";

export interface Quiz {
  question: string;
  options: string[];   // 3 или 4 разных варианта
  answerIndex: number; // 0-based, всегда < options.length
  explanation: string; // почему ответ верный
}

export interface Lesson {
  title: string;        // до 90 символов
  hook: string;         // одна фраза — главная мысль, до 200
  explanation: string;  // 2–4 абзаца, разделены "\n\n", до 1500
  narration: string;    // текст закадрового голоса, до 900
  captions: string[];   // 2–8 подписей, каждая до 100 символов
  scenePrompt: string;  // описание сцены для видео (для UI не обязательно)
  quiz: Quiz;
  sourceQuote: string;  // дословная цитата из присланного текста, до 300
  sourcePage: number;   // = sourcePage из запроса
}

export interface JobError {
  stage: "lesson" | "video";
  code: string;    // см. раздел 8
  message: string; // на английском, для логов/дебага
}

export interface LessonJob {
  jobId: string;
  status: JobStatus;
  lesson: Lesson | null;
  videoUrl: string | null;
  error: JobError | null;
}

export interface CreateLessonJobRequest {
  sourceTitle: string;
  sourcePage: number;
  sourceText: string;
  sessionId: string;
}

// Формат любой ошибки HTTP (4xx/5xx)
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: string[] | null; // для VALIDATION_ERROR — список "поле: проблема"
  };
  jobId: string | null;       // задан, если задача успела создаться
}
```

Гарантии бэкенда по `lesson`: все поля присутствуют и не пустые, длины в пределах лимитов, варианты квиза различаются, `answerIndex` указывает на существующий вариант, `sourceQuote` действительно есть в присланном тексте (если модель ошиблась с цитатой, бэкенд подставляет первое предложение источника).

Язык урока совпадает с языком `sourceText`: русский текст → русский урок.

---

## 5. Статусы и что показывать

| `status` | `lesson` | `videoUrl` | Что показывать |
|---|---|---|---|
| `generating_lesson` | `null` | `null` | Урок ещё генерируется. В норме фронт этого не видит: `POST` возвращается уже после генерации. Может встретиться, если опрашивать задачу по сохранённому `jobId` во время генерации |
| `rendering_video` | есть | `null` | Урок, квиз, подписи + прогресс/плейсхолдер на месте видео. Продолжать опрос |
| `ready` | есть | есть | Всё готово, показываем видео |
| `failed` + `error.stage = "video"` | **есть** | `null` | Урок и квиз показываем как обычно, вместо видео — заглушка («Видео недоступно»). Опрос прекратить |
| `failed` + `error.stage = "lesson"` | `null` | `null` | Урок не создан. Показать ошибку и дать пользователю повторить вручную |

Правило для UI: **если `lesson !== null` — урок показываем всегда**, независимо от статуса. Ошибка видео никогда не удаляет урок.

---

## 6. Видео

- `videoUrl` бывает двух видов:
  - относительный (`/demo/lesson.mp4`) — mock-провайдер отдаёт заранее подготовленный ролик с бэкенда;
  - абсолютный `https://...` — реальный ролик от LTX;
  - относительный `/api/media/<id>.mp4` — ролик HyperFrames, отрендеренный и раздаваемый самим бэкендом (ссылка постоянная, поддерживает Range/перемотку).
- Если ходите без proxy Next.js, нормализуйте:
  ```ts
  const API_ORIGIN = "http://localhost:3001";
  const toAbsolute = (url: string) => (url.startsWith("/") ? API_ORIGIN + url : url);
  ```
- Формат зависит от провайдера:
  - mock / LTX: вертикальный MP4 9:16 (720×1280), ~6 секунд, **без звука**. Для ленты: `<video autoPlay muted loop playsInline>`.
  - HyperFrames: вертикальный MP4 1080×1920, 20–60 секунд, анимированная объяснялка (схемы, графики, кинетическая типографика) с **вшитыми субтитрами** и, если на сервере включён TTS, **с озвучкой** (AAC, −14 LUFS). Автоплей всё равно начинайте с `muted` (так требуют браузеры) и дайте кнопку «включить звук».
- Ссылки LTX временные (срок не документирован). Для демо этого хватает, но не кэшируйте `videoUrl` надолго: при повторном открытии лучше снова запросить `GET`.
- Переключение mock ↔ LTX делается только на сервере. Контракт для фронта не меняется.
- `narration` и `captions` — для субтитров/озвучки поверх беззвучного ролика mock/LTX. У роликов HyperFrames субтитры и голос уже внутри видео — поверх них ничего не накладывайте (узнать провайдера можно из `GET /api/health` или по префиксу `/api/media/` у `videoUrl`).
- Proxy Next.js уже пропускает `/api/*`, поэтому `/api/media/...` работает без изменений.

---

## 7. `sessionId`

Анонимный идентификатор пользователя для лимитов. Генерируйте один раз и храните в `localStorage`:

```ts
export function getSessionId(): string {
  const KEY = "scrolled.sessionId";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID(); // подходит под формат: 36 символов, буквы/цифры/дефисы
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
```

---

## 8. Ошибки

Любая ошибка HTTP приходит в одном формате:

```json
{
  "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body.", "details": ["sourcePage: Too small: expected number to be >=1"] },
  "jobId": null
}
```

`message` — на английском и предназначен для логов. **Тексты для пользователя выбирайте по `code`**.

### 8.1. Ошибки HTTP (`POST /api/lesson-jobs`, `GET`)

| HTTP | `code` | Когда | Что показать пользователю | Повторить? |
|---|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Неверное тело запроса или битый JSON. Подробности в `details` | «Не удалось обработать выделенный текст» (у себя в коде — баг фронта) | Нет, исправить запрос |
| 413 | `PAYLOAD_TOO_LARGE` | `sourceText` длиннее 12 000 символов | «Выделено слишком много текста — выберите меньше страниц» | После уменьшения выделения |
| 404 | `NOT_FOUND` | Нет такой задачи или неизвестный маршрут | «Урок не найден» | Нет |
| 429 | `SESSION_LIMIT_REACHED` | Исчерпан лимит уроков на сессию (по умолчанию 20) | «Достигнут лимит уроков для демо» | Нет |
| 422 | `INSUFFICIENT_SOURCE` | В тексте слишком мало информации для урока. `message` объясняет почему (на языке модели) | «В этом фрагменте недостаточно материала — выберите больше текста» | Да, с другим фрагментом |
| 422 | `LESSON_REFUSED` | Модель отказалась работать с этим текстом | «Не удалось создать урок по этому фрагменту» | С другим фрагментом |
| 502 | `LESSON_GENERATION_FAILED` | Сбой генерации (невалидный ответ модели, обрыв связи и т.п.) | «Не получилось создать урок, попробуйте ещё раз» | Да, вручную по кнопке |
| 503 | `LESSON_GENERATION_FAILED` | Сервис ИИ перегружен | «Сервис занят, попробуйте через минуту» | Да, через минуту |
| 503 | `AI_NOT_CONFIGURED` | На сервере не задан или отклонён ключ Opus | «Сервис временно недоступен» | Нет — проблема конфигурации сервера |
| 500 | `INTERNAL_ERROR` | Непредвиденная ошибка | «Что-то пошло не так» | Да, вручную |

Не делайте автоматических повторов `POST`: каждый вызов — платная генерация. Повтор — только по действию пользователя.

Если ошибка возникла после создания задачи (например, `INSUFFICIENT_SOURCE`), в ответе будет `jobId`; задача в базе получит `status: "failed"` и `error.stage: "lesson"`.

### 8.2. Ошибки видео (`error.stage === "video"` в ответе задачи)

Приходят в поле `error` задачи (HTTP `200`/`201`). Урок при этом есть. Для пользователя достаточно одного текста — «Видео недоступно», коды полезны для дебага:

| `code` | Причина |
|---|---|
| `VIDEO_LIMIT_REACHED` | Исчерпан лимит видео на сессию (по умолчанию 5) или общий бюджет LTX. Можно показать «Лимит видео для демо исчерпан» |
| `VIDEO_RENDER_FAILED` | Рендер завершился ошибкой (в т.ч. mock: на сервере нет файла `public/demo/lesson.mp4`; LTX: сцена отклонена фильтром контента или кончились кредиты) |
| `VIDEO_TIMEOUT` | Рендер дольше 15 минут (HyperFrames — 30 минут) |
| `VIDEO_START_FAILED`, `VIDEO_STATUS_FAILED` | Не удалось запустить рендер или узнать его статус |
| `VIDEO_PROVIDER_CHANGED` | Провайдер видео переключили на сервере во время рендера |
| `LTX_NOT_CONFIGURED` | Включён LTX, но на сервере нет `LTX_API_KEY` |
| `LTX_REJECTED`, `LTX_AUTH_FAILED`, `LTX_BUSY`, `LTX_UPSTREAM_ERROR`, `LTX_UNREACHABLE`, `LTX_BAD_RESPONSE` | Ошибки сервиса LTX |

---

## 9. Лимиты (значения по умолчанию)

| Лимит | Значение |
|---|---|
| Длина `sourceText` | 80–12 000 символов |
| Размер тела запроса | 100 КБ |
| Уроков на `sessionId` | 20 |
| Видео на `sessionId` | 5 (после этого урок создаётся, но без видео) |
| Время генерации урока | обычно 10–40 с; таймаут на стороне фронта ставьте не меньше 120 с |
| Рендер видео | mock — ~8 с; LTX — обычно до нескольких минут, жёсткий таймаут 15 мин; HyperFrames — обычно 1–3 мин, таймаут 30 мин |

Лимиты меняются на сервере переменными окружения, фронту об этом знать не нужно — достаточно обрабатывать коды ошибок.

---

## 10. Пример клиента

```ts
// api.ts
import type { ApiErrorBody, CreateLessonJobRequest, LessonJob } from "./types";

const API_BASE = ""; // с proxy Next.js; без proxy — "http://localhost:3001"

export class ApiError extends Error {
  status: number;
  code: string;
  jobId: string | null;
  details: string[] | null;
  constructor(status: number, code: string, message: string, jobId: string | null, details: string[] | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.jobId = jobId;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? "INTERNAL_ERROR", e?.message ?? `HTTP ${res.status}`, (body as ApiErrorBody | null)?.jobId ?? null, e?.details ?? null);
  }
  return body as T;
}

export const createLessonJob = (req: CreateLessonJobRequest) =>
  request<LessonJob>("/api/lesson-jobs", { method: "POST", body: JSON.stringify(req) });

export const getLessonJob = (jobId: string, signal?: AbortSignal) =>
  request<LessonJob>(`/api/lesson-jobs/${encodeURIComponent(jobId)}`, { signal });

/** Опрашивает задачу, пока видео рендерится. Вызывает onUpdate на каждое изменение. */
export async function pollLessonJob(
  job: LessonJob,
  onUpdate: (job: LessonJob) => void,
  signal: AbortSignal,
  intervalMs = 4000,
): Promise<LessonJob> {
  let current = job;
  while (current.status === "rendering_video" || current.status === "generating_lesson") {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (signal.aborted) break;
    try {
      current = await getLessonJob(current.jobId, signal);
      onUpdate(current);
    } catch (e) {
      if (signal.aborted) break;
      // сетевой сбой при опросе — просто пробуем на следующем тике
      if (e instanceof ApiError && e.status === 404) break;
    }
  }
  return current;
}
```

### Пример React-хука

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createLessonJob, pollLessonJob } from "./api";
import type { CreateLessonJobRequest, LessonJob } from "./types";

export function useLessonJob() {
  const [job, setJob] = useState<LessonJob | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async (req: CreateLessonJobRequest) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCreating(true);
    setError(null);
    setJob(null);
    try {
      const created = await createLessonJob(req);
      setJob(created);
      await pollLessonJob(created, setJob, ctrl.signal);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "NETWORK_ERROR", String(e), null, null));
    } finally {
      setCreating(false);
    }
  }, []);

  return {
    start,
    job,
    lesson: job?.lesson ?? null,                // показывать, если не null
    videoUrl: job?.videoUrl ?? null,
    videoPending: job?.status === "rendering_video",
    videoFailed: job?.status === "failed" && job.error?.stage === "video",
    creating,                                   // лоадер 10–40 с
    error,                                      // ошибка создания урока (раздел 8.1)
  };
}
```

---

## 11. Ручная проверка через curl

```bash
curl -s localhost:3001/api/health
```

```bash
curl -s -X POST localhost:3001/api/lesson-jobs -H 'Content-Type: application/json' -d '{"sourceTitle":"Feedback at Work","sourcePage":3,"sourceText":"Effective feedback describes a specific behavior, its impact, and a concrete next step. Vague comments such as good job do not help people improve.","sessionId":"test-session-1"}'
```

```bash
curl -s localhost:3001/api/lesson-jobs/<jobId>
```

---

## 12. Чек-лист фронта

- [ ] proxy `/api` и `/demo` в Next.js (уже есть в `frontend/next.config.ts`) или префикс для относительного `videoUrl`
- [ ] `sessionId` генерируется один раз и хранится в `localStorage`
- [ ] Проверка длины выделения до отправки: 80–12 000 символов
- [ ] Лоадер на время `POST` (10–40 с), таймаут запроса ≥ 120 с, кнопка не даёт отправить дважды
- [ ] Урок и квиз показываются сразу из ответа `POST`
- [ ] Опрос `GET` каждые 3–5 с только при `rendering_video`; остановка на `ready`/`failed` и при уходе со страницы
- [ ] `failed` + `stage: "video"` → урок показан, вместо видео заглушка
- [ ] `failed` + `stage: "lesson"` / ошибки HTTP → понятный текст по `code`, повтор только вручную
- [ ] Видео: `autoPlay muted loop playsInline`, 9:16
- [ ] `explanation` отображается с сохранением абзацев (`white-space: pre-line` или split по `\n\n`)
- [ ] Квиз: правильный ответ — `options[answerIndex]`, после ответа показывать `quiz.explanation`
- [ ] Ссылка на источник: `sourceQuote` + «стр. `sourcePage`»
