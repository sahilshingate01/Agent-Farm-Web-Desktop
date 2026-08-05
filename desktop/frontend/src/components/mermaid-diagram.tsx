import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type MermaidModule = typeof import("mermaid");

let mermaidModulePromise: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid");
  }
  return mermaidModulePromise;
}

type RenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

/** Renders a ```mermaid fenced block as an SVG diagram. The `mermaid`
 *  package is dynamically imported so it never lands in the main bundle —
 *  only pulled in once a mermaid block is actually on screen.
 *
 *  Theme is resolved from the `dark` class on <html> at mount/re-render
 *  time only; mermaid keeps a single global config, so `initialize` is
 *  re-run before every render call rather than gated behind a "ran once"
 *  flag, letting each diagram mount pick up the theme current at that
 *  moment (already-mounted diagrams do not retroactively re-theme). */
export function MermaidDiagram({ code }: { code: string }) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const diagramId = `mermaid-${rawId}`;
  const [state, setState] = useState<RenderState>({ status: "loading" });
  const generation = useRef(0);

  useEffect(() => {
    const myGeneration = ++generation.current;
    setState({ status: "loading" });

    loadMermaid()
      .then(async ({ default: mermaid }) => {
        if (myGeneration !== generation.current) return;
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
        });
        const { svg } = await mermaid.render(diagramId, code);
        if (myGeneration !== generation.current) return;
        setState({ status: "ready", svg });
      })
      .catch((error: unknown) => {
        if (myGeneration !== generation.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ status: "error", message });
      });

    return () => {
      generation.current += 1;
    };
  }, [code, diagramId]);

  if (state.status === "loading") {
    return <p className="my-3 type-caption text-muted-foreground">Loading diagram…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="my-3 max-w-full overflow-x-auto rounded-md border bg-card p-3">
        <pre className="whitespace-pre-wrap font-mono type-caption">{code}</pre>
        <p className="mt-2 type-caption text-destructive">Mermaid render failed: {state.message}</p>
      </div>
    );
  }

  return (
    <div
      className={cn("my-3 max-w-full overflow-x-auto rounded-md border bg-card p-3")}
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
