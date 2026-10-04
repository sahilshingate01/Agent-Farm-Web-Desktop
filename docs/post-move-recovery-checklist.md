---
title: Post-move recovery and verification checklist
description: State that must be re-verified or reset when the farm directory is moved, the desktop app is relocated, or the farm is recovered on a new machine.
status: reference
---

# Post-move recovery checklist

The farm manages state across the desktop app, the CLI, account VM homes, and distributed integrations. After moving `~/.usage-farm`, the checkout, or the desktop app to a new location, several artifacts must be re-verified or reset. Use this checklist so nothing is silently broken.

## Local state verification

1. **Farm CLI discovery** (`docs/desktop-native-bridge-discovery.md`)
   - Confirm `FARM_CLI` is unset or points to the new location
   - Confirm `farm.sh` is beside the checkout or `farm` is on `PATH`
   - Test: `farm silos` should list account silos with no errors

2. **Desktop app build and SDK path** (`docs/desktop-app-build-and-packaging.md`)
   - If the app or Native SDK was moved, override the SDK path: `zig build run -Dnative-sdk-path=/path/to/native`
   - Run `zig build test` to confirm no build errors
   - Launch the app and confirm Settings → Gateway shows `http://127.0.0.1:4545`

3. **Account silo VM mounts** (`README.md`)
   - Every account silo mounts `~/.usage-farm/work` at the identical absolute path
   - After a move, VMs must remount. Confirm by running a test in a silo: the mounted path should match the host path exactly
   - Test: `farm setup <name>` for one account; inside the VM, verify `pwd` matches the host working directory

4. **Usage evidence refresh** (`docs/usage-evidence-files.md`)
   - After a move, usage evidence files at `~/.usage-farm/usage/<silo>/claude.json` may be stale
   - Run `farm refresh` or use the app's Crew → Refresh to re-populate evidence
   - Confirm: `ls -l ~/.usage-farm/usage/*/claude.json` and check modification times are recent

5. **Distributed silo integrations** (`skills/pair-agensis-workspace.md`)
   - If Agensis pairing was set up, confirm the integration token still exists: `cat ~/.usage-farm/integrations/agensis/<workspace-id>.json`
   - Confirm the control plane can reach the workspace: `farm silos` should list any paired remote machines or managed sandboxes
   - If connection fails, re-pair: `farm pair --url https://agensis.io` (one-time approval required)

6. **Rota gateway state** (`docs/rota-gateway.md`)
   - The gateway persists its current pick at `~/.usage-farm/rota.json`
   - After a move, this file is stale; a fresh pick will be made on the next request
   - No action required, but if you see unexpected routing, refresh evidence first (Step 4 above)

## Distributed silo-specific checks

7. **Remote machine connectivity** (`docs/distributed-silos.md`)
   - If remote machines are paired, confirm the relay can reach them: `farm silos` should show them as reachable
   - Test a handoff: `farm route <test-work-id> --account <remote-machine-name>`
   - If unreachable, check the Agensis daemon is running on the remote and the relay is up

8. **Managed cloud silo lifecycle** (`workflows/provision-managed-cloud-silo.md`)
   - E2B and Daytona silo descriptors are stored at `~/.usage-farm/silos/`
   - After a move, confirm descriptors still exist and list correctly: `farm silos`
   - Bring each silo up if needed: `farm silo start <id>` (uses the stored descriptor, not the old runtime state)

## If anything fails

- **Bridge discovery broken** → `skills/fix-desktop-bridge-discovery.md` for CLI/SDK resolution
- **Rota picking wrong lanes** → `skills/diagnose-rota-routing.md` to understand the decision
- **Evidence is stale** → `skills/refresh-usage-evidence.md` to re-populate from OAuth
- **Relay or remote silo unreachable** → validate network connectivity and Agensis daemon status; re-pair if needed
