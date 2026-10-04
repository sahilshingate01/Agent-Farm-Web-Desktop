---
title: Two credential classes — orchestration/routing vs provider
description: How to classify any credential you find in the farm, so the per-environment isolation invariant is applied to provider credentials only and never mistakenly to the host-resident Agensis routing token.
status: reference
---

# Two credential classes: orchestration/routing vs provider

The farm's security boundary is stated as an absolute: *credentials never cross an environment boundary* (`docs/provider-credential-isolation.md`). But there is exactly one credential that legitimately lives on the **host** and is neither isolated inside a silo nor an exception to the rule. Before you reason about where a credential belongs, classify it.

## The two classes

| Class | What it authorizes | Where it lives | Crosses boundaries? |
|---|---|---|---|
| **Provider credential** | *Consuming a model provider's quota* (OAuth token / API key for claude, codex, grok, gemini) | Inside exactly one environment: `~/.usage-farm/accounts/<name>/<provider>-home/`, a remote machine's env, or a sandbox's env | **Never** |
| **Orchestration / routing credential** | *Routing* work through the Agensis relay — the scoped `agf_` integration token | On the host, owner-only: `~/.usage-farm/integrations/agensis/<workspace-id>.json` | Stays on host; never copied into a sandbox or remote machine |

The Agensis integration token authorizes the farm to *route* work; it does not *consume* provider tokens. That is why it can sit on the host without violating the isolation invariant (`docs/provider-credential-isolation.md`).

## The rule of thumb

> If a credential lets something **consume a model provider's quota**, it belongs inside exactly one environment and stays there. If it only lets the farm **route** work, it is orchestration state and lives owner-only on the host.

## Why this matters in practice

- **Don't 'protect' the Agensis token by shoving it into a silo** — it must stay on the host for `farmd` to reach the relay.
- **Don't treat a provider token as routing metadata** — usage evidence (`~/.usage-farm/usage/<silo>/claude.json`) and silo descriptors (`~/.usage-farm/silos/`) are public routing metadata and may be shared; the provider token that produced them may not.
- **`farm equip <provider>` runs the browser login inside the target VM** precisely because the result is a provider credential (`docs/credential-lifecycle.md`). Never log in on the host and copy the token in.

See `docs/provider-credential-isolation.md` for the invariant this taxonomy protects.