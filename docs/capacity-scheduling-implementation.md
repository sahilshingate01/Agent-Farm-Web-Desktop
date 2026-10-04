---
title: Capacity Scheduling Model — Implementation Reference
description: How to query and route tasks using the three-bucket capacity model for multi-account farms.
---

# Capacity Scheduling Model — Implementation Reference

The availability-scheduling doctrine defines a three-bucket constraint model for routing work across isolated AI accounts. This guide maps that model to implementation.

## The Three Buckets

Each account has three overlapping resource ceilings:

1. **Session allowance** — replenishes frequently (typically hourly or per-session)
2. **Weekly all-model allowance** — the hard ceiling; once exhausted, account is effectively unavailable until reset
3. **Model-specific weekly allowance** — per-model pool (e.g., Fable, Spark); separate from all-model ceiling

## Computing Available Capacity

The usable capacity for a task targeting a specific model is:

```
usableCapacity = min(
  sessionRemainingTokens,
  weeklyAllModelsRemaining,
  weeklyModelRemaining
)
```

Before routing, check that `usableCapacity ≥ estimatedTaskTokens × uncertaintyMultiplier`.

## Implementation Checkpoints

### Before Routing

1. Query each candidate account's three buckets
2. Compute `usableCapacity` per account
3. Reject accounts where `usableCapacity < taskEstimate`
4. Apply expiry pressure: burn capacity expiring soonest first (e.g., session windows before weekly limits)
5. Preserve 8–20% safety reserve (configurable per account confidence)

### At Handoff Boundaries

- Before session reset: confirm next account will have sufficient capacity
- Before weekly reset: trigger account checkpoints, validate continuity planning

## Reference Implementation

The `lib/handoff-plan.ts` v2 target uses `AllowancePool`, `AccountCapacity`, and `Workload` types to model these constraints. See [availability-scheduling.md](availability-scheduling.md) for the full mathematical model and Crew-mode staffing strategy.
