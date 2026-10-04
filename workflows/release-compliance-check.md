---
name: release-compliance-check
description: 'Verify all license/attribution obligations, then run the desktop build and package steps for a ship-ready release'
phases:
  - title: 'Compliance gate'
  - title: 'Build and package'
---

# Pre-release license & packaging check

The project ships AGPL-3.0-or-later and bundles vendored GPL code plus redistributed fonts. `docs/license-compliance-inventory.md` is the single place to check before packaging a release — this workflow turns that inventory into a gate in front of `zig build package`.

## Phase 1: Compliance gate

Walk `docs/license-compliance-inventory.md` and confirm each obligation before building:

1. **Whole-project license** — no dependency added under a GPL-incompatible license since the last release.
2. **Vendored code** — every vendored directory still has its `VENDORED-NOTICE.md` present and accurate, upstream copyright headers intact, and its modification ledger current (GPL requires recipients can identify what changed).
3. **Redistributed fonts and artwork** — directly bundled fonts retain their
   license files, Fontsource output and project assets match `ASSETS.json`, and
   `THIRD_PARTY_NOTICES.md` is current. Public release additionally requires
   every project artwork ownership entry to be resolved.
4. If any obligation fails, fix it and re-run this phase. Do not proceed to packaging with a compliance gap.

## Phase 2: Build and package

From the desktop app (Vercel Native — Zig shell + React UI):

```bash
npm install --prefix frontend   # install frontend deps
zig build test                  # tests must pass
zig build run                   # production build sanity check
zig build package               # produce the shippable artifact
node ../scripts/release-check.mjs
```

If the Native SDK is not in the default sibling repository
`../../zero-native` from the desktop directory,
override the SDK path:

```bash
zig build run -Dnative-sdk-path=/path/to/native
```

Only the artifact from Phase 2, gated by a green Phase 1, is ship-ready.
Before a public tag, the sanitized snapshot must also pass
`node scripts/release-check.mjs --publication v<version>` from the repository
root.
