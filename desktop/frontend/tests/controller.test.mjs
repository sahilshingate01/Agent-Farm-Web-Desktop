import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);
const gatewayServer = new URL("../public/backend/gateway.mjs", import.meta.url);
const farmCli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "farm.sh");

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("replaces a running gateway when its bundled revision is stale", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-controller-test-"));
  const stale = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "gateway-runtime.json"), JSON.stringify({ pid: stale.pid, startedAt: new Date(0).toISOString(), revision: "old-build" }));
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 47000 + (process.pid % 1000), apiKey: "", routes: [] }));

  let replacementPid = null;
  t.after(() => {
    for (const pid of [replacementPid, stale.pid]) {
      if (pid && alive(pid)) try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
    }
  });

  const result = spawnSync(process.execPath, [controller.pathname, "farm.gateway.start", "{}"], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: "/bin/true" },
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  replacementPid = status.pid;
  assert.equal(status.running, true);
  assert.equal(status.stale, false);
  assert.notEqual(status.pid, stale.pid);
  assert.match(status.revision, /^[a-f0-9]{16}$/);
  if (alive(stale.pid)) await new Promise((resolve) => { stale.once("exit", resolve); setTimeout(resolve, 500); });
  assert.equal(alive(stale.pid), false);
});

test("gateway status summarizes durable inference activity", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-traffic-test-"));
  const now = new Date();
  const startedAt = new Date(now.getTime() - 2_000).toISOString();
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 1, apiKey: "", routes: [] }));
  writeFileSync(join(state, "gateway-activity.jsonl"), [
    JSON.stringify({ requestId: "req-1", event: "started", occurredAt: startedAt, startedAt, method: "POST", path: "/v1/chat/completions", protocol: "chat", client: "127.0.0.1 · test", model: "rota", route: "rota", provider: "claude", account: "alpha" }),
    // Legacy Anthropic-exclusive ledger shape: no dialect, status, or reported
    // flags. Status must normalize this on read after an upgrade.
    JSON.stringify({ requestId: "req-1", event: "completed", occurredAt: now.toISOString(), startedAt, completedAt: now.toISOString(), durationMs: 2000, statusCode: 200, method: "POST", path: "/v1/chat/completions", protocol: "chat", client: "127.0.0.1 · test", model: "rota", route: "rota", provider: "claude", account: "alpha", cacheMode: "explicit", baseInputUsdPerMillion: 5, cacheWriteMultiplier: 1.25, usage: { input_tokens: 20, output_tokens: 15, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 } }),
    "{torn-final-line",
  ].join("\n"));

  const result = spawnSync(process.execPath, [controller.pathname, "farm.gateway.status", "{}"], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: farmCli },
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.recentRequests[0].state, "completed");
  assert.equal(status.recentRequests[0].model, "rota");
  const hour = status.trafficWindows.find((window) => window.id === "1h");
  assert.equal(hour.totalTokens, 125);
  assert.equal(hour.cacheReadTokens, 80);
  assert.equal(hour.cacheWriteTokens, 10);
  assert.equal(hour.cacheHits, 1);
  assert.equal(hour.cacheWrites, 1);
  assert.equal(hour.cacheMisses, 0);
  assert.equal(hour.cacheUnreported, 0);
  assert.equal(hour.cacheNetInputTokensSaved, 69.5);
  assert.equal(hour.cacheSavingsUsd, 0.0003475);
  assert.equal(hour.cachePricedRequests, 1);
  assert.deepEqual(hour.topProviders[0], { id: "claude", requests: 1, tokens: 125 });
  assert.equal(status.activeRequests.length, 0);
});

test("completed inference appears in gateway status with client and token evidence", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-inference-e2e-"));
  const port = 48000 + ((process.pid + Date.now()) % 1000);
  writeFileSync(join(state, "gateway.json"), JSON.stringify({
    host: "127.0.0.1",
    port,
    apiKey: "",
    apiKeys: [{ id: "test-client", name: "Test client", key: "test-secret", createdAt: new Date().toISOString() }],
    routes: [{
      id: "test-model",
      transport: "command",
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify({type:'result',result:'ok',usage:{input_tokens:8,output_tokens:2,total_tokens:10}}))"],
      inputMode: "stdin",
      streamFormat: "ndjson",
    }],
  }));
  const gateway = spawn(process.execPath, [gatewayServer.pathname], {
    env: { ...process.env, FARM_STATE: state },
    stdio: "ignore",
  });
  t.after(() => { if (alive(gateway.pid)) try { process.kill(gateway.pid, "SIGTERM"); } catch { /* already stopped */ } });

  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) { healthy = true; break; }
    } catch { /* listener is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(healthy, true, "gateway did not start");
  writeFileSync(join(state, "gateway-runtime.json"), JSON.stringify({
    pid: gateway.pid,
    startedAt: new Date().toISOString(),
  }));
  const discovery = await fetch(`http://127.0.0.1:${port}/v1/models`, {
    headers: { authorization: "Bearer test-secret" },
  });
  assert.equal(discovery.ok, true);
  assert.equal(existsSync(join(state, "gateway-activity.jsonl")), false, "model discovery must not be reported as inference");
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
    body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "ping" }] }),
  });
  assert.equal(response.ok, true, await response.text());

  const result = spawnSync(process.execPath, [controller.pathname, "farm.gateway.status", "{}"], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: farmCli },
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.recentRequests[0].state, "completed");
  assert.equal(status.recentRequests[0].model, "test-model");
  assert.equal(status.trafficWindows.find((window) => window.id === "1h").totalTokens, 10);
  assert.equal(status.clients[0].keyName, "Test client");
  assert.equal(status.clients[0].inferenceCount, 1);
});

test("desktop bridge lists portable distributed silo descriptors", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-distributed-test-"));
  const directory = join(state, "silos", encodeURIComponent("e2b/sbx-1"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "silo.json"), JSON.stringify({ id: "e2b/sbx-1", name: "Cloud coder", runtime: "e2b", lifecycle: "paused" }));
  writeFileSync(join(state, "farmd.json"), JSON.stringify({ localGatewayBaseUrl: "" }));

  const result = spawnSync(process.execPath, [controller.pathname, "farm.distributed.list", "{}"], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: farmCli },
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.data[0].id, "e2b/sbx-1");
  assert.equal(payload.data[0].lifecycle, "paused");
});

test("desktop bridge can use a globally installed portable farm command", () => {
  const root = mkdtempSync(join(tmpdir(), "usage-farm-global-test-"));
  const state = join(root, "state");
  const executable = join(root, "farm");
  mkdirSync(state, { recursive: true });
  writeFileSync(executable, "#!/bin/sh\nprintf '%s' '{\"data\":[{\"id\":\"remote/global\",\"lifecycle\":\"running\"}]}'\n", { mode: 0o755 });

  const result = spawnSync(process.execPath, [controller.pathname, "farm.distributed.list", "{}"], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: executable },
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data[0].id, "remote/global");
});

test("farmd status discards a stale marker instead of trusting a reused pid", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-farmd-marker-test-"));
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => { if (alive(unrelated.pid)) try { process.kill(unrelated.pid, "SIGTERM"); } catch { /* already stopped */ } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const markerPath = join(state, "farmd-runtime.json");
  // Pin the config to a dead port — status now health-checks the port and
  // would otherwise adopt the developer's real farmd on the 4546 default.
  writeFileSync(join(state, "farmd.json"), JSON.stringify({ host: "127.0.0.1", port: 1, apiKey: "" }));
  writeFileSync(markerPath, JSON.stringify({ pid: unrelated.pid, command: "/tmp/farmd.mjs", service: "farmd", startedAt: new Date().toISOString() }));

  const result = spawnSync(process.execPath, [controller.pathname, "farm.farmd.status", "{}"], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: farmCli },
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).running, false);
  assert.equal(alive(unrelated.pid), true);
  assert.equal(existsSync(markerPath), false);
});

test("harvest suggestions are scoped to the active workspace", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-harvest-scope-"));
  const rootA = join(state, "proj-a");
  const rootB = join(state, "proj-b");
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: rootA }));
  writeFileSync(join(state, "harvest.json"), JSON.stringify({
    suggestions: [
      { id: "h-a", root: rootA, kind: "skill", title: "A thing", status: "proposed", createdAt: new Date().toISOString() },
      { id: "h-b", root: rootB, kind: "skill", title: "B thing", status: "proposed", createdAt: new Date().toISOString() },
    ],
    lastScanAt: null,
    lastError: null,
    scanning: false,
  }));
  const result = spawnSync(process.execPath, [controller.pathname, "farm.harvest.list", "{}"], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: farmCli },
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const listed = JSON.parse(result.stdout).suggestions;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "h-a");
});

test("harvest list strips draft bodies; farm.harvest.draft returns the full text", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-harvest-draft-"));
  const root = join(state, "proj");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root }));
  // Big enough that shipping it inline would overflow the native bridge's
  // fixed response buffer (the StreamTooLong failure on the harvest page).
  const bigDraft = "x".repeat(200000);
  writeFileSync(join(state, "harvest.json"), JSON.stringify({
    suggestions: [
      { id: "h-big", root, kind: "skill", title: "Big draft", status: "proposed", createdAt: new Date().toISOString(), draftPath: "skills/big.md", draft: bigDraft },
      { id: "h-none", root, kind: "skill", title: "No draft", status: "proposed", createdAt: new Date().toISOString(), draftPath: null, draft: null },
    ],
    lastScanAt: null,
    lastError: null,
    scanning: false,
  }));
  const call = (command, payload) => spawnSync(process.execPath, [controller.pathname, command, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: farmCli },
    timeout: 10000,
  });

  const list = call("farm.harvest.list", {});
  assert.equal(list.status, 0, list.stderr);
  const listed = JSON.parse(list.stdout).suggestions;
  assert.equal(listed.length, 2);
  assert.equal(listed[0].draft, null);
  assert.equal(listed[0].hasDraft, true);
  assert.equal(listed[1].hasDraft, false);

  const draft = call("farm.harvest.draft", { id: "h-big" });
  assert.equal(draft.status, 0, draft.stderr);
  assert.equal(JSON.parse(draft.stdout).draft, bigDraft);

  const missing = call("farm.harvest.draft", { id: "nope" });
  assert.notEqual(missing.status, 0);
});

test("profile.remove deletes custom kits but refuses bundled and equipped ones", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-profile-remove-"));
  mkdirSync(join(state, "profiles"), { recursive: true });
  writeFileSync(join(state, "profiles", "my-kit.json"), JSON.stringify({ name: "my-kit", description: "x", skills_packages: [], skills_from_host: [], agents_from_host: [], commands_from_host: [], mcp: [] }));
  const call = (payload) => spawnSync(process.execPath, [controller.pathname, "farm.profile.remove", JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: farmCli },
    timeout: 10000,
  });

  const removed = call({ name: "my-kit" });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(join(state, "profiles", "my-kit.json")), false);

  const bundled = call({ name: "coding" });
  assert.notEqual(bundled.status, 0, "bundled kits refuse deletion");
  assert.match(bundled.stderr || bundled.stdout, /bundled/i);

  const missing = call({ name: "nope" });
  assert.notEqual(missing.status, 0);
});
