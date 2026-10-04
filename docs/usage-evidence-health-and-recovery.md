---
title: Usage evidence substrate health and recovery
description: How to detect stale, corrupted, or missing usage evidence files; validate substrate health; and recover when evidence is unreliable.
status: reference
---

# Usage evidence substrate health and recovery

## What is usage evidence and why it matters

Usage evidence files at `~/.claude-farm/usage/<silo>/claude.json` record each silo's remaining quota across three dimensions: session, weekly, and model-specific. Both the rota gateway (per-request routing) and the handoff planner (task routing) read these files to compute headroom and avoid over-using a silo's quota.

Evidence is re-fetched from each provider by the desktop app's OAuth ping, which runs on **`Crew → Refresh`** only. The app's 90-second heartbeat re-reads these files but does **not** re-fetch them (verified 2026-07-29: `fetchClaudeOauthUsage` has one caller, `pingUsage`). Silos that requests flow through also self-refresh from live rate-limit events; idle silos do not.

## Detecting stale or missing evidence

### Check modification times

```bash
ls -l ~/.claude-farm/usage/*/claude.json
```

**Healthy:** All files modified within the last 90 seconds (if the app is running) or within the last app session.

**Stale:** Files not modified for hours or days. This happens when:
- The desktop app has not run recently
- A silo's OAuth refresh failed silently (network issue, expired token)
- The app is running but not pinging that silo

### Check file content

```bash
cat ~/.claude-farm/usage/<silo>/claude.json
```

**Healthy file structure:**
```json
{
  "silo": "<silo-name>",
  "provider": "claude",
  "refreshed": "2026-07-11T18:00:00Z",
  "session": { "remaining": 1000000, "limit": 2000000 },
  "weekly": { "remaining": 500000, "limit": 1000000 },
  "model": { "claude-opus": { "remaining": 300000, "limit": 500000 }, ... }
}
```

**Red flags:**
- `"refreshed"` timestamp is in the past (compare with `date -u`)
- `"remaining"` is zero for all buckets (quota exhausted)
- `"remaining"` is null or missing (parse error or incomplete refresh)
- File is empty or truncated

### Check for missing silos

```bash
ls ~/.claude-farm/accounts/   # list all account silos
ls ~/.claude-farm/usage/      # list silos with evidence
```

Every account silo should have an evidence file. If a silo is missing from `usage/`, that silo has never refreshed (e.g., right after `farm setup`, before the first OAuth ping) or never had valid credentials.

## Evidence scoring and routing impact

When evidence is stale or missing:
- **Rota gateway**: the silo scores a conservative **0.5** and is usable but never preferred over a silo with fresh evidence (`docs/rota-gateway-scoring-model.md`).
- **Handoff planner**: same floor of 0.5 (`docs/capacity-consumers-scoring-differences.md`).

This is correct behavior, not a bug: a silo with unproven headroom should not out-compete one with known headroom. However, if *all* silos are stale, all will score 0.5, and you will get unpredictable routing because no silo has better evidence than another.

## Recovery procedures

### Case 1: Stale evidence (app not running recently)

1. **Run the desktop app** and let it refresh:
   ```bash
   open /Applications/AgentFarm.app      # macOS
   # or launch from your launcher
   ```
   Click `Crew → Refresh` — that is what re-OAuths every silo. Waiting for the heartbeat will not do it.

2. **Verify** evidence is fresh:
   ```bash
   ls -l ~/.claude-farm/usage/*/claude.json | head -5
   ```
   Timestamps should be recent.

3. If evidence is still stale after the app ran, suspect a credential or network issue — see Case 3 below.

### Case 2: Missing evidence for one silo

1. Confirm the silo exists and has healthy credentials:
   ```bash
   cat ~/.claude-farm/usage/<silo>/claude.json   # does it exist?
   ```
   If missing, proceed to step 2.

2. Run the desktop app to refresh that silo:
   ```bash
   open /Applications/AgentFarm.app
   # Wait 90-120 seconds for a heartbeat
   ls -l ~/.claude-farm/usage/<silo>/claude.json   # check if it appeared
   ```

3. If it still doesn't appear:
   - Check the silo's credentials are valid (log into that silo and re-authenticate the provider)
   - Check the app logs for OAuth errors for that silo
   - If the silo has no credentials set up yet, run `farm equip <provider>` inside that silo first

### Case 3: Corrupted evidence or parse errors

1. **Backup the file** (in case you need to debug):
   ```bash
   cp ~/.claude-farm/usage/<silo>/claude.json ~/.claude-farm/usage/<silo>/claude.json.bak
   ```

2. **Delete the corrupted file**:
   ```bash
   rm ~/.claude-farm/usage/<silo>/claude.json
   ```

3. **Refresh** to regenerate it:
   ```bash
   open /Applications/AgentFarm.app
   # Wait for the app to heartbeat (~90 seconds)
   ```
   The app will write a fresh evidence file.

4. **Verify**:
   ```bash
   cat ~/.claude-farm/usage/<silo>/claude.json | jq .   # pretty-print and check structure
   ```

### Case 4: Bulk recovery after downtime

If the app didn't run for hours/days and all evidence is stale:

1. **Launch the app**:
   ```bash
   open /Applications/AgentFarm.app
   ```

2. **Manually force a refresh**:
   - Click `Crew` (in the app).
   - Click the `Refresh` button. (The heartbeat alone will not re-fetch.)
   - Wait 2-3 minutes for all silos to re-OAuth.

3. **Verify all silos have fresh evidence**:
   ```bash
   for silo in ~/.claude-farm/accounts/*/; do
     silo_name=$(basename "$silo")
     mod_time=$(stat -f %m "~/.claude-farm/usage/$silo_name/claude.json" 2>/dev/null || echo 0)
     age=$(($(date +%s) - mod_time))
     echo "$silo_name: ${age}s old"
   done
   ```
   All should be under 120 seconds old.

### Case 5: Suspected evidence corruption across multiple silos

If *multiple* silos have corrupted or unparseable evidence, and refreshing doesn't help:

1. **Nuke the entire evidence directory** (this is a last resort):
   ```bash
   rm -rf ~/.claude-farm/usage/
   mkdir -p ~/.claude-farm/usage/
   ```

2. **Refresh**:
   ```bash
   open /Applications/AgentFarm.app
   # Wait for heartbeat(s) to regenerate all evidence
   ```

3. **Verify**:
   ```bash
   ls ~/.claude-farm/usage/*/claude.json | wc -l    # should match number of silos
   ```

## Prevention

- **Refresh explicitly** during development, or cron `farm.usage.ping` — merely keeping the app running does not re-fetch evidence.
- **Run `Crew → Refresh`** manually if you know you've had long downtime.
- **Monitor evidence age** after extended app downtime or network issues — stale evidence will make routing conservative, but that's better than corruption.
- **Never hand-edit evidence files** (`docs/capacity-consumers-scoring-differences.md`) — they are machine-written and edits will be overwritten on the next refresh.

See also [[use-rota-gateway]] for how fresh evidence affects routing decisions.
