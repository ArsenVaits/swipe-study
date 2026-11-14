import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const backend = fileURLToPath(new URL("../", import.meta.url));
const revision = "a".repeat(40);
const identity = `${revision} ${revision}-123-1`;
const jobId = "00000000-0000-4000-8000-000000000001";
let directory;
let database;
let server;
let origin;
let output = "";

async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
}

async function start() {
  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  output = "";
  server = spawn(process.execPath, ["src/server.ts"], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATABASE_PATH: database,
      ANTHROPIC_API_KEY: "",
      LTX_API_KEY: "",
      VIDEO_PROVIDER: "mock",
      MOCK_VIDEO_URL: "/demo/lesson.mp4",
      CORS_ORIGIN: "http://localhost:3000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Test API exited before becoming ready:\n${output}`);
    }
    try {
      const response = await fetch(origin + "/api/health", { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* Process is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Test API did not become healthy:\n${output}`);
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "scrolled-api-test-"));
  database = path.join(directory, "jobs.db");
  await cp(path.join(backend, "src"), path.join(directory, "src"), { recursive: true });
  await cp(path.join(backend, "public"), path.join(directory, "public"), { recursive: true });
  await cp(path.join(backend, "package.json"), path.join(directory, "package.json"));
  await symlink(path.join(backend, "node_modules"), path.join(directory, "node_modules"));
  await writeFile(path.join(directory, ".deployment-revision"), identity + "\n");
  await start();
  const db = new DatabaseSync(database);
  try {
    db.prepare(`INSERT INTO lesson_jobs
      (id, session_id, status, source_title, source_page, source_chars, video_url, created_at, updated_at)
      VALUES (?, 'test-session', 'ready', 'Existing lesson', 1, 100, '/demo/lesson.mp4', 1, 1)`)
      .run(jobId);
  } finally { db.close(); }
});

after(async () => {
  await stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("health responds without external credentials", async () => {
  const response = await fetch(origin + "/api/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.videoProvider, "mock");
  assert.equal(body.lessonAi, "missing_key");
  assert.equal(body.revision, revision);
});

test("deployment endpoint reports this process's exact release without caching", async () => {
  const response = await fetch(origin + "/api/deployment");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.text()).trim(), identity);
});

test("invalid requests return structured validation errors", async () => {
  for (const body of ["{}", "{broken-json"]) {
    const response = await fetch(origin + "/api/lesson-jobs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  }
});

test("unknown jobs return a structured 404", async () => {
  const response = await fetch(origin + "/api/lesson-jobs/00000000-0000-4000-8000-000000000002");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("missing AI configuration fails safely without contacting a provider", async () => {
  const response = await fetch(origin + "/api/lesson-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceTitle: "Test document", sourcePage: 1,
      sourceText: "This is the selected passage in a test document. ".repeat(3),
      sessionId: "test-session",
    }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "AI_NOT_CONFIGURED");
});

test("bundled demo assets remain accessible", async () => {
  const response = await fetch(origin + "/demo/lesson.mp4", { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /video\/mp4/);
});

test("existing SQLite jobs survive an application restart", async () => {
  await stop();
  await start();
  const response = await fetch(origin + "/api/lesson-jobs/" + jobId);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.jobId, jobId);
  assert.equal(body.status, "ready");
  assert.equal(body.videoUrl, "/demo/lesson.mp4");
  const db = new DatabaseSync(database, { readOnly: true });
  try { assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lesson_jobs").get().count, 1); }
  finally { db.close(); }
});

test("an invalid release marker cannot pass revision verification", async () => {
  await stop();
  await writeFile(path.join(directory, ".deployment-revision"), "invalid\n");
  await start();
  assert.equal((await fetch(origin + "/api/deployment")).status, 503);
  assert.equal((await (await fetch(origin + "/api/health")).json()).revision, null);
});
