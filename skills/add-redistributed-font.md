---
name: add-redistributed-font
description: Bundle a font or icon asset under desktop/frontend/public/fonts/ (or elsewhere) so it carries its own in-tree license and clears the release gate — for when you add or move a redistributed asset, not vendored source code
---

# Add a redistributed font or asset

The desktop app ships **AGPL-3.0-or-later**, but a redistributed font or icon carries its **own** license and attribution obligations, independent of the app's AGPL (`docs/adding-a-dependency-compliance-paths.md`). Of the three compliance paths (`docs/adding-a-dependency-compliance-paths.md`), the *redistributed asset* path has a convention but no step-by-step — this skill is it. Use it when you add, move, or update anything under `desktop/frontend/public/fonts/` (or otherwise bundle an asset).

For copying third-party *source* into the tree, use `workflows/vendor-new-library.md` instead — that path has extra duties (copyright headers, modification ledger) this one does not.

## Step 1: Clear the GPL gate first

Even an asset passes the compatibility gate before anything else (`docs/adding-a-dependency-compliance-paths.md`). A font under SIL OFL 1.1 (e.g. Geist) is fine; confirm the specific asset's license is GPL-compatible before bundling.

## Step 2: Ship the license file alongside the asset, in-tree

- Place the asset's own license file next to it — e.g. `Geist-LICENSE.txt` (SIL OFL 1.1) beside the font. This file **must remain in-tree**; removing or orphaning it breaks the redistribution obligation.
- Do not rely on the app's GPL to cover it — a document or app built *with* a font isn't bound by the font license, but the font file you redistribute still is.

## Step 3: Honor the asset license's own rules

For **SIL OFL** fonts specifically:

- **Do not sell the font on its own.**
- **Do not use a reserved font name on a modified version.**

Other asset licenses may impose their own terms — read and honor them.

## Step 4: Record it in the inventory

Log the asset, where it is used, its license, and its obligation in `docs/license-compliance-inventory.md` — the single record checked before a release. (See the `record-compliance-inventory-entry` skill for the field template.)

## Step 5: Confirm the release gate will pass

`workflows/release-compliance-check.md` Phase 1 **fails the build** if any redistributed font in `desktop/frontend/public/fonts/` is missing its license file, is sold on its own, or uses a reserved name on a modified copy. Verify:

- The license file is present alongside every asset you touched.
- No reserved-name / no-sell violation was introduced.
- The inventory row exists.

Never package past a compliance gap.
