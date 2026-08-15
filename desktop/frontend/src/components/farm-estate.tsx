import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Action emitted by a button inside the estate visual (farm-estate.html).
 *  `type` is the estate's action vocabulary — rota.set, kit.assign,
 *  message.send, worktree.create… — with optional context fields. */
export interface EstateAction {
  type: string;
  arg?: string | null;
  kit?: string;
  silo?: string;
}

export interface EstateSilo {
  name: string;
  /** USED fractions 0..1 — the estate renders "% used" gauges. */
  session: number;
  weekly: number;
  fable: number;
}

interface EstateMessage {
  source?: string;
  kind?: string;
  action?: EstateAction;
  article?: { title: string; path: string };
  field?: string;
}

/** Iframe host for the 3D estate plan (public/farm-estate.html). The page
 *  is a self-contained three.js scene with a `window.farm` API; a host
 *  adapter inside it bridges postMessage both ways, so this component only
 *  pushes data snapshots in and receives clicked actions out. The estate's
 *  silo set is fixed at load — setSilo/setRota for names it doesn't know
 *  are silently ignored on its side. */
export function FarmEstate({
  silos,
  rota,
  sessionProgress,
  worktrees,
  kits,
  commands,
  experts,
  onAction,
  onOpenArticle,
  className,
}: {
  silos: EstateSilo[];
  /** Silo currently first in the rota (amber-highlighted pad in the scene). */
  rota: string | null;
  /** 0..1 — drives the sun across the sky. */
  sessionProgress: number;
  worktrees: { name: string; branches: number; uncommitted: number; active: boolean }[];
  kits: { name: string; skills: number; mcp: number; agents: number; assigned: string }[];
  commands: string[];
  experts: [string, string][];
  onAction: (action: EstateAction) => void;
  onOpenArticle?: (article: { title: string; path: string }, field: string) => void;
  /** Extra classes on the screen wrapper (the estate's CRT-glass shaping). */
  className?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const onOpenArticleRef = useRef(onOpenArticle);
  onOpenArticleRef.current = onOpenArticle;
  const stateRef = useRef({ silos, rota, sessionProgress, worktrees, kits, commands, experts });
  stateRef.current = { silos, rota, sessionProgress, worktrees, kits, commands, experts };

  const sync = useCallback(() => {
    if (!readyRef.current) return;
    const state = stateRef.current;
    const calls: { fn: string; args: unknown[] }[] = [
      ...state.silos.map((silo) => ({
        fn: "setSilo",
        args: [
          silo.name,
          {
            session: Math.round(silo.session * 100),
            weekly: Math.round(silo.weekly * 100),
            fable: Math.round(silo.fable * 100),
          },
        ],
      })),
      ...(state.rota ? [{ fn: "setRota", args: [state.rota] as unknown[] }] : []),
      { fn: "setSession", args: [state.sessionProgress] },
      ...(state.worktrees.length ? [{ fn: "setWorktrees", args: [state.worktrees] as unknown[] }] : []),
      ...(state.kits.length ? [{ fn: "setKits", args: [state.kits] as unknown[] }] : []),
      ...(state.commands.length ? [{ fn: "setCommands", args: [state.commands] as unknown[] }] : []),
      ...(state.experts.length ? [{ fn: "setExperts", args: [state.experts] as unknown[] }] : []),
    ];
    frameRef.current?.contentWindow?.postMessage({ source: "farm-estate-host", calls }, "*");
  }, []);

  useEffect(() => {
    sync();
  }, [sync, silos, rota, sessionProgress, worktrees, kits, commands, experts]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as EstateMessage;
      if (!data || data.source !== "farm-estate") return;
      if (data.kind === "ready") {
        readyRef.current = true;
        sync();
      } else if (data.kind === "action" && data.action) {
        onActionRef.current(data.action);
      } else if (data.kind === "article" && data.article) {
        onOpenArticleRef.current?.(data.article, data.field || "");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sync]);

  return (
    <div className={cn("relative min-h-72 flex-1 overflow-hidden", className)}>
      <iframe
        ref={frameRef}
        src="farm-estate.html"
        title="Farm estate plan"
        className="absolute inset-0 size-full border-0 bg-black"
      />
    </div>
  );
}
