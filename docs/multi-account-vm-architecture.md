---
title: Multi-account VM silo architecture pattern
description: Isolate provider state across N accounts using per-account VMs with shared mounted work — reusable for multi-tenant AI systems.
---

# Multi-account VM silo architecture pattern

When managing multiple isolated AI accounts (Anthropic, Codex, Grok, Gemini), a key challenge is preventing credential/state collisions while sharing work context. The usage-farm pattern solves this with three layers:

## Three-layer architecture

### Layer 1: CLI / Host Control

**Where**: Host machine (macOS, Linux)
**What**: Command-line tool to manage, setup, and delegate work to accounts
**Example**: `farm setup hello`, `farm equip codex`, `farm route work-id --account sahil`

### Layer 2: Per-account VM silos

**Where**: Isolated Apple container VMs (or Docker, Firecracker, etc.)
**What**: Each account has:
- Own provider home directory (`~/.usage-farm/accounts/<name>/<provider>-home`)
- Own OAuth tokens and API keys (never shared)
- Own MCP servers, skills, agents, settings
- No access to other accounts' credentials

**Why**: Complete isolation prevents cross-account auth failures. If one account's token rotates, others are unaffected.

### Layer 3: Shared work mounting

**Where**: `~/.usage-farm/work` on host → mounted at **identical absolute path** in every VM
**What**: Bare Git repos, worktrees, output files, shared logs
**Why**: Work stays in one place; every account can read and contribute to the same repo without copying.

## Example filesystem layout

```
Host macOS:
  ~/usage-farm/
    accounts/
      sahil/
        claude-home/        ← ~/.claude (isolated provider state)
        codex-home/         ← ~/.codex  (isolated provider state)
      hello/
        claude-home/
    work/                   ← shared, mounted identically in every VM
      repo-1.git/
        worktree-a/
        worktree-b/
      repo-2.git/

VM sahil:
  ~/ → /root
    .claude/      → mounted at identical path, provider state for this VM
    .codex/       → mounted at identical path
  /root/.usage-farm/work  → identical to host path, shared across VMs

VM hello:
  ~/ → /root
    .claude/      → different account's provider state
  /root/.usage-farm/work  → identical path, same shared work
```

## Usage limits and reset windows

Each account is metered independently:
- **Session allowance**: Replenishes frequently (hourly or per-session)
- **Weekly all-model allowance**: Hard ceiling across all models; once exhausted, account is unavailable until reset
- **Model-specific allowance**: Per-model pool (e.g., Fable separate from Spark)

The routing layer queries all three buckets before delegating work (see capacity-scheduling doctrine).

## Benefits

1. **No credential collisions** — each account's OAuth is isolated
2. **Shared context** — all accounts can see and edit the same work
3. **Scalable** — add new accounts without reconfiguring shared repos
4. **Reset-safe** — one account's token rotation doesn't affect others
5. **Testable** — simulate account exhaustion or reset in one silo

## Reusability

This pattern generalizes beyond usage-farm:
- Multi-tenant AI applications (each tenant = silo)
- Multi-workspace IDEs (each workspace = silo with own settings)
- Multi-provider API clients (each provider = silo)

Key principle: **isolate state, share work, query limits before routing**.
