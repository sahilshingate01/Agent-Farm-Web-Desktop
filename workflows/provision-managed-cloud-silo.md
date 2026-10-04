---
name: provision-managed-cloud-silo
description: 'Pair an Agensis workspace, provision a managed E2B or Daytona cloud silo, drive its lifecycle, and confirm it is routable through the farmd crew route'
phases:
  - title: 'Pair the workspace'
  - title: 'Create the managed silo'
  - title: 'Drive lifecycle and verify routing'
---

# Provision a managed cloud silo

Unlike a local account silo (`workflows/onboard-account-silo.md`, an Apple-container VM on the Mac host), a **managed cloud silo** runs in an E2B or Daytona sandbox reached through the portable `farmd` control plane and an Agensis relay (`docs/distributed-silos.md`). This workflow stands one up end-to-end so it becomes routable via the `crew` model (`docs/control-surfaces-rota-vs-crew.md`).

## Phase 1: Pair the workspace

1. Pair this Farm with one Agensis workspace (`skills/pair-agensis-workspace.md`):
   ```bash
   farm pair --url https://agensis.io
   ```
2. Farm prints a short device code and an approval URL. A signed-in workspace manager approves the requested scopes; the one-time code is exchanged for a scoped `agf_` token stored owner-only at `~/.usage-farm/integrations/agensis/<workspace-id>.json` (`docs/distributed-silos.md`).
3. Confirm the control plane is up so it can relay to the sandbox:
   ```bash
   farm serve          # runs farmd, the portable control plane / heterogeneous gateway
   ```

## Phase 2: Create the managed silo

1. Provision the worker and enroll its Agensis child agent (`docs/farm-cli-reference.md`):
   ```bash
   farm silo create e2b        # or: farm silo create daytona
   ```
2. This creates the provider runtime plus a silo descriptor under `~/.usage-farm/silos/`. Descriptors hold **public routing and lifecycle** metadata only — no credentials, which stay inside the sandbox environment (`README.md`, `docs/distributed-silos.md`).
3. List what is now visible:
   ```bash
   farm silos          # discover paired daemons and managed runtime descriptors
   ```

## Phase 3: Drive lifecycle and verify routing

1. Bring the silo up through its runtime adapter:
   ```bash
   farm silo start <id>       # pause | delete apply the other lifecycle transitions
   ```
2. Because a managed sandbox is a non-local, potentially non-claude lane, it is reached with **`crew`, not `rota`** (`docs/control-surfaces-rota-vs-crew.md`). Point a client at `farmd` (`:4546`) and request the `crew` model; confirm the request lands on the new silo.
3. When you are done, pause or delete to stop burning the sandbox:
   ```bash
   farm silo pause <id>
   farm silo delete <id>
   ```
