# Prompt-cache evidence: what actually caches, and what does not

Measured 2026-07-29 from `~/.claude-farm/gateway-activity.jsonl` (149 records, 45 with usage)
via `desktop/frontend/public/backend/cache-report.mjs`. Run it yourself:

```sh
node desktop/frontend/public/backend/cache-report.mjs
```

## The finding

**Content the gateway supplies is written to cache on every request and never read back.
The only thing ever read back is the provider CLI's own static prefix.**

Overall reuse across the ledger is 86.5%, but that number is misleading — it is dominated by
long agentic runs. Split by route it separates cleanly:

| session | turns | reuse | shape |
|---|---|---|---|
| `hello · rota` | 36 | **34.6%** | `read` pinned at **18,065 every single turn**; `create` grows 50,197 → 50,842 |
| `gmail · claude/gmail` | 5 | 96.6% | `read` 0.7M–3.0M, `input_tokens` 29–63 |
| `hello · claude/hello` | 2 | 96.7% | `read` 1.0M–1.7M |
| `host · claude/host` | 2 | 93.7% | `read` up to 2.4M |

### 1. The 18,065 constant is the CLI's, not ours

On the rota session `cache_read_input_tokens` is **exactly 18,065** on all 36 turns spanning
5.5 hours, while `cache_creation_input_tokens` climbs by ~130/turn — the conversation growing.
18,065 is the Claude Code CLI's own system prompt + tool definitions, cached and read by each
new `farm api-exec` process. Our conversation content sits after it and is re-created every time.

### 2. TTL is not the explanation

The ledger contains three consecutive requests **47s and 46s apart**, each reporting an
identical `cache_creation` of 17,261 with `read` still at 18,065. An identical prompt, well
inside any cache TTL, got zero reuse. That is the controlled experiment, and it happened
naturally — so cross-spawn reuse of gateway-supplied content does not work, and waiting less
between turns would not fix it.

### 3. The million-token reads are intra-request

`claude/gmail` shows `cache_read` of 953k–3.0M with `input_tokens` of 29–63. That is the CLI's
own agentic loop re-sending its growing internal transcript across many API calls **inside one
140–340s `api-exec` run**. A request always lands on one silo, so **silo rotation cannot affect
these at all.** This is where the cache economy already lives, and it already works.

## Consequences

- **Rotating silos costs ~18k of static prefix per switch — not the conversation.** The
  conversation cache is already 100% cold on every turn regardless of rotation. The claim in
  `docs/rota-gateway.md` that the `+0.12` sticky bonus "preserves warm context" has no
  implementation behind it.
- **We are paying the 1.25× cache-write premium on ~50k tokens per turn for a cache that is
  never read.**
- **We cannot fix the CLI route from our side.** `promptFrom` flattens the conversation to one plain-text
  blob on the CLI's stdin; the CLI builds the actual API request and decides where
  `cache_control` breakpoints go. We can see neither the wire body nor the breakpoints.
  Leading hypothesis (unproven, and unprovable from here): the CLI injects a per-run environment
  block — cwd, date, git state — ahead of the user content, breaking the prefix for everything
  after the static portion.

**Therefore the only lever we own on CLI routes is sending less.** Context scoping — giving a worker a tight
brief instead of the whole transcript — is the answer to the cache waste, not cache preservation.
Anchor mode is justified by volume reduction and thread coherence. Do not ship UI copy promising
"maintain context caching".

## Direct routes are different

For `transport: "anthropic"` routes the gateway owns the structured Messages
API body. Those routes now default explicit prompt caching on: one static
system breakpoint plus up to three content-block-aware rolling breakpoints. Their
read/write counters are captured for both JSON and SSE responses.

The direct route has now been verified live. On 2026-07-30 a cold request wrote
10,603 cache tokens and the byte-identical warm request read all 10,603. The
gateway reports both the raw counters and the net saving after the 1.25× write
premium; see `docs/direct-prompt-caching.md`.

This does not change or contradict the CLI evidence above. It creates a second,
cache-controllable route implementation alongside the provider-managed CLI
route. See `docs/direct-prompt-caching.md` for configuration, telemetry, and
the two-request probe.

## Watching it going forward

`beginInference` (`gateway.mjs`) now records `sessionId`, `promptChars`,
`promptPrefixSha`, `cacheMode`, and the usage dialect per request. Direct
Anthropic routes additionally record `cachePrefixSha` from the provider-ordered
prefix through the first real breakpoint. The report uses that direct hash
instead of the flattened CLI hash when available. A top-level automatic-cache
fingerprint covers the full growing context and is diagnostic only; it is not
compared between turns as prefix-break evidence. For comparable fingerprints,
a change between two turns of one session means that prefix broke.
`cache-report.mjs` reports
`prefixBreaks`, `rotations`, hits, writes, measured misses, and unreported
cache telemetry per session so a silent regression — for example a CLI update
changing the static prefix, which is visible above as `read` dropping 18,065 → 15,273 at 15:47 —
shows up as a number rather than a mystery.

Note the pre-instrumentation rows group as `(no-session)`; two different clients (a poller
sending a fixed 17,261-token prompt and the real conversation) currently share one bucket. New
records carry the real session id and will separate.
