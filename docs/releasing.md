# Release management

Releases are tag-driven and fail closed.

## Versioning

The version in these three files must match:

- `desktop/app.zon`
- `desktop/frontend/package.json`
- `daemon/package.json`

Run `node scripts/release-check.mjs` during normal development. Before tagging,
run the stricter public-source gate:

```sh
node scripts/release-check.mjs --publication v0.1.0
```

The publication mode rejects unresolved artwork ownership and private
development surfaces such as `.agensis/` and `suggested/`. The GitHub release
workflow uses this stricter mode and also requires the tag to be exactly
`v<version>`.

Both modes also validate every npm lockfile license against the reviewed
compatible set. Packages whose lock metadata omits a license need explicit
evidence in `DEPENDENCY_LICENSE_OVERRIDES.json`; unknown licenses fail the
check.

The release environment also runs `scripts/verify-release-artifact.mjs` against
the exact packaged `.app`. It requires the AGPL text, third-party notices, the
Native SDK Apache-2.0 text, OFL-1.1, and the generated npm dependency license
bundle inside the package. Every packaged image/font must match a reviewed
`ASSETS.json` content hash.

## Required GitHub secrets

The macOS release job requires:

- `MACOS_CERTIFICATE_P12_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `MACOS_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

The protected GitHub `release` environment must also define the
`RELEASE_GPG_PUBLIC_KEY` variable. The workflow imports it and runs
`git verify-tag`; `gh release create --verify-tag` alone only proves that the
tag exists.

The workflow imports the Developer ID certificate into an ephemeral keychain,
packages the app, applies hardened-runtime signing, notarizes and staples it,
creates a zip and `SHA256SUMS`, then attaches both to a GitHub release.
Every action is pinned to a reviewed commit SHA; update those pins explicitly,
never by changing them back to mutable major tags.

For a public AGPL release, the tag must live in the sanitized public repository
so GitHub's source archives are the complete corresponding source for the
attached binary. Never attach a binary built from the private development
history to a different public-source tag.

## Publish

After the public-source gate passes on the sanitized public snapshot and a
clean local package:

```sh
git tag -s v0.1.0 -m "Agensis Farm 0.1.0"
git push origin v0.1.0
```

Do not publish the existing private development history. The publication
decision and remaining cleanup are recorded in
`docs/publication-readiness.md`.
