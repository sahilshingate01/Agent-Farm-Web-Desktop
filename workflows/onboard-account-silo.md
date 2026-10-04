---
name: onboard-account-silo
description: 'Stand up a new isolated account silo (per-account VM, provider home, OAuth) and confirm its usage evidence and rota routing come online'
phases:
  - title: 'Create the silo'
  - title: 'Equip and authenticate a provider'
  - title: 'Verify capacity evidence and routing'
---

# Onboard a new account silo into the farm

The farm runs **N isolated AI accounts on one Mac**, each in its own Apple container VM with separate provider state — no shared Keychain, no credential collisions (`README.md`). This workflow adds one new account end-to-end so it becomes a routable silo. The three architectural layers it must satisfy are described in `docs/multi-account-vm-architecture.md`.

## Phase 1: Create the silo

1. From the host CLI, create the account:
   ```bash
   farm setup <name>      # e.g. farm setup hello
   ```
2. This provisions **Layer 2** — a per-account VM with its own provider home directory under `~/.usage-farm/accounts/<name>/`, its own OAuth tokens/API keys, and its own MCP servers / skills / agents / settings. Nothing here is ever committed to git (`README.md` layer table).
3. Confirm **Layer 3** — the shared work directory `~/.usage-farm/work` is mounted at the **identical absolute path** inside the new VM. Work must live in one place so every account reads and contributes to the same repos without copying.

## Phase 2: Equip and authenticate a provider

1. Add the provider(s) this account will serve:
   ```bash
   farm equip <provider>  # e.g. farm equip codex  (claude, codex, grok, gemini, …)
   ```
2. Complete the provider's OAuth/login **inside that account's silo** so the tokens land in the account's own provider home and never leak across accounts. Isolation means a token rotation on one account never affects another.

## Phase 3: Verify capacity evidence and routing

1. The routing layer only sees a silo once it has usage evidence. Trigger a refresh (desktop app: **Crew → Refresh**, or leave the app running for its 90-second OAuth heartbeat) and confirm the evidence file appears:
   ```bash
   cat ~/.claude-farm/usage/<name>/claude.json
   ```
   Until this file exists, the silo scores a conservative **0.5** — usable but never preferred over a silo with proven headroom (`docs/usage-evidence-files.md`).
2. Confirm the silo is now a routing candidate: point a client at the `rota` gateway (see the `use-rota-gateway` skill) and tail `gateway.log` to see the new silo appear as a scored lane.
3. Optionally route a specific task to it directly:
   ```bash
   farm route <work-id> --account <name>
   ```

The account is onboarded once it holds isolated provider state (Phase 1–2) **and** publishes fresh `claude.json` evidence that the gateway and handoff planner can read (Phase 3).