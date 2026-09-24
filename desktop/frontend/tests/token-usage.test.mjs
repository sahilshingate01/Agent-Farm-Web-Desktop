import assert from "node:assert/strict";
import test from "node:test";

const {
  cacheStatus,
  estimateCacheSavings,
  mergeUsageSnapshots,
  normalizeProviderUsage,
  sumTokenUsage,
} = await import("../public/backend/token-usage.mjs");

test("cache savings subtract the write premium and price the net result", () => {
  const savings = estimateCacheSavings({
    input_tokens: 20_000,
    output_tokens: 10,
    cached_input_tokens: 10_000,
    cache_creation_input_tokens: 2_000,
    cached_input_tokens_reported: true,
    cache_creation_input_tokens_reported: true,
    total_tokens: 20_010,
    total_tokens_reported: false,
    usage_dialect: "anthropic-exclusive",
    cache_status: "hit",
  }, { baseInputUsdPerMillion: 5 });
  assert.equal(savings.cache_net_input_tokens_saved, 8_500);
  assert.equal(savings.cache_savings_rate, 8_500 / 12_000);
  assert.equal(savings.cache_savings_usd, 0.0425);
});

test("an initial cache write may have negative savings before the first hit", () => {
  const savings = estimateCacheSavings({
    input_tokens: 5_000,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 5_000,
    cached_input_tokens_reported: true,
    cache_creation_input_tokens_reported: true,
    total_tokens: 5_000,
    total_tokens_reported: false,
    usage_dialect: "anthropic-exclusive",
    cache_status: "write",
  });
  assert.equal(savings.cache_net_input_tokens_saved, -1_250);
  assert.equal(savings.cache_savings_usd, null);
});

test("Anthropic one-hour cache writes use the 2x write price", () => {
  const usage = normalizeProviderUsage(
    {
      usage: {
        input_tokens: 0,
        output_tokens: 1,
        cache_read_input_tokens: 1_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 1_000,
        },
      },
    },
    "anthropic-exclusive",
  );
  assert.equal(usage.cache_creation_input_tokens, 1_000);
  assert.equal(usage.cache_creation_5m_input_tokens, 0);
  assert.equal(usage.cache_creation_1h_input_tokens, 1_000);
  assert.equal(usage.cache_creation_5m_input_tokens_reported, true);
  assert.equal(usage.cache_creation_1h_input_tokens_reported, true);

  const savings = estimateCacheSavings(usage, { baseInputUsdPerMillion: 5 });
  assert.equal(savings.cache_net_input_tokens_saved, -100);
  assert.equal(savings.cache_savings_usd, -0.0005);
  assert.equal(savings.cache_write_5m_multiplier, 1.25);
  assert.equal(savings.cache_write_1h_multiplier, 2);
});

test("mixed Anthropic cache writes price each TTL separately", () => {
  const savings = estimateCacheSavings({
    input_tokens: 3_000,
    output_tokens: 0,
    cached_input_tokens: 2_000,
    cache_creation_input_tokens: 1_000,
    cache_creation_5m_input_tokens: 600,
    cache_creation_1h_input_tokens: 400,
    cached_input_tokens_reported: true,
    cache_creation_input_tokens_reported: true,
    cache_creation_5m_input_tokens_reported: true,
    cache_creation_1h_input_tokens_reported: true,
    total_tokens: 3_000,
    total_tokens_reported: false,
    usage_dialect: "anthropic-exclusive",
    cache_status: "hit",
  });
  assert.equal(savings.cache_net_input_tokens_saved, 1_250);
});

test("provider-managed writes without a TTL breakdown are not priced", () => {
  const savings = estimateCacheSavings({
    input_tokens: 2_000,
    output_tokens: 0,
    cached_input_tokens: 1_000,
    cache_creation_input_tokens: 1_000,
    cached_input_tokens_reported: true,
    cache_creation_input_tokens_reported: true,
    total_tokens: 2_000,
    total_tokens_reported: false,
    usage_dialect: "anthropic-exclusive",
    cache_status: "hit",
  }, { requireKnownWriteTtl: true });
  assert.equal(savings, null);
});

test("Anthropic input is made inclusive without losing the cache split", () => {
  assert.deepEqual(
    normalizeProviderUsage(
      {
        usage: {
          input_tokens: 100,
          output_tokens: 12,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 20,
        },
      },
      "anthropic-exclusive",
    ),
    {
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
    },
  );
});

test("OpenAI cached tokens are a subset of inclusive prompt tokens", () => {
  const usage = normalizeProviderUsage(
    {
      usage: {
        prompt_tokens: 13_320,
        completion_tokens: 30,
        total_tokens: 13_350,
        prompt_tokens_details: {
          cached_tokens: 13_312,
          cache_write_tokens: 5,
        },
      },
    },
    "openai-inclusive",
  );
  assert.equal(usage.input_tokens, 13_320);
  assert.equal(usage.total_tokens, 13_350);
  assert.equal(usage.cached_input_tokens, 13_312);
  assert.equal(usage.cache_creation_input_tokens, 5);
  assert.equal(usage.total_tokens_reported, true);
});

test("alternative flat and nested cache spellings are never summed", () => {
  const usage = normalizeProviderUsage(
    {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        cache_read_input_tokens: 80,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    },
    "openai-inclusive",
  );
  assert.equal(usage.cached_input_tokens, 80);
  assert.equal(usage.input_tokens, 100);
  assert.equal(usage.total_tokens, 105);
});

test("reported zero remains distinguishable from a missing cache counter", () => {
  const cold = normalizeProviderUsage(
    {
      usage: {
        input_tokens: 50,
        output_tokens: 2,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
    },
    "openai-inclusive",
  );
  assert.equal(cold.cached_input_tokens, 0);
  assert.equal(cold.cached_input_tokens_reported, true);
  assert.equal(cold.cache_creation_input_tokens_reported, true);
  assert.equal(cold.cache_status, "miss");

  const absent = normalizeProviderUsage(
    { usage: { input_tokens: 50, output_tokens: 2 } },
    "openai-inclusive",
  );
  assert.equal(absent.cached_input_tokens, 0);
  assert.equal(absent.cached_input_tokens_reported, false);
  assert.equal(absent.cache_creation_input_tokens_reported, false);
  assert.equal(absent.cache_status, "unreported");
});

test("null, booleans, and blank strings are absent rather than reported zero", () => {
  const usage = normalizeProviderUsage(
    {
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: " ",
        total_tokens: false,
      },
    },
    "anthropic-exclusive",
  );
  assert.equal(usage.input_tokens, 10);
  assert.equal(usage.cached_input_tokens_reported, false);
  assert.equal(usage.cache_creation_input_tokens_reported, false);
  assert.equal(usage.total_tokens_reported, false);
  assert.equal(usage.cache_status, "unreported");
});

test("auto dialect treats prompt_tokens as inclusive even with flat Anthropic aliases", () => {
  const usage = normalizeProviderUsage({
    usage: {
      prompt_tokens: 13_320,
      completion_tokens: 30,
      cache_read_input_tokens: 13_312,
      total_tokens: 13_350,
    },
  });
  assert.equal(usage.usage_dialect, "openai-inclusive");
  assert.equal(usage.input_tokens, 13_320);
  assert.equal(usage.total_tokens, 13_350);
});

test("usage sums preserve whether every provider reported each field", () => {
  const reported = normalizeProviderUsage(
    {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 },
      },
    },
    "openai-inclusive",
  );
  const absent = normalizeProviderUsage(
    { usage: { prompt_tokens: 20, completion_tokens: 2 } },
    "openai-inclusive",
  );
  const sum = sumTokenUsage([reported, absent]);
  assert.equal(sum.input_tokens, 120);
  assert.equal(sum.output_tokens, 7);
  assert.equal(sum.cached_input_tokens, 80);
  assert.equal(sum.cached_input_tokens_reported, false);
  assert.equal(sum.cache_creation_input_tokens_reported, false);
  assert.equal(sum.cache_status, "hit");
});

test("stream usage snapshots merge cumulative fields instead of adding them", () => {
  const start = normalizeProviderUsage(
    {
      usage: {
        input_tokens: 4,
        output_tokens: 0,
        cache_read_input_tokens: 1_000,
        cache_creation_input_tokens: 0,
      },
    },
    "anthropic-exclusive",
  );
  const delta = normalizeProviderUsage(
    { usage: { output_tokens: 30 } },
    "anthropic-exclusive",
  );
  const merged = mergeUsageSnapshots(start, delta);
  assert.equal(merged.input_tokens, 1_004);
  assert.equal(merged.output_tokens, 30);
  assert.equal(merged.cached_input_tokens, 1_000);
  assert.equal(merged.total_tokens, 1_034);
});

test("conflicting stream usage dialects are labeled mixed", () => {
  const anthropic = normalizeProviderUsage(
    { usage: { input_tokens: 4, output_tokens: 0 } },
    "anthropic-exclusive",
  );
  const openai = normalizeProviderUsage(
    { usage: { prompt_tokens: 4, completion_tokens: 2 } },
    "openai-inclusive",
  );
  assert.equal(mergeUsageSnapshots(anthropic, openai).usage_dialect, "mixed");
});

test("a turn may read an old prefix and write a new tail", () => {
  const usage = normalizeProviderUsage(
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
  assert.equal(usage.cache_status, "hit");
  assert.equal(usage.cached_input_tokens, 80);
  assert.equal(usage.cache_creation_input_tokens, 20);
});

test("cache status distinguishes hits, writes, misses, and absent counters", () => {
  assert.equal(cacheStatus({ read: 2, write: 0, readReported: true, writeReported: true }), "hit");
  assert.equal(cacheStatus({ read: 0, write: 2, readReported: true, writeReported: true }), "write");
  assert.equal(
    cacheStatus({ read: 0, write: 0, readReported: true, writeReported: false }),
    "miss",
    "a reported zero read is a measured miss even when the provider has no write counter",
  );
  assert.equal(cacheStatus({ read: 0, write: 0, readReported: true, writeReported: true }), "miss");
  assert.equal(cacheStatus({ read: 0, write: 0, readReported: false, writeReported: false }), "unreported");
});
