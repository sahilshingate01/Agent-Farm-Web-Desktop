---
name: monitor-distributed-silo-connectivity
description: 'Detect when a remote Agensis machine or managed cloud silo becomes unreachable through the relay; diagnose the failure; and recover connectivity'
phases:
  - title: 'Detect unreachability'
  - title: 'Diagnose the failure'
  - title: 'Recover connectivity'
---

# Monitor and detect distributed silo connectivity failures

The distributed control plane (`farmd`) routes work to local account silos, remote Agensis machines, and managed E2B/Daytona sandboxes through a relay. When a remote silo becomes unreachable — network failure, the Agensis daemon crashed, or the sandbox timed out — the relay cannot deliver work. This workflow detects the failure, diagnoses its cause, and recovers connectivity.

## Phase 1: Detect unreachability

A remote silo that cannot be reached will fail to accept work. Watch for these symptoms:

### Symptom 1: `farm silos` shows the silo as unreachable

```bash
farm silos
```

Look for the silo's status column. Expected states:
- `ready` — silo is up and responding
- `paused` — silo is paused (intentionally offline)
- `unreachable` — silo is not responding to the relay

**If unreachable:** proceed to Phase 2.

### Symptom 2: Work routed to the silo fails immediately

When you request the `crew` model and work lands on a distributed silo that is unreachable, the request fails with a relay timeout or connection refused. Example:

```bash
claude --model crew --prompt "hello"
# error: silo <name> timed out after 30s
```

**If you see this:** the silo's relay connection is down. Proceed to Phase 2.

### Symptom 3: Usage evidence from a distributed silo is missing

```bash
cat ~/.claude-farm/usage/<remote-silo-name>/claude.json
# file not found, or file is stale (not modified in > 24 hours)
```

Remote silos can only refresh evidence if the relay is up. Missing or stale evidence for a remote silo suggests relay failure or that the remote daemon has not pinged back.

## Phase 2: Diagnose the failure

Determine where the connection is broken: the relay itself, the remote daemon, or the Agensis workspace.

### Step 1: Confirm the local control plane is running

```bash
farm serve   # or: kill -0 $(pgrep -f farmd) && echo "farmd is running"
```

If `farmd` is not running, start it:

```bash
farm serve &   # start in background
```

If `farmd` crashes or won't start, check its logs:

```bash
tail -f ~/.usage-farm/farmd-runtime.json   # look for errors
```

### Step 2: Confirm the Agensis workspace token is valid

```bash
cat ~/.usage-farm/integrations/agensis/<workspace-id>.json
```

If the file is missing or stale, the workspace pairing is broken:

```bash
farm pair --url https://agensis.io   # re-pair (one-time approval required)
```

### Step 3: Test the relay to the remote daemon

If it is a **remote Agensis machine**, SSH to it and confirm the daemon is running:

```bash
ssh <user>@<remote-machine>
agensis status   # or: ps aux | grep agensis-daemon
```

If the daemon is not running, start it (depends on how it was set up; typically `systemctl start agensis-daemon` or `agensis serve`).

If it is a **managed E2B/Daytona sandbox**, confirm the sandbox is still running:

```bash
farm silo start <silo-id>   # if paused, bring it up
farm silos                  # check its status
```

E2B and Daytona sandboxes can time out and be reclaimed if unused. If the status is `terminated`, the sandbox is gone — see step 5 below.

### Step 4: Test connectivity from the relay to the remote

On the host, ask the relay to ping the remote daemon:

```bash
# This is a diagnostic command (if exposed; check farmd docs)
farm relay ping <remote-daemon-name>
# or check farmd logs:
tail -f ~/.usage-farm/farmd-runtime.json | grep <remote-daemon-name>
```

If the relay cannot reach the remote, check:
- Network connectivity: can the host reach the remote's network? (ping, ssh)
- Firewall rules: does the remote allow inbound connections from the host?
- Agensis workspace routing: are the host and remote in the same workspace?

## Phase 3: Recover connectivity

Recovery depends on where the connection broke:

### Recovery 1: Relay (farmd) is down

```bash
farm serve   # start the portable control plane
```

If it crashes on startup, check:

```bash
farm serve --debug   # enable verbose logging
```

and read the logs in `~/.usage-farm/farmd-runtime.json`.

### Recovery 2: Remote Agensis machine daemon is down

SSH to the machine and restart its daemon:

```bash
ssh <user>@<remote-machine>
agensis serve &   # or: systemctl restart agensis-daemon
exit
```

Wait ~10 seconds for the daemon to reconnect through the relay.

### Recovery 3: Managed cloud silo is paused or terminated

If the silo is **paused**:

```bash
farm silo start <silo-id>
```

Wait for it to become `ready`:

```bash
farm silos | grep <silo-id>
```

If the silo is **terminated** (reclaimed by E2B/Daytona after inactivity), it is gone:

```bash
farm silo create e2b   # or: daytona
```

to stand up a new one. Refer to `workflows/provision-managed-cloud-silo.md`.

### Recovery 4: Workspace pairing is broken

```bash
farm pair --url https://agensis.io
```

A workspace manager must approve the pairing one-time. After approval, the new token is written to `~/.usage-farm/integrations/agensis/<workspace-id>.json` and the relay can discover remote daemons again.

## Verification

After recovery, confirm the silo is reachable:

```bash
farm silos
# The silo should show status: ready

farm route <test-work-id> --account <remote-silo-name>
# should succeed with no relay timeout

cat ~/.usage-farm/usage/<remote-silo-name>/claude.json
# evidence should exist and be fresh
```

If `farm silos` still shows `unreachable`, the relay is still unable to reach it. Re-run Phase 2 diagnostics.
