---
title: Two capacity consumers, two scoring formulas
description: The rota gateway and the handoff planner both read the shared usage-evidence substrate but score silos differently — this doc contrasts the two so a divergent pick isn't mistaken for a bug.
status: reference
---

# Two capacity consumers, two scoring formulas

The farm has two consumers of account capacity, and they read the **same** substrate — the per-silo usage evidence at `~/.claude-farm/usage/<silo>/claude.json` (`docs/usage-evidence-files.md`). Both compute usable capacity as `min(session, weeklyAllModels, weeklyModel)` and both score an unreported silo a conservative **0.5**.

But they turn that capacity into a pick using **different formulas**. When the gateway and the planner send work to different silos from identical evidence, that is usually expected, not a routing bug. Use this doc to tell the two apart.

## Consumer 1 — rota gateway (per-request pick)

Source: `docs/rota-gateway-scoring-model.md`. The Claude-specific `rota` model (alias `auto`) scores each local account silo per request; heterogeneous `crew` routing is owned by `farmd`:

```
score = min(session remaining, max(weekly remaining − 10% reserve, 0))
      + 0.12 sticky bonus if this silo served the previous request
```

- **Flat 10% weekly reserve** — never drains a silo to zero.
- **0.12 sticky bonus** — keeps consecutive requests on the previous silo for warm context / prompt cache until another lane is meaningfully healthier.
- Pick persisted at `~/.claude-farm/rota.json`; handoffs logged in `gateway.log`.

Characteristic: request-granular, cache-aware, stability-biased.

## Consumer 2 — handoff planner (task routing)

Source: `docs/handoff-routing-implementation.md` (`lib/handoff-plan.ts` v2). It routes **tasks** across accounts using three `AllowancePool`s per `AccountCapacity`, and weights by **expiry pressure** rather than a flat reserve:

- `AllowancePool.expiryUrgency()` = `remaining / hoursUntilReset` — capacity that resets soon is preferred for spending now, so it isn't wasted at reset.
- `AccountCapacity.confidence` (`high | medium | low`) determines the **safety reserve %** — the reserve is *tiered by confidence*, not the gateway's fixed 10%.
- No sticky bonus; there is no "previous request" to stay warm against at task granularity.

Characteristic: task-granular, expiry-aware, confidence-tiered reserve.

## Why they can disagree

| Dimension | Rota gateway | Handoff planner |
|---|---|---|
| Reserve | flat 10% weekly | tiered by `confidence` |
| Reset timing | ignored | `expiryUrgency` = remaining / hoursUntilReset |
| Stickiness | +0.12 to previous silo | none |
| Granularity | per request | per task |

A silo whose weekly allowance resets in two hours can lose in the gateway (which only sees flat remaining headroom) yet win in the planner (which prefers to spend soon-to-reset capacity). A low-`confidence` account holds back more reserve in the planner than the gateway's flat 10%. Both are correct for their job.

## When to worry

A divergent pick is a bug only if it contradicts the **shared** rules both consumers must honor: unreported silo scored anything other than 0.5, stale evidence trusted silently, or a second data plane being read instead of `claude.json`. Otherwise, to explain a specific gateway pick use the `diagnose-rota-routing` skill; to refresh evidence use the `refresh-usage-evidence` skill.
