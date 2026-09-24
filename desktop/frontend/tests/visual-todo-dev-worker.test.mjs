import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.USAGE_FARM_VISUAL_TODO_WORKER_TEST = "1";
process.env.VISUAL_TODO_AGENT_COMMAND = "definitely-no-such-agent";
const {
  createVisualTodoDevServer,
  isAllowedVisualTodoOrigin,
} = await import("../public/backend/visual-todo-dev-worker.mjs");

test("visual TODO worker rejects hostile browser origins", async (t) => {
  const server = createVisualTodoDevServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const hostile = await fetch(`${base}/health`, {
    headers: { Origin: "https://example.invalid" },
  });
  assert.equal(hostile.status, 403);
  assert.equal(hostile.headers.get("access-control-allow-origin"), null);

  const proxy = await fetch(`${base}/health`, {
    headers: { Origin: "http://127.0.0.1:7417" },
  });
  assert.equal(proxy.status, 200);
  assert.equal(
    proxy.headers.get("access-control-allow-origin"),
    "http://127.0.0.1:7417",
  );
  const health = await proxy.json();
  assert.equal(health.warm, false);

  const unavailable = await fetch(`${base}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:7417",
    },
    body: JSON.stringify({ id: "task", prompt: "work" }),
  });
  assert.equal(unavailable.status, 400);

  const controller = await fetch(`${base}/health`);
  assert.equal(controller.status, 200);
  assert.equal(isAllowedVisualTodoOrigin(undefined), true);
});

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function stopProcess(pid) {
  try { process.kill(pid, "SIGTERM"); } catch { return; }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try { process.kill(pid, "SIGKILL"); } catch {}
}

test("controller reports a cold worker honestly and replaces an idle worker from another project", async (t) => {
  const port = await freePort();
  const state = mkdtempSync(join(tmpdir(), "visual-todo-worker-state-"));
  const projectA = mkdtempSync(join(tmpdir(), "visual-todo-project-a-"));
  const projectB = mkdtempSync(join(tmpdir(), "visual-todo-project-b-"));
  const controller = new URL("../public/backend/controller.mjs", import.meta.url);
  const invoke = (projectRoot) => spawnSync(
    process.execPath,
    [
      controller.pathname,
      "farm.visual-todo.worker.start",
      JSON.stringify({ projectRoot }),
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        FARM_STATE: state,
        USAGE_FARM_VISUAL_TODO_WORKER_TEST: "0",
        VISUAL_TODO_WORKER_PORT: String(port),
        VISUAL_TODO_AGENT_COMMAND: "definitely-no-such-agent",
      },
    },
  );

  const first = invoke(projectA);
  assert.equal(first.status, 0, first.stderr);
  const workerA = JSON.parse(first.stdout);
  t.after(() => stopProcess(workerA.pid));
  assert.equal(workerA.ready, true);
  assert.equal(workerA.warm, false);
  assert.match(workerA.error, /not found/);
  assert.equal(workerA.projectRoot, projectA);

  const second = invoke(projectB);
  assert.equal(second.status, 0, second.stderr);
  const workerB = JSON.parse(second.stdout);
  t.after(() => stopProcess(workerB.pid));
  assert.equal(workerB.ready, true);
  assert.equal(workerB.warm, false);
  assert.equal(workerB.projectRoot, projectB);
  assert.notEqual(workerB.pid, workerA.pid);
});
