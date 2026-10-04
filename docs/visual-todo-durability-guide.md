---
title: Implementing Durable Visual TODO State
description: How to persist TODO status using an append-only ledger, preventing loss from browser clears or session resets.
---

# Implementing Durable Visual TODO State

Browser-based TODO state (localStorage, sessionStorage, in-memory React) is fragile: users clear caches, browsers crash, tabs refresh. The durable pattern uses an append-only ledger in the project filesystem.

## The project invariant

- **Source of truth**: `.agensis/visual-todos.jsonl` (append-only ledger)
- **User authority**: A user-set status is never overwritten unless there is an explicit state transition
- **Presentation layer**: Browser-held visual TODO markers are UI-only; clearing them must not lose state
- **Transactions**: Each status change appends a new ledger entry; never mutate existing entries

## Ledger Format

Each line in `.agensis/visual-todos.jsonl` is a JSON object:

```json
{"id":"todo-uuid","timestamp":"2026-07-11T15:30:00Z","action":"created","title":"...","status":"open"}
{"id":"todo-uuid","timestamp":"2026-07-11T16:15:00Z","action":"status-changed","oldStatus":"open","newStatus":"in-progress","reason":"user-click"}
{"id":"todo-uuid","timestamp":"2026-07-11T17:00:00Z","action":"status-changed","oldStatus":"in-progress","newStatus":"completed","reason":"user-click"}
```

### Required Fields
- `id`: Stable UUID for the TODO
- `timestamp`: ISO 8601 UTC
- `action`: `created`, `status-changed`, `title-changed`, `deleted` (via tombstone)
- Ledger is append-only; never edit or remove lines

### Status Transitions
Valid transitions depend on action:
- `status-changed`: include `oldStatus`, `newStatus`, `reason` (e.g., "user-click", "auto-resolved", "task-complete")
- `title-changed`: include `newTitle`
- `deleted`: logical deletion; mark with tombstone entry

## Rebuilding State from Ledger

On app boot:

1. Load `.agensis/visual-todos.jsonl` line-by-line
2. For each line, apply the action to an in-memory TODO map
3. Skip entries for deleted TODOs (tombstone entries)
4. Use the latest non-deleted entry per `id` as the current state
5. Display in UI

## Migration: From Browser Storage

If you have existing TODOs in browser storage:

1. On first load, detect old TODOs
2. For each old TODO, append a ledger entry: `{"action": "migrated", "id": "...", "timestamp": "...", ...}`
3. Clear browser storage
4. Rebuild state from ledger (step above)

## Visual TODO overlay integration

The visual annotation overlay holds presentation state only:
- Markers may be cleared at any time
- Clearing markers does not delete TODOs from the ledger
- On next load, the overlay re-renders all non-deleted TODOs from the ledger
- Overlay updates are UI-only; always persist state changes to the ledger first

## Testing

1. Create a TODO → verify line appears in `.agensis/visual-todos.jsonl`
2. Change status → verify new line appended (old line unchanged)
3. Close and reopen app → verify TODO state matches ledger
4. Clear browser storage → re-load app → verify state intact
5. Delete a TODO → verify tombstone entry in ledger
