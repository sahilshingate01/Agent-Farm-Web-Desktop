---
title: Placing a specific unit of work — farm route vs farm job run
description: The two commands for hand-placing a named unit of work — farm route (pin to a local account silo) and farm job run (dispatch a sessionless job to a distributed Agensis daemon) — and when each is the right one.
status: reference
---

# Placing a specific unit of work: `farm route` vs `farm job run`

Auto-routing (the `rota`/`crew` virtual models) picks a silo *for* you (`docs/control-surfaces-rota-vs-crew.md`). But sometimes you need to place a *specific* unit of work on a *specific* target by hand. There are **two** commands for that, one per control surface, and they are the manual counterparts of the two auto-routing models. Conflating them sends work to the wrong place.

| Command | Surface | Target | State it touches |
|---|---|---|---|
| `farm route <work-id> --account <name>` | Local `farm.sh` / `:4545` | One **local** Apple-container account silo | shared work dir |
| `farm job run --agent-id <id> --prompt <work>` | Portable `farmd` / `:4546` | A **connected Agensis daemon** or managed E2B/Daytona sandbox | Agensis-side job record |

`skills/dispatch-sessionless-job.md` states the relationship directly: `farm job run` is "the distributed analogue of pinning local work with `farm route`."

## `farm route` — pin to a local account silo

Use when the work must land on a **specific local account** on the Mac host — most often because you need a **non-claude provider** (codex/grok/gemini) or a specific paid tier. Auto-`rota` will not do this for you: it scores claude silos only, so provider-specific work must be hand-picked (`docs/control-surfaces-rota-vs-crew.md`). The target account must have been `farm equip`-ped for that provider.

```bash
farm route <work-id> --account <name>
```

## `farm job run` — dispatch a sessionless job to a distributed worker

Use when the target is a **remote Agensis machine** or a **managed cloud sandbox** reached through the relay, and you want a one-shot job with no interactive session held open (`docs/farm-cli-reference.md`, `skills/dispatch-sessionless-job.md`).

```bash
farm silos                                   # find the agent-id of the daemon/silo
farm job run --agent-id <id> --prompt "<the work>"
```

Preconditions specific to this path:
- The Farm is paired to an Agensis workspace and the target is a **connected** daemon (local claude-only work does not use this path — it uses `rota`).
- A managed sandbox must be **started** first; a paused/absent sandbox cannot take a job (`skills/manage-managed-silo-lifecycle.md`).

## How to choose

- Target is a **local account VM** on this Mac → `farm route`.
- Target is a **remote machine or cloud sandbox** through Agensis → `farm job run`.
- You don't care which target, just "give me claude" → don't hand-place at all; request the `rota` (local) or `crew` (distributed) model (`docs/control-surfaces-rota-vs-crew.md`).

## The shared invariant

Either way, the job runs with the **target environment's own** provider credentials. Never plumb a host credential into a route or job to "save a login" — that silently breaks the isolation every capacity decision assumes (`docs/provider-credential-isolation.md`).
