# Third-party notices

Agensis Farm is distributed under AGPL-3.0-or-later. The full project license
is in `LICENSE`.

This file summarizes source and assets redistributed with the application.
Dependency-specific license metadata remains in the npm lockfiles; exact
binary-asset hashes and provenance are in `ASSETS.json`.
Release packages also contain `legal/NPM-DEPENDENCY-LICENSES.txt`, generated
from the exact installed frontend tree, with a package index and the
license/notice texts present in each npm tarball.

## Open Knowledge editor

`desktop/frontend/src/editor-ok/` contains code from Inkeep's Open Knowledge
project, copyright Inkeep contributors, licensed GPL-3.0-or-later. The exact
source paths, vendoring date, and local modification ledger are recorded in
`desktop/frontend/src/editor-ok/VENDORED-NOTICE.md`. It is combined with this
AGPL work under AGPL section 13.

## Three.js r128

`desktop/frontend/public/three-r128.min.js` is copyright 2010-2021 Three.js
Authors and licensed MIT. Its upstream license header is preserved in the
file.

## Vercel Native SDK

The desktop shell is built against the Vercel Native SDK, copyright its
contributors and licensed Apache-2.0. CI and release builds pin the SDK source
commit; the project license is available at
<https://github.com/vercel-labs/native/blob/main/LICENSE>.
The exact pinned SDK license is copied into release packages as
`legal/Native-SDK-Apache-2.0.txt`.

## Fonts

The application redistributes typefaces supplied through Fontsource packages,
including DM Sans, Geist, IBM Plex Mono, Inter, JetBrains Mono, Manrope, Plus
Jakarta Sans, Space Grotesk, Space Mono, and Work Sans. These font files are
licensed under SIL Open Font License 1.1. The directly bundled Geist Mono copy
ships with `desktop/frontend/public/fonts/Geist-LICENSE.txt`.
Release packages co-locate that text as `legal/OFL-1.1.txt`.

## Project artwork and screenshots

Project icons, diagrams, and screenshots are listed individually in
`ASSETS.json`. Project owner Sahil Shingate confirmed authorship and ownership on
2026-07-30 and releases them with this project under AGPL-3.0-or-later.
Third-party font and vendored-code terms remain independent as described above.
