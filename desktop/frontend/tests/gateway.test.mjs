import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = mkdtempSync(join(tmpdir(), "usage-farm-gateway-test-"));
mkdirSync(join(state, "accounts", "alpha", "claude-home"), { recursive: true });
mkdirSync(join(state, "accounts", "alpha", "codex-home"), { recursive: true });
writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes: [] }));
process.env.FARM_STATE = state;
process.env.USAGE_FARM_GATEWAY_TEST = "1";
process.env.USAGE_FARM_DIRECT_TEST_KEY = "test-secret";

const gateway = await import("../public/backend/gateway.mjs");

test("discovers provider/account pairs as model IDs, led by the rota", () => {
  assert.deepEqual(gateway.modelsResponse().data.map((model) => model.id), ["rota", "claude/alpha", "codex/alpha"]);
  assert.deepEqual(gateway.anthropicModelsResponse().data.map((model) => model.id), ["rota", "claude/alpha", "codex/alpha"]);
  assert.equal(gateway.anthropicModelsResponse().has_more, false);
});

test("OpenAPI prominently offers the AGPL corresponding source", () => {
  const schema = gateway.openApi();
  assert.equal(schema.externalDocs.description, "Corresponding Source (AGPL-3.0-or-later)");
  assert.match(schema.externalDocs.url, /^https:\/\/github\.com\//);
  assert.match(schema.info.description, /Corresponding Source/);
});

test("normalizes OpenAI multimodal messages, system text, tools, and response formats", () => {
  const prompt = gateway.promptFrom({
    instructions: "Answer briefly.",
    input: [{ role: "user", content: [{ type: "input_text", text: "Describe this" }, { type: "input_image", image_url: "data:image/png;base64,abc" }] }],
    tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
    text: { format: { type: "json_schema", name: "answer", schema: { type: "object" } } },
  }, "responses");
  assert.match(prompt, /SYSTEM\nAnswer briefly/);
  assert.match(prompt, /Describe this/);
  assert.match(prompt, /Image:/);
  assert.match(prompt, /AVAILABLE CLIENT TOOLS/);
  assert.match(prompt, /RESPONSE FORMAT/);
});

test("extracts final text from supported provider JSONL shapes", () => {
  assert.equal(gateway.extractText('{"type":"result","result":"Claude answer"}\n'), "Claude answer");
  assert.equal(gateway.extractText('{"type":"item.completed","item":{"type":"agent_message","text":"Codex answer"}}\n'), "Codex answer");
});

test("normalizes exact provider token usage without losing cache tokens", () => {
  assert.deepEqual(gateway.normalizeUsage({ usage: { input_tokens: 100, output_tokens: 12, cache_read_input_tokens: 400, cache_creation_input_tokens: 20 } }), {
    input_tokens: 520,
    output_tokens: 12,
    cached_input_tokens: 400,
    cache_creation_input_tokens: 20,
    total_tokens: 532,
    cached_input_tokens_reported: true,
    cache_creation_input_tokens_reported: true,
    total_tokens_reported: false,
    usage_dialect: "anthropic-exclusive",
    cache_status: "hit",
    estimated: false,
  });
  assert.deepEqual(gateway.normalizeUsage({ usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } }).total_tokens, 12);
  const openai = gateway.normalizeUsage({
    usage: {
      prompt_tokens: 9,
      completion_tokens: 3,
      total_tokens: 12,
      prompt_tokens_details: { cached_tokens: 8 },
    },
  });
  assert.equal(openai.input_tokens, 9, "cached OpenAI tokens are already inside prompt_tokens");
  assert.equal(openai.cached_input_tokens, 8);
});

test("Anthropic-compatible responses restore exclusive input and cache fields", () => {
  const canonical = gateway.normalizeUsage(
    {
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    },
    "anthropic-exclusive",
  );
  assert.deepEqual(gateway.anthropicWireUsage(canonical), {
    input_tokens: 10,
    output_tokens: 2,
    cache_read_input_tokens: 80,
    cache_creation_input_tokens: 20,
  });
  assert.deepEqual(gateway.anthropicWireUsage(canonical, { output: false }), {
    input_tokens: 10,
    output_tokens: 0,
    cache_read_input_tokens: 80,
    cache_creation_input_tokens: 20,
  });
});

test("extracts live reasoning, model, rate-limit, and timing events", () => {
  const thinking = gateway.normalizeProviderEvent({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "checking the route" } } });
  assert.equal(thinking.reasoningDelta, "checking the route");
  const limit = gateway.normalizeProviderEvent({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1783653600 } });
  assert.deepEqual(limit.rateLimit, { status: "allowed", window: "five_hour", resetsAt: 1783653600, overageStatus: undefined });
  const result = gateway.normalizeProviderEvent({ type: "result", duration_ms: 1571, ttft_ms: 1552, total_cost_usd: 0.02, usage: { input_tokens: 10, output_tokens: 2 } });
  assert.equal(result.durationMs, 1571);
  assert.equal(result.ttftMs, 1552);
  assert.equal(result.costUsd, 0.02);
});

test("decodes incremental text, NDJSON, and SSE command output", () => {
  assert.equal(gateway.decodeCommandChunk("text", { buffer: "" }, "live ").text, "live ");
  const ndjsonState = { buffer: "" };
  assert.equal(gateway.decodeCommandChunk("ndjson", ndjsonState, '{"text":"hel').text, "");
  assert.equal(gateway.decodeCommandChunk("ndjson", ndjsonState, 'lo"}\n').text, "hello");
  const sseState = { buffer: "" };
  assert.equal(gateway.decodeCommandChunk("sse", sseState, 'data: {"text":"world"}\n\n').text, "world");
});

test("disabling tools strips client and specialist tool surfaces", () => {
  const prepared = gateway.routeRequest(
    { tools: ["shell"], mcp: ["filesystem"] },
    { farm: { tools: false }, tools: [{ type: "function", name: "lookup" }], messages: [] },
  );
  assert.deepEqual(prepared.tools, []);
  assert.match(prepared.system, /Tools are disabled/);
  assert.doesNotMatch(prepared.system, /Enabled tools|Enabled MCP/);
});

test("session modes add concrete configure and test instructions", () => {
  const configure = gateway.routeRequest({}, { farm: { mode: "configure" }, messages: [] });
  const testMode = gateway.routeRequest({}, { farm: { mode: "test" }, messages: [] });
  assert.match(configure.system, /Configuration mode/);
  assert.match(testMode.system, /Test mode/);
});

test("runs arbitrary command routes and hybrid panels", async () => {
  const routes = [
    { id: "worker-a", transport: "command", command: process.execPath, args: ["-e", "console.log(JSON.stringify({result:'alpha'}))"], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "worker-b", transport: "command", command: process.execPath, args: ["-e", "console.log(JSON.stringify({result:'beta'}))"], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "panel", transport: "hybrid", members: ["worker-a", "worker-b"], strategy: "parallel", repeats: 1 },
  ];
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes }));
  const events = [];
  const result = await gateway.executeRoute(routes[2], { messages: [{ role: "user", content: "work" }] }, "chat", new AbortController().signal, [], (event) => events.push(event));
  assert.match(result.text, /## worker-a/);
  assert.match(result.text, /alpha/);
  assert.match(result.text, /## worker-b/);
  assert.match(result.text, /beta/);
  assert.equal(gateway.modelsResponse().data.find((model) => model.id === "panel").farm.transport, "hybrid");
  assert.deepEqual(events.filter((event) => event.type === "member_start").map((event) => event.route).sort(), ["worker-a", "worker-b"]);
  assert.deepEqual(events.filter((event) => event.type === "member_done").map((event) => event.route).sort(), ["worker-a", "worker-b"]);
});

test("runs ordered chain and cascade workflows", async () => {
  const routes = [
    { id: "chain-a", transport: "command", command: process.execPath, args: ["-e", "console.log(JSON.stringify({result:'first'}))"], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "chain-b", transport: "command", command: process.execPath, args: ["-e", "console.log(JSON.stringify({result:'last'}))"], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "chain", transport: "hybrid", members: ["chain-a", "chain-b"], workflow: { kind: "chain", members: ["chain-a", "chain-b"] } },
    { id: "cascade-fail", transport: "command", command: process.execPath, args: ["-e", "process.exit(1)"], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "cascade-ok", transport: "command", command: process.execPath, args: ["-e", "console.log(JSON.stringify({result:'fallback'}))"], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "cascade", transport: "hybrid", members: ["cascade-fail", "cascade-ok"], workflow: { kind: "cascade", members: ["cascade-fail", "cascade-ok"] } },
  ];
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes }));
  const chain = await gateway.executeRoute(routes[2], { messages: [{ role: "user", content: "work" }] }, "chat", new AbortController().signal);
  assert.equal(chain.text, "last");
  const cascade = await gateway.executeRoute(routes[5], { messages: [{ role: "user", content: "work" }] }, "chat", new AbortController().signal);
  assert.equal(cascade.text, "fallback");
});

test("direct Anthropic routes add cache breakpoints and normalize cache writes", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "cached response" }],
      usage: {
        input_tokens: 2,
        output_tokens: 1,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 0,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await gateway.executeRoute(
      {
        id: "direct-anthropic",
        transport: "anthropic",
        baseUrl: "https://example.invalid",
        apiKeyEnv: "USAGE_FARM_DIRECT_TEST_KEY",
        upstreamModel: "test-model",
      },
      {
        system: "Stable system",
        messages: [
          { role: "user", content: "one" },
          { role: "assistant", content: "two" },
          { role: "user", content: "three" },
        ],
      },
      "chat",
      new AbortController().signal,
    );
    assert.match(JSON.stringify(sentBody), /cache_control/);
    assert.equal(result.usage.input_tokens, 102);
    assert.equal(result.usage.cache_creation_input_tokens, 100);
    assert.equal(result.usage.cache_status, "write");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("direct Anthropic prompt caching can be disabled per route", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      content: [{ type: "text", text: "plain response" }],
      usage: { input_tokens: 2, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await gateway.executeRoute(
      {
        id: "direct-anthropic-off",
        transport: "anthropic",
        baseUrl: "https://example.invalid",
        apiKeyEnv: "USAGE_FARM_DIRECT_TEST_KEY",
        upstreamModel: "test-model",
        promptCaching: false,
      },
      {
        system: "Stable system",
        messages: [{ role: "user", content: "hello" }],
      },
      "chat",
      new AbortController().signal,
    );
    assert.doesNotMatch(JSON.stringify(sentBody), /cache_control/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("native Anthropic SSE usage is merged into one cache-aware snapshot", () => {
  const body = [
    `data: ${JSON.stringify({
      type: "message_start",
      message: {
        usage: {
          input_tokens: 4,
          output_tokens: 0,
          cache_read_input_tokens: 1_000,
          cache_creation_input_tokens: 0,
        },
      },
    })}`,
    "",
    `data: ${JSON.stringify({
      type: "message_delta",
      usage: { output_tokens: 30 },
    })}`,
    "",
  ].join("\n");
  const usage = gateway.usageFromUpstreamBody(body, "anthropic-exclusive");
  assert.equal(usage.input_tokens, 1_004);
  assert.equal(usage.output_tokens, 30);
  assert.equal(usage.cached_input_tokens, 1_000);
  assert.equal(usage.total_tokens, 1_034);
  assert.equal(usage.cache_status, "hit");
});

// ---- anchor workflow -------------------------------------------------------
// A command route is a fresh process with no memory, so the fake anchor decides
// what to say by inspecting its own stdin — which means these tests also pin
// the fold-back marker contract.
const SENTINEL = "PRIVATE-TRANSCRIPT-SENTINEL";

function anchorRoutes({ directive, maxDelegations = 1 } = {}) {
  const anchorScript = `
    let input = "";
    process.stdin.on("data", (c) => { input += c; });
    process.stdin.on("end", () => {
      // Detect the WORKER'S OUTPUT, not the phrase "WORKER RESULT" — the
      // anchor charter contains that phrase, so matching it would make the
      // very first turn think a worker had already run.
      const seen = input.includes("WORKER_SAW");
      const body = seen ? "final answer" : ${JSON.stringify(`plan\n\n\`\`\`farm-delegate\n${directive}\n\`\`\``)};
      console.log(JSON.stringify({ result: body }));
    });
  `;
  const workerScript = `
    let input = "";
    process.stdin.on("data", (c) => { input += c; });
    process.stdin.on("end", () => console.log(JSON.stringify({ result: "WORKER_SAW:" + input })));
  `;
  return [
    { id: "anchor-m", transport: "command", command: process.execPath, args: ["-e", anchorScript], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "worker-m", transport: "command", command: process.execPath, args: ["-e", workerScript], inputMode: "stdin", streamFormat: "ndjson" },
    { id: "anchored", transport: "hybrid", members: ["anchor-m", "worker-m"], workflow: { kind: "anchor", members: ["anchor-m", "worker-m"], anchor: "anchor-m", workers: ["worker-m"], maxDelegations } },
  ];
}

const anchorRequest = () => ({ messages: [{ role: "user", content: `original question ${SENTINEL}` }] });

test("anchor delegates once, strips the directive, and returns its final answer", async () => {
  const routes = anchorRoutes({ directive: '{"id":"t1","objective":"count the files","context":"src/ has 3 files","deliverable":"a number"}' });
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes }));
  const events = [];
  const result = await gateway.executeRoute(routes[2], anchorRequest(), "chat", new AbortController().signal, [], (e) => events.push(e));

  assert.equal(result.text, "final answer");
  assert.ok(!result.text.includes("farm-delegate"), "the directive must not reach the user");
  const roles = events.filter((e) => e.type === "member_start").map((e) => e.role);
  assert.deepEqual(roles, ["anchor", "worker", "anchor"], "anchor -> worker -> anchor");
});

test("a worker sees ONLY its brief — never the conversation", async () => {
  // The reason this whole workflow exists. If the sentinel leaks, context
  // scoping is broken and the feature is pointless.
  const routes = anchorRoutes({ directive: '{"id":"t1","objective":"count the files","context":"src/ has 3 files","constraints":"do not edit","deliverable":"a number"}' });
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes }));
  const events = [];
  await gateway.executeRoute(routes[2], anchorRequest(), "chat", new AbortController().signal, [], (e) => events.push(e));

  const workerSaw = events.find((e) => e.type === "member_done" && e.role === "worker")?.output || "";
  assert.ok(workerSaw.includes("count the files"), "the brief's objective must reach the worker");
  assert.ok(workerSaw.includes("src/ has 3 files"), "the anchor's hand-picked context must reach the worker");
  assert.ok(workerSaw.includes("do not edit"), "constraints must reach the worker");
  assert.ok(!workerSaw.includes(SENTINEL), "the user's conversation must NOT reach the worker");
  assert.ok(!workerSaw.includes("farm-delegate"), "the anchor's own reply must not reach the worker");
});

test("a malformed directive degrades to a plain answer with no worker", async () => {
  const routes = anchorRoutes({ directive: "{not json at all" });
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes }));
  const events = [];
  const result = await gateway.executeRoute(routes[2], anchorRequest(), "chat", new AbortController().signal, [], (e) => events.push(e));

  assert.equal(events.filter((e) => e.type === "member_start" && e.role === "worker").length, 0);
  assert.match(result.text, /plan/, "the anchor's prose is still returned");
});

test("a directive with no objective is ignored rather than dispatched empty", async () => {
  const routes = anchorRoutes({ directive: '{"id":"t1","context":"some context"}' });
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes }));
  const events = [];
  await gateway.executeRoute(routes[2], anchorRequest(), "chat", new AbortController().signal, [], (e) => events.push(e));
  assert.equal(events.filter((e) => e.role === "worker").length, 0);
});

test("maxDelegations:0 never delegates", async () => {
  const routes = anchorRoutes({ directive: '{"id":"t1","objective":"do a thing"}', maxDelegations: 0 });
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes }));
  const events = [];
  await gateway.executeRoute(routes[2], anchorRequest(), "chat", new AbortController().signal, [], (e) => events.push(e));
  assert.equal(events.filter((e) => e.role === "worker").length, 0);
  assert.equal(events.filter((e) => e.role === "anchor" && e.type === "member_start").length, 1);
});

test("fold-back keeps the anchor's prompt append-only", () => {
  const before = { messages: [{ role: "user", content: "q" }] };
  const after = {
    ...before,
    messages: [...before.messages, { role: "assistant", content: "plan" }, { role: "user", content: "WORKER RESULT (silo · task t1)\n\nanswer" }],
  };
  assert.ok(gateway.promptFrom(after, "chat").startsWith(gateway.promptFrom(before, "chat")));
});

test("publishes the compatibility endpoints in OpenAPI", () => {
  const spec = gateway.openApi();
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.paths["/chat/completions"]);
  assert.ok(spec.paths["/responses"]);
  assert.ok(spec.paths["/messages"]);
});

test("cliArgs forwards catalog model and effort, preferring them over the route's pin", () => {
  const route = { provider: "claude", account: "alpha", upstreamModel: "claude-haiku-4-5" };
  const plain = gateway.cliArgs(route, {});
  assert.deepEqual(plain.slice(0, 5), ["api-exec", "claude", "alpha", "--model", "claude-haiku-4-5"]);
  assert.equal(plain.includes("--effort"), false);

  const cascade = gateway.cliArgs(route, { farm: { model: "claude-fable-5", effort: "xhigh", permissions: "read-only" } });
  assert.deepEqual(cascade.slice(0, 7), ["api-exec", "claude", "alpha", "--model", "claude-fable-5", "--effort", "xhigh"]);
  assert.equal(cascade[cascade.indexOf("--permissions") + 1], "read-only");
});

// ---- rota: affinity + rate-limit veto --------------------------------------
// These create a SECOND silo, so they must run after the test that asserts the
// exact model list.
function usageFile(account, { session = 90, weekly = 90, rateLimit } = {}) {
  mkdirSync(join(state, "usage", account), { recursive: true });
  writeFileSync(join(state, "usage", account, "claude.json"), JSON.stringify({
    provider: "claude",
    windows: [
      { window: "session", remainingPercent: session },
      { window: "weekly all models", remainingPercent: weekly },
    ],
    ...(rateLimit ? { rateLimit } : {}),
  }));
}

function resetRota() {
  for (const name of ["rota.json", "rota-sessions.json"]) {
    try { rmSync(join(state, name)); } catch { /* absent is fine */ }
  }
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes: [] }));
}

test("rota pins a lane per session and holds it when the evidence flips", () => {
  mkdirSync(join(state, "accounts", "beta", "claude-home"), { recursive: true });
  resetRota();
  usageFile("alpha", { session: 90, weekly: 90 });
  usageFile("beta", { session: 20, weekly: 20 });

  assert.equal(gateway.routeFor("rota", "s1").account, "alpha");
  // Beta is now clearly healthier, but s1 already has a lane.
  usageFile("alpha", { session: 30, weekly: 30 });
  usageFile("beta", { session: 95, weekly: 95 });
  assert.equal(gateway.routeFor("rota", "s1").account, "alpha", "affinity must survive a score flip");
  // A different conversation is free to follow the score.
  assert.equal(gateway.routeFor("rota", "s2").account, "beta");
});

test("callers with no session id keep today's global behaviour", () => {
  resetRota();
  usageFile("alpha", { session: 95, weekly: 95 });
  usageFile("beta", { session: 20, weekly: 20 });
  assert.equal(gateway.routeFor("rota").account, "alpha");
  assert.equal(existsSync(join(state, "rota.json")), true, "the global sticky file is still written");
});

test("an exhausted lane breaks affinity", () => {
  resetRota();
  usageFile("alpha", { session: 90, weekly: 90 });
  usageFile("beta", { session: 50, weekly: 50 });
  assert.equal(gateway.routeFor("rota", "s3").account, "alpha");
  usageFile("alpha", { session: 0, weekly: 0 });
  assert.equal(gateway.routeFor("rota", "s3").account, "beta");
});

test("rotaAffinity:'per-request' bypasses the pin entirely", () => {
  resetRota();
  usageFile("alpha", { session: 90, weekly: 90 });
  usageFile("beta", { session: 20, weekly: 20 });
  assert.equal(gateway.routeFor("rota", "s4").account, "alpha");
  writeFileSync(join(state, "gateway.json"), JSON.stringify({ host: "127.0.0.1", port: 4545, routes: [], rotaAffinity: "per-request" }));
  // The gap must beat the +0.12 sticky bonus alpha still earns from rota.json:
  // bypassing affinity falls through to scoring, it does not ignore stickiness.
  usageFile("alpha", { session: 20, weekly: 20 });
  usageFile("beta", { session: 99, weekly: 99 });
  assert.equal(gateway.routeFor("rota", "s4").account, "beta");
});

test("overageStatus:'rejected' must NOT block a lane", () => {
  // The trap: overageStatus "rejected" is the NORMAL steady state (overage
  // purchasing off). Treating it as a block would black-hole the whole fleet.
  resetRota();
  usageFile("alpha", {
    session: 95, weekly: 95,
    rateLimit: { status: "allowed", window: "five_hour", overageStatus: "rejected", resetsAt: Math.floor(Date.now() / 1000) + 3600 },
  });
  usageFile("beta", { session: 10, weekly: 10 });
  assert.equal(gateway.routeFor("rota").account, "alpha");
});

test("a genuinely rate-limited lane is skipped until its reset passes", () => {
  resetRota();
  usageFile("alpha", {
    session: 95, weekly: 95,
    rateLimit: { status: "rejected", window: "five_hour", resetsAt: Math.floor(Date.now() / 1000) + 3600 },
  });
  usageFile("beta", { session: 10, weekly: 10 });
  assert.equal(gateway.routeFor("rota").account, "beta", "blocked lane must be skipped even though it scores higher");

  // An expired reset is not a block.
  usageFile("alpha", {
    session: 95, weekly: 95,
    rateLimit: { status: "rejected", window: "five_hour", resetsAt: Math.floor(Date.now() / 1000) - 60 },
  });
  assert.equal(gateway.routeFor("rota").account, "alpha");
});

test("every lane blocked degrades to a route rather than a 404", () => {
  resetRota();
  const blocked = { status: "rejected", window: "five_hour", resetsAt: Math.floor(Date.now() / 1000) + 3600 };
  usageFile("alpha", { session: 90, weekly: 90, rateLimit: blocked });
  usageFile("beta", { session: 90, weekly: 90, rateLimit: blocked });
  const route = gateway.routeFor("rota", "s5");
  assert.ok(route, "must never return null — that surfaces as model_not_found");
  assert.equal(route.id, "rota");
});

test("the prompt is a strict prefix extension turn over turn", () => {
  // Prompt caching can only ever hit when turn N+1 extends turn N byte for
  // byte. Nothing enforced this, so it could regress silently — see
  // docs/prompt-cache-evidence.md.
  // Longer than the 4096-char hash window, so the sampled prefix is the part
  // that stays put as the conversation grows.
  const opening = "x".repeat(5000);
  const turn1 = { system: "Be brief.", messages: [{ role: "user", content: opening }] };
  const turn2 = { ...turn1, messages: [...turn1.messages, { role: "assistant", content: "1" }, { role: "user", content: "two" }] };
  const a = gateway.promptFrom(turn1, "chat");
  const b = gateway.promptFrom(turn2, "chat");
  assert.ok(b.startsWith(a), "turn 2 must extend turn 1's prompt, not rewrite it");
  assert.equal(gateway.promptPrefixSha(a), gateway.promptPrefixSha(b));

  // Editing an earlier turn legitimately breaks the prefix — the hash is what
  // makes that visible in the ledger rather than a silent cache miss.
  const edited = { ...turn1, messages: [{ role: "user", content: `EDITED${opening}` }] };
  assert.notEqual(gateway.promptPrefixSha(gateway.promptFrom(edited, "chat")), gateway.promptPrefixSha(a));
});

test("images are described, not inlined, in text prompts", () => {
  // A screenshot as a data URL used to be pasted into the prompt verbatim on
  // every subsequent turn. textPart only ever builds a string, so the bytes
  // never functioned as an image anyway.
  const base64 = "A".repeat(400_000);
  const prompt = gateway.promptFrom({
    messages: [{ role: "user", content: [
      { type: "text", text: "what is this" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
    ] }],
  }, "chat");
  assert.ok(!prompt.includes(base64), "base64 payload must not reach the prompt");
  assert.ok(prompt.length < 1000, `prompt was ${prompt.length} chars`);
  assert.match(prompt, /\[Image: image\/png, \d+(\.\d+)? (KB|MB)/);
  assert.match(prompt, /what is this/);

  // Deterministic — the same image must render identically next turn or it
  // breaks the prefix it was meant to protect.
  assert.equal(gateway.imageReference(`data:image/png;base64,${base64}`), gateway.imageReference(`data:image/png;base64,${base64}`));
  // Remote URLs stay verbatim: they are short and the model may be able to use them.
  assert.equal(gateway.imageReference("https://example.com/a.png"), "[Image: https://example.com/a.png]");
  assert.equal(gateway.imageReference(""), "[Image: attached]");
});

test("streamChat sends farm reasoning/tools as a delta on ONE chunk only", () => {
  // The client accumulates these because they do NOT repeat. If this ever
  // becomes per-chunk-cumulative, chat-workspace's `reasoning += …` would
  // start duplicating — pin the contract on this side too.
  const written = [];
  const res = {
    writeHead() {},
    write(chunk) { written.push(chunk); },
    end(chunk) { if (chunk) written.push(chunk); },
  };
  gateway.streamChat(res, "claude/alpha", "a".repeat(120), "prompt", {
    reasoning: "thinking hard",
    tools: [{ id: "t1", name: "Read", status: "completed" }],
  });

  const deltas = written
    .join("")
    .split("\n\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)))
    .map((chunk) => chunk.choices?.[0]?.delta)
    .filter(Boolean);

  const withFarm = deltas.filter((delta) => delta.farm);
  assert.equal(withFarm.length, 1);
  assert.equal(withFarm[0].farm.reasoning, "thinking hard");
  assert.equal(withFarm[0].farm.tools.length, 1);
  // …and the text that follows carries no farm payload at all.
  const textDeltas = deltas.filter((delta) => delta.content && !delta.farm);
  assert.ok(textDeltas.length >= 2);
  assert.equal(textDeltas.map((delta) => delta.content).join(""), "a".repeat(120));
});

test("authenticates independently revocable managed client keys", () => {
  writeFileSync(join(state, "gateway.json"), JSON.stringify({
    host: "127.0.0.1",
    port: 4545,
    apiKey: "legacy-secret",
    apiKeys: [{ id: "client-a", name: "Continue", key: "managed-secret", createdAt: new Date().toISOString() }],
    routes: [],
  }));
  assert.deepEqual(
    gateway.requestAuth({ headers: { authorization: "Bearer managed-secret" } }),
    { ok: true, keyId: "client-a", keyName: "Continue" },
  );
  assert.deepEqual(
    gateway.requestAuth({ headers: { "x-api-key": "legacy-secret" } }),
    { ok: true, keyId: "legacy", keyName: "Legacy key" },
  );
  assert.equal(gateway.requestAuth({ headers: { authorization: "Bearer wrong" } }).ok, false);
});
