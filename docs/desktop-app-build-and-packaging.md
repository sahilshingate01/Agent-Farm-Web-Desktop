---
title: Desktop app build & packaging commands
description: The zig build / npm commands that test, run, and package the desktop companion app, plus the Native SDK path override — the one place to look up how to build the app.
status: reference
---

# Desktop app build & packaging commands

The desktop companion is a **Vercel Native** app: a **Zig shell + React UI**. Its build commands are the same whether you are producing a release (`workflows/release-compliance-check.md`, Phase 2) or just bringing the app up after a move (`skills/fix-desktop-bridge-discovery.md`). They are collected here so you don't have to reconstruct them from either.

All commands run from the desktop app directory.

## Standard build cycle

```bash
npm install --prefix frontend   # install the React frontend deps
zig build test                  # unit/integration tests — must pass
zig build run                   # production build sanity check / bring the app up
zig build package               # produce the shippable artifact
```

- `zig build test` gates everything — do not `run` or `package` on red tests.
- Only the `zig build package` artifact, gated by a green compliance check (`docs/license-compliance-inventory.md`), is ship-ready (`workflows/release-compliance-check.md`).

## Full production build — one command

```bash
./build-release.sh          # from the desktop app directory
```

`build-release.sh` quits any running app instance, runs `zig build package -Doptimize=ReleaseFast`, verifies the code signature, warns about stale same-id bundles, and opens the result. `--no-open` skips the launch, `--optimize ReleaseSafe` picks a different mode, and unrecognized flags are forwarded to `zig build` (so `-Dnative-sdk-path=…` works after a move).

For distribution, the same script can replace the local ad-hoc signature with
a hardened-runtime Developer ID signature, notarize and staple the bundle, and
write a checksummed archive:

```bash
./build-release.sh --no-open \
  --sign-identity "Developer ID Application: Example (TEAMID)" \
  --notary-profile agensis-release \
  --archive-dir ../artifacts
```

The root `.github/workflows/release.yml` runs this path for `v*` tags after
validating version/license metadata and running all release gates. Required
secrets and the tag procedure are in `docs/releasing.md`.

What the underlying `zig build package -Doptimize=ReleaseFast` step does, in order: `npm install --prefix frontend`, a production Vite build into `frontend/dist`, a ReleaseFast compile of the Zig shell, `native package --target macos --manifest app.zon --assets frontend/dist`, then an **ad-hoc** codesign (`--sign -`). Output:

```
zig-out/package/usage-farm-desktop-0.1.0-macos-ReleaseFast.app
```

- The optimize mode is baked into the bundle name — a plain `zig build package` produces `…-Debug.app` beside the release one. These are separate artifacts; delete stale ones to avoid opening the wrong build.
- Ad-hoc signing runs locally but will not pass Gatekeeper on another machine.
  Distribution uses the Developer ID and notarization path above.
- `app.zon` pins `web_engine = "system"` (WebKit), so packaging needs no CEF download. A Chromium build needs `-Dweb-engine=chromium` and a CEF bundle (`-Dcef-auto-install=true`).

## Packaged app opens blank

Diagnosed 2026-07-15. If a freshly packaged app opens to an empty window, the bundle is almost never the problem — **a still-running older instance is**. Every bundle (and `zig build dev`/`run`) shares the bundle id `dev.usage-farm.desktop`; a lingering instance leaves a newly launched window's webview wedged before the frontend boots.

- Confirming the mode: the app log `~/Library/Logs/dev.usage-farm.desktop/native-sdk.jsonl` shows `webview.load` and published frames but **zero `bridge_message`/`bridge.dispatch` events** — the frontend never made a single native call. A healthy boot shows bridge traffic within a second of `app.start`.
- Fix: quit every instance (`pgrep -f '/usage-farm$'` to check; instances force-quit earlier may not have logged a clean shutdown), then relaunch. `build-release.sh` does the quit automatically.
- Rule of thumb: **⌘Q the running copy before opening a freshly packaged one.**

## Native SDK path override

For a clean checkout, install the pinned Native CLI and clone the reviewed SDK
commit beside the repository:

```bash
npm install --global @native-sdk/cli@0.6.1
git clone https://github.com/vercel-labs/native.git ../zero-native
git -C ../zero-native checkout a7509a7fa6c467eaed021250538b482886f1c6bf
```

Use Node 22.12 or newer (CI uses Node 24) and Zig 0.16.0.

`VISUAL_TODO_WIDGET_PATH` is an optional development-only path to a compatible
visual annotation widget checkout. Leave it unset for the built-in unavailable
placeholder. If it is set, the path must exist; the build fails instead of
silently dropping the requested integration.

The module must provide `loadAllAnnotations` and `saveAnnotations`. Its
component export defaults to `VisualTodo`; set `VISUAL_TODO_WIDGET_EXPORT` when
adapting an earlier or differently named widget. Vite wraps the module behind
the stable project-owned `visual-todo-widget` contract.

The project-owned development worker ships in
`desktop/frontend/public/backend/visual-todo-dev-worker.mjs`. Set
`VISUAL_TODO_WORKER_SCRIPT` only to test another compatible worker; clean
checkouts and packaged development builds require no private skill install.

The generated build resolves the Native SDK from `NATIVE_SDK_PATH`, then from
the sibling repository at `../../zero-native` from the desktop directory. If
the app or SDK checkout moves,
override the path explicitly:

```bash
zig build run -Dnative-sdk-path=/path/to/native
```

This is the same override used in the packaging path — reach for it whenever a build fails to find the SDK after a move.

## Related knobs (not build flags)

The Native bridge also shells out to the **farm CLI**, resolved independently of the build via `FARM_CLI` → `farm.sh` beside the checkout → `farm` on `PATH` (`docs/desktop-native-bridge-discovery.md`, `skills/fix-desktop-bridge-discovery.md`). If the app builds but can't reach the CLI, that is a `FARM_CLI` problem, not an SDK-path one.

## Related

- Release gate that fronts these commands: `workflows/release-compliance-check.md`.
- Bridge/SDK discovery troubleshooting: `skills/fix-desktop-bridge-discovery.md`.
- Host CLI (distinct — `farm setup/equip/route`): `docs/farm-cli-reference.md`.
