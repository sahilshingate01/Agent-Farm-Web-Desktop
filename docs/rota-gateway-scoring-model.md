---
title: Rota gateway routing and scoring model
description: The scoring formula, evidence sources, and stickiness behavior that decide which silo the virtual `rota` model burns for each request.
---

# Rota gateway routing and scoring model

The local gateway's virtual model `rota` (alias `auto`) scores every Claude silo per request and routes to the winner. The portable `farmd` service owns the separate heterogeneous `crew` model. This is the runtime companion to the three-bucket availability doctrine: the doctrine decides *usable capacity*, the rota turns that into a *per-request pick*.

## Selection order

Scoring is the last step, not the first. In order:

1. **Explicit route id** (`claude/gmail`) — never rotated, never scored.
2. **Blocked-lane veto** — a lane whose `rateLimit.status === "rejected"` and whose `resetsAt` is still in the future is removed from consideration. If *every* lane is blocked the router degrades to the full set rather than failing the request.
3. **Session affinity** — a request carrying `farm.session_id` reuses the lane that session is already pinned to. See `docs/rota-session-affinity.md`.
4. **Score** — everything below.

## The score

```
score = min(session remaining, max(weekly remaining − 10% reserve, 0))
      + 0.12 sticky bonus if this silo served the previous request
```

- **`min(session remaining, weekly remaining − reserve)`** — the healthiest lane by remaining headroom, protecting a 10% weekly reserve so a silo is never drained to zero.
- **`+0.12 sticky bonus`** — keeps consecutive requests on the silo that served the previous one until another lane is meaningfully healthier.

  **What stickiness actually preserves (measured 2026-07-29).** Each silo is a separate org, so switching lanes discards that silo's warm prompt prefix. Measured, that prefix is the provider CLI's own static system+tools block — **~18k tokens** — and *not* the conversation: `cache_read` stays pinned at exactly 18,065 across turns while the conversation is re-created every request and never read back. Earlier revisions of this doc claimed the bonus preserved conversation cache; it does not, and nothing ever implemented that. See `docs/prompt-cache-evidence.md` for the numbers. Stickiness is still worth having — ~18k/turn and thread coherence — just not for the reason previously stated.

## Evidence sources

- Usage numbers come from `~/.claude-farm/usage/<silo>/claude.json`, rewritten by the app's OAuth ping on **Crew → Refresh** (the 90s heartbeat only re-reads these files — it does not re-fetch; see `docs/usage-evidence-files.md`). A silo that requests flow through also self-refreshes from live rate-limit events.
- **The scorer ignores evidence age.** `rotaLaneScore` reads `windows` and never looks at `updatedAt`, so week-old numbers score as if live.
- A silo with **no usage report** scores a conservative **0.5**: usable, but never preferred over a silo with proven headroom.

## State and observability

- **Current pick**: persisted at `~/.claude-farm/rota.json` — one global record, shared by every caller with no session id.
- **Per-session pins**: `~/.claude-farm/rota-sessions.json`.
- **Handoffs and lane releases**: logged in `gateway.log`. To understand why a request landed where it did, correlate the log entry against the silo's `claude.json` at that time.
- **Per-request evidence**: `~/.claude-farm/gateway-activity.jsonl` records the account, route, and (since 2026-07-29) the `sessionId`, `promptChars`, and `promptPrefixSha` of every request. `node desktop/frontend/public/backend/cache-report.mjs` turns that into a per-session reuse report.

## Tuning notes

- Raising the 10% weekly reserve makes the rota more conservative near weekly limits; lowering it burns weekly capacity more aggressively.
- Raising the 0.12 sticky bonus increases lane stability at the cost of slower rebalancing toward a healthier lane. Note that with session affinity on (the default) the bonus now matters mainly for callers that send no session id — affinity already holds the lane for real conversations.
