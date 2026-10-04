---
name: reconcile-usage-evidence-path-drift
description: 'Find and reconcile the usage-evidence path root that drifted between ~/.claude-farm/usage/ and ~/.usage-farm/usage/ after the claude-farm → usage-farm rename, so every doc, skill, and workflow points readers at the same file'
phases:
  - title: 'Confirm the drift and pick the canonical root'
  - title: 'Enumerate every occurrence'
  - title: 'Reconcile to the canonical root'
  - title: 'Verify no stale references remain'
---

# Reconcile the usage-evidence path drift

The project was renamed `claude-farm → usage-farm` (`README.md`: "usage-farm (formerly claude-farm)"), but the rename is incomplete for the single most-cited path in the docs: the per-silo **usage-evidence file** every routing and scheduling decision reads. It currently appears under **two different roots** across the workspace, and a reader who copies the wrong one lands on a path that does not exist:

| Root used | Appears in |
|---|---|
| `~/.claude-farm/usage/<silo>/claude.json` | `docs/farm-filesystem-paths.md`, `skills/validate-usage-evidence.md`, `docs/usage-evidence-health-and-recovery.md`, `docs/usage-evidence-files.md` |
| `~/.usage-farm/usage/<silo>/claude.json` | `workflows/reconcile-farm-state-after-move.md`, `docs/post-move-recovery-checklist.md` |

This is the same failure mode as the wordmark-font drift: whichever doc a reader opens first wins, and the substrate fragments. This workflow drives it to a single answer.

## Phase 1: Confirm the drift and pick the canonical root

1. Establish ground truth on disk — inspect the real filesystem to see which root actually holds `usage/<silo>/claude.json`:
   ```bash
   ls -ld ~/.usage-farm/usage ~/.claude-farm/usage 2>/dev/null
   ls -l  ~/.usage-farm/usage/*/claude.json ~/.claude-farm/usage/*/claude.json 2>/dev/null
   ```
2. The root that the **desktop app actually writes** (Crew → Refresh / 90s heartbeat) is canonical — evidence is machine-written, so the writer's path wins, not any doc's claim.
3. Note that `docs/farm-filesystem-paths.md` currently *rationalizes* the split as an intentional "two state roots" design (account/work under `~/.usage-farm`, routing substrate under `~/.claude-farm`). Decide explicitly whether that two-root split is real or is post-rename drift — do not assume; confirm against Phase 1's disk evidence before editing anything.

## Phase 2: Enumerate every occurrence

1. Find every reference to either root, across docs, skills, workflows, and agent-updates:
   ```bash
   grep -rn -e '\.claude-farm/usage' -e '\.usage-farm/usage' -e '\.claude-farm/rota' -e '\.claude-farm/' .
   ```
2. Build the full list of files to touch — include the routing-substrate siblings that live beside `usage/` (e.g. `rota.json`, `gateway.log`), because if the root moves they move with it.

## Phase 3: Reconcile to the canonical root

1. Rewrite each occurrence to the canonical root chosen in Phase 1, in one pass, so no file is left half-updated.
2. Update `docs/farm-filesystem-paths.md` decisively: either affirm the two-root split with a one-line rationale for *why* usage evidence sits apart from account state, or collapse it to the single canonical root. It is the path-reference doc, so it must be unambiguous.
3. If the two-root split is confirmed real, add a short callout to the drift-prone docs stating the exact root and cross-linking `docs/farm-filesystem-paths.md`, so future readers stop guessing.

## Phase 4: Verify no stale references remain

1. Re-run the Phase 2 grep. The only surviving references to the non-canonical root should be intentional historical notes (e.g. the `README.md` rename line).
2. Spot-check one consumer end to end: follow `skills/validate-usage-evidence.md` using only the reconciled path and confirm it resolves to a real file.
