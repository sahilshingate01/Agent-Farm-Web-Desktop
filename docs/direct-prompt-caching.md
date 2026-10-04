---
title: Direct-route prompt caching
description: Where Claude Farm can control prompt-cache breakpoints, how direct Anthropic routes use them, and how to verify reads and writes.
---

# Direct-route prompt caching

Claude Farm has two materially different inference paths:

| Route | Who builds the provider request? | Cache behavior |
|---|---|---|
| `cli` / `rota` | The spawned provider CLI | Provider-managed. Claude Farm cannot add or move wire-level breakpoints. |
| Direct `anthropic` | Claude Farm's gateway | Explicit Anthropic breakpoints, on by default. |
| Direct `openai` | Claude Farm's gateway | Provider-managed caching; Claude Farm records the returned cache split. |

This boundary is non-negotiable. A `cache_control` object added around the
flattened CLI stdin prompt would never reach the provider request.

## Direct Anthropic strategy

Every configured `transport: "anthropic"` route defaults
`promptCaching` to `true`. The gateway adds at most four breakpoints:

1. One static-prefix breakpoint on the final system block. Anthropic orders
   the prefix as tools, system, then messages, so this also covers the tools.
2. A rolling breakpoint on the latest eligible content block.
3. Up to two leapfrog breakpoints, using the remaining slots to keep
   tool-heavy content within Anthropic's 20-block lookback.

Rolling selection is content-block based, not merely message based, so a single
tool-heavy assistant message cannot outrun the lookback window. Image-only,
empty-text, thinking, and redacted-thinking blocks are skipped. Existing caller
breakpoints are preserved and count toward the four-breakpoint limit. If the
caller supplies an explicit TTL, the gateway leaves the whole TTL strategy
untouched rather than mixing default 5-minute markers into a 1-hour sequence.

Disable it per route in Gateway → Provider mappings, or in `gateway.json`:

```json
{
  "id": "direct-claude",
  "transport": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "apiKeySecret": "anthropic-direct",
  "upstreamModel": "your-model-id",
  "baseInputUsdPerMillion": 5,
  "promptCaching": false
}
```

Direct routes resolve credentials in this order: `apiKeyEnv`, then
`apiKeySecret`. A secret identifier such as `anthropic-direct` resolves only to
`<farm state>/secrets/anthropic-direct.key`; routes cannot read arbitrary file
paths. Secret files must be regular files with no group or other permissions
(`chmod 600`), and the containing `secrets` directory should be `chmod 700`.
Inline `apiKey` and arbitrary `apiKeyFile` route fields are rejected.

## Usage accounting

`public/backend/token-usage.mjs` is the single normalization seam.

- Native Anthropic `input_tokens` excludes cache reads and writes. The
  canonical `input_tokens` therefore adds
  `cache_read_input_tokens + cache_creation_input_tokens`.
- OpenAI `prompt_tokens` / `input_tokens` already includes its cached subset.
  Nested `prompt_tokens_details.cached_tokens` and
  `input_tokens_details.cached_tokens` are recorded but never added again.
- Reported zero is preserved separately from an absent field. `cache_status`
  is `hit`, `write`, `miss`, or `unreported`.
- `total_tokens_reported` says whether `total_tokens` came from the provider.
  When absent, the numeric total is an exact display sum of normalized input
  and output, not represented as a provider-reported total.

The Gateway traffic view shows aggregate cache reads and writes. Individual
activity rows and model traces distinguish a hit, write, measured miss, and
missing telemetry.

## Savings

For Anthropic's default five-minute cache duration, a write costs 1.25 times
base input; a one-hour write costs 2 times base input; and a read costs 0.1
times base input. The gateway preserves Anthropic's separate five-minute and
one-hour counters and reports:

```text
net base-input-token equivalents saved
  = 0.9 × cache reads
    − 0.25 × five-minute cache writes
    − 1.0 × one-hour cache writes

estimated USD saved
  = net saved × baseInputUsdPerMillion / 1,000,000
```

The initial write can correctly be negative: it is an investment that only
pays back when a later request reads it. The estimate excludes uncached input
and output tokens because those costs are identical with or without caching.
Provider prices are route configuration, not hard-coded application constants,
so they can be updated without a new build. A price is accepted only on a route
with a pinned `upstreamModel`; otherwise one model's price could be applied to
another. Provider-managed writes without a TTL breakdown are shown as cache
activity but are not assigned a savings figure.

## Verify a configured route

The probe makes two byte-identical, non-streaming calls with a cacheable static
prefix. The synthetic prefix must be 4,096–32,000 characters (24,000 by
default), keeping one probe item below roughly 8K tokens. It incurs two provider
requests, so inspect it first:

```sh
node desktop/frontend/public/backend/cache-probe.mjs direct-claude --dry-run
node desktop/frontend/public/backend/cache-probe.mjs direct-claude
```

Successful shape:

- First request: cache write greater than zero.
- Second request: cache read greater than zero.
- Verdict: `working`.

Other verdicts are intentionally distinct:

- `written-not-reused`: the provider accepted a write but the second request
  did not read it.
- `miss`: the provider explicitly reported a zero cache read.
- `unreported`: the upstream returned no cache split, so the probe cannot
  claim caching worked or failed.

The activity ledger records `cachePrefixSha` for direct Anthropic routes. That
hash follows provider order (tools, system, messages) and stops at the first
real cache breakpoint. The older `promptPrefixSha` remains the flattened
CLI-prompt diagnostic; it is not used to claim direct-route prefix stability.

Use the historical ledger report for ongoing behavior:

```sh
node desktop/frontend/public/backend/cache-report.mjs
```

The report always shows net base-input-token equivalents. It shows dollar
savings only for activity records whose route supplied
`baseInputUsdPerMillion`, avoiding false precision across mixed models and
providers.

## Verified direct route

On 2026-07-30, the configured `direct-opus` route (`claude-opus-5`) passed the
controlled probe:

- Cold request: 10,603 cache-write tokens.
- Byte-identical warm request: 10,603 cache-read tokens.
- Net across the pair: 6,891.95 base-input-token equivalents saved.
- At the configured $5 / MTok base input price: $0.03445975 estimated saved.

This is direct provider evidence, not an inference from latency or a prefix
hash.

## Files

- `public/backend/prompt-cache.mjs` — request mutation and breakpoint limits.
- `public/backend/token-usage.mjs` — provider-dialect normalization.
- `public/backend/route-secret.mjs` — environment and state-confined secret resolution.
- `public/backend/cache-probe.mjs` — controlled two-request verification.
- `public/backend/cache-report.mjs` — session-level ledger report.
- `public/backend/gateway.mjs` — route integration and streamed usage capture.
