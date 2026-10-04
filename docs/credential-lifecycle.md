---
title: Provider credential lifecycle
description: Managing the full lifecycle of provider OAuth tokens and API keys — rotation, expiry monitoring, token recovery, and why isolation is critical to safety.
status: reference
---

# Provider credential lifecycle

Every account silo, remote Agensis machine, and managed E2B/Daytona sandbox holds its own provider credentials (OAuth tokens, API keys) inside its own isolated environment. This isolation is the security boundary for the entire farm. This doc covers the full lifecycle: how credentials are provisioned, monitored, rotated, and recovered when expired.

## The isolation invariant

**Every silo/machine/sandbox keeps its own credentials. Credentials never cross environment boundaries.** This is non-negotiable:

- A token rotation or compromise in one account must never affect another.
- The farm's capacity routing decisions assume each silo is independently authorized — shared credentials would break this assumption.
- Shared state like usage evidence and silo descriptors is OK because it is public routing metadata, not secrets.

See `docs/provider-credential-isolation.md` for storage locations per environment.

## Phase 1: Provisioning

### Local account silo

```bash
farm equip <provider>              # launch OAuth login inside that silo
```

The CLI opens a browser login **inside that account's VM**. The resulting OAuth token lands in that silo's provider home directory (`~/.usage-farm/accounts/<name>/<provider>-home/`), never touching the host.

**Why inside the VM:** ensures the token never transits through the host where it could be intercepted, logged, or backed up carelessly.

### Remote Agensis machine

SSH to the machine and authorize there:

```bash
ssh <machine>
# Inside the machine:
$AGENSIS_HOME/bin/equip <provider>   # or follow provider's auth flow
```

The token lives in that machine's environment, never sent to the host.

### Managed E2B/Daytona sandbox

When you provision the sandbox (`farm silo create e2b`), authorize the provider **inside** the sandbox before taking work:

```bash
farm silo start <id>
farm exec <id> -- equip <provider>    # or equivalent auth inside sandbox
```

The token stays in the sandbox environment.

## Phase 2: Monitoring and detecting expiry

Credentials can expire or be revoked. The desktop app's OAuth ping (**Crew → Refresh** — not the 90-second heartbeat, which only re-reads the files) re-fetches provider quota and writes usage evidence. **If an OAuth refresh fails, that is a sign the token may be expired or revoked.**

**Watch for:**
- Usage evidence files stop updating (`ls -l ~/.claude-farm/usage/*/claude.json` — modification times are old)
- A silo's score drops to the conservative 0.5 floor (because evidence is stale, see `docs/usage-evidence-files.md`)
- Requests routed to that silo fail with "unauthorized" or similar auth errors

**Proactive checks:**

For local silos, the desktop app handles this. For remote machines and sandboxes:

```bash
# Remote machine: test the token by making an API call
ssh <machine>
echo 'export ANTHROPIC_API_KEY=<token>' | bash -c 'curl https://api.anthropic.com/v1/models'

# Managed sandbox: similar test inside the sandbox
farm exec <id> -- 'export ANTHROPIC_API_KEY=<token> && curl https://api.anthropic.com/v1/models'
```

A 401 or 403 response means the token is expired/revoked.

## Phase 3: Rotation

Rotate a credential by re-authorizing:

### Local silo

```bash
farm equip <provider>              # triggers re-login inside the silo
```

The new token replaces the old one in that silo's home. The old token is discarded (and should be revoked in the provider's dashboard if possible).

### Remote machine

```bash
ssh <machine>
$AGENSIS_HOME/bin/equip <provider>   # re-login on the machine
```

### Managed sandbox

```bash
farm silo start <id>               # bring it up
farm exec <id> -- equip <provider> # re-login inside
```

After rotation, the old token should be revoked in the provider's dashboard to prevent misuse if compromised.

## Phase 4: Recovery from expiry

If a credential is discovered to be expired:

1. **Stop using that silo immediately** for new work — it will fail requests.
   ```bash
   farm silo pause <id>           # for managed silos, pause to stop incurring cost
   ```

2. **Rotate the credential** (Phase 3 above) and re-authorize.

3. **Resume work:**
   ```bash
   farm silo start <id>           # bring it back up
   # For local silos: routing will prefer it once evidence refreshes
   # For managed silos: subsequent work will route to it
   ```

## Checking isolation

To verify credentials are properly isolated, spot-check:

```bash
# Local accounts: check ownership and perms
ls -la ~/.usage-farm/accounts/<name>/*/
# Should be owned by you, mode 0700 (rwx------)

# Desktop app's OAuth cache (used for evidence refresh only)
ls -la ~/.usage-farm/oauth-cache/
# Should be owner-only

# Remote machines: credentials live inside the remote environment
# You cannot easily inspect from the host — this is by design

# Managed sandboxes: same — credentials are in the sandbox environment
# Never pass them through the descriptor or environment from the host
```

## Why isolation is critical

Shared credentials would mean:
- A compromise of one silo's token grants access to all work done under that provider account.
- Token rotation in one silo would affect all silos using that token.
- Capacity decisions would be wrong — multiple silos sharing one quota bucket would overdraw it.
- Audit trails would be confused — you couldn't tell which silo used how much quota.

Isolation means each silo's quota is independent, each token is independent, and a problem in one is contained. The farm's three-bucket capacity model and the rota/handoff routing formulas both depend on this.
