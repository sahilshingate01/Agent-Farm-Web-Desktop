# Route work across farm accounts with three-bucket capacity constraints

The farm's multi-account architecture isolates provider state in separate VMs but shares a work directory. This workflow routes tasks to the most suitable account by checking three overlapping capacity buckets and applying expiry pressure.

## The Three Capacity Buckets

Each account has three independent resource ceilings that must ALL be satisfied:

1. **Session allowance** — short-window capacity (typically hourly or per-session), replenishes frequently
2. **Weekly all-model allowance** — hard ceiling across all models; once exhausted, account is dead until reset
3. **Model-specific weekly allowance** — per-model pool (e.g., separate Fable vs Spark limits)

## Routing Decision Tree

### Step 1: Query Candidate Accounts
For each candidate account, retrieve:
- Current session remaining tokens
- Weekly all-model remaining tokens  
- Weekly model-specific remaining tokens
- Time until next reset for each bucket

### Step 2: Compute Usable Capacity
For the target model, calculate:
```
usableCapacity = min(
  sessionRemainingTokens,
  weeklyAllModelsRemaining,
  weeklyModelRemaining
)
```

### Step 3: Check Capacity vs Task Estimate
```
safeCapacity = usableCapacity - (usableCapacity × safetyReserve)
# safety reserve is typically 8–20% depending on account confidence
```

**Reject account if**: `safeCapacity < (estimatedTaskTokens × uncertaintyMultiplier)`

### Step 4: Apply Expiry Pressure (Routing Weight)
For accounts that pass the safety check, compute expiry urgency:
```
expiryPressure = weeklyHeadroom / hoursUntilWeeklyReset
# Higher pressure = capacity expiring soon; route here first
```

Route to the account with highest expiryPressure (burn expiring capacity first), while preserving the freshest account as continuity reserve.

### Step 5: Checkpoint Before Reset Boundaries
If a reset window is imminent (< 1 hour), confirm task can complete before reset. If not, defer or route to post-reset account.

## Implementation Notes

- Never route a task if `usableCapacity < taskEstimate` even if the account looks available in other metrics
- The three-bucket check is the admission gate; expiry pressure is the tie-breaker for routing among qualified accounts
- Keep the newest account in reserve with minimal burn; don't route routine work there
- After each task, update consumed capacity and recalculate available pools