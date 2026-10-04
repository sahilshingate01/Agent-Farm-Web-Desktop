---
title: Harvest auto-triage
description: How a small model rates harvested suggestions, banks the good ones, merges into existing files, rejects the dead ones, and leaves the judgement calls for a human.
---

# Harvest auto-triage

`farm.harvest.triage` runs a small model (default `claude-haiku-4-5`) over every
**proposed** suggestion so a human only has to look at the genuinely uncertain
ones. Triggered from the Harvest page's **Auto-triage** button, or over the
bridge directly.

Harvest *scan* proposes; triage *decides*. They are separate passes on purpose —
triage is re-runnable, does not slow a scan down, and can be run again after a
human edits a draft.

## Verdicts

Per suggestion the model returns one of:

| Verdict | Effect |
|---|---|
| `accept` | The draft is written to `draftPath`. Only valid when no file exists there. |
| `refine` | The model returns a corrected full draft (and optionally a better title/summary); that is written. |
| `merge` | An existing file was shown to the model; it returns the **full merged body** with the new material folded in, and that is written. This is what makes the old `already exists — resolve manually` dead end actionable. |
| `reject` | Status becomes `dismissed`, with the reason recorded. |
| `human` | Left `proposed`, carrying its rating and the reason the model was unsure. |

Plus a `rating` of 1–5 and a one-sentence `reason`, both stored on the
suggestion and shown on its card.

## The rails that matter

These exist because an automated pass that writes into your workspace has to
fail safe:

- **A contradiction resolves toward the human queue.** An `accept` at rating 2
  becomes `human`. Anything below rating 3 is never written.
- **A `refine`/`merge` with no revised body becomes `human`** rather than
  writing the *unrevised* draft over a real file.
- **An unknown verdict becomes `human`.** An unparseable opinion must never
  silently reject someone's work.
- **A failed write parks the suggestion** with the error appended to its reason,
  rather than losing it.
- **Containment is unchanged.** `writeHarvestDraft` is the single writer for
  both manual approve and auto-accept, so the path-escape check and the
  overwrite rule cannot drift apart. Without an explicit merge an existing file
  is still never clobbered.
- **A failed triage touches nothing.** If the model is unreachable the pass
  records `lastTriageError` and every suggestion stays `proposed`.

## Merging by hand

The same path is available without the model: `farm.harvest.resolve` with
`{ action: "approve", merge: true }` permits writing over an existing file. The
caller is asserting the draft already contains that file's content — nothing
merges it for you.

## Concurrency

Triage runs as a detached worker with its own lock (`triaging`, `triagePid`,
`triageStartedAt` in `harvest.json`), for the same reason the scan does: every
bridge call runs `controller.mjs` synchronously on the app's main thread, so a
multi-minute LLM call in-band would freeze the UI. A dead worker's lock heals on
the next read, and a second triage while one is running is a no-op start.

The pass re-reads `harvest.json` after the model returns, so approving or
dismissing something by hand while triage is in flight is not clobbered.

## State

All on the suggestion in `~/.claude-farm/harvest.json`: `rating`, `verdict`,
`triageReason`, `triagedAt`, `autoApplied`, `merged`. Pass-level:
`lastTriageAt`, `lastTriageError`, `lastTriageCounts`
(`{accepted, merged, refined, rejected, human, failed}`), surfaced under the
Harvest floor header.
