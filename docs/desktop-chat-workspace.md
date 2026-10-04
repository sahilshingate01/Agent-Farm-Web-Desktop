---
title: Desktop chat workspace — feature surface & frontend stack
description: What the desktop app's default workspace does and the exact frontend stack it is built on.
status: reference
---

# Desktop chat workspace

The desktop companion (`desktop/`) is a Vercel Native app: a **Zig + Native SDK** shell wrapping a React UI. Its default surface is a persistent chat workspace.

## Feature surface

The default workspace is a **persistent, multi-session chat surface** with:

- File attachments
- Queued follow-ups
- Steering and stop controls
- Route mentions (address a specific silo/route inline)
- Slash commands
- Per-session permissions
- AI Elements rendering for Markdown, reasoning, and tool activity

### Choosing where a session runs

The composer's target row leads with **Auto — rotate silos** (the gateway's
`rota` route), then Host, Elevators, and individual Silos. Auto is the only
target where you keep a **model** pick while the **silo** is chosen per request:

- `ChatSession.model` holds the **route** (`rota`, `claude/gmail`, an elevator id).
- `ChatSession.catalogModel` holds the **upstream model** inside it, and rides
  the request as `farm.model`. It is persisted, so a reload cannot silently fall
  back to the route's pinned `upstreamModel`.
- `ChatSession.effort` is the reasoning tier, validated against the chosen
  model — switching provider or model clears a tier the new model does not accept.

A conversation on Auto is pinned to one silo for the life of the thread
(`docs/rota-session-affinity.md`). For long threads where worker silos should
receive a scoped brief rather than the transcript, build an elevator with the
`anchor` workflow (`docs/anchor-workflow.md`).

Direct Anthropic provider mappings are a separate path: the gateway owns their
structured request and adds explicit prompt-cache breakpoints by default. Their
route row exposes the cache on/off setting, while the Gateway traffic and
activity views show reads, writes, measured misses, and absent telemetry. See
`docs/direct-prompt-caching.md`.

## Frontend stack

| Layer | Technology |
|---|---|
| Shell | Zig + Native SDK (Vercel Native) |
| UI framework | React 19 |
| Bundler | Vite |
| Styling | Tailwind 4 |
| Components | shadcn/ui source components |
| Chat primitives | AI Elements-style |

## Build & run

```bash
npm install --prefix frontend   # install frontend deps
zig build dev                   # dev server + app
zig build run                   # production build
zig build test                  # tests
zig build package               # package
```

The Native bridge shells out to the farm CLI and resolves the Native SDK by convention; see `docs/desktop-native-bridge-discovery.md` for the CLI discovery order and the `-Dnative-sdk-path` override, and the `setup-claude-farm-desktop` skill for the full setup flow.
