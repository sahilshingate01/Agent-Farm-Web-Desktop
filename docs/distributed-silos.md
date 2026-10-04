---
title: Distributed Agent Farm silos
description: Pair Farm with Agensis, connect arbitrary machines, share local inference, and provision E2B or Daytona workers.
status: reference
---

# Distributed silos

Farm now has two compatible control surfaces:

- `farm.sh` remains the Apple-container adapter for isolated local provider accounts.
- `daemon/bin/farmd.mjs` is the portable Node control plane for Agensis-connected machines and managed sandbox providers.

The two share `~/.usage-farm` state and the desktop app. They do not share provider credentials.

```text
OpenAI client ──> farmd :4546 ──> local gateway :4545 ──> Apple account silo
                         ├──────> Agensis relay ─────────> arbitrary machine
                         ├──────> Agensis relay ─────────> E2B sandbox
                         └──────> Agensis relay ─────────> Daytona sandbox
```

## Pair a workspace

```bash
farm pair --url https://agensis.io
```

Farm prints a short code and an Agensis approval URL. A signed-in workspace
manager selects exactly one workspace and approves the requested scopes. The
one-time device code is exchanged for a scoped `agf_` integration token.

The token lives at:

```text
~/.usage-farm/integrations/agensis/<workspace-id>.json
```

The integration file and its parent directory use owner-only permissions. Silo
descriptors under `~/.usage-farm/silos/` contain public routing and lifecycle
metadata only; token, key, credential, and secret fields are removed before a
descriptor is written.

## Connect any machine

Create a daemon agent in Agensis and copy its connection command, or let a
paired Farm enroll one. On the target machine:

```bash
npm install -g agensis-cli
cd /path/to/workspace
agensis connect --url https://agensis.io --token aga_... --workspace ... --agent ...
```

The daemon makes the outbound WebSocket connection, publishes presence and
capability metadata, accepts coding jobs, and returns progress and results. Its
coding CLI and provider authentication remain on that machine.

Discovery is policy-driven. The default includes explicitly shared daemons and
agents enrolled by the paired Farm. Set these keys in
`~/.usage-farm/farmd.json` to change it:

```json
{
  "host": "127.0.0.1",
  "port": 4546,
  "apiKey": "",
  "discovery": {
    "includeShared": true,
    "includeCoding": true,
    "includeAllDaemons": false,
    "includeFarmManaged": true
  }
}
```

## Share local inference

`agensis-cli` only accepts loopback HTTP endpoints in a shared-model config.
Private base URLs and API keys are removed from capability adverts; the daemon
itself performs every request locally.

```json
{
  "models": [
    {
      "id": "qwen3-8b",
      "name": "Qwen 3 8B",
      "provider": "ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "upstreamModel": "qwen3:8b",
      "capabilities": ["text", "streaming", "tools"],
      "maxConcurrency": 2
    }
  ]
}
```

```bash
agensis connect ... --share --shared-models-file ./shared-models.json
```

The model becomes a workspace-scoped route:

```text
agensis/<workspace-id>/<agent-id>/<encoded-model-id>
```

It appears in Agensis chat model selectors and in `farm models`. Requests and
streaming chunks relay through Agensis, while the loopback endpoint remains
private.

## Managed sandbox runtimes

```bash
export E2B_API_KEY=...
farm silo create e2b --name cloud-coder \
  --template my-coder --coding-cmd "codex exec"

export DAYTONA_API_KEY=...
farm silo create daytona --name durable-coder \
  --snapshot my-coder --coding-cmd "claude -p"
```

Both adapters enroll a one-time child agent in the paired workspace, inject
only that agent connection material into the environment, launch
`agensis-cli`, and write a secret-free descriptor.

Use a prepared E2B template or Daytona snapshot/image containing the coding
tool and its environment-local authentication. Farm does not copy provider
credentials from the host. `--coding-cmd` is explicit: without it, the child
does not advertise a coding route. Inference sharing is also explicit and
requires a config path that already exists inside the runtime:

```bash
farm silo create e2b --name inference-worker --template local-models \
  --share --shared-models-file /home/user/shared-models.json
```

- E2B uses a 15-minute timeout with `onTimeout: pause` and explicit Farm resume.
- Daytona uses its 15-minute auto-stop interval. Farm starts the sandbox and
  relaunches the Agensis background session before dispatch.

Lifecycle commands are uniform:

```bash
farm silos
farm silo start e2b/<sandbox-id>
farm silo pause e2b/<sandbox-id>
farm silo delete e2b/<sandbox-id>
```

Delete is terminal and also disables the Farm-enrolled Agensis agent. Pause is
reversible.

## Routing

- `rota` (`auto`) is the existing Claude quota-aware route across local account silos.
- `crew` filters every known route by required capabilities and available
  concurrency, then orders candidates by explicit priority, running state,
  locality, load, latency, and stable ID.

The distributed gateway defaults to `http://127.0.0.1:4546`:

```text
GET  /health
GET  /v1/farm/silos
POST /v1/farm/silos
POST /v1/farm/silos/:id/start|pause|delete
GET  /v1/farm/events
POST /v1/farm/jobs
GET  /v1/farm/jobs/:id
POST /v1/farm/jobs/:id/cancel
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses
POST /v1/messages
```

Set `apiKey` in `farmd.json` before binding through a port-forward or allowing
untrusted local processes to call the service. Keep the default host on
`127.0.0.1`; remote workers connect outbound through Agensis and do not require
an inbound Farm listener. `farmd` refuses a non-loopback bind without a key and,
when no key is configured, rejects browser origins that are not loopback.
