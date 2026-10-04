---
title: Tracking intentional modifications to vendored libraries
description: Maintain a ledger of deliberate changes to vendored code (removals, replacements, patches) to guide safe upgrades and prevent reversion.
---

# Tracking intentional modifications to vendored libraries

When vendoring third-party code, modifications are often necessary (remove unused features, replace i18n, stub collaboration). This guide maintains a ledger so future upgrades don't accidentally revert intentional changes or miss incompatibilities.

## Modification categories

### Removals (features no longer needed)

**Format**: `REMOVED: <feature> from <file> | reason: <why>`

Example from Open Knowledge editor:
```
REMOVED: Collaboration layer (yjs, Hocuspocus, y-tiptap, awareness) | reason: single-user client-side edit, no CRDT needed
REMOVED: html-preview iframe from CodeBlockView.tsx | reason: code-only view, no preview needed
REMOVED: Ask-AI button and modal source editor from CodeBlockView.tsx | reason: not in desktop spec
REMOVED: EditWithAi, Footnote, File, ImageAlign, LinkEditPopover buttons from BubbleMenuBar.tsx | reason: not in desktop spec
REMOVED: find-replace from BubbleMenuBar.tsx | reason: not in current desktop UI
```

### Replacements (swapping dependencies or patterns)

**Format**: `REPLACED: <original> with <replacement> in <file> | reason: <why>`

Example:
```
REPLACED: Lingui i18n macros (t, Trans, msg, useLingui) with plain English strings | reason: no i18n needed for single-user desktop app
REPLACED: server-side markdown conversion (yjs CRDT) with client-side MarkdownManager in OkMarkdownEditor.tsx | reason: single-user no need for sync
REPLACED: yjs-based undo/redo with custom undo-redo.ts | reason: no collaboration, simpler local undo stack
```

### Patches (small targeted fixes)

**Format**: `PATCHED: <location> | reason: <why> | change: <one-liner>`

Example:
```
PATCHED: import statements throughout | reason: host tsconfig does not enable allowImportingTsExtensions | change: strip .ts/.tsx extensions from imports
PATCHED: OTel metric counters in core-index.ts | reason: observability not needed in desktop | change: stubbed to no-ops
```

### Local glue (new files written for this vendoring)

**Format**: `ADDED: <file> | purpose: <what it does>`

Example:
```
ADDED: core-index.ts | purpose: barrel export for @inkeep/open-knowledge-core references; resolves local vendored packages
ADDED: lib/ | purpose: utility functions for vendoring (markdown conversion, editor setup)
ADDED: undo-redo.ts | purpose: custom undo/redo replacing yjs, tailored to single-user case
ADDED: OkMarkdownEditor.tsx | purpose: wrapper mounting plain TipTap editor with client-side markdown conversion
```

## Using the ledger during upgrades

### Before applying upstream changes:

1. **Enumerate modifications** — build a current ledger from the vendoring documents
2. **Check upstream diffs** — what changed in each upstream file?
3. **Assess conflicts**:
   - If upstream changed `CodeBlockView.tsx`, does it conflict with our removals? (Likely no, removals are UI)
   - If upstream changed `MarkdownManager`, test fidelity — we kept this core piece
   - If upstream added new dependencies, check if they're needed (e.g., new i18n, collaboration)

### After applying upstream changes:

1. **Re-apply modifications** — using the ledger as a checklist, re-apply each removal, replacement, patch
2. **Update the ledger** — add new modifications if upstream changes required tweaks
3. **Test fidelity** — markdown round-trip, extension behavior, no visual regressions

## Example: Open Knowledge editor vendoring ledger

**Vendored date**: 2026-07-11  
**Upstream**: https://github.com/inkeep/open-knowledge  
**Packages**: `packages/app/src/editor`, `packages/app/src/components/ui`, `packages/core/src`, `packages/app/src/globals.css`

### Removals
- Collaboration layer (yjs, Hocuspocus, awareness, pooling, agent-flash)
- html-preview iframe and resize handles from CodeBlockView
- Ask-AI button and modal source editor from CodeBlockView
- EditWithAi, Footnote, File, ImageAlign, LinkEditPopover from BubbleMenuBar
- find-replace from BubbleMenuBar

### Replacements
- Lingui i18n → English strings
- Server-side CRDT conversion → client-side MarkdownManager
- yjs undo/redo → custom single-user stack

### Patches
- Import extensions `.ts`/`.tsx` stripped
- OTel metric stubs

### Local glue
- `core-index.ts` barrel (resolve @inkeep/open-knowledge-core)
- `lib/` utilities
- `undo-redo.ts` custom implementation
- `OkMarkdownEditor.tsx` wrapper

## When to update the ledger

- **After each upgrade**: Document any new removals or patches needed
- **If maintenance changes approach**: Update reason/motivation if context shifts
- **Before handoff**: Ensure ledger is clear and complete for the next maintainer
