---
title: Silo class capability matrix
description: Which farm mechanisms apply to which silo class — local Apple-container account silos, remote Agensis machines, and managed E2B/Daytona sandboxes — collected into one table instead of per-doc scope disclaimers.
status: reference
---

# Silo class capability matrix

The farm has **three silo classes**, and nearly every mechanism applies to only some of them. The docs handle this with inline scope disclaimers ("applies to local Apple-container account silos only", "these transitions apply only to managed runtime silos"). This matrix collects those disclaimers in one place so you check here instead of hunting for the caveat.

## The three classes

- **Local account silo** — Apple-container VM on the Mac host, provisioned with `farm setup <name>`.
- **Remote Agensis machine** — a paired daemon reached through `farmd` and the Agensis relay.
- **Managed cloud sandbox** — an E2B/Daytona runtime created with `farm silo create`, reached through `farmd`.

## The matrix

| Mechanism | Local account silo | Remote Agensis machine | Managed E2B/Daytona sandbox |
|---|---|---|---|
| Shared work dir (`~/.usage-farm/work`) mounted at identical absolute path | **Yes — load-bearing invariant** (`docs/distributed-silos.md`) | No — no host work-dir mount | No — no host work-dir mount |
| Extra host folders via `farm add-host-dir` (virtiofs, injected by `start_one`) | **Yes — local containers only** (`skills/share-host-dir-into-silos.md`) | No | No |
| Provisioning | `farm setup <name>` | Pair daemon (`skills/pair-agensis-workspace.md`) | `farm silo create <e2b\|daytona>` |
| Lifecycle `farm silo start/pause/delete` | **No** — managed with `farm setup` / host-side routing | No (restart the daemon on that machine) | **Yes — the only class with these transitions** (`skills/manage-managed-silo-lifecycle.md`) |
| Bills for runtime while up | No | No (your machine) | **Yes — pause when idle, start before use** (`docs/distributed-silos.md`) |
| Auto-routing surface | `rota` on `:4545` (claude silos only) | `crew` on `:4546` | `crew` on `:4546` |
| Manual placement command | `farm route <work-id> --account <name>` | `farm job run --agent-id <id>` | `farm job run --agent-id <id>` (must be started first) |
| Has a descriptor under `~/.usage-farm/silos/` | No | Yes (paired daemon entry) | Yes (created by `farm silo create`) |
| Provider credential location | `~/.usage-farm/accounts/<name>/<provider>-home/` via `farm equip` inside the VM | That machine's own environment (SSH in, equip there) | Inside the sandbox; destroyed with it on delete |
| Usage evidence written by desktop app heartbeat | Yes (`usage/<silo>/claude.json`) | Routed by `farmd` capability scoring, not rota evidence | Routed by `farmd`, lifecycle state gates dispatch |

## How to use it

Before running a command against a silo, find the mechanism's row and confirm the silo's class column says yes. The two most common mistakes it prevents:

- Running `farm silo pause` against a **local account silo** — the lifecycle transitions exist only for managed runtimes.
- Expecting a **distributed** silo to see files under the shared work dir — only local silos mount it; ship work to distributed targets through the job prompt and the Agensis-side job record (`skills/dispatch-sessionless-job.md`).
