---
name: use-crew-gateway
description: Route an OpenAI/Anthropic-compatible client through the portable farmd control plane's virtual `crew` model, for work that may land on a non-claude provider, a remote Agensis machine, or a managed E2B/Daytona sandbox — the distributed counterpart to the local rota gateway.
---

# Point a client at the crew gateway

The farm has two compatible control surfaces (`docs/control-surfaces-rota-vs-crew.md`). Use the local **`rota`** model on `:4545` when you need claude and don't care which local account (`skills/use-rota-gateway.md`). Use the portable **`crew`** model on `:4546` when the route may be a **different provider**, a **remote Agensis machine**, or a **managed E2B/Daytona sandbox** — capability-aware routing owned by `farmd`, not the local gateway (`docs/distributed-silos.md`).

## Prerequisites

- `farmd` is running: `farm serve` (the portable control plane / heterogeneous gateway, `docs/farm-cli-reference.md`). Runtime lands at `~/.usage-farm/farmd-runtime.json`.
- For anything on the distributed side (remote machines, sandboxes), the Farm is paired to an Agensis workspace (`skills/pair-agensis-workspace.md`). Local claude-only work does not need pairing — `farmd` delegates it down into the `:4545` gateway where the rota formula applies.

## Configure the client

```sh
export ANTHROPIC_BASE_URL="http://127.0.0.1:4546"   # farmd, not the :4545 local gateway
export ANTHROPIC_API_KEY="<gateway key, or anything if none set>"
claude --model crew
```

For any other compatible client: base URL `http://127.0.0.1:4546`, model name `crew`, pass the key as bearer / `x-api-key`.

## What crew does that rota cannot

- Routes across **heterogeneous** targets — a different provider lane, a paired remote machine, or a managed sandbox — not just local claude silos.
- `farmd` is the front door for heterogeneous work; it delegates claude-only, same-host requests down into `:4545` where the rota scoring formula picks the highest-headroom local silo.

## Notes

- `crew` and `farmd` never share provider credentials with the local surface — each silo/machine/sandbox holds its own (`docs/provider-credential-isolation.md`). They share only `~/.usage-farm` routing/capacity state.
- If you specifically need a non-claude provider on a *local* account, that is a host-side hand-pick with `farm route`, not a crew decision (`docs/control-surfaces-rota-vs-crew.md`).
