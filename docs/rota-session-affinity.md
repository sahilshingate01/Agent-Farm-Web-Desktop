---
title: Rota session affinity
description: How a conversation pins its rota silo instead of being re-picked per request, when the pin is released, and how to turn it off.
---

# Rota session affinity

The `rota` route scores every claude silo **per request**. Without affinity a
single conversation can land on a different silo on every turn — and because each
silo is a separate org, that discards the silo's warm prompt prefix (~18k tokens,
measured — see `docs/prompt-cache-evidence.md`) and makes the thread incoherent.

Affinity pins a conversation to the lane it started on.

## The key

The gateway uses `farm.session_id` from the request body. The desktop app has
always sent it; the gateway simply never read it until 2026-07-29.

**Callers that send no session id are completely unaffected** — they keep the
global per-request behaviour driven by `~/.claude-farm/rota.json`. That covers
`farm.sh`, raw API clients, and anything hitting `:4545` directly.

## Selection order

Affinity sits third, not first:

1. **Explicit route id** (`claude/gmail`) — never rotated, never scored.
2. **Blocked-lane veto** — a rate-limited lane is removed from consideration.
3. **Session affinity** — this document.
4. **Score + sticky bonus** — `docs/rota-gateway-scoring-model.md`.

## State

`~/.claude-farm/rota-sessions.json`, gateway-owned machine-written evidence
(`docs/usage-evidence-files.md` — do not hand-edit):

```json
{
  "updatedAt": "2026-07-29T15:47:58.481Z",
  "sessions": {
    "sess_9f2a": {
      "account": "hello", "provider": "claude",
      "pinnedAt": "…", "lastUsedAt": "…", "turns": 7, "reason": "affinity"
    }
  }
}
```

Bounded on every write: entries idle more than 24h are pruned, then the file is
capped at 200 sessions by `lastUsedAt`. Concurrent requests on one session race
the write; last-write-wins is harmless because both would compute the same lane.

## When the pin is released

| Trigger | Logged reason |
|---|---|
| The pinned silo no longer exists | `gone` |
| `rotaLaneScore` hits 0 (quota gone) | `exhausted` |
| The lane is rate-limited (`status: "rejected"`, future `resetsAt`) | `rate-limit` |
| The thread has been idle past `rotaAffinityIdleMs` | `idle` |
| The request sets `farm.rotate: true` | `user` |

Releases are logged to `gateway.log` as
`rota: session <id> released its lane (<reason>)`.

## Settings

In `~/.claude-farm/gateway.json`, surfaced in the app under
**Settings → Crew rotation → "Keep one silo per conversation"**:

- `rotaAffinity`: `"session"` (default) or `"per-request"` to restore the old
  behaviour for every caller.
- `rotaAffinityIdleMs`: default `1800000` (30 min). A judgement call rather than
  a derived number — past that window there is no warm prefix left to protect,
  so re-optimising the lane is free. Tune it from the evidence in
  `gateway-activity.jsonl`.

## What this does NOT do

- It does not pin **workers** in the `anchor` workflow. Those resolve `rota`
  per dispatch on purpose — the anchor stays put, the silos underneath rotate.
  See `docs/anchor-workflow.md`.
- It does not make the conversation cacheable. The conversation is re-sent in
  full every turn and is never read back from cache, on a pinned silo as much
  as a rotating one. Affinity protects the ~18k static prefix and the thread's
  coherence, nothing more.
