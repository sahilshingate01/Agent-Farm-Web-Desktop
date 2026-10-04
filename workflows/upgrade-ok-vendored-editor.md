---
name: upgrade-ok-vendored-editor
description: 'Check upstream Open Knowledge changes, compare against local modifications, test fidelity, apply updates'
phases:
  - title: 'Audit upstream'
  - title: 'Diff local mods'
  - title: 'Apply and test'
---

# Upgrade vendored Open Knowledge editor

Open Knowledge (https://github.com/inkeep/open-knowledge) is actively maintained. This workflow safely applies upstream updates to the desktop editor.

## Prerequisites
- Upstream repo cloned or available locally
- Knowledge of what's been modified locally (see VENDORED-NOTICE.md)

## Phase 1: Audit upstream

1. Check upstream release notes / recent commits for changes to:
   - `packages/app/src/editor`
   - `packages/app/src/components/ui`
   - `packages/core/src` (MarkdownManager, fidelity extensions)
   - `packages/app/src/globals.css`

2. Document any changes to:
   - Markdown ↔ ProseMirror pipeline (core fidelity)
   - Extension set stability
   - UI primitive changes
   - Styling changes

## Phase 2: Diff local modifications

1. Cross-reference upstream changes against known local mods:
   - Collaboration layer removed (yjs, Hocuspocus, y-tiptap, awareness)
   - Lingui i18n macros replaced with English strings
   - Import-specifier extensions stripped (`.ts`/`.tsx` removed)
   - CodeBlockView: html-preview, resize handles, Ask-AI button removed
   - BubbleMenuBar: EditWithAi, Footnote, File, ImageAlign, LinkEditPopover removed
   - Custom undo-redo (replaces yjs)
   - OkMarkdownEditor.tsx client-side mount (vs upstream server-side CRDT)

2. Assess conflict risk:
   - Will upstream changes touch removed code? (low risk)
   - Will upstream changes affect MarkdownManager? (test fidelity)
   - Will styling changes break editor layout? (visual regression test)

## Phase 3: Apply and test

1. Update vendored files by copying from upstream
2. Re-apply local modifications (see VENDORED-NOTICE.md for checklist)
3. Update VENDORED-NOTICE.md vendored date
4. Run fidelity tests (markdown round-trip, extension behavior)
5. Visual smoke test: create document, edit, verify no layout issues
6. Verify OkMarkdownEditor.tsx still mounts correctly
