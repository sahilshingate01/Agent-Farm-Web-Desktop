---
name: fix-desktop-bridge-discovery
description: Resolve the desktop app failing to shell out to the farm CLI or failing to resolve the Native SDK — the two override knobs (FARM_CLI, -Dnative-sdk-path) and when each applies, usually after moving the app or checkout
---

# Fix desktop bridge discovery (farm CLI + Native SDK)

The desktop companion is a Vercel Native app (Zig shell + React UI) whose Native bridge shells out to the **farm CLI** and depends on a globally installed **Native SDK**. Both are resolved by convention (`docs/desktop-native-bridge-discovery.md`), and both break in the same predictable way — after you move the app or the checkout. This skill covers the two escape hatches.

## Symptom 1: the bridge can't find or run the farm CLI

The bridge resolves the `farm` command in this order, first match wins:

1. `FARM_CLI=/absolute/path/to/farm.sh` (explicit override)
2. a `farm.sh` sitting beside the checkout
3. `farm` on `PATH`

**Fix:** point it explicitly. `FARM_CLI` always beats the other two:

```sh
export FARM_CLI=/absolute/path/to/farm.sh
```

Confirm the path is the real host-side `farm.sh` (Layer 1 CLI — `docs/farm-cli-reference.md`), not a copy inside a silo.

## Symptom 2: the build can't resolve the Native SDK

The generated build resolves the Native SDK from the globally installed `@native-sdk/cli`. After **moving the app**, that global install no longer resolves. Override the SDK path on the build command:

```sh
zig build run -Dnative-sdk-path=/path/to/native
```

This is the same override called out in the release/packaging path (`workflows/release-compliance-check.md`, Phase 2) — reach for it whenever `zig build run`/`package` fails to find the SDK after a move.

## Verify

```sh
npm install --prefix frontend   # deps present
zig build run                   # app comes up, bridge reaches the CLI
```

If the app launches and can invoke `farm` (e.g. Crew → Refresh reaches a silo), both knobs are resolved.

## Notes

- These are runtime discovery knobs only. For the full setup flow use the `setup-claude-farm-desktop` skill; this skill is the narrow "it moved and now can't find things" fix.