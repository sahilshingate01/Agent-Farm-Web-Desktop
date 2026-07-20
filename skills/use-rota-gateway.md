---
name: use-rota-gateway
description: Configure any OpenAI- or Anthropic-compatible client to route through the farm gateway's virtual `rota` model
---

# Point a client at the rota gateway

The local gateway exposes a virtual model, **`rota`** (alias: `auto`). Requesting it routes each call to whichever Claude silo has the most headroom under the three-bucket doctrine — you never pick a silo by hand. Use `crew` through `farmd` when the route may be a different provider, a remote Agensis machine, or a managed sandbox.

## Prerequisites

- The gateway is running and listening on `http://127.0.0.1:4545` (Settings → Gateway).
- Usage evidence is fresh: each silo's `~/.claude-farm/usage/<silo>/claude.json` is refreshed by the app's OAuth ping (Crew → Refresh, or the 90s heartbeat while the app runs).
- If a gateway API key is set in Settings, have it ready; send it as the bearer / `x-api-key`. If none is set, any placeholder value works.

## Configure Claude Code

```sh
export ANTHROPIC_BASE_URL="http://127.0.0.1:4545"
export ANTHROPIC_API_KEY="<gateway key, or anything if none set>"
claude --model rota
```

## Configure any other compatible client

1. Set the base URL to `http://127.0.0.1:4545`.
2. Set the model name to `rota` (or `auto`).
3. Pass the gateway key as the bearer token or `x-api-key` header.

## Verify routing

- The current pick is persisted at `~/.claude-farm/rota.json`.
- Handoffs between silos are logged in `gateway.log` — tail it to confirm requests are landing and to see when a lane switch happens.

## Notes

- Consecutive requests stick to one silo until another lane is meaningfully healthier — this is expected, not a routing bug. A conversation sending `farm.session_id` is pinned outright (see `docs/rota-session-affinity.md`). Switching lanes costs that silo's ~18k static prompt prefix, not the conversation — the conversation is re-sent in full every turn either way (`docs/prompt-cache-evidence.md`).
- A silo with no usage report scores conservatively and is usable but never preferred over a silo with proven headroom.
