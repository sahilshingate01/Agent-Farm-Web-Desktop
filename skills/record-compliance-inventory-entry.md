---
name: record-compliance-inventory-entry
description: Add or update a row in docs/license-compliance-inventory.md for any addition (npm package, vendored source, or redistributed asset) with the exact fields the release gate checks — do this at the moment you clear the GPL gate, not later
---

# Record an addition in the license-compliance inventory

`docs/license-compliance-inventory.md` is the **single record checked before a release** (`workflows/release-compliance-check.md`, Phase 1). Every convention that governs adding third-party material ends with the same instruction — *record it in the inventory* — because the release build fails if an obligation is undocumented. This skill is that recurring step, done once and correctly.

Run it the moment you clear the GPL-compatibility gate (`docs/adding-a-dependency-compliance-paths.md`), **before** you build on top of the addition. The gate decision is recorded here *whether or not* you end up adding the code (`docs/adding-a-dependency-compliance-paths.md`, Step 0).

## Step 1: Classify what you added

The required fields differ by kind (`docs/adding-a-dependency-compliance-paths.md`):

- **npm package** (linked, not copied) — inventory row only; no in-tree notice.
- **Vendored source** (copied into `desktop/frontend/src/<lib>/`) — inventory row **plus** the `VENDORED-NOTICE.md` + modification-ledger duties (`docs/vendored-code-modification-ledger.md`).
- **Redistributed asset** (font/icon under `desktop/frontend/public/fonts/` etc.) — inventory row **plus** the alongside-license-file duty (`docs/adding-a-dependency-compliance-paths.md`).

## Step 2: Write the row

Capture, at minimum:

- **Upstream URL**
- **Copyright holder**
- **License** (SPDX id where possible)
- **Date** added / decided
- **What & where** — exact package name, or vendored paths, or asset file(s) and where each is used
- **Obligation** — the attribution/notice duty that now applies (e.g. `VENDORED-NOTICE.md` present, `Geist-LICENSE.txt` shipped alongside, SIL OFL reserved-name rule), or `none beyond record` for a plain npm dependency
- **Decision** — added / isolated behind a process boundary / rejected (record even a rejection)

## Step 3: Cross-check the release gate will pass

From the addition's perspective, confirm the thing the gate will look for actually exists:

- Vendored source → its directory has a `VENDORED-NOTICE.md` with headers preserved and a started ledger.
- Redistributed font → its own license file sits next to it in-tree; no reserved font name on a modified copy; not sold on its own.
- npm package → the inventory row is the whole obligation.

If any of these is missing, fix it now — `workflows/release-compliance-check.md` Phase 1 will otherwise fail the build specifically to catch the gap.

## Notes

- The inventory is a *record*, not the gate itself: it is where the pre-release walk gets its checklist. A missing row means the gate can't verify an obligation it doesn't know about.
- Full new-vendoring procedure: `workflows/vendor-new-library.md`. Which path applies to your addition: `docs/adding-a-dependency-compliance-paths.md`.
