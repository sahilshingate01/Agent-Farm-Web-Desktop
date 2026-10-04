---
title: Troubleshooting distributed silos
description: Diagnose and recover from distributed silo issues — connectivity, pairing failures, descriptor problems, credential isolation, and managed sandbox errors.
status: reference
---

# Troubleshooting distributed silos

Distributed silos (remote Agensis machines and managed E2B/Daytona sandboxes) are reached through the `farmd` control plane and an Agensis relay. Failures fall into a few categories; use this guide to diagnose and recover.

## Problem 1: Silo shows as unreachable

**Symptom:** `farm silos` shows a silo with status `unreachable`.

**Diagnosis:**

```bash
farm silos                          # confirm status is unreachable
farm silo start <id>               # for managed silos, try to bring it up
```

If it's a managed sandbox, it may need to be started.

If it's a remote Agensis daemon:
1. Confirm the daemon is still running on that machine
2. Confirm network connectivity between the host and the machine
3. Check the daemon's logs for errors

**Recovery:**
- Managed sandboxes: `farm silo start <id>` brings it up through the runtime adapter
- Remote Agensis daemons: restart the daemon on that machine (see `skills/pair-agensis-workspace.md` for how daemons are set up)
- Network issues: restore network connectivity and then re-test with `farm silos`

## Problem 2: Work routed to a silo fails with timeout or connection refused

**Symptom:** When you request the `crew` model and work fails with "silo <name> timed out after 30s" or similar.

**Diagnosis:**

```bash
farm silos                          # check the silo's status column
farm silo start <id>               # for managed silos, verify it's running
```

Same as Problem 1 — the relay cannot reach that silo. Either it's paused/stopped, the daemon crashed, or there's a network problem.

**Recovery:** Same as Problem 1.

## Problem 3: Agensis pairing failed or the integration token is missing

**Symptom:** `farm silos` shows no daemons or managed silos; `farm pair` fails.

**Diagnosis:**

```bash
farm pair --url https://agensis.io                # re-run pairing
ls -la ~/.usage-farm/integrations/agensis/        # check if token exists and has owner-only perms
```

The integration token should exist at `~/.usage-farm/integrations/agensis/<workspace-id>.json` with mode `0600` (owner-only). If it's missing:

1. Pairing never completed successfully
2. The token file was deleted
3. The file has wrong permissions (readable by others)

**Recovery:**

```bash
# Re-run pairing if the token is missing
farm pair --url https://agensis.io
# A workspace manager must approve the device code

# If the token exists but has wrong perms, fix it
chmod 600 ~/.usage-farm/integrations/agensis/<workspace-id>.json

# If the token exists but farmd still can't reach Agensis, check:
farm serve                          # confirm farmd starts without errors
echo '{}' | curl -X POST http://localhost:4546/v1/models  # test farmd is listening
```

## Problem 4: Managed sandbox creation failed

**Symptom:** `farm silo create e2b` or `farm silo create daytona` fails.

**Diagnosis:**

```bash
farm silo create e2b                # see the error message
```

Common causes:
- Provider credentials not set up on the host (the app hasn't authorized E2B/Daytona)
- Provider quota exhausted
- Network connectivity to the provider API failed
- The Agensis pairing isn't complete

**Recovery:**

1. Confirm Agensis pairing is complete: `farm silos` should list at least one workspace.
2. Confirm you have valid credentials for the provider (E2B or Daytona) — this is host-side, not inside a silo. The desktop app is usually where these are set up.
3. Check your quota with the provider.
4. If network is the issue, retry after connectivity is restored.

## Problem 5: Silo descriptor corrupted or missing

**Symptom:** A silo shows in `farm silos` but operations like `farm silo pause <id>` fail with "descriptor not found" or similar.

**Diagnosis:**

```bash
cat ~/.usage-farm/silos/<id>.json           # read the descriptor
```

Descriptors are JSON files holding public routing and lifecycle metadata. If the file is missing or malformed, lifecycle operations fail.

**Recovery:**

- **If the file is missing:** The silo cannot be managed. Use the provider's console (E2B/Daytona) to delete the runtime instance if you no longer need it.
- **If the file is malformed (invalid JSON):** Edit the file by hand to repair the JSON, or re-create it from the provider's API output.

Descriptors contain only public metadata — no credentials. They are safe to edit or rebuild. The credential lives inside the sandbox environment, not in the descriptor.

## Problem 6: Credential isolation broken (host credential leaked into sandbox or vice versa)

**Symptom:** A managed sandbox is using the host's provider tokens, or vice versa.

**Diagnosis:**

This should never happen if you follow the credential-isolation pattern. Check:

```bash
# Host credentials should be in per-silo homes or app OAuth caches
ls -la ~/.usage-farm/accounts/<name>/<provider>-home/

# Sandbox credentials should only exist inside the sandbox
# You can't easily inspect this, but symptoms include:
# - A sandbox operation using host account quota (wrong headroom)
# - A sandbox failing when the host's token expires (shouldn't happen)
```

**Recovery:**

1. Re-run `farm equip <provider>` to authorize that silo/provider pair — the login must happen **inside** the silo so the token lands in that silo's home.
2. If a sandbox is still using a host token, delete the sandbox and recreate it: `farm silo delete <id>` then `farm silo create <e2b|daytona>`.
3. For local silos, run `farm setup <name>` to re-provision the account and re-authorize.

See `docs/provider-credential-isolation.md` for the isolation invariant and how credentials should flow.

## Problem 7: farmd is not listening on port 4546

**Symptom:** `crew` model requests fail with "connection refused on :4546".

**Diagnosis:**

```bash
farm serve                          # start farmd
# Confirm it's listening
netstat -an | grep 4546
# or
ss -an | grep 4546
```

**Recovery:**

```bash
# Bring farmd up in the foreground to see startup errors
farm serve

# Or run it in the background and keep it running
farm serve &
```

farmd should start immediately. If it fails to bind on `:4546`, another process is using that port, or the host firewall is blocking it.

For ongoing use, consider adding `farm serve` to your shell startup or running it in a persistent background service.
