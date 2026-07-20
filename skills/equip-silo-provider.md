---
name: equip-silo-provider
description: Add a provider (claude, codex, grok, gemini, …) to an already-onboarded account silo with `farm equip`, completing OAuth inside that silo so tokens never leak across accounts — for when a lane needs a provider it wasn't set up for
---

# Equip an existing silo with an additional provider

Onboarding a silo (`workflows/onboard-account-silo.md`) equips it with the provider(s) it needs at stand-up time. But an existing, routable account often needs a **new** provider later — because a unit of work requires a provider only some accounts have, or you want to spread a provider across more lanes. That is a standalone `farm equip`, run from the host against the current account (`docs/farm-cli-reference.md`, Layer 1).

## When to use this

- Routing or the `route-work-to-silo` skill reports the work needs a provider this account was never `farm equip`-ped for.
- You want an existing account to also serve `codex`/`grok`/`gemini`/etc. alongside what it already has.

For a brand-new account, use the `onboard-account-silo` workflow instead — it does setup + equip + verify end to end.

## Step 1: Select the target account

Equip runs **inside** the account's own silo so credentials land in that account's provider home and never leak across accounts. Make sure you are operating against the intended silo before equipping.

## Step 2: Equip the provider

```sh
farm equip <provider>   # e.g. farm equip codex   (claude, codex, grok, gemini, …)
```

Complete the provider's OAuth/login **inside that silo**. The tokens land in `~/.usage-farm/accounts/<name>/<provider>-home` and are isolated — a rotation on one account never affects another.

## Step 3: Verify the provider is usable

- Confirm the provider home now holds login state for that account.
- Equipping does not change routing capacity — the silo still routes on its existing usage evidence (`~/.claude-farm/usage/<name>/claude.json`). If the silo is being passed over, that is a capacity/evidence question, not an equip one; use the `refresh-usage-evidence` skill.
- To send provider-specific work to this exact lane, hand-pick it with the `route-work-to-silo` skill.

## Notes

- Nothing under `~/.usage-farm/accounts/<name>/` is ever committed to git.
- Equip is additive and per-account — equipping one silo for a provider says nothing about the others.