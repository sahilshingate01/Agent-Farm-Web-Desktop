---
title: Farm on-disk state — filesystem path reference
description: Every path the farm reads or writes, across its two state roots, and which component owns each. The one place to look up where a piece of farm state lives.
status: reference
---

# Farm on-disk state

The farm keeps state under **two** roots, and which one a path lives under is not obvious from its name. This doc maps both so you never guess.

- `~/.usage-farm/` — **account silos and shared work** (Layer 2 + Layer 3 of `docs/multi-account-vm-architecture.md`).
- `~/.claude-farm/` — **routing/capacity substrate** the gateway and planner read.



## Path map

| Path | Holds | Writer | Committed? |
|---|---|---|---|
| `~/.usage-farm/accounts/<name>/` | A silo's per-account VM home: provider homes, OAuth tokens/API keys, MCP servers, skills, agents, settings | `farm setup` / `farm equip`, inside the silo | Never |
| `~/.usage-farm/accounts/<name>/<provider>-home` | One provider's login state for that account | provider OAuth inside the silo | Never |
| `~/.usage-farm/work` | Bare git repos, worktrees, output, shared logs — mounted at the **identical absolute path** inside every VM | any account | The repos are; the mount is host-local |
| `~/.usage-farm/host-dirs` | Extra host folders to share into every **local** container, one TSV record per line (`host<TAB>target<TAB>rw\|ro`); injected as virtiofs `-v` mounts by `start_one` | `farm add-host-dir` / `farm rm-host-dir` | Never — host-local, machine-specific paths |
| `~/.claude-farm/usage/<silo>/claude.json` | Per-silo usage evidence — the substrate every routing/scheduling decision reads (`docs/usage-evidence-files.md`) | desktop app OAuth ping (Crew → Refresh) and the gateway's live rate-limit events; NOT the 90s heartbeat | Never — hand-editing forbidden |
| `~/.claude-farm/rota.json` | The rota gateway's current silo pick | rota gateway | Never |
| `gateway.log` | Per-request handoff log; correlate against `claude.json` at that timestamp | rota gateway | Never |

## Ownership rules that bite

- \*\*`claude.json`\*\***&#x20;is evidence, not config.** The desktop app is its only legitimate writer. Do not hand-edit it; if you can't refresh it, treat the silo as stale (see the `refresh-usage-evidence` skill).
- **A freshly&#x20;**\*\*`setup`**&#x20;silo has no&#x20;**`~/.claude-farm/usage/<name>/claude.json`\*\*\*\*.\*\* Until that file appears it scores a conservative **0.5** and is usable but never preferred.
- **Shared work must stay single-homed.** `~/.usage-farm/work` is one directory mounted at the same absolute path in every VM — never copy repos per-account.

## Related

- Command surface that touches these paths: `docs/farm-cli-reference.md`.
- Architecture behind the split: `docs/multi-account-vm-architecture.md`.
- Evidence lifecycle and staleness: `docs/usage-evidence-files.md`, `[[capacity-consumers-shared-substrate]]`.

