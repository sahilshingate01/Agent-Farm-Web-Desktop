---
title: Anchor workflow
description: An elevator workflow where one pinned member holds the whole conversation and hands scoped task briefs to rotating worker silos, so workers never receive the transcript.
---

# Anchor workflow

`workflow.kind: "anchor"` on a `transport: "hybrid"` route. One member — the
**anchor** — holds the conversation and decides what to hand out. **Workers**
execute self-contained briefs and never see the transcript.

## Why it exists

Not for caching. Measured (`docs/prompt-cache-evidence.md`): the conversation is
written to the provider's cache every turn and **never read back**, on a pinned
silo as much as a rotating one. `cache_read` sits at exactly 18,065 across turns
— the provider CLI's own static prefix — while the conversation is re-created
every request. The cause is inside the CLI, which builds its own API request and
places its own cache breakpoints. We can see neither.

So we cannot make what we send cheaper. **The only lever we own is sending
less.** A worker that receives a four-field brief instead of a 50k-token
transcript is a direct, measurable reduction. That is the justification, along
with one model keeping a coherent view of a long thread while silos rotate
beneath it.

Do not describe this feature as "maintain context caching" in UI copy or docs.

## Configuring it

In the elevator editor (Settings → route editor), or directly in
`gateway.json`:

```json
{
  "id": "anchored",
  "transport": "hybrid",
  "members": ["claude/gmail", "rota"],
  "workflow": {
    "kind": "anchor",
    "anchor": "claude/gmail",
    "anchorModel": "claude-sonnet-5[1m]",
    "workers": ["rota"],
    "maxDelegations": 1,
    "anchorReadOnly": true,
    "foldCharCap": 24000
  }
}
```

| Field | Default | Notes |
|---|---|---|
| `anchor` | first member | The route that holds the conversation. |
| `anchorModel` | request's own pick | Wants a large context window. `contextWindow` on `CatalogModel` marks candidates; the `[1m]` variants exist for this. May be any provider — Gemini and Grok qualify. |
| `workers` | non-anchor members, else `["rota"]` | `rota` here is the point: the anchor stays put, the silo under each worker rotates. |
| `workerModel` | request's own pick | |
| `maxDelegations` | **1** | Each round is anchor → worker → anchor. The activity ledger shows 130–340s per silo run, so latency is the real cost. Hard cap 3. |
| `anchorReadOnly` | **true** | Maps to `permissions: "read-only"` → `--permission-mode plan`, so the anchor structurally cannot do the work itself. This is what makes it actually delegate. |
| `foldCharCap` | 24000 | Cap on a worker result folded into the anchor's context. |

## The delegation protocol

The anchor emits a fenced block; the gateway parses it with one regex and a
`JSON.parse` in a try/catch:

````
```farm-delegate
{"id":"t1","objective":"…","context":"…","constraints":"…","deliverable":"…"}
```
````

`route` is optional and overrides the worker pool for that task.

**Failure is a no-op.** No block, malformed JSON, or a missing `objective` all
mean "no delegation" — the anchor's prose is returned as a plain single-model
answer, byte-identical to a non-anchored route. A rule-based trigger was
rejected: a rule can decide *that* a worker runs but cannot author the brief,
and the brief is the entire value.

## What a worker sees — and only this

History-replacing, exactly like the existing `synthesize` pass:

```
TASK <id>
<objective>

CONTEXT
<the anchor's hand-picked slice>

CONSTRAINTS
<what must not be touched>

DELIVERABLE
<the shape the anchor will fold back>
```

No transcript, no earlier user turns, no anchor reasoning. `routeRequest` still
prepends the *worker's own* route equipment (its skills/tools/permissions),
which is correct and per-worker. The brief is capped; overflow truncates with an
explicit elision marker.

Two silos are two orgs (`docs/provider-credential-isolation.md`), so a worker
genuinely cannot know anything beyond its brief. **An under-specified brief
yields plausible-but-wrong work.** That is inherent to the architecture, not a
bug — it is why the anchor charter states the constraint explicitly.

## Fold-back

Each round appends exactly two entries — the anchor's own turn verbatim, then
`WORKER RESULT (<silo> · task <id>)` clamped to `foldCharCap` with a head+tail
elision marker. Appending only keeps the anchor's prompt a strict prefix
extension of the previous turn, which is the invariant any future caching would
depend on. `tests/gateway.test.mjs` asserts it directly.

## Observability

Anchor and worker turns emit the same `member_start` / `member_done` /
`member_error` events every hybrid route does, with `role: "anchor"` or
`role: "worker"`, so the desktop trace renders them with no extra work. Usage is
summed across every turn in the round trip.

## Rotation and rate limits

Workers resolve `rota` per dispatch and rotate freely. **The anchor is never
rotated by `rotaPick`** — session affinity is passed only for the anchor
(`docs/rota-session-affinity.md`). If the anchor's silo is rate-limited the turn
fails loudly naming the silo and its reset time rather than silently swapping:
the warm prefix is gone either way, and a silent swap would also destroy the
user's expectation of talking to one model.

## Known limits

- **Latency.** A delegating turn is three process spawns. `maxDelegations`
  defaults to 1 and the anchor answers directly whenever it can.
- **Fold-back truncation is lossy.** The marker makes it visible; nothing makes
  it safe.
- **Untested against a live model at time of writing.** The delegation loop is
  covered offline with command-transport fakes, including a test that a sentinel
  planted in the user's message never reaches the worker. Whether a real anchor
  chooses to emit directives at a useful rate is the part that needs field
  evidence; expect the charter wording to need iteration.
