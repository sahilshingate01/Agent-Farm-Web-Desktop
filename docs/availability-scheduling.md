---
title: Availability scheduling doctrine
description: The three-bucket capacity model and reset-aware scheduling strategy for routing work across silo accounts — source doctrine for lib/handoff-plan.ts v2 and Crew-mode staffing.
tags:
  - scheduler
  - silos
  - usage
  - relay
  - crew
source: ChatGPT analysis supplied by Sahil Shingate, 2026-07-11
status: adopted
---
# Availability scheduling doctrine

> Source: ChatGPT analysis pasted by Sahil Shingate (2026-07-11), preserved verbatim below the implementation notes. This is the reference model for upgrading `desktop/frontend/src/lib/handoff-plan.ts` (Relay mode) and for Crew-mode staffing decisions.

## Implementation mapping (Agent Farm)

- Today's `planHandoff` models bucket 1 (session windows) fully and buckets 2-3 (weekly all-model + per-model) as route weights/hard-stops only.
- v2 adopts: `usableNow = min(session, weeklyOverall, weeklyModel)` per lane; **expiry pressure** (`weeklyHeadroom / hoursUntilWeeklyReset`) as the primary routing weight — burn expiring capacity first, protect scarce model pools, keep the freshest account as continuity reserve; safety reserves (8–20% by account confidence); task admission (`estimatedHours × uncertaintyMultiplier` vs `safelyAvailableBeforeReset`); checkpoint before session/weekly resets.
- The `AllowancePool`/`AccountCapacity`/`Workload` shapes below are the target types for `lib/handoff-plan.ts` v2; model pools stay configurable per provider (no hard-coding whether e.g. Spark is separately metered).

---

You need to treat each account as **three overlapping resource buckets**, not as one percentage:

1. **Session / short-window allowance** — replenishes frequently.
2. **Weekly all-model allowance** — the hard ceiling. Once exhausted, the account is effectively dead until reset.
3. **Model-specific weekly allowance** — for example Fable, and potentially Spark for Codex if it has an independent pool.

The available capacity for a Fable task is therefore:

```text
usableFableNow =
  min(
    currentSessionRemaining,
    weeklyAllModelsRemaining,
    weeklyFableRemaining
  )
```

But that only determines what can run **right now**. Scheduling should also consider which allowance expires first and how much work must survive until each weekly reset.

## Simulated four-account pool

| Account | Session remaining | Session reset | Overall weekly remaining | Overall reset | Fable remaining | Fable reset |
|---|---:|---|---:|---|---:|---|
| **A — supplied** | 85% of 6h = **5.1h** | 11 Jul, 05:09 | 85% of 40h = **34h** | 11 Jul, 16:59 | 77% of 24h = **18.5h** | 11 Jul, 16:59 |
| **B — newly added** | 100% of 4h = **4h** | 11 Jul, 08:00 | 100% of 25h = **25h** | 15 Jul, 10:00 | 100% of 15h = **15h** | 15 Jul, 10:00 |
| **C — heavily used** | 42% of 8h = **3.4h** | 11 Jul, 03:30 | 28% of 50h = **14h** | 12 Jul, 23:00 | 55% of 20h = **11h** | 12 Jul, 23:00 |
| **D — Fable constrained** | 70% of 5h = **3.5h** | 11 Jul, 06:30 | 63% of 35h = **22h** | 18 Jul, 08:00 | 18% of 30h = **5.4h** | 18 Jul, 08:00 |

These “hours” are normalized productive compute-hours; the application can substitute percentages, tokens, weighted tokens, API duration, or observed task-minutes.

## What the naïve scheduler gets wrong

A basic scheduler might pick Account A because it has the most remaining weekly capacity. That would be wrong. Account A’s weekly allocation resets soon, so unused capacity disappears — it should receive substantial work before that reset. Account C has little weekly capacity left but a near reset: usable carefully for work that completes in time. Account D has good overall capacity but almost no Fable allocation — run non-Fable work there. Account B is pristine but resets days away: the strategic reserve.

## Recommended account roles

- **A — burn expiring capacity**: Fable-heavy implementation, large autonomous tasks, cache-heavy repo work that stops cleanly before its weekly reset. Unused capacity past reset has no future value.
- **C — controlled use before its reset**: spend down to a safety reserve (e.g. overall 4h, model 3h held back); session refreshes unlock more of the weekly pool over time.
- **D — non-Fable lane**: Sonnet work, reviews, searches, planning, tool calls; keep 3–4 Fable hours untouched for genuinely Fable-dependent tasks.
- **B — reserve and continuity**: long-running jobs spanning days, overflow when others hit safety floors, emergencies, high-uncertainty tasks.

## Routing order (changes after every reset)

Fable work: A → C (to reserve) → B → D only when necessary.
General work: A (while weekly expires) → D → C (within reserve) → B.

## The scheduling calculation

```text
weeklyHeadroom    = weeklyRemaining - weeklySafetyReserve
modelHeadroom     = modelRemaining  - modelSafetyReserve
immediateHeadroom = min(sessionRemaining, weeklyHeadroom, modelHeadroom)

hoursUntilWeeklyReset = weeklyResetAt - now
expiryPressure        = weeklyHeadroom / max(hoursUntilWeeklyReset, 1)

accountScore =
    expiryPressure    * 0.40
  + immediateHeadroom * 0.25
  + modelSuitability  * 0.20
  + continuityScore   * 0.10
  - scarcityPenalty   * 0.05
```

`modelSuitability` rewards preferred-model placement; `continuityScore` rewards finishing before a reset (lower when a task crosses a reset without checkpoints); `scarcityPenalty` protects accounts with very little model-specific capacity.

## Protecting the weekly limit

Never allocate the entire reported weekly remainder — reported percentages may be rounded, delayed, or weighted. Reserves: normal account 8–12%, critical 15–20%, new/unproven 20% initially; reduce as observed usage correlates with real work.

## Task admission rule

```text
requiredCapacity = estimatedComputeHours * uncertaintyMultiplier
```

Multipliers: known repetitive 1.10 · normal implementation 1.30 · repository-wide 1.50 · open-ended autonomous 2.00. Do not admit when `requiredCapacity > safelyAvailableBeforeRelevantReset` — instead split into checkpointed stages, assign to another account, explore on a cheaper model, or delay the expensive stage past a reset.

## Reset-aware behaviour

Recalculate from scratch at every reset (service percentages are the source of truth). Events: `SESSION_RESET`, `WEEKLY_ALL_RESET`, `MODEL_WEEKLY_RESET`, `ACCOUNT_USAGE_REFRESH`, `TASK_STARTED`, `TASK_CHECKPOINTED`, `TASK_FINISHED`, `TASK_ESTIMATE_CHANGED`. Checkpoint shortly before: a short-window limit runs out, a weekly reset, the safety floor, or another account becoming more economical.

## Data structures

```ts
type AllowancePool = {
  capacityHours: number;
  remainingHours: number;
  resetsAt: string;
  safetyReserveHours: number;
};

type AccountCapacity = {
  id: string;
  enabled: boolean;
  session: AllowancePool;
  weeklyOverall: AllowancePool;
  modelPools: Record<string, AllowancePool | undefined>;
  confidence: number;
  lastRefreshedAt: string;
};

type Workload = {
  id: string;
  preferredModel: string;
  fallbackModels: string[];
  estimatedHours: number;
  uncertaintyMultiplier: number;
  checkpointable: boolean;
  minimumContinuousHours: number;
  priority: number;
};
```

Separately metered models (e.g. Spark) are configurable pools — when no independent pool exists they consume `session + weekly overall` only.

## The key strategy

```text
Use capacity that will expire soon,
protect scarce model-specific capacity,
retain a weekly emergency reserve,
and place long tasks on accounts that can survive until completion.
```
