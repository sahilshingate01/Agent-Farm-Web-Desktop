---
title: Maintaining the Vendored Open Knowledge Editor
description: How to track, patch, and upgrade the GPL-licensed Open Knowledge editor vendored in desktop/frontend/src/editor-ok.
---

# Maintaining the Vendored Open Knowledge Editor

The desktop app vendors React editor code from Inkeep's Open Knowledge (https://github.com/inkeep/open-knowledge), licensed GPL-3.0-or-later. This guide tracks what's vendored, what's been modified, and how to upgrade.

## Vendoring Source

**Upstream**: https://github.com/inkeep/open-knowledge  
**Packages vendored**: `packages/app/src/editor`, `packages/app/src/components/ui`, `packages/app/src/globals.css`, `packages/core/src`  
**Vendored date**: 2026-07-11  
**License**: GPL-3.0-or-later (compatible with claude-farm's AGPL-3.0-or-later license under AGPL section 13)

## Directory Layout

### `core/`
Verbatim copy of OpenKnowledge's markdown ↔ ProseMirror pipeline:
- `MarkdownManager`: Markdown serialization/deserialization (the critical piece)
- Fidelity extensions (transitive closure of `core/src/markdown/index.ts` + `core/src/extensions/shared.ts`)
- **Do not patch**: If changes are needed, they should be upstreamed or wrapped locally.

### `extensions/`, `slash-command/`, `bubble-menu/`, `block-ux/`
App-side editor chrome (slash commands, bubble menu, drag handles, tables UX, code-block NodeView).
- **OK-sourced but app-scoped**: These are close enough to upstream that they should be compared before each upgrade.

### `ui/`
Shadcn-style primitive components copied from OK.
- **Risk area**: These may diverge from upstream; track versions.

### `editor.css`
Vendored from OK's `globals.css` (editor sections only).
- **Maintenance point**: If OK updates global styles, this may need refresh.

### Local Glue Code
- `core-index.ts`: Barrel export for local `@inkeep/open-knowledge-core` references
- `lib/`: Utility functions written for this vendoring
- `undo-redo.ts`: Custom undo/redo (replaces upstream yjs collaboration)
- `OkMarkdownEditor.tsx`: Component wrapper; client-side markdown conversion via vendored `MarkdownManager`

## Key Modifications from Upstream

### Removed: Collaboration Layer
Upstream uses Yjs (CRDT) + Hocuspocus for real-time collaboration. Vendored version removes:
- `yjs` / `y-tiptap` / Hocuspocus imports
- Awareness protocol
- Editor pooling
- Agent-flash collaboration UI

**Why**: Desktop app is single-user; collaboration overhead not needed. Markdown is synced offline.

### Replaced: i18n (Lingui)
Upstream uses Lingui macros (`t`, `Trans`, `msg`, `useLingui`).  
Vendored version: All replaced with English strings.

**When upgrading**: If OK adds new strings, you'll need to i18n-strip or translate them.

### Removed: HTML Preview
Upstream `CodeBlockView.tsx` has an iframe HTML preview, resize handles, and an "Ask-AI" modal.  
Vendored version: Code-only NodeView (no HTML preview or Ask-AI button).

**Patching**: If you need HTML preview, wrap the NodeView rather than patching core.

### Removed: Inline Editing Features
Upstream `BubbleMenuBar.tsx` has: EditWithAi, Footnote, File, ImageAlign, LinkEditPopover buttons.  
Vendored version: Only core editing buttons remain.

### Fixed: Import Specifiers
Upstream `.ts`/`.tsx` files use explicit extensions (`import { x } from './foo.ts'`).  
Vendored version: Extensions stripped (host `tsconfig` does not enable `allowImportingTsExtensions`).

**Upgrade check**: After pulling new code, run `grep -r 'from.*\.tsx\?['"]' desktop/frontend/src/editor-ok/` and strip extensions.

### Stubbed: @inkeep/open-knowledge-core OTel Metrics
Upstream exports OTel metric counters.  
Vendored version: Replaced with no-op stubs (desktop doesn't use observability yet).

## Upgrade Checklist

When a new Open Knowledge release comes out:

1. **Clone upstream** to a temp directory and check the changelog
2. **Compare packages**: diff your local `editor-ok/` against upstream source
3. **Identify breaking changes**: New i18n strings? New file format? New extension?
4. **Apply modifications**:
   - Strip `.ts`/`.tsx` import extensions
   - Replace Lingui macros with English strings
   - Remove yjs/collaboration imports
   - Stub OTel metrics if new code added
5. **Test**:
   - Load app and open editor
   - Create/edit a document
   - Verify Markdown serialization (most critical)
   - Check slash commands, bubble menu, tables
6. **Commit**: One commit per major chunk (core update, UI updates, glue updates)

## Known Fragile Points

- **MarkdownManager**: The core serialization logic. Any change here is high-risk; test thoroughly after upgrade.
- **Extensions**: If OK adds new TipTap extensions, ensure they're in `fidelity extensions` closure or skip them.
- **UI primitives**: If upstream changes button/input APIs, glue code may break.
- **CSS**: If OK changes editor styling, your overrides in `editor.css` may conflict.

## Upstream Communication

If you find bugs or need features:
- Patches that benefit OK → upstream first, then vendor the fix
- Desktop-specific features → keep local (don't upstream)
- GPL compliance questions → check inkeep/open-knowledge issues
