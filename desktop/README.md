# Usage Farm Desktop

A Vercel Native desktop companion for `usage-farm`. The shell is Zig + Native
SDK; the interface is React 19, Vite, Tailwind 4, shadcn/ui source components,
and AI Elements-style chat primitives.

The default workspace is a persistent, multi-session chat surface with file
attachments, queued follow-ups, steering, stop controls, route mentions,
slash commands, per-session permissions, and AI Elements rendering for
Markdown, reasoning, and tool activity.

## Run

```bash
npm install --prefix frontend
zig build dev
```

Production and packaging:

```bash
./build-release.sh   # one command: quit running copies, package ReleaseFast, verify, open
```

Or the individual steps:

```bash title="Bash"
npm install --global @native-sdk/cli@0.6.1
git clone https://github.com/vercel-labs/native.git ../../zero-native
git -C ../../zero-native checkout a7509a7fa6c467eaed021250538b482886f1c6bf
zig build run
zig build test
zig build package    # -Doptimize=ReleaseFast for the production artifact
```

Full detail + blank-window troubleshooting: `docs/desktop-app-build-and-packaging.md`.

The supported desktop toolchain is Node 22.12 or newer (CI uses Node 24), Zig
0.16.0, Native CLI 0.6.1, and Native SDK commit
`a7509a7fa6c467eaed021250538b482886f1c6bf`.

The build uses `NATIVE_SDK_PATH` when set and otherwise expects the Native SDK
checkout beside this repository at `../../zero-native` from the desktop
directory. Override it explicitly after
moving either checkout:

```bash
zig build run -Dnative-sdk-path=/path/to/native
```

Signed and notarized archives are produced by the root tag-release workflow.
Local signing uses the same script:

```bash
./build-release.sh --no-open \
  --sign-identity "Developer ID Application: Example (TEAMID)" \
  --notary-profile agensis-release \
  --archive-dir ../artifacts
```

See `../docs/releasing.md` for the required GitHub secrets and tag flow.

## CLI discovery

The Native bridge resolves the farm command in this order:

1. `FARM_CLI=/absolute/path/to/farm.sh`
2. a `farm.sh` beside the checkout
3. `farm` on `PATH`

Use `FARM_STATE` to select a non-default state directory. The default remains
`~/.usage-farm`, with the existing `~/.claude-farm` fallback.

## Local compatibility API

The gateway runs as a Node sidecar because Node is already a host requirement
for profile setup. It binds only to localhost and supports OpenAI-compatible
models, chat completions, and Responses endpoints, plus Anthropic-compatible
Messages. `/openapi.json` describes the surface.

CLI-backed routes preserve streaming response formats and normalize text,
system instructions, multimodal references, tool definitions, and structured
output requests into each provider's headless client. For protocol-perfect
pass-through, add an explicit OpenAI or Anthropic upstream route in
`~/.usage-farm/gateway.json`; same-protocol requests and streams are forwarded
without reshaping.

The Model studio can publish two additional route types through the same API:

- Hybrid specialists combine account or upstream routes, their selected
  skills/tools/MCP servers, and a shared instruction. Members can run in
  parallel, race, or feed a final synthesizer, with configurable repeats.
- Streamable CLI routes invoke any executable that accepts a prompt through
  stdin or an argument and emits plain text, NDJSON, or SSE-style output.

Model identifiers are never guessed by the desktop app. Account routes are
discovered from local state, upstream identifiers are supplied by the user,
and specialist/CLI identifiers are explicitly created in Model studio.

## Typography

Bundled interface choices include Geist, Inter, Space Grotesk, Manrope,
DM Sans, Work Sans, and Plus Jakarta Sans. The mono menu includes Geist Mono,
JetBrains Mono, IBM Plex Mono, and Space Mono, with local Berkeley Mono,
SF Mono, and Menlo fallbacks.

## Frontend checks

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run build
native validate app.zon
```
