---
title: Routing decision matrix — auto vs manual, local vs distributed
description: The four ways to place a unit of work on the farm, arranged as a single 2x2 (auto-routing vs hand-placement crossed with local vs distributed), so you pick the right one without cross-referencing.
status: reference
---

# Routing decision matrix

There are exactly **four** ways to place work on the farm, and they factor cleanly along two axes:

- **Auto vs manual** — do you let the farm *score and pick* a target, or do you *name* a specific one?
- **Local vs distributed** — does the work land on a **local Apple-container account silo** on the Mac host, or on a **distributed target** (remote Agensis machine, E2B/Daytona sandbox, or non-claude provider) reached through `farmd` and the Agensis relay?

`docs/placing-work-route-vs-job-run.md` states the key relationship the matrix formalizes: the two manual commands are "the manual counterparts of the two auto-routing models."

## The 2x2

| | **Local** (Mac host, claude account silos) | **Distributed** (remote machine / sandbox / other provider) |
|---|---|---|
| **Auto** (farm picks) | request virtual model **`rota`** (alias `auto`) on `:4545` | request virtual model **`crew`** on `:4546` |
| **Manual** (you name the target) | `farm route <work-id> --account <name>` | `farm job run --agent-id <id> --prompt <work>` |

## How to choose

1. **Do you care *which* target?**
   - No → use an **auto** model (`rota` or `crew`).
   - Yes → use a **manual** command (`farm route` or `farm job run`).
2. **Is the target local-claude, or something else?**
   - Local claude account → left column (`rota` / `farm route`).
   - Remote machine, managed sandbox, or a **non-claude provider** (codex/grok/gemini) → right column (`crew` / `farm job run`).

## The trap the matrix prevents

`rota` scores **claude silos only** — it will never auto-distribute to a non-claude provider (`docs/control-surfaces-rota-vs-crew.md`). So provider-specific work always lives in the right column or the manual-local cell: pick it by hand with `farm route --account <name>` (to a silo `farm equip`-ped for that provider) or dispatch it with `farm job run`. Requesting `rota` and expecting it to reach grok/gemini is the single most common misroute.

## State each cell touches

| Command | Surface | State |
|---|---|---|
| `rota` | local gateway `:4545` | `rota.json` global pick, `rota-sessions.json` per-conversation pin, `gateway.log` handoff |
| `anchor` route | local gateway `:4545` | hybrid route with `workflow.kind: "anchor"`; anchor pinned, workers resolve `rota` per dispatch |
| `crew` | `farmd` `:4546` | delegates local claude down to `:4545`; else Agensis relay |
| `farm route` | local `farm.sh` | shared work dir |
| `farm job run` | `farmd` / Agensis | Agensis-side job record |

See `docs/farm-cli-reference.md` for the full command surface.

## A third axis the 2x2 does not cover

The matrix answers *which target runs this work*. It says nothing about *how much
context that target receives*, which is now a separate choice:

- **Whole conversation to whichever silo is picked** — the default for every cell
  above. Each turn re-sends the full transcript.
- **Anchor workflow** — one pinned member holds the conversation and hands
  rotating workers a scoped brief instead of the transcript
  (`docs/anchor-workflow.md`).

Both are local-auto (`rota`) at the routing layer, so they occupy the same cell.
The difference is volume, not placement.
