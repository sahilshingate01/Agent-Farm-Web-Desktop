---
name: refresh-usage-evidence
description: Bring a silo's usage evidence current when it is missing or stale, so the rota gateway and handoff planner stop scoring it conservatively
---

# Restore fresh usage evidence for a silo

Every routing and scheduling decision in the farm reads one substrate — the per-silo usage evidence at `~/.claude-farm/usage/<silo>/claude.json` (`docs/usage-evidence-files.md`, `[[capacity-consumers-shared-substrate]]`). If that file is **missing or stale**, the silo scores a conservative **0.5**: usable, but never preferred over a silo with proven headroom. Use this when a silo you expect to be healthy is being passed over.

## Step 1: Confirm the symptom

```sh
cat ~/.claude-farm/usage/<silo>/claude.json
```

- **File does not exist** → the silo has no evidence yet (common right after `farm setup`). It scores 0.5.
- **File exists but old** → evidence is stale. The files only stay current while the desktop app's OAuth ping runs, so an app that isn't running lets them go stale.

## Step 2: Refresh the evidence

The desktop app is the only writer of these files:

- **Manual:** Crew → **Refresh**.
- **Automatic:** leave the app running — it re-pings on a **90-second heartbeat**.

## Step 3: Verify freshness

Re-read the file and confirm the timestamp/consumed state moved:

```sh
cat ~/.claude-farm/usage/<silo>/claude.json
```

Once present and current, the three-bucket capacity (`min(session, weeklyAllModels, weeklyModel)`) is recomputed and the silo scores on real headroom instead of the 0.5 floor.

## Notes

- Do **not** hand-edit `claude.json` — consumers treat it as evidence, not config. If you can't refresh it, treat the silo as stale rather than trusting an old file.
- This restores *evidence*; to understand a specific routing *pick*, use the `diagnose-rota-routing` skill.
