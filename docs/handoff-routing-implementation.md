---
title: Implementing handoff routing with account capacity types
description: TypeScript patterns and type definitions for routing tasks across silo accounts using the three-bucket capacity model.
---

# Implementing handoff routing with account capacity types

This guide details the type signatures and algorithm for `lib/handoff-plan.ts` v2, which routes tasks across isolated farm accounts using three overlapping capacity buckets and expiry-pressure weighting.

## Type Definitions

### AllowancePool
Represents one capacity bucket (session, weekly-all, or weekly-model):

```typescript
interface AllowancePool {
  name: 'session' | 'weeklyAllModels' | `weeklyModel:${string}`
  limitTokens: number
  consumedTokens: number
  resetAtUtc: string  // ISO 8601
  
  remaining(): number
  hoursUntilReset(): number
  expiryUrgency(): number  // remaining / hoursUntilReset
}
```

### AccountCapacity
Aggregates three AllowancePools for one account:

```typescript
interface AccountCapacity {
  accountName: string
  confidence: 'high' | 'medium' | 'low'  // determines safety reserve %
  
  session: AllowancePool
  weeklyAllModels: AllowancePool
  weeklyModel: Record<string, AllowancePool>  // per-provider/per-model
  
  usableFor(model: string): number  // min of three buckets
  isExhausted(): boolean
  expiryPressure(): number  // weighted urgency across buckets
}
```

### Workload
Task spec with estimation uncertainty:

```typescript
interface Workload {
  estimatedTokens: number
  uncertaintyMultiplier: number  // typically 1.1–1.5; scale for unknown tasks
  targetModel: string
  deadline?: string  // ISO 8601; for reset-boundary checks
}
```

## Routing Algorithm

```typescript
function routeTask(
  candidates: AccountCapacity[],
  workload: Workload,
  safetyReserves: Record<'high' | 'medium' | 'low', number>  // 0.08, 0.12, 0.20
): AccountCapacity | null {
  // Step 1: Filter by usable capacity
  const qualified = candidates.filter(acc => {
    const usable = acc.usableFor(workload.targetModel)
    const reserve = safetyReserves[acc.confidence]
    const safeCapacity = usable * (1 - reserve)
    return safeCapacity >= workload.estimatedTokens * workload.uncertaintyMultiplier
  })
  
  if (qualified.length === 0) return null
  
  // Step 2: Rank by expiry pressure (burn expiring capacity first)
  const ranked = qualified.sort(
    (a, b) => b.expiryPressure() - a.expiryPressure()
  )
  
  // Step 3: Checkpoint reset boundaries
  if (workload.deadline) {
    return ranked.find(acc => {
      const weeklyResetHours = acc.weeklyAllModels.hoursUntilReset()
      const hoursUntilDeadline = (
        new Date(workload.deadline!).getTime() - Date.now()
      ) / (1000 * 60 * 60)
      return weeklyResetHours > hoursUntilDeadline
    }) || null
  }
  
  return ranked[0]
}
```

## Safety Reserves

The safety reserve cushion depends on account maturity and provider stability:

| Confidence | Reserve % | Use Case |
|---|---|---|
| **high** | 8% | Established accounts with proven token reporting accuracy |
| **medium** | 12% | Stable provider, account recently verified |
| **low** | 20% | New account, unproven provider, or accuracy concerns |

Reserve is always held; never route tasks that would violate it. Recalculate after each successful task completes.

## Expiry Pressure Weighting

For multi-bucket routing, compute urgency per bucket and take a weighted urgency score:

```typescript
function bucketExpiryPressure(pool: AllowancePool): number {
  const headroom = pool.remaining()
  const hoursLeft = pool.hoursUntilReset()
  if (hoursLeft <= 0 || headroom <= 0) return 0  // already reset or exhausted
  return headroom / hoursLeft
}

function accountExpiryPressure(account: AccountCapacity): number {
  // Weighted by which bucket is most constrained
  const sessionPress = bucketExpiryPressure(account.session) * 0.3
  const weeklyAllPress = bucketExpiryPressure(account.weeklyAllModels) * 0.5
  const modelPress = Math.max(
    ...Object.values(account.weeklyModel).map(p => bucketExpiryPressure(p) * 0.2)
  )
  return sessionPress + weeklyAllPress + modelPress
}
```

High pressure = capacity expiring soon; route routine work there first. Preserve low-pressure (fresh) accounts for continuation reserves or critical tasks.

## Reset Boundary Checkpoints

Before admitting a task:

1. Check if task completion time + buffer fits before any bucket resets
2. If a weekly reset is < 1 hour away, defer or route to post-reset account
3. Log reset-driven deferrals for observability (indicates near-saturation)

```typescript
function canCompleteBeforeReset(
  capacity: AccountCapacity,
  taskDurationHours: number,
  bufferHours: number = 0.25
): boolean {
  const hoursUntilWeeklyReset = capacity.weeklyAllModels.hoursUntilReset()
  return hoursUntilWeeklyReset > taskDurationHours + bufferHours
}
```