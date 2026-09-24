import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const gatewayPath = new URL("../public/backend/gateway.mjs", import.meta.url);

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* listener is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("gateway did not become healthy");
}

function completedActivity(state, model) {
  try {
    return readFileSync(join(state, "gateway-activity.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .findLast((entry) => entry.event === "completed" && entry.model === model);
  } catch {
    return null;
  }
}

async function waitForCompletedActivity(state, model) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const activity = completedActivity(state, model);
    if (activity) return activity;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

test("native Anthropic proxy and compatibility responses preserve cache semantics", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-cache-e2e-"));
  mkdirSync(state, { recursive: true });
  mkdirSync(join(state, "secrets"), { mode: 0o700 });
  writeFileSync(join(state, "secrets", "anthropic-direct.key"), "upstream-secret\n", {
    mode: 0o600,
  });
  let upstreamBody = null;
  let upstreamKey = null;
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    upstreamBody = JSON.parse(body);
    upstreamKey = req.headers["x-api-key"];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_upstream",
      type: "message",
      role: "assistant",
      model: "upstream-model",
      content: [{ type: "text", text: "proxied" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 5,
        output_tokens: 2,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 10,
      },
    }));
  });
  const upstreamPort = await listen(upstream);
  const gatewayPort = await freePort();
  const commandScript = [
    "console.log(JSON.stringify({",
    "type:'result',result:'command result',",
    "usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:80,cache_creation_input_tokens:20}",
    "}))",
  ].join("");
  writeFileSync(join(state, "gateway.json"), JSON.stringify({
    host: "127.0.0.1",
    port: gatewayPort,
    routes: [
      {
        id: "direct-cache",
        transport: "anthropic",
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        apiKeySecret: "anthropic-direct",
        upstreamModel: "upstream-model",
        baseInputUsdPerMillion: 5,
      },
      {
        id: "direct-unpinned-price",
        transport: "anthropic",
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        apiKeySecret: "anthropic-direct",
        baseInputUsdPerMillion: 99,
      },
      {
        id: "command-cache",
        provider: "claude",
        transport: "command",
        command: process.execPath,
        args: ["-e", commandScript],
        inputMode: "stdin",
        streamFormat: "ndjson",
      },
    ],
  }));
  const environment = { ...process.env, FARM_STATE: state };
  delete environment.USAGE_FARM_GATEWAY_TEST;
  const gateway = spawn(process.execPath, [gatewayPath.pathname], {
    env: environment,
    stdio: "ignore",
  });
  t.after(async () => {
    if (alive(gateway.pid)) {
      try { process.kill(gateway.pid, "SIGTERM"); } catch { /* already stopped */ }
    }
    await new Promise((resolve) => upstream.close(resolve));
  });
  await waitForHealth(gatewayPort);

  const native = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "direct-cache",
      max_tokens: 16,
      system: "Stable native prefix",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  assert.equal(native.ok, true, await native.text());
  assert.equal(upstreamKey, "upstream-secret");
  assert.match(JSON.stringify(upstreamBody), /cache_control/);
  const nativeActivity = await waitForCompletedActivity(state, "direct-cache");
  assert.ok(nativeActivity, "native proxy must write a completed activity record");
  assert.equal(nativeActivity.usage.input_tokens, 415);
  assert.equal(nativeActivity.usage.cached_input_tokens, 400);
  assert.equal(nativeActivity.usage.cache_creation_input_tokens, 10);
  assert.equal(nativeActivity.usage.cache_status, "hit");
  assert.equal(nativeActivity.usage.cache_net_input_tokens_saved, 357.5);
  assert.equal(nativeActivity.usage.cache_savings_usd, 0.0017875);
  assert.match(nativeActivity.cachePrefixSha, /^[a-f0-9]{16}$/);

  const unpinned = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "direct-unpinned-price",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  assert.equal(unpinned.ok, true, await unpinned.text());
  const unpinnedActivity = await waitForCompletedActivity(
    state,
    "direct-unpinned-price",
  );
  assert.equal(unpinnedActivity.baseInputUsdPerMillion, null);
  assert.equal(unpinnedActivity.usage.cache_savings_usd, null);

  const compatible = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "command-cache",
      max_tokens: 16,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  const compatibleBody = await compatible.json();
  assert.deepEqual(compatibleBody.usage, {
    input_tokens: 10,
    output_tokens: 2,
    cache_read_input_tokens: 80,
    cache_creation_input_tokens: 20,
  });

  const streamed = await fetch(`http://127.0.0.1:${gatewayPort}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "command-cache",
      max_tokens: 16,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  const streamText = await streamed.text();
  const startLine = streamText
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: ") && line.includes('"message_start"'));
  assert.ok(startLine, "stream must include an Anthropic message_start event");
  const start = JSON.parse(startLine.slice(6));
  assert.deepEqual(start.message.usage, {
    input_tokens: 10,
    output_tokens: 0,
    cache_read_input_tokens: 80,
    cache_creation_input_tokens: 20,
  });
});
