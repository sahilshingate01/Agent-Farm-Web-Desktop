---
name: validate-usage-evidence
description: Diagnose corrupted or malformed usage evidence files; validate JSON structure; rebuild from fresh provider API state when repair is needed
---

# Validate and repair usage evidence files

Usage evidence files at `~/.claude-farm/usage/<silo>/claude.json` record each silo's remaining quota across three dimensions: session, weekly, and model-specific. Both the rota gateway and handoff planner read these to compute headroom. Corrupted or missing evidence breaks routing. This skill diagnoses and repairs.

## Step 1: Detect corruption or staleness

```bash
# Check which files are missing or stale
ls -l ~/.claude-farm/usage/*/claude.json

# Healthy: modified within the last 90 seconds (app running) or last app session
# Stale: not modified for hours/days
```

Stale evidence happens when:
- The desktop app hasn't run recently
- A silo's OAuth refresh failed silently
- The app is running but not pinging that silo

## Step 2: Validate file structure

```bash
cat ~/.claude-farm/usage/<silo>/claude.json
```

**Healthy structure:**
```json
{
  "silo": "<silo-name>",
  "provider": "claude",
  "session": { "remaining": <number>, "limit": <number> },
  "weekly": { "remaining": <number>, "limit": <number> },
  "modelSpecific": {
    "<model>": { "remaining": <number>, "limit": <number> }
  },
  "refreshedAt": "<ISO timestamp>"
}
```

**Corruption signs:**
- Missing required fields (`silo`, `provider`, `session`, `weekly`)
- Non-numeric values in `remaining` or `limit`
- Invalid or missing `refreshedAt` timestamp
- Extra fields outside the known schema

## Step 3: Repair

If the file is malformed or very stale (older than 24 hours and the app is running):

```bash
# Option A: Refresh from the app's OAuth ping (recommended if app is running)
farm refresh
# or use the desktop app: Crew → Refresh

# Option B: Manually rebuild a silo's evidence (if app isn't running)
# This requires API access to the provider; best done inside that silo
farm exec <silo-name> -- <provider-quota-fetch-command>
```

After repair, re-run Step 2 to confirm structure is now valid.

## Step 4: Verify routing impact

After repair, a silo with fresh evidence is now preferred in routing (rota picks highest-headroom silo; handoff planner weights by urgency). 

```bash
# Check the current rota pick
cat ~/.claude-farm/rota.json

# Watch for lane switches in the gateway log
tail -f gateway.log
```

If a repaired silo still isn't preferred, check that your fresh evidence actually shows headroom — a silo reporting zero remaining capacity will score low regardless.
