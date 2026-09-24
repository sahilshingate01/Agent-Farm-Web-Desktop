import assert from "node:assert/strict";
import test from "node:test";

const { summarizeCacheEvidence, cacheTokens } = await import("../public/backend/cache-report.mjs");

const turn = (overrides = {}) => ({
  event: "completed",
  occurredAt: "2026-07-29T12:00:00.000Z",
  sessionId: "s1",
  account: "hello",
  route: "rota",
  promptChars: 200_000,
  promptPrefixSha: "aaaaaaaaaaaaaaaa",
  usage: { input_tokens: 2, cache_creation_input_tokens: 50000, cache_read_input_tokens: 18065 },
  ...overrides,
});

test("reads cache counters across provider casings", () => {
  assert.deepEqual(cacheTokens({ cache_read_input_tokens: 5, cache_creation_input_tokens: 7, input_tokens: 1, output_tokens: 2 }), {
    read: 5,
    creation: 7,
    input: 13,
    output: 2,
    readReported: true,
    creationReported: true,
    status: "hit",
  });
  assert.deepEqual(cacheTokens({ cachedInputTokens: 5, cacheCreationInputTokens: 7, inputTokens: 13, outputTokens: 2 }), {
    read: 5,
    creation: 7,
    input: 13,
    output: 2,
    readReported: true,
    creationReported: true,
    status: "hit",
  });
  assert.equal(cacheTokens({}), null);
  assert.equal(cacheTokens(null), null);
});

test("reads nested OpenAI cache counters without adding them to input", () => {
  assert.deepEqual(cacheTokens({
    prompt_tokens: 100,
    completion_tokens: 2,
    prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 },
  }), {
    read: 80,
    creation: 5,
    input: 100,
    output: 2,
    readReported: true,
    creationReported: true,
    status: "hit",
  });
});

test("distinguishes a reported cache miss from absent cache telemetry", () => {
  const report = summarizeCacheEvidence([
    turn({
      usage: {
        input_tokens: 100,
        output_tokens: 2,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
    }),
    turn({
      occurredAt: "2026-07-29T12:00:10.000Z",
      usage: { input_tokens: 100, output_tokens: 2 },
    }),
  ]);
  assert.equal(report.overall.cacheMisses, 1);
  assert.equal(report.overall.cacheUnreported, 1);
});

test("ignores started events and requests that never reached a provider", () => {
  const report = summarizeCacheEvidence([
    { event: "started", sessionId: "s1" },
    { event: "failed", sessionId: "s1", usage: null },
    turn(),
  ]);
  assert.equal(report.overall.turns, 1);
});

test("reuse is near zero when every turn re-creates and never reads the conversation", () => {
  // This is the shape the live ledger actually shows — the finding that drove
  // the whole plan. read stays pinned at the CLI's static prefix while
  // creation grows with the conversation.
  const report = summarizeCacheEvidence([
    turn({ occurredAt: "2026-07-29T12:00:00.000Z", usage: { cache_creation_input_tokens: 50197, cache_read_input_tokens: 18065 } }),
    turn({ occurredAt: "2026-07-29T12:00:47.000Z", usage: { cache_creation_input_tokens: 50332, cache_read_input_tokens: 18065 } }),
    turn({ occurredAt: "2026-07-29T12:01:33.000Z", usage: { cache_creation_input_tokens: 50479, cache_read_input_tokens: 18065 } }),
  ]);
  const session = report.sessions[0];
  assert.equal(session.totals.turns, 3);
  assert.ok(session.totals.reuse < 0.3, `reuse ${session.totals.reuse} should be low`);
  // 47s and 46s gaps — well inside any TTL, so TTL cannot explain the misses.
  assert.deepEqual(session.turns.map((t) => t.gapSeconds), [null, 47, 46]);
  assert.equal(session.totals.prefixBreaks, 0);
});

test("a changed prefix hash is reported as a prefix break", () => {
  const report = summarizeCacheEvidence([
    turn({ promptPrefixSha: "aaaaaaaaaaaaaaaa" }),
    turn({ occurredAt: "2026-07-29T12:00:10.000Z", promptPrefixSha: "bbbbbbbbbbbbbbbb" }),
  ]);
  assert.equal(report.sessions[0].totals.prefixBreaks, 1);
  assert.equal(report.sessions[0].turns[0].prefixStable, null); // first turn has nothing to compare
  assert.equal(report.sessions[0].turns[1].prefixStable, false);
});

test("direct routes compare their exact provider-ordered cache prefix", () => {
  const report = summarizeCacheEvidence([
    turn({
      promptChars: 100,
      promptPrefixSha: "flattened-one",
      cachePrefixChars: 80,
      cachePrefixSha: "provider-prefix",
    }),
    turn({
      occurredAt: "2026-07-29T12:00:10.000Z",
      promptChars: 200,
      promptPrefixSha: "flattened-two",
      cachePrefixChars: 80,
      cachePrefixSha: "provider-prefix",
    }),
  ]);
  assert.equal(report.sessions[0].turns[1].prefixKind, "provider");
  assert.equal(report.sessions[0].turns[1].prefixStable, true);
});

test("automatic full-context fingerprints are diagnostic, not prefix-break evidence", () => {
  const report = summarizeCacheEvidence([
    turn({
      cachePrefixChars: 80,
      cachePrefixSha: "automatic-one",
      cachePrefixComparable: false,
    }),
    turn({
      occurredAt: "2026-07-29T12:00:10.000Z",
      cachePrefixChars: 120,
      cachePrefixSha: "automatic-two",
      cachePrefixComparable: false,
    }),
  ]);
  assert.equal(report.sessions[0].turns[1].prefixKind, "provider");
  assert.equal(report.sessions[0].turns[1].prefixStable, null);
  assert.equal(report.sessions[0].totals.prefixBreaks, 0);
});

test("a turn that reads and writes is counted in both cache totals", () => {
  const report = summarizeCacheEvidence([turn({ cacheMode: "explicit" })]);
  assert.equal(report.overall.cacheHits, 1);
  assert.equal(report.overall.cacheWrites, 1);
  assert.equal(report.overall.cacheNetInputTokensSaved, 3_758.5);
});

test("priced direct-route turns report net dollar savings", () => {
  const report = summarizeCacheEvidence([
    turn({
      cacheMode: "explicit",
      baseInputUsdPerMillion: 5,
      cacheWriteMultiplier: 1.25,
      usage: {
        input_tokens: 0,
        output_tokens: 1,
        cache_creation_input_tokens: 10_000,
        cache_read_input_tokens: 0,
      },
    }),
    turn({
      cacheMode: "explicit",
      occurredAt: "2026-07-29T12:00:10.000Z",
      baseInputUsdPerMillion: 5,
      cacheWriteMultiplier: 1.25,
      usage: {
        input_tokens: 0,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 10_000,
      },
    }),
  ]);
  assert.equal(report.overall.cacheNetInputTokensSaved, 6_500);
  assert.equal(report.overall.cacheSavingsUsd, 0.0325);
  assert.equal(report.overall.pricedTurns, 2);
});

test("Anthropic cache multipliers are not applied to OpenAI cache counters", () => {
  const report = summarizeCacheEvidence([
    turn({
      provider: "openai",
      transport: "openai",
      usage: {
        prompt_tokens: 10_000,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 8_000 },
      },
      baseInputUsdPerMillion: 5,
    }),
  ]);
  assert.equal(report.sessions[0].turns[0].cacheNetInputTokensSaved, null);
  assert.equal(report.sessions[0].turns[0].cacheSavingsUsd, null);
  assert.equal(report.overall.pricedTurns, 0);
});

test("switching silo mid-session is flagged as a rotation", () => {
  const report = summarizeCacheEvidence([
    turn({ account: "hello" }),
    turn({ occurredAt: "2026-07-29T12:00:10.000Z", account: "gmail" }),
  ]);
  assert.equal(report.sessions[0].totals.rotations, 1);
  assert.equal(report.sessions[0].turns[1].rotated, true);
});

test("high reuse is reported when the prefix is actually read back", () => {
  const report = summarizeCacheEvidence([
    turn({ usage: { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0 } }),
    turn({ occurredAt: "2026-07-29T12:00:30.000Z", usage: { cache_creation_input_tokens: 200, cache_read_input_tokens: 50000 } }),
  ]);
  assert.ok(report.sessions[0].totals.reuse > 0.4, `reuse ${report.sessions[0].totals.reuse} should be high`);
});

test("requests with no session id group by account and route, not into one bucket", () => {
  const report = summarizeCacheEvidence([
    turn({ sessionId: null, account: "hello", route: "rota" }),
    turn({ sessionId: null, account: "gmail", route: "claude/gmail" }),
  ]);
  assert.equal(report.sessions.length, 2);
  assert.ok(report.sessions.every((s) => s.key.startsWith("(no-session)")));
});

test("turns predating instrumentation report prefixStable as null, not false", () => {
  const report = summarizeCacheEvidence([
    turn({ promptPrefixSha: undefined }),
    turn({ occurredAt: "2026-07-29T12:00:10.000Z", promptPrefixSha: undefined }),
  ]);
  assert.equal(report.sessions[0].totals.prefixBreaks, 0);
  assert.equal(report.sessions[0].turns[1].prefixStable, null);
});

test("short prompts never report a prefix break", () => {
  // Below the sample window the whole prompt IS the prefix, so it grows every
  // turn for a boring reason. Reporting that as a break would cry wolf on
  // every short conversation — and such prompts are under the provider's
  // minimum cacheable size anyway.
  const report = summarizeCacheEvidence([
    turn({ promptChars: 400, promptPrefixSha: "aaaaaaaaaaaaaaaa" }),
    turn({ occurredAt: "2026-07-29T12:00:10.000Z", promptChars: 900, promptPrefixSha: "bbbbbbbbbbbbbbbb" }),
  ]);
  assert.equal(report.sessions[0].totals.prefixBreaks, 0);
  assert.equal(report.sessions[0].turns[1].prefixStable, null);
});
