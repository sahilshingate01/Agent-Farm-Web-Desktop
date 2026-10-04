---
title: Two control surfaces — farm.sh/rota vs farmd/crew
description: The farm has two compatible control surfaces with two virtual routing models. This doc draws the line so `rota` and `crew` aren't used interchangeably.
status: reference
---

# Two control surfaces: farm.sh/rota vs farmd/crew

Farm exposes **two compatible control surfaces** that share `~/.usage-farm` state and the desktop app but route differently (`docs/distributed-silos.md`):

| Surface | Binary | Virtual model | Routes to |
|---|---|---|---|
| Local gateway (`:4545`) | `farm.sh` (Apple-container adapter) | **`rota`** (alias `auto`) | claude silos on the local Mac host only |
| Portable control plane (`:4546`) | `daemon/bin/farmd.mjs` | **`crew`** | local silos, remote Agensis machines, E2B and Daytona sandboxes — and non-claude providers |

## When to request which model

- **`rota`** — you need claude and don't care which local account. The gateway scores every claude silo per request under the three-bucket doctrine and picks the highest-headroom lane (`docs/rota-gateway-scoring-model.md`, `skills/use-rota-gateway.md`). Claude-only; it does not auto-distribute across codex/grok/gemini.
- **`crew`** — the route may land on a **different provider**, a **remote Agensis machine**, or a **managed E2B/Daytona sandbox**. `crew` is capability-aware routing owned by `farmd`, not the local gateway (`docs/rota-gateway.md`, `docs/distributed-silos.md`).

**Gateway-side only.** Session affinity (`docs/rota-session-affinity.md`),
rate-limit lane vetoes, and the `anchor` workflow (`docs/anchor-workflow.md`) all
live in the local gateway's `rotaPick`/`executeRoute`. `farmd`'s `crew` router
has its own — and separately implemented — notion of availability and load
(`daemon/src/crew-router.mjs`). Do not assume a behaviour described for `rota`
applies to `crew`; this divergence is deliberate but real.

## The dataflow

```text
OpenAI client ──> farmd :4546 ──> local gateway :4545 ──> Apple account silo   (rota picks here)
                         ├──────> Agensis relay ─────────> arbitrary machine
                         ├──────> Agensis relay ─────────> E2B sandbox
                         └──────> Agensis relay ─────────> Daytona sandbox
```

`farmd` is the front door for heterogeneous work; it delegates claude-only, same-host requests down into the local gateway where the rota scoring formula applies.

## What they do and don't share

- **Shared:** `~/.usage-farm` state and the desktop app.
- **Not shared:** provider credentials — each silo/environment keeps its own (see [[control-surfaces-shared-state-separate-creds]]).

## Related

- Local rota scoring: `docs/rota-gateway-scoring-model.md`
- Provisioning a distributed silo: `workflows/provision-managed-cloud-silo.md`
- Host CLI: `docs/farm-cli-reference.md`
