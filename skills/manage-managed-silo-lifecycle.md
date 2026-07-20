---
name: manage-managed-silo-lifecycle
description: Apply start / pause / delete lifecycle transitions to a managed E2B or Daytona cloud silo with `farm silo <transition> <id>`, for bringing a worker up before use, pausing it to stop burning sandbox cost, or tearing it down — the ongoing operations after one-time provisioning.
---

# Manage a managed cloud silo's lifecycle

Provisioning a managed cloud silo (`workflows/provision-managed-cloud-silo.md`) stands one up once. Day-to-day you need to move it between states: bring it **up** before dispatching work, **pause** it so an idle E2B/Daytona sandbox stops costing money, or **delete** it when done. Each transition is applied through the descriptor's runtime adapter (`docs/farm-cli-reference.md`).

## The transitions

```sh
farm silo start  <id>   # bring the silo up through its runtime adapter
farm silo pause  <id>   # suspend the sandbox — stops burning runtime cost while idle
farm silo delete <id>   # tear it down through the adapter
```

Each applies a lifecycle transition to the provider runtime plus the silo descriptor under `~/.usage-farm/silos/` (`docs/farm-cli-reference.md`).

## When to reach for each

- **start** — before a `crew` route or a sessionless job can land on the silo (`skills/dispatch-sessionless-job.md`); a paused/absent sandbox can't serve.
- **pause** — the default idle posture for managed sandboxes: E2B/Daytona bill for running time, so pause between bursts of work rather than leaving it up.
- **delete** — when the silo is no longer needed. The descriptor and runtime go away together.

## Verify

```sh
farm silos        # confirm the descriptor's state reflects the transition
```

## Notes

- These transitions apply only to **managed** runtime silos reached through `farmd`/Agensis — not to local Apple-container account silos, which are managed with `farm setup` / host-side routing (`docs/control-surfaces-rota-vs-crew.md`).
- Descriptors carry public routing/lifecycle data only; the sandbox keeps its own provider credentials, which are destroyed with it on delete (`docs/distributed-silos.md`, `docs/provider-credential-isolation.md`).
