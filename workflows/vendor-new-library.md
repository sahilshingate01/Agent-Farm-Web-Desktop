---
name: vendor-new-library
description: 'Vet a third-party library for GPL compatibility, vendor it, and stand up its attribution notice and modification ledger'
phases:
  - title: 'License vetting'
  - title: 'Vendor and attribute'
  - title: 'Establish the ledger'
---

# Vendor a new third-party library

The desktop app ships **AGPL-3.0-or-later**. Anything vendored must be license-compatible and carry attribution. This workflow sets up a new vendoring correctly on day one, so later maintenance and upgrades (see `docs/maintaining-vendored-ok-editor.md`, `workflows/upgrade-ok-vendored-editor.md`) have the records they depend on.

## Phase 1: License vetting

1. Identify the upstream license. Because the project is AGPL-3.0-or-later, you may vendor any **AGPL-compatible** dependency, but you **must not** add one under an incompatible license (proprietary, or AGPL-incompatible copyleft).
2. If incompatible, stop — do not vendor. Find an alternative or isolate it behind a process boundary.
3. Record the decision in `docs/license-compliance-inventory.md`: upstream URL, copyright holder, license, and vendored date.

## Phase 2: Vendor and attribute

1. Copy the needed source into a dedicated directory (e.g. `desktop/frontend/src/<lib>/`). Prefer copying only the packages you actually use.
2. **Preserve upstream copyright headers** in every vendored file — GPL requires recipients can identify origin.
3. Create a `VENDORED-NOTICE.md` in that directory recording: copyright, license, upstream URL, exact packages/paths vendored, and vendored date. This file must remain in-tree — it is the required attribution + modification record.
4. If the library redistributes assets (fonts, icons) under separate licenses, add each asset's license file alongside it and log its obligation in the compliance inventory (a font under SIL OFL 1.1, for example, keeps its own license and reserved-name rules independent of the app's GPL).

## Phase 3: Establish the modification ledger

1. Start the modification ledger in `VENDORED-NOTICE.md` (and cross-reference `docs/vendored-code-modification-ledger.md`). Use the standard categories:
   - `REMOVED: <feature> from <file> | reason: <why>`
   - `REPLACED: <original> with <replacement> in <file> | reason: <why>`
   - `PATCHED: <location> | reason: <why> | change: <one-liner>`
2. Mark the core/verbatim portions that must **not** be patched (upstream-or-wrap only) versus the app-scoped chrome that is expected to diverge.
3. Log every intentional change from the first commit onward, so future upgrades don't silently revert them.
