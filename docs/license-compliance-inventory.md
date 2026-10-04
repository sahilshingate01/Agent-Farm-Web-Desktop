---
title: Desktop app third-party license & attribution compliance
description: Inventory of every vendored library and redistributed font in the desktop app, its license, and the obligations that must be honored on ship.
status: reference
---

# Third-party license & attribution compliance

The project and desktop app ship under AGPL-3.0-or-later. Everything they bundle must be license-compatible, and every redistributed asset carries attribution/notice obligations. This is the single place to check before packaging a release.

## Whole-project license

- **Agensis Farm / claude-farm**: AGPL-3.0-or-later (see the root `LICENSE`).
- GPL-3.0-or-later code may be included in this AGPL-3.0-or-later work under AGPL section 13. Every other dependency must also be AGPL-compatible; incompatible code must not be linked or vendored.

## Vendored code

### Open Knowledge editor (`desktop/frontend/src/editor-ok/`)

| Field | Value |
|---|---|
| Upstream | https://github.com/inkeep/open-knowledge |
| Copyright | © Inkeep contributors |
| License | GPL-3.0-or-later (compatible with the project under AGPL section 13) |
| Vendored | 2026-07-11 |
| Notice file | `desktop/frontend/src/editor-ok/VENDORED-NOTICE.md` (must remain in-tree) |

**Obligations:**
- Keep `VENDORED-NOTICE.md` present and accurate — it is the required attribution + modification record.
- Preserve upstream copyright headers in vendored files.
- Local modifications must be logged (see `docs/maintaining-vendored-ok-editor.md` and the modification ledger). GPL requires that recipients can identify what was changed.

## Native desktop SDK

The Zig shell links the Vercel Native SDK under Apache-2.0. Clean CI and
release builds fetch the pinned commit recorded in the root GitHub workflows;
`THIRD_PARTY_NOTICES.md` must retain that attribution.

## npm dependency licenses

`scripts/release-check.mjs` checks both npm lockfiles against the reviewed
AGPL-compatible license set. A package whose lock metadata omits a license must
have version-specific evidence in `DEPENDENCY_LICENSE_OVERRIDES.json`; unknown
or unreviewed licenses block the release.

## Redistributed fonts (`desktop/frontend/public/fonts/`)

Font files are redistributed with the app and each carries its own license and
attribution requirement, separate from the app's AGPL license (a document/app
created with a font is not itself bound by the font license).

| Font | Where used | License | Obligation |
|---|---|---|---|
| Geist | Bundled in `public/fonts/` | SIL Open Font License 1.1 (`Geist-LICENSE.txt`) | Keep the license file alongside the font; do not sell the font by itself; do not use reserved font names on modified versions. |
| Fontsource families | Generated frontend assets, including Space Grotesk and Inter | SIL OFL 1.1 | Keep `THIRD_PARTY_NOTICES.md` and the per-file provenance in `ASSETS.json`. |

Any font copied directly into `public/fonts/` must carry its license file,
exactly as Geist does. Generated Fontsource assets are inventoried by hash in
`ASSETS.json` and covered by `THIRD_PARTY_NOTICES.md`.

## Pre-ship checklist

1. `VENDORED-NOTICE.md` is present and its modification list matches reality.
2. Every directly bundled font under `public/fonts/` has a co-located license,
   and generated Fontsource assets match `ASSETS.json`.
3. No newly added dependency is under a GPL-incompatible license.
4. Upstream copyright headers are intact in vendored files.
5. The modification ledger for vendored code is up to date (guides safe upgrades and satisfies GPL change-disclosure).
6. `node scripts/release-check.mjs` passes; public releases additionally
   require `node scripts/release-check.mjs --publication v<version>`.
