---
name: explain-consumer-pick-divergence
description: Confirm whether the rota gateway and the handoff planner sending work to different silos is expected or a bug, by reconstructing both scoring formulas from the same usage-evidence substrate
---

# Explain a divergent silo pick between the two capacity consumers

The farm has **two** consumers of account capacity — the rota gateway (per-request) and the handoff planner (per-task) — and they read the **same** substrate: `~/.claude-farm/usage/<silo>/claude.json` (`docs/usage-evidence-files.md`, `docs/capacity-consumers-scoring-differences.md`). They compute the same usable capacity, but they turn it into a pick with **different formulas**. So the two can legitimately send work to different silos from identical evidence. Use this skill when someone reports "the gateway and the planner disagree" and you need to decide *expected vs. bug* before touching anything.

Reference: `docs/capacity-consumers-scoring-differences.md`.

## Step 0: Confirm both read the same, current evidence

Both consumers only differ *after* the shared step. Rule that out first:

```sh
cat ~/.claude-farm/usage/<silo>/claude.json   # for each silo in question
```

- Both compute usable capacity as `min(session, weeklyAllModels, weeklyModel)`.
- Both score a silo with **no evidence** a conservative **0.5**.
- If evidence is missing or stale, that alone can explain a surprising pick — refresh it (`refresh-usage-evidence` skill) and re-check before blaming the formulas.

## Step 1: Score the way the gateway does (per-request, stability-biased)

Source: `docs/rota-gateway-scoring-model.md`.

```
score = min(session remaining, max(weekly remaining − 10% reserve, 0))
      + 0.12 sticky bonus if this silo served the previous request
```

- **Flat 10% weekly reserve** — never drains a silo to zero.
- **0.12 sticky bonus** — keeps consecutive requests on the previous lane until another lane is *meaningfully* healthier. (It preserves that silo's ~18k static prompt prefix, not the conversation — `docs/prompt-cache-evidence.md`.)
- **Session affinity** — a request with `farm.session_id` reuses its pinned lane before scoring runs at all, so the planner and the gateway can diverge simply because one conversation is pinned.
- Pick persisted at `~/.claude-farm/rota.json`; handoffs in `gateway.log`.

The sticky bonus and the flat reserve are the usual reason the gateway "stays" on a lane the planner would move off.

## Step 2: Score the way the planner does (per-task, expiry-weighted)

Source: `docs/handoff-routing-implementation.md` (`lib/handoff-plan.ts` v2). It routes **tasks** across accounts using three `AllowancePool`s per `AccountCapacity`, and weights by **expiry pressure** rather than a flat reserve:

- `AllowancePool.expiryUrgency()` = `remaining / hoursUntilReset` — capacity that resets soon is *preferred for spending now* so it isn't wasted at reset.
- `AccountCapacity.confidence` (`high | medium | low`) sets a **tiered** safety reserve %, not the gateway's flat 10%.

So the planner will deliberately prefer a lane whose capacity is about to reset, and reserve more/less depending on confidence — divergence from the gateway here is by design.

## Step 3: Reach a verdict

- **Expected divergence** — the gateway stayed sticky / protected its flat reserve while the planner chased expiry urgency or applied a confidence-tiered reserve. No action; this is the two formulas doing their jobs.
- **Actual bug** — the two disagree *and* neither formula, applied by hand to the current evidence, reproduces the pick; or a consumer ignored staleness / didn't score an unreported silo 0.5 (violating `docs/capacity-consumers-scoring-differences.md`). Then investigate the offending consumer.

## Notes

- To reconstruct a specific *gateway* request end-to-end (log → `rota.json` → evidence), use the `diagnose-rota-routing` skill; this skill is specifically for the *cross-consumer* comparison.
- Never hand-edit evidence or `rota.json` to force agreement (`docs/usage-evidence-files.md`); steer with `farm route` (`route-work-to-silo` skill) instead.
