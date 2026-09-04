import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, Loader2Icon, SparklesIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Floating AI input for the wiki editor — the simple spin on OK's bottom
 * composer: a collapsible bottom-center pill that expands to one text input.
 * Submitting dispatches `agensis:editor-ai-request` {prompt, docPath,
 * selection}; the pill shows a pending state until an
 * `agensis:editor-ai-response` event lands (or a 30s fallback), since the
 * backend side isn't wired yet.
 *
 * ⌘K toggles it (capture-phase, so it wins over the command palette while a
 * wiki doc is open); Esc collapses.
 */
export function WikiAiInput({ docPath }: { docPath: string }) {
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  // Selection snapshot, grabbed at expand time — focusing the input clears
  // the document selection, so it must be captured before that.
  const selectionRef = useRef("");
  const [selectionSize, setSelectionSize] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingTimer = useRef<number | null>(null);

  const grabSelection = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLTextAreaElement) {
      return focused.value.slice(
        focused.selectionStart ?? 0,
        focused.selectionEnd ?? 0,
      );
    }
    return window.getSelection()?.toString() ?? "";
  };
  const expand = () => {
    const selection = grabSelection();
    selectionRef.current = selection;
    setSelectionSize(selection.length);
    setExpanded(true);
  };

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  // ⌘K toggle — capture phase so it beats the app-wide command-palette
  // binding while a document is open in the wiki editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k")
        return;
      if (event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded((open) => {
        if (!open) {
          const selection = grabSelection();
          selectionRef.current = selection;
          setSelectionSize(selection.length);
        }
        return !open;
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Pending clears when the (future) backend answers, or after 30s.
  useEffect(() => {
    const onResponse = () => {
      setPending(false);
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
    };
    window.addEventListener("agensis:editor-ai-response", onResponse);
    return () => {
      window.removeEventListener("agensis:editor-ai-response", onResponse);
      if (pendingTimer.current !== null)
        window.clearTimeout(pendingTimer.current);
    };
  }, []);

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || pending) return;
    window.dispatchEvent(
      new CustomEvent("agensis:editor-ai-request", {
        detail: {
          prompt: trimmed,
          docPath,
          selection: selectionRef.current,
        },
      }),
    );
    setPrompt("");
    setExpanded(false);
    setPending(true);
    if (pendingTimer.current !== null) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = window.setTimeout(() => setPending(false), 30000);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-start px-4">
      {expanded ? (
        <div className="pointer-events-auto flex h-9 w-md max-w-full items-center gap-2 rounded-full border bg-background/80 pr-1 pl-3 shadow-md shadow-black/10 backdrop-blur">
          <SparklesIcon className="size-4 shrink-0 text-primary" />
          <input
            ref={inputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setExpanded(false);
              }
            }}
            placeholder={
              selectionSize
                ? `Ask about the ${selectionSize}-char selection…`
                : "Ask AI to write or rework this page…"
            }
            aria-label="Ask AI about this document"
            className="flat-input min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Collapse AI input"
            className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!prompt.trim()}
            aria-label="Send to AI"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={pending ? undefined : expand}
          aria-label={pending ? "AI request pending" : "Ask AI (⌘K)"}
          title="Ask AI (⌘K)"
          className={cn(
            "pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 shadow-md shadow-black/10 backdrop-blur transition-colors",
            pending
              ? "cursor-default text-muted-foreground"
              : "text-primary hover:bg-primary/15",
          )}
        >
          {pending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SparklesIcon className="size-4 text-primary" />
          )}
          <span className="type-list [font-family:var(--font-secondary,inherit)]">
            {pending ? "Working…" : "Ask AI"}
          </span>
        </button>
      )}
    </div>
  );
}
