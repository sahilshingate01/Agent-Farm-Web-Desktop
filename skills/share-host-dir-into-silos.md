---
name: share-host-dir-into-silos
description: Expose an additional host folder to every local account silo by registering it with `farm add-host-dir`, which injects it as a virtiofs mount into each container — for sharing a dataset, credentials-free asset directory, or scratch space beyond the standard shared work dir.
---

# Share an extra host folder into every local silo

Every local account silo already mounts `~/.usage-farm/work` at an identical absolute path (`docs/distributed-silos.md`). When you need to share **another** host directory into all local silos — a dataset, a read-only asset tree, extra scratch space — register it through the farm rather than editing container configs by hand.

## How it works

The farm keeps a registry of extra shared folders at:

```
~/.usage-farm/host-dirs
```

One **TSV record per line**, tab-separated (`docs/farm-filesystem-paths.md`):

```
<host-path>\t<target-path>\t<rw|ro>
```

These records are injected as virtiofs `-v` mounts into every **local** container by `start_one`. The file is host-local and machine-specific — its paths are never committed.

## Add a folder

```sh
farm add-host-dir <host-path> <target-path> <rw|ro>
```

- `<host-path>` — the directory on the Mac host to share.
- `<target-path>` — where it appears inside each silo VM.
- `rw` / `ro` — writable or read-only inside the silo. Prefer `ro` unless silos must write back.

## Remove a folder

```sh
farm rm-host-dir <host-path>
```

## Notes

- This affects **local** Apple-container silos only — not remote Agensis machines or managed E2B/Daytona sandboxes.
- Because the registry stores host-local paths, it does **not** survive a relocation unchanged; re-check it as part of post-move recovery (`docs/post-move-recovery-checklist.md`).
- Never use this to plumb provider credentials into silos — credentials are per-environment and authorized inside the VM via `farm equip` (`docs/provider-credential-isolation.md`).