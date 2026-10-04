---
name: swap-brand-wordmark-font-bundle
description: 'Carry the wordmark font change (Space Grotesk → Manrope, Sahil Shingate 2026-07-11) through the redistributed-font bundle and docs/license-compliance-inventory.md — the compliance half of the brand-font swap that the doc-reconciliation workflow does not cover'
phases:
  - title: 'Bundle the new font with its license'
  - title: 'Update the compliance inventory'
  - title: 'Retire or annotate the old font'
  - title: 'Verify against the release gate'
---

# Swap the bundled brand wordmark font

The brand spec now names **Manrope** for the wordmark (`docs/brand-agent-farm.md`: "Manrope — chosen over Space Grotesk (Sahil Shingate, 2026-07-11)"). `workflows/reconcile-wordmark-font-drift.md` retires the drift in the *brand documents and render skill*, but the compliance surface is separate and still points at the old font: `docs/license-compliance-inventory.md` lists **Space Grotesk** in the redistributed-fonts table as "Brand wordmark (`Agent` / `Farm`)". A brand typography change is also a redistribution change — the app must now bundle the new font, ship its license, and record it, or the release gate (`workflows/release-compliance-check.md`, Phase 1) is checking obligations for a font the brand no longer uses while the font it *does* use goes unrecorded.

## Phase 1: Bundle the new font with its license

Follow `skills/add-redistributed-font.md` for Manrope:

1. **Clear the GPL gate.** Manrope is published under the SIL Open Font License 1.1 — GPL-compatible, same class as Geist. Confirm against the actual license file you download.
2. Place the font files under `desktop/frontend/public/fonts/` with the license file alongside (e.g. `Manrope-LICENSE.txt`). The license file must remain in-tree.
3. Honor the OFL rules: do not sell the font on its own; do not use a reserved font name on a modified version.

## Phase 2: Update the compliance inventory

Add a Manrope row to the redistributed-fonts table in `docs/license-compliance-inventory.md` per `skills/record-compliance-inventory-entry.md`:

- Font: Manrope; Where used: Brand wordmark (`Agent` / `Farm`) — see `docs/brand-agent-farm.md`
- License: SIL Open Font License 1.1 (`Manrope-LICENSE.txt`)
- Obligation: license file ships alongside the font; OFL no-standalone-sale and reserved-name rules.

## Phase 3: Retire or annotate the old font

Decide what happens to the Space Grotesk entry and files:

1. **If Space Grotesk is no longer bundled anywhere**, remove its font files from `public/fonts/` and its inventory row in the same change — an inventory row for a font you no longer redistribute misstates the shipped artifact.
2. **If it remains bundled** (e.g. still referenced by an unmigrated surface), keep the files, keep the license file, and annotate the row's "Where used" to note the wordmark usage is superseded by Manrope — the redistribution obligation follows the *bundled file*, not the brand decision.
3. Either way, do not delete the license file while the font files still ship — that breaks the redistribution obligation (`docs/adding-a-dependency-compliance-paths.md`).

## Phase 4: Verify against the release gate

1. Confirm every font currently in `desktop/frontend/public/fonts/` has a matching inventory row and an alongside license file, and every inventory row has matching files on disk.
2. Run the compliance gate walk from `workflows/release-compliance-check.md` Phase 1 before the next `zig build package`.
