/**
 * Minimal shim for OpenKnowledge's `@/lib/keyboard-shortcuts` — only the
 * surface the vendored bubble-menu consumes (`formatShortcut`,
 * `formatShortcutLabel`, `KeyboardShortcutId`). Upstream's module is
 * lingui-localized and app-wide; here we inline the wysiwyg format bindings.
 */
import { isMacOS } from '@tiptap/core'

export type KeyboardShortcutId =
  | 'format-bold'
  | 'format-italic'
  | 'format-underline'
  | 'format-strike'
  | 'format-inline-code'
  | 'format-highlight'

const BINDINGS: Record<KeyboardShortcutId, { mac: string; windowsLinux: string }> = {
  'format-bold': { mac: '⌘ B', windowsLinux: 'Ctrl B' },
  'format-italic': { mac: '⌘ I', windowsLinux: 'Ctrl I' },
  'format-underline': { mac: '⌘ U', windowsLinux: 'Ctrl U' },
  'format-strike': { mac: '⇧⌘ X', windowsLinux: 'Ctrl Shift X' },
  'format-inline-code': { mac: '⌘ E', windowsLinux: 'Ctrl E' },
  'format-highlight': { mac: '⇧⌘ H', windowsLinux: 'Ctrl Shift H' },
}

export function formatShortcut(id: KeyboardShortcutId): string {
  const binding = BINDINGS[id]
  return isMacOS() ? binding.mac : binding.windowsLinux
}

export function formatShortcutLabel(id: KeyboardShortcutId): string {
  return formatShortcut(id)
}
