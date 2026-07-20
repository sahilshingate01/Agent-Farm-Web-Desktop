---
name: pair-agensis-workspace
description: Pair a Farm with one Agensis workspace via the one-time device-code flow, exchanging it for a scoped agf_ integration token — the prerequisite for distributed silos, remote machines, and managed sandboxes
---

# Pair the Farm with an Agensis workspace

Everything on the distributed side of the farm — remote machines, E2B/Daytona sandboxes, sessionless jobs — is reached through an Agensis workspace the Farm has been **paired** to (`docs/distributed-silos.md`). Local Apple-container silos (`workflows/onboard-account-silo.md`) need none of this; pairing is only for the `farmd`/`crew` distributed surface (`docs/control-surfaces-rota-vs-crew.md`).

## Step 1: Start the device-code flow

```bash
farm pair --url https://agensis.io
```

Farm prints a short device code and an Agensis approval URL.

## Step 2: Approve in the workspace

A signed-in workspace **manager** opens the URL, selects exactly one workspace, and approves the requested scopes. The one-time device code is then exchanged for a scoped `agf_` integration token.

> This is a human, one-time approval — do not script around it or ask for the code out of band.

## Step 3: Confirm the token landed

The scoped token is written owner-only at:

```text
~/.usage-farm/integrations/agensis/<workspace-id>.json
```

```bash
cat ~/.usage-farm/integrations/agensis/<workspace-id>.json   # confirm present, owner-only perms
farm silos                                                   # paired daemons now discoverable
```

The integration file and its parent directory use owner-only permissions (`docs/distributed-silos.md`). Silo descriptors under `~/.usage-farm/silos/` hold only public routing/lifecycle data — the pairing token is the sensitive part.

## Notes

- One `farm pair` scopes to **exactly one** workspace. Pair again for a second workspace.
- Pairing does **not** provision compute — it authorizes it. Create workers with `farm silo create` (`workflows/provision-managed-cloud-silo.md`).
- The token never grants provider credentials; those stay inside each silo's environment (`README.md`).
