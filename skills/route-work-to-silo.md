---
name: route-work-to-silo
description: Hand-pick which account silo serves a unit of work with `farm route`, bypassing the gateway's auto rota — for when you deliberately want a specific account, not the highest-headroom one
---

# Manually pin work to a specific silo

The gateway's virtual `rota` model auto-picks the silo with the most headroom (`docs/rota-gateway-scoring-model.md`). Sometimes you instead want a *specific* account to serve a unit of work — a paid tier, a provider only one account has equipped, or an account you're deliberately draining. That is a **host-side hand-pick**, Layer 1 of `docs/multi-account-vm-architecture.md`, done with `farm route`.

## When to use this instead of rota

- The work needs a provider only one account has been `farm equip`-ped for.
- You are intentionally burning a specific account (e.g. a tier that resets soonest).
- You are reproducing a routing issue against one lane in isolation.

For everything else, prefer auto-rota (`use-rota-gateway` skill) — it protects the weekly reserve, skips rate-limited lanes, and keeps a conversation on one silo.

## Step 1: Pick the target and confirm it can serve

Manual routing does **not** wait for capacity. Before pinning, confirm the account is real and healthy:

```sh
cat ~/.claude-farm/usage/<name>/claude.json   # evidence present and current?
```

- No file / stale → the silo may have little headroom; refresh first (`refresh-usage-evidence` skill) or accept that you're routing blind.
- Confirm the account was `farm equip`-ped for the provider this work needs.

## Step 2: Route

```sh
farm route <work-id> --account <name>
```

The work is delegated to that account's silo. Because `~/.usage-farm/work` is mounted at the identical absolute path in every VM, the account reads and contributes to the same repos with no copying.

## Step 3: Verify

- Confirm the handoff in `gateway.log`.
- If you later want auto behavior back, just request the `rota` model again — manual routing is per-work-id, not a mode switch.

## Notes

- Manual routing overrides the scoring model; it will happily send work to a nearly-drained silo. That is the point, but it means the 10% weekly reserve protection does not apply.
- To understand why *auto* routing chose a silo instead, use the `diagnose-rota-routing` skill.
