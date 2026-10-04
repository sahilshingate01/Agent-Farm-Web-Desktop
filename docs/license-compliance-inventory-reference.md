---
title: The license-compliance inventory — the single pre-release record
description: What docs/license-compliance-inventory.md is, what each kind of addition must record in it, and why it is the one file walked by the release compliance gate. Read this before you edit the inventory or wonder what belongs in it.
status: reference
---

# The license-compliance inventory

The desktop app ships **AGPL-3.0-or-later**. Five different conventions and workflows all point at **one** file, `docs/license-compliance-inventory.md`, and call it "the single place checked before a release." This doc explains what that file is, what every addition must write into it, and how the release gate uses it — so the references stop being scattered and nothing reaches the gate un-recorded.

## What it is

A living, in-tree ledger of every third-party thing the app depends on or redistributes — npm packages, vendored source, and redistributed assets (fonts/icons). It is **not** the license text itself and **not** the per-directory `VENDORED-NOTICE.md`; it is the *index* that lets a release reviewer check every obligation from one place.

**Every addition writes a record here, whether or not source is copied into the tree** — including a plain `npm install` that ships no in-tree notice. If it's a dependency, it's in the inventory.

## What each record must carry

The fields depend on *what kind of thing* you added (the classification lives in `docs/adding-a-dependency-compliance-paths.md`):

| Kind | Record must include | Also produces (outside the inventory) |
|---|---|---|
| **npm package** (linked, not copied) | upstream URL, copyright holder, license, date, and the AGPL-compatibility decision | nothing else — no in-tree notice, since source isn't vendored |
| **Vendored source** (copied into `desktop/frontend/src/<lib>/`) | same four fields + exact packages/paths vendored + vendored date | a `VENDORED-NOTICE.md` in the vendored dir + preserved copyright headers + the modification ledger (`docs/vendored-code-modification-ledger.md`) |
| **Redistributed asset** (font/icon under `desktop/frontend/public/fonts/` etc.) | the asset, where it's used, its license, and its specific obligation (e.g. SIL OFL 1.1: no selling alone, no reserved name on a modified version) | the asset's own license file shipped alongside it, in-tree (`docs/adding-a-dependency-compliance-paths.md`) |

In all three cases the **AGPL-compatibility gate is decided and recorded first** (`docs/adding-a-dependency-compliance-paths.md`): a compatible dependency may be added; an incompatible one must be replaced or **isolated behind a process boundary** and never linked in. The inventory records that decision even when you *don't* end up vendoring.

## Why it's the single source of truth at release

`workflows/release-compliance-check.md` Phase 1 does not re-derive obligations from scratch — it **walks this inventory** and confirms, per entry:

1. No dependency added under a GPL-incompatible license since the last release.
2. Every vendored directory still has an accurate `VENDORED-NOTICE.md`, intact upstream copyright headers, and a current modification ledger.
3. Every redistributed font still ships its own license file alongside it.

The build **fails** on any gap. That is deliberate: the inventory is the checklist, so an addition that skipped its inventory record is invisible to the gate — which is exactly the failure mode this file exists to prevent. Keep the inventory current *at the moment you add the dependency*, not at release time.

## Related

- Which path applies to your addition: `docs/adding-a-dependency-compliance-paths.md`
- The GPL gate that precedes any record: `docs/adding-a-dependency-compliance-paths.md`
- Vendoring a new library end-to-end: `workflows/vendor-new-library.md`
- The release gate that walks this file: `workflows/release-compliance-check.md`
