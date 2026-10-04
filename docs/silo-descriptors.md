---
title: Silo descriptors — the public routing/lifecycle registry
description: What a silo descriptor is, what it holds and deliberately does not hold, who writes it, and how discovery reads it. The one place that defines the concept the distributed-side docs reference inline.
status: reference
---

# Silo descriptors

The distributed side of the farm keeps a **descriptor** for each paired daemon and managed runtime silo under `~/.usage-farm/silos/`. Nearly every distributed-side doc references it (`skills/dispatch-sessionless-job.md`, `skills/manage-managed-silo-lifecycle.md`, `workflows/provision-managed-cloud-silo.md`), but none define it — this doc does.

## What a descriptor holds

**Public routing and lifecycle metadata only:**

- The silo's `agent-id` (the handle `farm job run --agent-id <id>` and lifecycle commands target).
- Its runtime kind (remote Agensis daemon, or managed `e2b`/`daytona` sandbox) and the adapter used to drive it.
- Its lifecycle state — `ready`, `paused`, or `unreachable` — as surfaced by `farm silos`.

## What a descriptor deliberately does NOT hold

**No credentials.** Provider OAuth tokens and API keys live inside the target environment (the sandbox or remote machine) and never leave it (`docs/provider-credential-isolation.md`). The descriptor carries nothing secret, which is exactly why it is safe to keep as shared routing metadata alongside usage evidence.

## Who writes it, who reads it

| Action | Effect on the descriptor |
|---|---|
| `farm silo create <e2b\|daytona>` | Creates the descriptor plus the provider runtime, and enrolls the Agensis child agent (`docs/farm-cli-reference.md`). |
| `farm silo start\|pause\|delete <id>` | Applies a lifecycle transition through the runtime adapter and updates descriptor state. |
| `farm silos` | Read-only discovery — lists paired daemons and managed runtime descriptors; the source of truth for `agent-id` and current state. |

## How it fits the two-state model

Descriptors sit with usage evidence in the **public routing metadata** class — the only state permitted to be shared across environments (`docs/provider-credential-isolation.md`). The pairing token (`~/.usage-farm/integrations/agensis/<workspace-id>.json`) is the sensitive counterpart and is owner-only; descriptors are not.
