---
name: escalation-chain
description: 'Cost-tiered model chain: deep plan (Codex GPT-5.5 xhigh) → Sonnet execute → Opus default escalate → Opus max as final solver/advisor'
source: '~/.claude/workflows/escalation-chain.js'
runtime: claude-code-workflow
whenToUse: 'Hard multi-step tasks where you want a strong plan first, cheap execution second, and only escalate model tier when blocked. Pass the task as a string or { task, context }.'
phases:
  - title: Plan
    detail: Codex GPT-5.5 (xhigh reasoning) via Haiku relay produces a concrete plan — no side effects
    model: claude-haiku-4-5
    external: 'codex exec -m gpt-5.5 -c model_reasoning_effort="xhigh"'
  - title: Execute
    detail: Sonnet-4-6 executes the plan with tools and returns a structured result contract
    model: claude-sonnet-4-6
  - title: Escalate-Opus
    detail: Opus-4-8 (default) continues only if Sonnet is blocked (not if human help was requested)
    model: claude-opus-4-8
  - title: Escalate-OpusMax
    detail: Opus-4-8 (max effort) final solver/advisor only if default Opus is still blocked
    model: claude-opus-4-8
---

# Escalation chain

Human-readable twin of the Claude Code workflow module at
`~/.claude/workflows/escalation-chain.js`. That file is a **Claude Code
runtime DSL** (`args`, `phase()`, `agent()`, `log()`) — it does **not** run
inside Agent Farm. Use this document to operate the same chain by hand (or
adapt it into a farm job / rota dispatch). Open the `.js` in the desktop
agentic **Workflows** sidebar for syntax-highlighted source + phase cards.

## Inputs

| Form | Meaning |
|---|---|
| plain string | The task text |
| `{ task, context }` | Task plus optional extra context block |

## Shared result contract (executors)

Every execute/escalate agent returns JSON shaped like:

```json
{
  "solved": true,
  "summary": "what was done",
  "workCompleted": "files, commands, findings",
  "blocker": "",
  "needsHelpFrom": "none"
}
```

| Field | Rule |
|---|---|
| `solved` | `true` **only** if fully complete **and** verified |
| `blocker` | Specific obstacle when `solved=false`; empty when solved |
| `needsHelpFrom` | `none` · `stronger-model` (escalate) · `human` (stop chain) |

## Phase 1 — Plan (Codex GPT-5.5, xhigh)

**Runtime role:** Haiku is only a **relay**. It must not plan itself.

1. Write the planning prompt (task + optional context) to `/tmp/codex-plan-prompt.txt`.
2. Run with a long timeout (~590s):

```bash
codex exec --skip-git-repo-check --sandbox read-only \
  -m gpt-5.5 \
  -c model_reasoning_effort="xhigh" \
  -o /tmp/codex-plan-out.txt \
  - < /tmp/codex-plan-prompt.txt
```

3. Read `/tmp/codex-plan-out.txt` and use the **full** plan text downstream.
4. On failure / empty output, continue with a note that planning failed and execute from the raw task.

**Planner prompt intent:** ordered steps, assumptions, files/commands, risks, verification — **no execution**.

## Phase 2 — Execute (Sonnet 4.6)

Give Sonnet:

- the original **TASK** (+ context)
- the **PLAN** from phase 1

Instructions:

- Do the real work with tools and **verify**.
- Set `solved=true` only when genuinely done.
- If blocked after honest effort: `solved=false`, `needsHelpFrom="stronger-model"`, precise `blocker` + `workCompleted`.

**Stop early:** if Sonnet returns `needsHelpFrom="human"`, return to the user — do **not** escalate to Opus.

## Phase 3 — Escalate Opus (default)

Run only when Sonnet did not solve **and** did not request a human.

Give Opus:

- TASK + PLAN  
- Sonnet’s `workCompleted` and `blocker`  

Instructions: continue from prior work; do not restart from zero. Same result contract. Human stop still wins.

## Phase 4 — Escalate Opus max

Run only when default Opus still did not solve (and no human stop).

Give Opus-max:

- TASK + PLAN  
- Opus default’s `workCompleted` and `blocker`  

Role: final solver **or** precise advisory with `needsHelpFrom="human"` when fundamentally blocked (access, ambiguity, external dependency).

## Final result shape

```json
{
  "task": "…",
  "solved": false,
  "resolvedBy": "sonnet-4-6 | opus-4-8 | opus-4-8-max",
  "escalationPath": [
    "codex-gpt-5.5-xhigh:plan",
    "sonnet-4-6:execute"
  ],
  "summary": "…",
  "workCompleted": "…",
  "blocker": null,
  "needsHelpFrom": "none"
}
```

`escalationPath` grows as tiers fire:

1. plan + sonnet  
2. + opus-4-8  
3. + opus-4-8-max  

## Operating notes

- **Model IDs in `meta.phases` for Plan list Haiku** because the Claude workflow host can only spawn Claude-tier agents; the deep plan is still **Codex GPT-5.5** via CLI.
- Explicit `-m` / `model_reasoning_effort` avoid drift from `~/.codex/config.toml`.
- Prefer this chain when the cost of a wrong first execution exceeds the cost of a strong plan.
- Prefer a single strong model when the task is small or already well-specified.

## Source of truth

| Artifact | Role |
|---|---|
| `~/.claude/workflows/escalation-chain.js` | Executable Claude Code workflow module |
| `workflows/escalation-chain.md` (this file) | Editable farm doc — procedure, contracts, ops notes |

Do not delete the `.js` if you still invoke it from Claude Code; keep this markdown in sync when the chain’s tiers or contract change.
