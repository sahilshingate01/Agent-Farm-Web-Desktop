---
title: Usage evidence files — the shared capacity substrate
description: Where per-silo usage data lives, how it is refreshed, staleness handling, and the two consumers (rota gateway + handoff planner).
status: reference
---

# Usage evidence files

Every routing decision in the farm — the `rota` virtual model and the `lib/handoff-plan.ts` planner — reads the same underlying data: per-silo usage evidence. This doc describes that data plane so both consumers stay consistent.

## Location

```
~/.claude-farm/usage/<silo>/claude.json
```

One file per silo/account. It records the consumed/remaining state that the three-bucket capacity model (session, weekly-all-model, weekly-model) is computed from.

## Refresh mechanism

Two different things happen at two different cadences, and conflating them is
why silos can look healthy on evidence that is hours old:

- **Re-fetch from the provider** — `farm.usage.ping` calls the OAuth usage
  endpoint per silo and rewrites these files. This runs on **Crew → Refresh**
  only. It is the only thing that produces new numbers.
- **Re-read from disk** — the app's **90-second heartbeat** re-pulls
  `farm.bootstrap`, which reads these files. It does *not* call the provider.
  (Verified 2026-07-29: `fetchClaudeOauthUsage` has exactly one caller,
  `pingUsage`.) So the heartbeat keeps the UI in step with the files; it does
  not keep the files in step with reality.
- **Incidental writes** — the gateway's `persistProviderUsage` updates a silo's
  file whenever a request actually flows through it, from the live
  `rate_limit_event`. Busy silos therefore self-refresh; idle ones do not.

Consequence: without a manual Refresh or a cron'd `farm.usage.ping`, evidence
for an idle silo can be arbitrarily old, and **nothing in the routing layer
checks its age** — `rotaLaneScore` reads `windows` and ignores `updatedAt`
entirely. Staleness is surfaced in the UI (Control Tower warns past 30 minutes)
but never acted on by the scorer. Treat that explicitly (below).

## Consumers

### 1. Rota gateway (`docs/rota-gateway.md`)

Scores each silo:

```
score = min(session remaining, max(weekly remaining − 10% reserve, 0))
      + 0.12 sticky bonus if this silo served the previous request
```

- A silo with **no usage evidence** scores a conservative **0.5** — usable, but never preferred over a silo with proven headroom.
- The winning pick is persisted to `~/.claude-farm/rota.json`; handoffs are logged in `gateway.log`.

### 2. Handoff planner (`lib/handoff-plan.ts` v2)

Computes `usableNow = min(session, weeklyOverall, weeklyModel)` per lane and applies expiry pressure. See `docs/availability-scheduling.md` and `docs/capacity-scheduling-implementation.md`.

## Staleness & missing-data rules

- **Missing file / unreported silo** → conservative default (rota uses 0.5; the planner treats it as low-confidence).
- **Stale file** (app not running / heartbeat lapsed) → the numbers reflect the last ping, not now. Prefer refreshing before a large routing decision.
- Safety reserves (8–20% by account confidence) sit on top of whatever these files report — they are not a substitute for fresh data.

## Why one substrate

Both consumers reading the same files means a Crew Refresh improves routing everywhere at once, and there is a single format to reason about when debugging why a silo was or wasn't picked.
