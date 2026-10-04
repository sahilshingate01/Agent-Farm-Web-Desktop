# Publication readiness

## Decision

Do not rewrite the private development repository in place. The remote is
private, has no published tags, and the current reachable history contains
development records and source-associated terminology that should not become
public. No credential-shaped secrets were found in the reachable commits by
the current scan, but that does not make the history suitable for publication.

Evidence checked on 2026-07-30:

- GitHub reports `sahilshingate01/Agent-Farm-Web-Desktop` as private.
- The remote exposes one branch (`dev`) and no tags; local `main` has not been
  published.
- The repository has 53 reachable commits.
- A history-wide pattern scan found no Anthropic-key, GitHub-token, AWS-key, or
  private-key-block shapes, but did find 76 personal absolute-path
  occurrences. This was a focused engineering scan, not a substitute for the
  final secret scanner.
- The private development history contains local state, harvested drafts, and
  source-associated terminology that are deliberately absent from the public
  snapshot.

When publication is authorized, create a fresh sanitized orphan-root history
from a verified working tree, scan every resulting blob and commit message,
and publish only that branch and new release tags. Do not push old branches or
tags.

## Completed publication foundations

- Project license is AGPL-3.0-or-later across the root, desktop, and daemon.
- Network API health/OpenAPI responses prominently offer Corresponding Source
  at `https://github.com/sahilshingate01/Agent-Farm-Web-Desktop`. That repository
  must contain the sanitized source snapshot and be public before any
  network-accessible build is published.
- Contributor, security, third-party notice, and asset-provenance files exist.
- The project owner, Sahil Shingate, confirmed ownership of the project artwork
  recorded in `ASSETS.json` on 2026-07-30 and released it with the project
  under AGPL-3.0-or-later. Third-party fonts retain their OFL-1.1 terms.
- Release readiness rejects version/license drift, external `file:`
  dependencies, personal Vite paths, and stale asset hashes. Its
  `--publication` mode additionally blocks unresolved artwork ownership and
  private development surfaces, personal absolute paths, and the prohibited
  source-product identities named by the open-source plan.
- CI runs frontend, daemon, Zig logic, dependency-audit, and release-readiness
  checks from a clean checkout.
- Tag releases produce signed, notarized, checksummed macOS artifacts.
- Direct-provider credentials can live in an owner-only file outside the
  repository.

## Publication gate

Publication validation must run against a clean Git tree so it certifies one
exact commit rather than a mixture of index, working-tree, and untracked
content:

```sh
node scripts/release-check.mjs --publication v0.1.0
```

Development-only ledgers, suggested artifacts, scratch plans, and local agent
configuration are absent from the candidate tree; they remain available in
the private working copy. Source-associated visual-TODO names were replaced
with project-owned terminology. The gate rejects a dirty tree, checks the
complete private-path denylist, scans source bytes for personal paths and
prohibited identities, verifies internal Markdown links, and uses anti-vacuity
checks to prove the desktop and daemon source were enumerated.

Before making the repository public, create the orphan-root/squashed history
described above from this verified tree, run the final dedicated secret scanner
over every resulting blob and commit message, and repeat the clean-checkout
build and package inspection on that public root.

This is an engineering provenance and redistribution audit, not a guarantee of
legal clearance.
