---
title: The rota — quota-aware rotation through the gateway
description: Point any OpenAI- or Anthropic-compatible client at the local gateway with model "rota" and every request lands on the silo with the most headroom.
status: adopted
---

# The rota

The local gateway exposes a virtual model, **`rota`** (alias: `auto`). The
portable `farmd` gateway reserves **`crew`** for capability-aware routing across
local, remote Agensis, E2B, and Daytona silos.
Requesting it routes each call to whichever claude silo the three-bucket
doctrine says to burn right now:

```
score = min(session remaining, max(weekly remaining − 10% reserve, 0))
      + 0.12 sticky bonus if this silo served the previous request
```

- Usage evidence comes from `~/.claude-farm/usage/<silo>/claude.json` — the
  same files the app's OAuth ping refreshes (Crew → Refresh, or the 90s
  heartbeat while the app runs).
- The sticky bonus keeps consecutive requests on one silo until another lane is
  meaningfully healthier. Switching lanes discards that silo's warm prompt
  prefix, measured at **~18k tokens** (the provider CLI's own static block) —
  *not* the conversation, which is re-sent in full every turn regardless. See
  `docs/prompt-cache-evidence.md`.
- Unreported silos score a conservative 0.5: usable, but never preferred
  over proven headroom.
- A silo reporting `rateLimit.status: "rejected"` with a future `resetsAt` is
  skipped until it resets. If every lane is blocked the router degrades to the
  full set rather than failing the request.
- A request carrying `farm.session_id` pins its lane for the conversation —
  see `docs/rota-session-affinity.md`. Callers without one keep the global
  per-request behaviour.
- The current pick is persisted at `~/.claude-farm/rota.json`, per-session pins
  at `~/.claude-farm/rota-sessions.json`; handoffs are logged in `gateway.log`.

## Configuring clients

The gateway listens on `http://127.0.0.1:4545` (Settings → Gateway). If an
API key is set there, send it as the bearer/`x-api-key`.

### Claude Code

```sh
export ANTHROPIC_BASE_URL="http://127.0.0.1:4545"
export ANTHROPIC_API_KEY="<gateway key, or anything if none set>"
claude --model rota
```

### OpenAI-compatible clients (SDKs, editors, tools)

```sh
export OPENAI_BASE_URL="http://127.0.0.1:4545/v1"
export OPENAI_API_KEY="<gateway key>"
# model: rota
```

### Curl smoke test

```sh
curl -s http://127.0.0.1:4545/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"rota","messages":[{"role":"user","content":"ping"}]}'
```

`GET /v1/models` lists `rota` first, then every discovered `provider/silo`
route — pin a specific silo by requesting its id (`claude/gmail`) instead.

## Sharp edges

- Rotation quality is only as good as usage freshness: keep the desktop app
  refreshed (Crew → Refresh) or cron `farm.usage.ping` so the evidence stays
  live. Stale evidence degrades to sticky round-robin, not failure.
- `rota` currently rotates **claude** silos only; codex/gemini/grok routes
  remain direct.
- Each request is an independent CLI invocation in the picked silo's
  container — conversation continuity across a handoff is the caller's
  concern (Claude Code keeps its own transcript, so this is fine). Session
  affinity now keeps a conversation on one lane by default, so handoffs
  mid-thread are the exception rather than the norm.
- The conversation is re-sent in full on every turn and is **not** cached
  across requests. Rotation is not what makes that true — it is true on a
  single pinned silo as well. If that cost matters, the lever is sending less:
  see the `anchor` workflow in `docs/anchor-workflow.md`.
