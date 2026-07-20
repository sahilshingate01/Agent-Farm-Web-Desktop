---
name: tune-rota-scoring
description: Adjust the two rota gateway scoring knobs — the flat weekly reserve (default 10%) and the sticky bonus (default 0.12) — and understand the routing tradeoff each one moves, for when the gateway is switching lanes too eagerly or draining weekly capacity too aggressively.
---

# Tune the rota gateway scoring

The gateway scores every claude silo per request with a fixed formula (`docs/rota-gateway-scoring-model.md`):

```
score = min(session remaining, max(weekly remaining − 10% reserve, 0))
      + 0.12 sticky bonus if this silo served the previous request
```

Only two numbers are tunable — the **weekly reserve** and the **sticky bonus**. Reach for this skill when routing behavior is wrong in one of two specific ways; don't touch these knobs to fix a *surprising individual pick* (that's the `diagnose-rota-routing` skill) or a silo being unfairly passed over (that's usually stale evidence — `refresh-usage-evidence`).

## Knob 1 — the weekly reserve (default 10%)

Protects a slice of each silo's weekly allowance so a lane is never drained to zero.

- **Raise it** → the rota gets *more conservative* near weekly limits, backing off a silo sooner. Use when silos are hitting weekly caps and getting stranded.
- **Lower it** → burns weekly capacity *more aggressively*, keeping a lane in play closer to its cap. Use when you're consistently leaving weekly headroom unspent at reset.

## Knob 2 — the sticky bonus (default 0.12)

Note first: with session affinity on (the default) real conversations are pinned before scoring, so this knob mainly affects callers that send no `farm.session_id`. If lanes are "too stable", check `rotaAffinity` before touching this.

Added to the silo that served the previous request, so consecutive requests stay on one lane for warm context / prompt cache until another lane is *meaningfully* healthier.

- **Raise it** → *more lane stability* (fewer switches, better cache-hit rate), at the cost of *slower rebalancing* toward a healthier lane.
- **Lower it** → rebalances faster toward the healthiest lane, at the cost of more lane switches and colder caches.

## Verify the change

After tuning, watch real routing rather than trusting the numbers:

```sh
tail -f gateway.log              # observe how often lanes switch now
cat ~/.claude-farm/rota.json     # confirm the current pick
```

If a single pick still looks wrong after tuning, reconstruct it by hand with the `diagnose-rota-routing` skill before touching the knobs again.

## Note

These two knobs govern the **rota gateway only**. The handoff planner is a separate capacity consumer with its own confidence-tiered reserve and expiry-urgency weighting (`docs/capacity-consumers-scoring-differences.md`) — changing the gateway's reserve/sticky bonus does not affect it.
