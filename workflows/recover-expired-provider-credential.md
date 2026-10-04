---
name: recover-expired-provider-credential
description: 'Trace stale usage evidence to its root cause and, when the cause is a silently-expired provider credential, re-authorize it in the correct environment and confirm the silo returns to routing — the recovery path the health and lifecycle docs describe but never chain together'
phases:
  - title: 'Confirm the evidence is stale'
  - title: 'Distinguish idle-app from expired-credential'
  - title: 'Re-authorize in the correct environment'
  - title: 'Refresh evidence and verify routing'
---

# Recover an expired provider credential

A silo that keeps getting passed over by `rota`/`crew` is usually not a scoring bug — it is **stale usage evidence** scoring the conservative floor. One documented cause of stale evidence is **a silo's OAuth refresh failing silently** because its provider credential expired (`docs/usage-evidence-health-and-recovery.md`, `skills/validate-usage-evidence.md`). This workflow separates that case from a merely-idle app and drives the credential recovery to completion.

## Phase 1: Confirm the evidence is stale

1. Check modification times of every evidence file:
   ```bash
   ls -l ~/.usage-farm/usage/*/claude.json
   ```
   Fresh = modified within ~90s while the app runs. Stale = untouched for hours/days.
2. If a specific silo's file is stale while others are fresh, that silo is the suspect — the app is running and pinging *other* silos, so this is not a global idle-app problem.

## Phase 2: Distinguish idle-app from expired-credential

Stale evidence has three causes (`docs/usage-evidence-health-and-recovery.md`):
- the app hasn't run recently → **all** files stale → not a credential problem; just run the app / `Crew → Refresh`.
- the app is running but not pinging that silo.
- **a silo's OAuth refresh failed silently (expired token)** → this workflow.

1. Force a refresh (app `Crew → Refresh` or `farm refresh`).
2. Re-check the suspect silo's mtime. If it stays stale *after* a refresh while others update, the refresh could not authenticate that silo — treat it as an **expired credential** and continue.

## Phase 3: Re-authorize in the correct environment

Re-authorize **in the environment that owns the credential** — never on the host, never by copying a token (`docs/credential-lifecycle.md`; see the credential-isolation convention):

- **Local account silo:**
  ```bash
  farm equip <provider>      # launches OAuth login inside that account's VM
  ```
  The new token lands in `~/.usage-farm/accounts/<name>/<provider>-home/`.
- **Remote Agensis machine:** SSH in and run that machine's provider auth flow there.
- **Managed E2B/Daytona sandbox:** re-authorize inside the sandbox; if it cannot be salvaged, `farm silo delete <id>` and re-provision — the credential is destroyed and recreated with it.

## Phase 4: Refresh evidence and verify routing

1. Refresh again: `farm refresh` or `Crew → Refresh`.
2. Confirm the file is now current:
   ```bash
   ls -l ~/.usage-farm/usage/<silo>/claude.json   # mtime recent
   cat ~/.usage-farm/usage/<silo>/claude.json      # valid session/weekly/modelSpecific structure
   ```
3. Confirm the silo is preferred again once it has proven headroom — tail `gateway.log` and watch a request land on it, or reconstruct the score with the rota diagnosis skill.

> If the file is present but structurally malformed rather than merely stale, that is a corruption problem, not a credential one — repair it with `skills/validate-usage-evidence.md` first.
