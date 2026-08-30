/**
 * OkMarkdownEditor — WYSIWYG markdown editor assembled from OpenKnowledge's
 * vendored editor code (see VENDORED-NOTICE.md).
 *
 * Upstream mounts its TipTap editor on a Hocuspocus/yjs CRDT provider and
 * converts markdown server-side. This component replaces that collab layer
 * with a plain controlled contract: markdown string in (`value`), markdown
 * string out (`onChange`), converted client-side through the vendored
 * `MarkdownManager` (OK's CommonMark/GFM/MDX round-trip pipeline, including
 * raw-mdx-fallback preservation of unrecognized syntax).
 */
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/editor-ok/ui/tooltip'
import { BubbleMenuBar } from './bubble-menu/BubbleMenuBar'
import { KeyboardNav } from './block-ux/keyboard-nav'
import { MarkdownManager, sharedExtensions } from './core-index'
import {
  prependFrontmatter,
  stripFrontmatter,
} from './core/extensions/frontmatter'
import { BlockMover } from './extensions/block-mover'
import { CodeBlockFidelity } from './extensions/code-block'
import { BlockDragHandle } from './extensions/drag-handle'
import { FormattingShortcuts } from './extensions/formatting-shortcuts'
import { FrozenTableHeaders } from './extensions/frozen-table-headers'
import { HeadingAnchors } from './extensions/heading-anchors'
import { SlashCommand } from './extensions/slash-command'
import { TabFocusTrap } from './extensions/tab-focus-trap'
import { TableInsertControls } from './extensions/table-insert-controls'
import { UndoRedo } from './undo-redo'

export interface OkMarkdownEditorHandle {
  /** Parse a markdown snippet through the OK pipeline and insert it at the
   *  current cursor (replacing any live selection). */
  insertMarkdown: (markdown: string) => void
}

export interface OkMarkdownEditorProps {
  /** Markdown source. The editor re-parses when this diverges from its last
   *  emitted value (external file switch / agent edit). Key the component by
   *  document path so undo history doesn't bleed across documents. */
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  /** Imperative surface for the host (e.g. AI-response insertion). Set to
   *  the live handle on mount, nulled on unmount. */
  editorApi?: MutableRefObject<OkMarkdownEditorHandle | null>
}

/**
 * Editor extension list — OK core's schema/fidelity set (heading, unified
 * list incl. task items, tables, links, wiki links, code, footnotes,
 * raw-mdx-fallback, …) with the app-side CodeBlock swap (lowlight highlight
 * plugin + React NodeView), plus the vendored editor-UX extensions.
 * Mirrors upstream `editor/extensions/shared.ts` minus the collab, file
 * upload, find-replace, tag and jsx-descriptor surfaces (not vendored).
 */
const editorExtensions = [
  ...sharedExtensions.map((ext) => (ext.name === 'codeBlock' ? CodeBlockFidelity : ext)),
  // Upstream disables StarterKit's UndoRedo because yjs owns history; there
  // is no collab layer here, so plain ProseMirror history comes back.
  UndoRedo,
  SlashCommand,
  FormattingShortcuts,
  TabFocusTrap,
  HeadingAnchors,
  BlockDragHandle,
  BlockMover,
  TableInsertControls,
  KeyboardNav,
  FrozenTableHeaders,
]

export function OkMarkdownEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  editorApi,
}: OkMarkdownEditorProps) {
  // Schema-bearing extensions only — the UX extensions above add no nodes or
  // marks, so core's shared set yields the same schema the editor runs.
  const mdManager = useMemo(() => new MarkdownManager({ extensions: sharedExtensions }), [])
  // The markdown this component last saw (in either direction). Guards the
  // controlled-value loop: onUpdate emits -> parent state -> value prop comes
  // back identical -> no re-parse (which would drop the caret).
  const lastMarkdownRef = useRef(value)
  // YAML frontmatter is document metadata, not editor content — upstream
  // strips it before parse and re-prepends after serialize (server-side);
  // do the same here or a WYSIWYG edit would silently drop it.
  const frontmatterRef = useRef(stripFrontmatter(value).frontmatter)
  const initialContent = useMemo(
    () => mdManager.parseWithFallback(stripFrontmatter(value).body),
    // Initial mount only — later external changes go through the sync effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mdManager],
  )

  const editor = useEditor({
    extensions: [
      ...editorExtensions,
      Placeholder.configure({
        placeholder: placeholder ?? "Type '/' for commands",
        showOnlyCurrent: true,
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'pt-4 pb-4 h-full',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
    },
    onUpdate({ editor }) {
      let markdown: string
      try {
        markdown = prependFrontmatter(
          frontmatterRef.current,
          mdManager.serialize(editor.getJSON()),
        )
      } catch (err) {
        console.warn('[OkMarkdownEditor] serialize failed — edit not propagated', err)
        return
      }
      if (markdown === lastMarkdownRef.current) return
      lastMarkdownRef.current = markdown
      onChange(markdown)
    },
  })

  useEffect(() => {
    if (!editor || !editorApi) return
    editorApi.current = {
      insertMarkdown(markdown) {
        try {
          const json = mdManager.parseWithFallback(stripFrontmatter(markdown).body)
          editor.chain().focus().insertContent(json.content ?? []).run()
        } catch {
          // Snippet failed to parse — insert as plain text rather than dropping it.
          editor.chain().focus().insertContent(markdown).run()
        }
      },
    }
    return () => {
      editorApi.current = null
    }
  }, [editor, editorApi, mdManager])

  // External value change (file switched under the same key, or an agent
  // rewrote the doc): re-parse into the live editor.
  useEffect(() => {
    if (!editor) return
    if (value === lastMarkdownRef.current) return
    lastMarkdownRef.current = value
    const { frontmatter, body } = stripFrontmatter(value)
    frontmatterRef.current = frontmatter
    editor.commands.setContent(mdManager.parseWithFallback(body))
  }, [value, editor, mdManager])

  return (
    // Upstream mounts a TooltipProvider at app scope; the vendored bubble
    // menu's Tooltips need one, so provide it at the editor root here.
    <TooltipProvider>
      <div className={cn('tiptap-editor ok-markdown-editor', className)}>
        {editor ? <BubbleMenuBar editor={editor} /> : null}
        <EditorContent editor={editor} />
      </div>
    </TooltipProvider>
  )
}
