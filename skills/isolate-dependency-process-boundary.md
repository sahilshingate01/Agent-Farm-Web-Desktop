---
name: isolate-dependency-process-boundary
description: Use an AGPL-incompatible-but-needed dependency by running it in a separate process the app talks to over IPC, so it is never linked into the AGPL-3.0-or-later desktop work — the "isolate it behind a process boundary" path that the compat gate, the compliance-paths router, and the vendoring convention all name but none spell out
---

# Isolate a GPL-incompatible dependency behind a process boundary

The desktop app ships **AGPL-3.0-or-later**. The AGPL-compatibility gate (`docs/adding-a-dependency-compliance-paths.md`) gives exactly two moves when a dependency is **incompatible** (proprietary, or AGPL-incompatible copyleft): find a compatible alternative, **or isolate it behind a process boundary** so it is never *linked into* the AGPL work. The same escape hatch is restated in `docs/adding-a-dependency-compliance-paths.md` (Step 0) and `docs/vendored-code-modification-ledger.md`, and the inventory's own **Decision** field lists `isolated behind a process boundary` as a first-class outcome (`skills/record-compliance-inventory-entry.md`). Yet no artifact says *how*. This skill is that procedure.

Use it only after the gate has ruled the dependency **incompatible** but you still need its capability. If a GPL-compatible alternative exists, prefer it and stop here.

## Step 1: Confirm you are actually on the isolation path

- Re-run the gate (`docs/adding-a-dependency-compliance-paths.md`). Isolation is **only** for a dependency you may not link. If it is GPL-compatible, you do not need a process boundary — add it normally (npm-package or vendored path).
- "Isolate" means: the incompatible code runs as its **own process**, and the GPL app communicates with it over an arms-length boundary (IPC, a local socket, stdio, or an HTTP/RPC call). The GPL app must not `import`/link/statically bundle the incompatible code into its own binary.

## Step 2: Build the boundary, not a shim

- Run the incompatible dependency in a **separate process** — a sidecar the app spawns, or a service it connects to. The desktop bridge already has precedent for shelling out to a separate process (the farm CLI, `docs/desktop-native-bridge-discovery.md`); model the boundary on that arms-length pattern, not on an in-tree call.
- Cross the boundary with **data only** (a defined request/response protocol over IPC/stdio/socket). Do not pass code, callbacks, or linked objects across it.
- Do **not** vendor the incompatible source into `desktop/frontend/src/<lib>/`. Vendoring copies it *into* the GPL tree and defeats the isolation — that path (`docs/vendored-code-modification-ledger.md`) is for GPL-**compatible** source only.

## Step 3: Record the decision in the inventory

Even though nothing is linked in, **every** dependency decision is recorded — the inventory is the single pre-release record (`docs/license-compliance-inventory-reference.md`). Add a row in `docs/license-compliance-inventory.md` (`skills/record-compliance-inventory-entry.md`) capturing:

- **Upstream URL**, **copyright holder**, **license** (SPDX id), **date**.
- **What & where** — the dependency and the process/service it runs in.
- **Obligation** — how the boundary is enforced (e.g. "runs as a sidecar process; app communicates over local socket; not linked").
- **Decision** — `isolated behind a process boundary`.

Record this **whether or not** you proceed, exactly as the gate requires — the decision belongs in the inventory even if you later back out.

## Step 4: Verify the boundary holds before the release gate

The release build fails on any un-recorded or mis-classified obligation (`workflows/release-compliance-check.md`, Phase 1). Before you build on top of the isolation:

- Confirm the incompatible package appears in **no** dependency graph that gets linked/bundled into the GPL binary (it should not be an `import` target of app source).
- Confirm it is spawned/reached only across the process boundary.
- Confirm the inventory row exists with Decision = `isolated behind a process boundary`.

If you cannot keep it out of the linked binary, you are not isolating it — you are linking an incompatible dependency, which makes the combination undistributable. In that case, stop and find a compatible alternative.
