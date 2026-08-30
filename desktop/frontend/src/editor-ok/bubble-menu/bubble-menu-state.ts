/**
 * Pure editor-state predicates for the WYSIWYG bubble menu: when the bar is
 * visible, and how a ⌘K press routes while a link affordance could apply.
 *
 * Kept out of `BubbleMenuBar` so `LinkEditPopover`'s shortcut listener can
 * share the bar's exact visibility predicate without an import cycle
 * (BubbleMenuBar → LinkEditPopover → this module).
 */

import type { Editor } from '@tiptap/react';

export function shouldShowBubbleMenu({ editor }: { editor: Editor }): boolean {
  if (editor.isActive('codeBlock')) return false;
  if (editor.state.selection.empty) return false;
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, ' ');
  if (!text.trim()) return false;
  return true;
}
