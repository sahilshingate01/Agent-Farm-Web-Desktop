---
title: Provider credential isolation pattern and lifecycle
description: How OAuth tokens and API keys are stored per account silo and distributed environment, why isolation matters, and lifecycle operations like rotation and recovery.
status: reference
---

# Provider credential isolation

## The isolation invariant

Every account silo, remote Agensis machine, and managed E2B/Daytona sandbox **holds its own provider credentials** (`~/.usage-farm/accounts/<name>/<provider>-home/`, the remote machine's environment, or the sandbox's environment). Credentials **never cross environment boundaries**.

Shared state like usage evidence and silo descriptors is OK because it is public routing metadata. Shared *credentials* would break the isolation that every capacity and routing decision assumes: a token rotation or compromise in one account must never affect another.

## Storage by environment

| Environment | Credential storage | Isolation scope |
|---|---|---|
| **Local account silo** | `~/.usage-farm/accounts/<name>/<provider>-home/` | One account; isolated from other accounts on the same Mac |
| **Remote Agensis machine** | That machine's environment (e.g. `~/.anthropic`, `~/.google`) | One remote machine; isolated from the host and other remotes |
| **E2B/Daytona sandbox** | Inside the sandbox environment | One runtime instance; isolated from the host and other sandboxes |
| **Desktop app (for usage evidence refresh)** | Per-account silo, via OAuth | See below |

Note: the Agensis integration token at `~/.usage-farm/integrations/agensis/<workspace-id>.json` is an **orchestration/routing credential**, not a provider credential — it authorizes the farm to *route* work through the relay, not to *consume provider tokens*. It lives on the host and is owner-only because it is sensitive, but it is never copied into a sandbox or remote machine.

## How credentials enter each environment

**Local account silo:**
```bash
farm equip <provider>      # on the host
```
This launches a browser login *inside* that account's VM, so the OAuth token lands in that account's home directory. The host never touches the token.

**Remote Agensis machine:**
SSH to the machine and run `farm equip <provider>` or `anthropic login` *on that machine*, so credentials stay there.

**E2B/Daytona sandbox:**
Credentials are injected at provisioning time if needed (use `farm silo create --coding-cmd` only if the provider is already authenticated in the sandbox environment). Alternatively, complete a login *inside* the sandbox.

## The anti-pattern that breaks isolation

Do **not**:
```bash
farm setup --copy-credentials-from-host    # ❌ not a real command, but illustrates the pattern
farm route --inject-provider-token         # ❌ do not do this
cp ~/.anthropic/state/* ~/.usage-farm/accounts/other/claude-home/  # ❌ never copy credentials
```

These anti-patterns cause credentials to leak across accounts or machines. If that token is rotated or compromised, the compromise affects multiple environments — exactly what isolation prevents. Always complete a login *inside* each target environment.

## Credential lifecycle operations

### Rotating a credential

1. Inside the target environment (account silo VM, remote machine, or sandbox), re-authenticate:
   ```bash
   anthropic login        # for Claude providers
   gcloud auth login      # for Gemini
   codex login            # (example)
   ```
   The new token replaces the old one in that environment's local storage.

2. Refresh usage evidence to pick up the new token's quota/limits:
   ```bash
   farm refresh           # on the host, forces all silos to re-OAuth
   ```

3. Confirm the silo is healthy:
   ```bash
   cat ~/.usage-farm/usage/<silo>/claude.json   # evidence should be current
   ```

### Recovering a compromised credential

1. Immediately rotate the token (step above).
2. If the provider supports token revocation, revoke the old token (e.g. `anthropic logout` to clear saved tokens).
3. Do **not** copy a credential from another account/machine/sandbox to "save time" — force the environment to re-authenticate.

### Handling expiring provider credentials

OAuth tokens and API keys have different expiration policies:

- **OAuth (Claude, Gemini, Codex):** The desktop app's `Crew → Refresh` button re-OAuths every silo. This is **not** automatic — the app's 90-second heartbeat only re-reads the evidence files it already has. Refresh explicitly, or cron `farm.usage.ping`, or tokens can silently go stale.
- **API keys (some providers):** If a provider uses long-lived API keys without expiry, rotation is manual — create a new key in the provider's console, replace it in the silo, and revoke the old one.

## Observability

- Each account silo's provider state is invisible to the host (by design). You cannot inspect or audit a silo's credentials from the host.
- If a silo's credentials are stale or invalid, usage evidence will be missing or stale, causing it to score a conservative 0.5 in routing (`docs/usage-evidence-files.md`).
- Verify credential health indirectly: is the silo's usage evidence fresh and current? If not, suspect credential issues and refresh.

See also [[control-surfaces-shared-state-separate-creds]] for the control plane's isolation model.
