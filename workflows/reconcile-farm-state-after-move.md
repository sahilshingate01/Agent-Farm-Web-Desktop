---
name: reconcile-farm-state-after-move
description: 'Automate verification and repair of Farm state after the farm directory is moved, the desktop app is relocated, or recovery occurs on a new machine — orchestrates the five post-move recovery areas into a single workflow'
phases:
  - title: 'Verify CLI and build tooling'
  - title: 'Verify account silo VM mounts'
  - title: 'Refresh usage evidence'
  - title: 'Verify distributed integrations'
---

# Reconcile Farm state after relocation or recovery

When `~/.usage-farm`, the checkout, or the desktop app moves to a new location, five areas of Farm state must be re-verified and potentially repaired. The post-move recovery checklist (`docs/post-move-recovery-checklist.md`) describes these steps manually. This workflow orchestrates them — each step detects issues and repairs them where possible.

## Phase 1: Verify CLI and build tooling

1. Check `FARM_CLI` environment variable and resolution path
   - Confirm `farm.sh` is beside the new checkout location or `farm` is on `PATH`
   - Run `farm silos` to verify CLI is reachable
2. If the desktop app or Native SDK moved, override the SDK path and rebuild
   - Test: `zig build test` must pass
   - If fails, flag the SDK path mismatch
3. Confirm Settings → Gateway shows `http://127.0.0.1:4545`

## Phase 2: Verify account silo VM mounts

1. Every account silo must mount `~/.usage-farm/work` at the identical absolute path on host and inside the VM
2. For each account silo:
   - Run `farm setup <name>` to remount if needed
   - Test working directory inside the VM: `pwd` must match the host path exactly
3. Flag any silos where the mount path diverged

## Phase 3: Refresh usage evidence

1. Usage evidence files at `~/.usage-farm/usage/<silo>/claude.json` may be stale after a move
2. Refresh: `farm refresh` or use the app's Crew → Refresh
3. Verify: `ls -l ~/.usage-farm/usage/*/claude.json` — all modification times should be recent

## Phase 4: Verify distributed integrations

1. If Agensis pairing was set up, confirm the integration token still exists: `~/.usage-farm/integrations/agensis/<workspace-id>.json`
2. Confirm the control plane can reach the workspace: `farm silos` lists daemons/managed silos without errors
3. For each distributed silo, test connectivity via `farm silo start <id>` (managed silos) or a sessionless job dispatch (`farm job run`)
