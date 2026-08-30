# Vendored code notice

The code in this directory is © Inkeep contributors, licensed under
**GPL-3.0-or-later**, vendored from
https://github.com/inkeep/open-knowledge (`packages/app/src/editor`,
`packages/app/src/components/ui`, `packages/app/src/globals.css`, and
`packages/core/src` under `core/`), vendored 2026-07-11.

claude-farm is licensed AGPL-3.0-or-later. The upstream GPL-3.0-or-later
editor code is combined under the compatibility terms in AGPL section 13.

## Layout

- `core/` — verbatim copy of OpenKnowledge core's markdown <-> ProseMirror
  pipeline (`MarkdownManager`) and fidelity extension set (the transitive
  closure of `core/src/markdown/index.ts` + `core/src/extensions/shared.ts`).
- `extensions/`, `slash-command/`, `bubble-menu/`, `block-ux/` — app-side
  editor chrome (slash menu, bubble menu, drag handle, code-block NodeView,
  tables UX, keyboard nav).
- `ui/` — the shadcn-style primitives those files import, copied from OK.
- `editor.css` — the editor sections of OK's `globals.css`.
- `core-index.ts`, `lib/`, `undo-redo.ts`, `OkMarkdownEditor.tsx` — local
  glue written for this vendoring (not upstream code).

## Modifications from upstream

- Collaboration layer removed entirely (yjs / Hocuspocus / y-tiptap,
  awareness, editor pooling, agent-flash). `OkMarkdownEditor.tsx` mounts a
  plain TipTap editor instead and does markdown conversion client-side via
  the vendored `MarkdownManager` (upstream converts server-side over a CRDT).
- `@inkeep/open-knowledge-core` imports point at the local `core-index.ts`
  barrel; its OTel metric counters are stubbed to no-ops.
- Lingui i18n macros (`t`, `Trans`, `msg`, `useLingui`) replaced with plain
  English strings.
- `.ts`/`.tsx` import-specifier extensions stripped (host tsconfig does not
  enable `allowImportingTsExtensions`).
- `CodeBlockView.tsx`: html-preview iframe, resize handles, Ask-AI button and
  modal source editor stubbed out (code-only view).
- `BubbleMenuBar.tsx` / `bubble-menu-state.ts`: EditWithAi, Footnote, File,
  ImageAlign and LinkEditPopover buttons removed; find-replace and
  mark-identity checks removed.
- `drag-handle.ts`: jsx-descriptor (registry/component-items) branches
  removed; native-block behavior kept.
- `slash-command/items.tsx`: inline-math item removed (its auto-open popover
  machinery is not vendored).
- `wiki-link-helpers.ts`: upstream's `PageListCacheSnapshot` type inlined
  (page-list cache itself not vendored). Wiki links render as chips via the
  core extension; live resolution/navigation is TODO(editor-ok).
- `editor.css`: tailwind-scrollbar plugin utilities replaced with plain
  `scrollbar-width`; OK theme tokens the host lacks declared in an `@theme`
  block.
