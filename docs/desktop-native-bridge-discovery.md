---
title: Desktop Native bridge — farm CLI discovery and SDK path override
description: How the desktop app resolves the farm command and the Native SDK, and how to override each when defaults don't apply.
---

# Desktop Native bridge: farm CLI discovery and SDK path override

The desktop companion is a Vercel Native app (Zig shell + React UI). Its Native bridge shells out to the farm CLI and depends on a Native SDK install. Both are resolved by convention; this doc records the resolution order and the escape hatches.

## farm CLI discovery

The Native bridge resolves the farm command in this order — first match wins:

1. `FARM_CLI=/absolute/path/to/farm.sh` (explicit override)
2. a `farm.sh` sitting beside the checkout
3. `farm` on `PATH`

If the bridge can't find or run the CLI, set `FARM_CLI` to the absolute path of your `farm.sh` — that always wins over the other two.

## Native SDK path override

The generated build resolves the Native SDK from the globally installed `@native-sdk/cli`. After **moving the app** (so the global install no longer resolves), override it:

```bash
zig build run -Dnative-sdk-path=/path/to/native
```

## Related build commands

```bash
npm install --prefix frontend   # install frontend deps
zig build dev                   # dev server + app
zig build run                   # production build
zig build test                  # tests
zig build package               # package
```

See the `setup-claude-farm-desktop` skill for the full setup flow; this doc covers only the runtime discovery/override knobs.