---
title: Farm host CLI command reference
description: The Layer-1 host-control commands (setup, equip, route) that manage account silos, plus where their state lands.
status: reference
---

# Farm host CLI reference

The farm's **Layer 1** is a host-machine CLI that manages, provisions, and delegates work to account silos (`docs/multi-account-vm-architecture.md`). Everything below runs from the host, not inside a silo VM. The CLI is resolved by the desktop Native bridge in the order `FARM_CLI` → `farm.sh` beside the checkout → `farm` on `PATH`.

## Commands

| Command | Purpose | State it touches |
|---|---|---|
| `farm setup <name>` | Provision a new account silo — a per-account VM with its own provider home, OAuth tokens/keys, MCP servers, skills, agents, settings. | `~/.usage-farm/accounts/<name>/` (never committed) |
| `farm equip <provider>` | Add a provider (`claude`, `codex`, `grok`, `gemini`, …) to the current account; complete its OAuth/login **inside that silo** so tokens never leak across accounts. | that account's provider home |
| `farm route <work-id> --account <name>` | Manually delegate a unit of work to a specific account (host-side hand pick, as opposed to the gateway's auto `rota` model). | shared work dir |
| `farm pair --url <agensis-url>` | Pair this Farm with one Agensis workspace through a one-time device code. | `~/.usage-farm/integrations/agensis/` |
| `farm silos` | Discover paired Agensis daemons and list managed runtime descriptors. | read-only registry/discovery |
| `farm silo create <e2b\|daytona>` | Provision a managed cloud silo from a prepared template/snapshot and enroll its Agensis child agent. Add `--coding-cmd` only when that environment contains an authenticated coding tool. | provider runtime plus `~/.usage-farm/silos/` |
| `farm silo start\|pause\|delete <id>` | Apply a lifecycle transition through the descriptor's runtime adapter. | provider runtime plus descriptor |
| `farm serve` | Run `farmd`, the portable control plane and heterogeneous model gateway. | `~/.usage-farm/farmd-runtime.json` |
| `farm job run --agent-id <id> --prompt <work>` | Dispatch a sessionless coding job to a connected Agensis daemon. | Agensis `agent_jobs` |
| `farm add-host-dir <path> [target] [--ro]` | Share an extra host folder into **every local** account container as a virtiofs `-v` mount. `<path>` resolves to an absolute physical path (so `.`, relative, and `~` work); `[target]` defaults to the identical absolute path; read-write unless `--ro`. Remote/managed silos can't see the host FS and ignore it. | `~/.usage-farm/host-dirs` |
| `farm host-dirs` | List shared host dirs as TSV (`host\ttarget\trw\|ro`). Local silos only. | `~/.usage-farm/host-dirs` (read-only) |
| `farm rm-host-dir <path>` | Stop sharing a host dir. | `~/.usage-farm/host-dirs` |
| `farm reload [acct...]` | Recreate running containers so host-dir mount changes take effect (mounts bind at `container run` time). Restarts the account's session. | local containers |

## What each command guarantees

- **Isolation** — every silo gets its own credentials; a token rotation on one account never affects another (`docs/multi-account-vm-architecture.md`, Layer 2).
- **Shared work** — `~/.usage-farm/work` on the host is mounted at the **identical absolute path** inside every VM (Layer 3), so all accounts read and contribute to the same repos without copying.
- **Routability** — a freshly-`setup` silo is not routable until it has usage evidence at `~/.claude-farm/usage/<name>/claude.json`; until then it scores a conservative 0.5.

## Related

- Full stand-up procedure: `workflows/onboard-account-silo.md`.
- Bridge discovery / SDK override knobs: `docs/desktop-native-bridge-discovery.md`.
