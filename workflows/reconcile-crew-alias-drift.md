---
name: reconcile-crew-alias-drift
description: 'Retire the stale claim that `crew` is an alias of the local rota model — docs/rota-gateway.md states crew is reserved by the portable farmd gateway for capability-aware routing, and the rota-auto-routes-claude-only convention still lists crew as a rota alias'
phases:
  - title: 'Confirm the authoritative source'
  - title: 'Fix the stale source'
  - title: 'Verify no conflicting alias claims remain'
---

# Reconcile the crew-alias drift

Two sources disagree about the virtual model name `crew`:

- `docs/rota-gateway.md` (the gateway's own doc): the local gateway exposes **`rota`** with alias **`auto`**, and "the portable `farmd` gateway **reserves `crew`** for capability-aware routing across local, remote Agensis, E2B, and Daytona silos."
- `docs/control-surfaces-rota-vs-crew.md`: "the gateway's virtual `rota` model (aliases **`crew`**, `auto`)".

These cannot both be true. While they disagree, a client configured with model `crew` against the local gateway may silently get claude-only rota rotation when the operator expected farmd's capability-aware routing across all silo classes — or vice versa. This is the same fragmentation failure mode as the wordmark-font drift: implementers follow whichever doc they open first.

## Phase 1: Confirm the authoritative source

1. `docs/rota-gateway.md` is the gateway's own reference and draws the explicit boundary: `rota`/`auto` = local claude-only rotation; `crew` = farmd's capability-aware routing. The two-control-surfaces distinction (farm.sh/rota local vs farmd/crew distributed) corroborates it. Treat `docs/rota-gateway.md` as the winner.
2. Sanity-check against the running system if available: request model `crew` on the local gateway (`http://127.0.0.1:4545`) and observe whether it is served as a rota alias or rejected/reserved. The on-wire behavior is canonical over any doc.

## Phase 2: Fix the stale source

1. In `docs/control-surfaces-rota-vs-crew.md`, change "(aliases `crew`, `auto`)" to "(alias `auto`)" in both the description frontmatter and the body, and where the rule says "request the `rota` model", leave it — that guidance is already correct.
2. Add one clarifying line to that convention: `crew` is **not** a rota alias — it is the farmd gateway's model for capability-aware routing across local, remote Agensis, E2B, and Daytona silos; requesting `crew` is how you opt into the distributed surface, not another spelling of rota.

## Phase 3: Verify no conflicting alias claims remain

1. Search the tree for remaining claims that `crew` aliases rota:
   ```sh
   grep -rni "alias" docs/ skills/ workflows/ | grep -i crew
   ```
2. Legitimate remaining mentions describe `crew` as the farmd/distributed model (e.g. `docs/rota-gateway.md`, the two-control-surfaces doc, the point-a-client-at-crew skill). Anything calling `crew` a name for the local rota model is drift — fix it the same way.
