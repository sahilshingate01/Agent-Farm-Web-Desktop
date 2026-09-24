import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const probePath = new URL("../public/backend/cache-probe.mjs", import.meta.url);
const { callRoute, probePrefixChars, probeVerdict } = await import(probePath);

test("probe passes when the second identical request reads the first write", () => {
  const verdict = probeVerdict(
    {
      cache_creation_input_tokens: 5_000,
      cached_input_tokens: 0,
      cache_creation_input_tokens_reported: true,
      cached_input_tokens_reported: true,
    },
    {
      cache_creation_input_tokens: 0,
      cached_input_tokens: 5_000,
      cache_creation_input_tokens_reported: true,
      cached_input_tokens_reported: true,
    },
  );
  assert.equal(verdict.status, "working");
  assert.equal(verdict.ok, true);
});

test("probe reports write-without-reuse instead of calling it a hit", () => {
  const verdict = probeVerdict(
    {
      cache_creation_input_tokens: 5_000,
      cached_input_tokens: 0,
      cache_creation_input_tokens_reported: true,
      cached_input_tokens_reported: true,
    },
    {
      cache_creation_input_tokens: 5_000,
      cached_input_tokens: 0,
      cache_creation_input_tokens_reported: true,
      cached_input_tokens_reported: true,
    },
  );
  assert.equal(verdict.status, "written-not-reused");
  assert.equal(verdict.ok, false);
});

test("probe distinguishes absent counters from a measured miss", () => {
  const verdict = probeVerdict(
    {
      cache_creation_input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens_reported: false,
      cached_input_tokens_reported: false,
    },
    {
      cache_creation_input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens_reported: false,
      cached_input_tokens_reported: false,
    },
  );
  assert.equal(verdict.status, "unreported");
});

test("probe does not call a write-only zero a measured read miss", () => {
  const verdict = probeVerdict(
    {
      cache_creation_input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens_reported: true,
      cached_input_tokens_reported: false,
    },
    {
      cache_creation_input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens_reported: true,
      cached_input_tokens_reported: false,
    },
  );
  assert.equal(verdict.status, "unreported");
});

test("probe rejects invalid or wastefully large synthetic prefixes", () => {
  assert.equal(probePrefixChars("24000"), 24_000);
  assert.throws(() => probePrefixChars("not-a-number"), /whole number/);
  assert.throws(() => probePrefixChars("32001"), /between 4096 and 32000/);
});

test("dry run loads a configured direct route without contacting its upstream", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-cache-probe-"));
  writeFileSync(join(state, "gateway.json"), JSON.stringify({
    routes: [{
      id: "direct",
      transport: "anthropic",
      baseUrl: "https://example.invalid",
      upstreamModel: "probe-model",
    }],
  }));
  const result = spawnSync(
    process.execPath,
    [probePath.pathname, "direct", "--dry-run", "--prefix-chars=24000"],
    {
      encoding: "utf8",
      env: { ...process.env, FARM_STATE: state },
      timeout: 5_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    route: "direct",
    model: "probe-model",
    prefixChars: 24_000,
    breakpoints: 2,
    dryRun: true,
  });
});

test("keyless local probe omits x-api-key instead of sending null", async (t) => {
  let receivedKey;
  const upstream = createServer((request, response) => {
    receivedKey = request.headers["x-api-key"];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const port = upstream.address().port;
  await callRoute(
    { id: "local", baseUrl: `http://127.0.0.1:${port}` },
    { model: "local-model", messages: [] },
    mkdtempSync(join(tmpdir(), "usage-farm-cache-probe-")),
  );
  assert.equal(receivedKey, undefined);
});
