---
title: Adding a third-party dependency — which compliance path applies
description: One decision guide that routes any new addition (npm package, vendored source, or redistributed asset) to the correct AGPL gate and attribution duties, so no obligation is missed before the release compliance gate.
status: reference
---

# Adding a third-party dependency — which compliance path applies

The desktop app ships **AGPL-3.0-or-later**. Every addition must first clear the same **AGPL-compatibility gate**, and then pick up a *different* set of attribution duties depending on **what kind of thing** you added. Those duties live in three separate conventions today; this doc is the single router that sends you to the right one, so nothing slips past the release gate (`workflows/release-compliance-check.md`).

## Step 0 — the gate applies to everything (always first)

Before anything else, decide license compatibility — this precedes attribution:

- **AGPL-compatible?** You may add it.
- **Incompatible** (proprietary or AGPL-incompatible)? **Stop.** Find a compatible alternative, or **isolate it behind a process boundary** (separate process over IPC) so it is never linked into the AGPL work. Never link an incompatible dependency in.
- **Record the decision in `docs/license-compliance-inventory.md`** — upstream URL, copyright holder, license, date — *whether or not* you end up vendoring it. That inventory is the single place checked before a release.

## Step 1 — classify the addition, then follow that column

| You are adding… | Example | After the gate, you must… | Convention |
|---|---|---|---|
| **An npm package** (linked, not copied into the tree) | a normal `npm install` dependency | Nothing beyond the inventory record from Step 0 — no in-tree notice is needed because the source is not vendored. | Step 0 above |
| **Vendored source** (copied into `desktop/frontend/src/<lib>/`) | the Open Knowledge editor (`editor-ok/`) | Preserve upstream copyright headers, ship a `VENDORED-NOTICE.md` in the vendored dir, and start the **modification ledger**. | `docs/vendored-code-modification-ledger.md`, `workflows/vendor-new-library.md` |
| **A redistributed asset** (font/icon under `desktop/frontend/public/fonts/`) | Geist (SIL OFL 1.1) | Ship the asset's own license file alongside it in-tree, honor OFL rules (no selling alone, no reserved-name-on-modified), and log the obligation in the inventory. | This document |

A single addition can hit **more than one** column — e.g. a vendored library that also bundles a font pulls in *both* the vendored-source and redistributed-asset duties.

## Step 2 — the release gate will check exactly this

`workflows/release-compliance-check.md` Phase 1 walks `docs/license-compliance-inventory.md` and fails the build if: a dependency was added under an incompatible license, a vendored dir is missing its `VENDORED-NOTICE.md` / copyright headers / current ledger, or a redistributed font is missing its license file. Doing the right column up front is cheaper than discovering the gap at the gate.

## Related

- `docs/license-compliance-inventory.md` — the single record every path writes to.
- `docs/maintaining-vendored-ok-editor.md` — how the vendored-source path is maintained over time.
