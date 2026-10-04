---
name: reconcile-wordmark-font-drift
description: 'Retire the stale Space Grotesk wordmark sources so all three brand documents agree on Manrope — the authoritative decision (Sahil Shingate, 2026-07-11)'
phases:
  - title: 'Confirm the authoritative source'
  - title: 'Fix the two stale sources'
  - title: 'Verify no Space Grotesk references remain'
---

# Reconcile the wordmark font drift

The brand identity currently specifies **Manrope** for the wordmark (`docs/brand-agent-farm.md`: "Manrope — chosen over Space Grotesk (Sahil Shingate, 2026-07-11)", the newest brand doc). Two older in-tree sources still say **Space Grotesk** and are stale (`docs/brand-agent-farm.md`). While they disagree, implementers pick whichever doc they open first and the identity fragments. This workflow retires the drift rather than propagating it.

## Phase 1: Confirm the authoritative source

1. Re-read `docs/brand-agent-farm.md` — it is the newest brand spec and names **Manrope**. This is the winner.
2. Confirm everything *other than the typeface* is already consistent across all three sources and must stay unchanged:
   - `Agent` — weight **700**, tracking **-0.03em**, foreground colour.
   - `Farm` — weight **700**, tracking **-0.03em**, gradient `#5B7CFF → #8A6BFF → #C85ED8` (single colour in monochrome).
   - Byline `BY AGENSIS` — Inter 500, 12px, tracking 0.42em, 55% opacity.

## Phase 2: Fix the two stale sources

1. **`docs/brand-system-reference.md`** — change the primary typeface from "Space Grotesk — chosen for infrastructure software" to **Manrope**, matching `docs/brand-agent-farm.md`. Leave weights, tracking, gradient, and byline untouched.
2. **`skills/render-agent-farm-wordmark.md`** — update both the prose ("Font: Space Grotesk") and the Tailwind sketch's `font-[Space_Grotesk]` class to **Manrope** (`font-[Manrope]`). This skill is what actually renders the wordmark, so it is the highest-impact fix.

## Phase 3: Verify no Space Grotesk references remain

1. Search the tree for any lingering `Space Grotesk` / `Space_Grotesk` in a wordmark context:
   ```sh
   grep -rn "Space[ _]Grotesk" docs/ skills/
   ```
2. Two legitimate mentions may remain and should **not** be blindly deleted: the redistributed-font license record in `docs/license-compliance-inventory.md` (the font file itself still ships with its own OFL terms if bundled) and the `docs/brand-agent-farm.md` note (which documents the supersession). Everything else naming Space Grotesk as *the wordmark typeface* should now read Manrope.
3. Once the two stale sources are updated, the drift is retired: all three brand references agree on Manrope.

## Related

- `docs/brand-agent-farm.md` — the standing convention this workflow enforces.
- `docs/adding-a-dependency-compliance-paths.md` — why a bundled font file keeps its own license independent of which typeface the wordmark uses.
