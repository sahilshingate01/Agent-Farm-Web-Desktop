/**
 * React NodeView for the visual-mode code block.
 *
 * Visual design — zero permanent chrome: the code body renders solo, with a
 * hover/selection-revealed chrome bar floating above the block edge that
 * carries the language picker, settings, copy, and delete affordances.
 *
 * TODO(editor-ok): upstream's html-preview iframe, resize handles, Ask-AI
 * button, and the modal source editor are stubbed out in this vendored copy —
 * this view is code-only.
 */

import type { NodeViewProps } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { Check, ChevronDown, Copy, Settings2, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/editor-ok/ui/command';
import { Input } from '@/editor-ok/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/editor-ok/ui/popover';
import { cn } from '@/lib/utils';
import { OPT_OUT_ATTR } from '@/editor-ok/lib/clipboard-opt-out';
import { CODE_BLOCK_LANGUAGES, normalizeCodeLanguage } from './code-block-languages';
import { getMetaTitle, setMetaTitle } from './code-block-meta';

const PLAIN_TEXT = 'plaintext';

function useCursorInside(editor: NodeViewProps['editor'], getPos: NodeViewProps['getPos']) {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    const compute = () => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (typeof pos !== 'number') return;
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return;
      const { from, to } = editor.state.selection;
      const start = pos;
      const end = pos + node.nodeSize;
      // Selection overlaps this node when from < end AND to > start.
      const next = from < end && to > start;
      // Equality guard: avoid scheduling a state update when the cursor-inside
      // bit didn't actually flip.
      setInside((prev) => (prev === next ? prev : next));
    };
    compute();
    editor.on('selectionUpdate', compute);
    return () => {
      if (!editor.isDestroyed) editor.off('selectionUpdate', compute);
    };
  }, [editor, getPos]);
  return inside;
}

export function CodeBlockView({ node, updateAttributes, editor, getPos, selected }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);
  const rawLanguage = (node.attrs.language as string | null) ?? null;
  const rawMeta = (node.attrs.meta as string | null) ?? null;
  const title = getMetaTitle(rawMeta);
  // Settings popover state — opens via the chrome's gear button, hosts
  // the title input.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  // React's `useId` gives each NodeView instance its own DOM ids so a doc
  // with multiple code blocks doesn't collide on `htmlFor` ↔ `id`
  // association.
  const baseId = useId();
  const titleInputId = `${baseId}-title-input`;
  const titleHelpId = `${baseId}-title-help`;
  const normalized = normalizeCodeLanguage(rawLanguage);
  const currentLabel = !rawLanguage
    ? 'Plain'
    : (CODE_BLOCK_LANGUAGES.find((l) => l.value === normalized)?.label ?? rawLanguage);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    },
    [],
  );

  const editable = editor.isEditable;
  const cursorInside = useCursorInside(editor, getPos);

  const handleCopy = () => {
    const text = node.textContent;
    // `writeText` returns a Promise; gate the success-state flip on actual
    // resolution so a permissions denial or insecure-context rejection
    // doesn't paint a misleading checkmark over a no-op write.
    const flipSuccess = () => {
      setCopied(true);
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 1200);
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(flipSuccess, () => {
          /* permission denial / insecure context — leave the icon as-is */
        });
      }
    } catch {
      /* sync throw (navigator absent in test env) — fail silent */
    }
  };

  const handleDelete = () => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos !== 'number') return;
    try {
      editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
    } catch (err) {
      // Concurrent edits can shift `pos` between getPos() and the chain run,
      // producing a RangeError — classify + log instead of letting the error
      // boundary catch what's actually a benign race.
      if (!(err instanceof RangeError)) throw err;
      console.warn('[CodeBlockView] delete failed — position race', err);
    }
  };

  // Live-commit pattern: every keystroke writes through to `meta`, no local
  // draft. An empty string removes the `title=…` token entirely so
  // backspacing to empty doesn't leave a stale `title=""` in the markdown.
  const handleTitleChange = (raw: string) => {
    const newMeta = setMetaTitle(rawMeta, raw.length > 0 ? raw : null);
    if (newMeta === rawMeta) return;
    updateAttributes({ meta: newMeta });
  };

  return (
    <NodeViewWrapper
      className="ok-codeblock relative my-3"
      data-language={rawLanguage ?? undefined}
      data-cursor-inside={cursorInside ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-code-visible="true"
      data-hovered={hovered ? 'true' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Title strip — rendered above the source whenever the fence carries
          `title="…"` in its info-string. Display-only here; the editable
          surface is the title input inside the settings popover. */}
      {title ? (
        <div
          className="ok-codeblock-title"
          contentEditable={false}
          data-testid="ok-codeblock-title"
          title={title}
        >
          <span className="ok-codeblock-title-text">{title}</span>
        </div>
      ) : null}

      <pre className="ok-codeblock-pre m-0 overflow-x-auto rounded-lg px-5 py-4 font-mono text-sm leading-relaxed">
        <NodeViewContent<'code'>
          as="code"
          className={cn(
            'hljs block whitespace-pre bg-transparent p-0',
            rawLanguage ? `language-${rawLanguage}` : undefined,
          )}
        />
      </pre>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation required inside PM NodeView */}
      <div
        className="ok-codeblock-chrome"
        contentEditable={false}
        onMouseDown={(e) => e.stopPropagation()}
        {...{ [OPT_OUT_ATTR]: 'true' }}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!editable}
              className="ok-codeblock-chrome-btn ok-codeblock-chrome-lang"
              aria-label={`Code block language: ${currentLabel}. Click to change.`}
            >
              <span>{currentLabel}</span>
              {editable ? <ChevronDown className="size-3 opacity-60" aria-hidden="true" /> : null}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-56 p-0">
            <Command
              filter={(value, search) => {
                if (!search) return 1;
                return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
              }}
            >
              <CommandInput placeholder="Filter languages" />
              <CommandList>
                <CommandEmpty>No language match.</CommandEmpty>
                <CommandGroup>
                  {CODE_BLOCK_LANGUAGES.map((lang) => {
                    // The Plain entry is active when the fence has no language
                    // (`null`) OR the user explicitly typed `plaintext` /
                    // an alias that normalizes to it.
                    const isActive =
                      lang.value === PLAIN_TEXT
                        ? !rawLanguage || normalized === PLAIN_TEXT
                        : normalized === lang.value;
                    return (
                      <CommandItem
                        key={lang.value}
                        value={`${lang.label} ${lang.value} ${lang.aliases?.join(' ') ?? ''}`}
                        onSelect={() => {
                          const next = lang.value === PLAIN_TEXT ? null : lang.value;
                          updateAttributes({ language: next });
                          setOpen(false);
                          editor.commands.focus();
                        }}
                      >
                        <span className="flex-1">{lang.label}</span>
                        {isActive ? <Check className="size-3.5" aria-hidden="true" /> : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {editable ? (
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="ok-codeblock-chrome-btn"
                data-active={title ? 'true' : undefined}
                aria-label="Code block settings"
              >
                <Settings2 className="size-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-64 p-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={titleInputId}
                  className="text-2xs font-mono uppercase tracking-wide text-muted-foreground"
                >
                  Title
                </label>
                <Input
                  id={titleInputId}
                  type="text"
                  value={title ?? ''}
                  placeholder="e.g. server.ts"
                  data-testid="ok-codeblock-title-input"
                  aria-describedby={titleHelpId}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter / Escape close the popover; the live-commit
                    // already happened on the prior `onChange` keystroke.
                    if (e.key === 'Enter' || e.key === 'Escape') {
                      e.preventDefault();
                      setSettingsOpen(false);
                    }
                  }}
                  className="h-8"
                />
                <p id={titleHelpId} className="text-2xs text-muted-foreground">
                  Shows above the code body. Round-trips as `title="..."` in markdown.
                </p>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        <button
          type="button"
          className="ok-codeblock-chrome-btn"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </button>

        {editable ? (
          <button
            type="button"
            className="ok-codeblock-chrome-btn ok-codeblock-chrome-btn--delete"
            aria-label="Delete code block"
            onClick={handleDelete}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
