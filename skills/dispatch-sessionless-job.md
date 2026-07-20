---
name: dispatch-sessionless-job
description: Fire a one-shot, sessionless coding job at a connected Agensis daemon with `farm job run --agent-id --prompt` — the way to put a paired remote machine or managed sandbox to work without holding an interactive session open.
---

# Dispatch a sessionless coding job

Once a Farm is paired to an Agensis workspace (`skills/pair-agensis-workspace.md`) and has connected daemons or managed silos (`workflows/provision-managed-cloud-silo.md`), you can hand a distributed worker a **sessionless** unit of work — a one-shot job dispatched to a connected Agensis daemon, no interactive session held open (`docs/farm-cli-reference.md`).

This is the distributed analogue of pinning local work with `farm route` (`skills/route-work-to-silo.md`): there you delegate to a local account silo; here you dispatch to a remote/managed agent through Agensis.

## Step 1: Confirm a target agent exists

List what the pairing has made visible:

```sh
farm silos        # paired Agensis daemons + managed runtime descriptors
```

Note the `agent-id` of the daemon/silo you want to run the job. Descriptors under `~/.usage-farm/silos/` hold public routing/lifecycle data only — no credentials (`docs/distributed-silos.md`).

## Step 2: Dispatch the job

```sh
farm job run --agent-id <id> --prompt "<the work>"
```

The job is delegated to that Agensis daemon and runs sessionlessly; state lands in the Agensis-side job record (`docs/farm-cli-reference.md`).

## Notes

- The target must be a **connected Agensis daemon** — this is the `farmd`/`crew` distributed surface, not the local Apple-container gateway. Local claude-only work goes through `rota` instead (`docs/control-surfaces-rota-vs-crew.md`).
- The job runs with the target environment's **own** provider credentials; never plumb a host credential into it to "save a login" (`docs/provider-credential-isolation.md`).
- A managed sandbox must be started before it can take a job — drive its lifecycle first (`skills/manage-managed-silo-lifecycle.md`).
