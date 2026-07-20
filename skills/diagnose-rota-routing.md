---
name: diagnose-rota-routing
description: Explain why the rota gateway sent a request to a particular claude silo by reconstructing the scoring decision from logs and usage evidence
---

# Diagnose a rota gateway routing decision

The local gateway's Claude-specific `rota` model (alias `auto`) scores every local account silo per request and routes to the winner. The heterogeneous `crew` model belongs to `farmd`. When a rota request lands somewhere surprising, the decision is fully reconstructable from three on-disk artifacts. This skill walks the correlation.

## The formula you are reconstructing

```
score = min(session remaining, max(weekly remaining − 10% reserve, 0))
      + 0.12 sticky bonus if this silo served the previous request
```

- A silo with **no usage evidence** scores a conservative **0.5** — usable but never preferred over proven headroom.

## Step 1: Find the request in the handoff log

```sh
tail -f gateway.log        # live, or grep for a timestamp/request id
```

Each handoff is logged here. Note the winning silo and the timestamp — you will correlate the usage evidence *as it was at that time*.

## Step 2: Check the persisted pick

```sh
cat ~/.claude-farm/rota.json    # current pick
```

If the current pick differs from the logged one, a lane switch happened after — expected when another lane became meaningfully healthier.

## Step 3: Score each candidate silo by hand

For each silo, read its evidence:

```sh
cat ~/.claude-farm/usage/<silo>/claude.json
```

Compute `min(session remaining, weekly remaining − 10% reserve)` per silo. The highest score wins — **plus 0.12** for whichever silo served the previous request.

## Common explanations

- **Stuck on one silo across many requests** — usually session affinity: a request carrying `farm.session_id` pins its lane for the conversation (`~/.claude-farm/rota-sessions.json`). Failing that, the +0.12 sticky bonus is holding the lane. Neither is a bug. Affinity releases on exhaustion, rate limit, idle, or `farm.rotate`; the bonus releases when another lane is meaningfully healthier. Set `rotaAffinity: "per-request"` in `gateway.json` to disable affinity.
- **A healthy silo is never picked** — check `rateLimit.status` in its `usage/<silo>/claude.json`. `"rejected"` with a future `resetsAt` vetoes the lane. Note `overageStatus: "rejected"` is the *normal* state and does not block.
- **A drained-looking silo still not picked** — the 10% weekly reserve protects it from being burned to zero.
- **An unknown silo picked over a healthy one** — check for staleness: if the app isn't running, evidence goes stale and an unreported silo scores the flat 0.5. Refresh via Crew → Refresh (or rely on the 90s heartbeat) and re-check.

## Escalation: tuning

If the routing behaviour is systematically wrong rather than a one-off, the knobs are the 10% weekly reserve (raise = more conservative near weekly limits) and the 0.12 sticky bonus (raise = more lane stability, slower rebalancing). See `docs/rota-gateway-scoring-model.md`.
