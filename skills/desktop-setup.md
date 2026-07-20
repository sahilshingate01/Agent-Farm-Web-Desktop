---
name: setup-claude-farm-desktop
description: Install frontend deps, build dev/prod, configure CLI bridge, and run desktop app
---

# Setup and run claude-farm desktop

The desktop companion is a Vercel Native application (Zig shell + React UI). Use this skill to develop or package it.

## Prerequisites
- Zig toolchain installed
- Node.js + npm
- Xcode command-line tools (macOS)

## Development build

```bash
npm install --prefix frontend
zig build dev
```

This starts the dev server and app in development mode.

## Production build

```bash
zig build run
```

## Testing

```bash
zig build test
```

## Packaging

```bash
zig build package
```

The generated package resolves the `farm` CLI in this order (checked before each command):

1. `$FARM_CLI` environment variable (absolute path)
2. `farm.sh` in the checkout root
3. `farm` on `PATH`

If the app is moved or the CLI location changes, override the Native SDK path:

```bash
zig build run -Dnative-sdk-path=/path/to/native-sdk
```

## Troubleshooting CLI discovery

If the app can't find `farm` commands:
- Check `echo $PATH` includes the CLI directory
- Or set `FARM_CLI=/absolute/path/to/farm.sh`
- Verify farm.sh is executable (`chmod +x farm.sh`)
