# Contributing

Agensis Farm is licensed under AGPL-3.0-or-later. By submitting a contribution,
you agree that it may be distributed under that license.

## Development checks

Run the checks that cover the area you changed:

```sh
cd desktop/frontend
npm ci
npm run typecheck
npm test
npm run build

cd ../../daemon
npm ci
npm run check
npm test

cd ../desktop
zig build test -Dplatform=null -Dnative-sdk-path=/path/to/native-sdk
```

Before release-related changes, also run:

```sh
node scripts/generate-assets-manifest.mjs
node scripts/release-check.mjs
git diff --check
```

Do not commit credentials, state files, personal absolute paths, or generated
runtime data. New vendored code and binary assets must be recorded in
`docs/license-compliance-inventory.md`, `THIRD_PARTY_NOTICES.md`, and
`ASSETS.json` as applicable.

## Pull requests

Keep changes focused, explain the user-visible outcome, and include the exact
verification performed. Preserve required third-party copyright and license
notices.
