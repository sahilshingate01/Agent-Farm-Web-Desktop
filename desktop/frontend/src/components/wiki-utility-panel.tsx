import {
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  LinkIcon,
  SparklesIcon,
  WaypointsIcon,
  WorkflowIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MarkdownPreview } from "@/components/markdown-preview";
import { graphPalette, TopologyGraph } from "@/components/topology-graph";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import { localLinkGraph } from "@/lib/wiki-local-graph";
import { FlowGraph } from "@/components/flow-graph";
import { parseFlowDeterministic, parseFlowWithAI, type ParsedFlow } from "@/lib/flow-parse";
import { Button } from "@/components/ui/button";

export type WikiUtilityTab = "preview" | "flow" | "graph" | "links" | "timeline";

/** Wire shape of farm.workspace.links (see public/backend/controller.mjs). */
export interface WikiLinkGraph {
  root: string;
  nodes: { path: string; title: string }[];
  edges: { source: string; target: string; kind: "wiki" | "md" }[];
}

/** Wire shape of farm.workspace.fileHistory entries. */
interface WikiHistoryEntry {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

/** Panel width bounds: 16rem minimum, up to 65% of the window — a preview
 *  is a first-class reading surface, not a gutter (the old 40rem ceiling
 *  made the divider feel stuck on wide screens). */
const PANEL_MIN_REM = 16;
const PANEL_DEFAULT_PX = 320;

function rootRem() {
  const size = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(size) && size > 0 ? size : 14;
}

function clampPanelWidth(width: number) {
  const rem = rootRem();
  const max = Math.max(PANEL_MIN_REM * rem, window.innerWidth * 0.65);
  return Math.min(max, Math.max(PANEL_MIN_REM * rem, width));
}

const utilityTabs: [WikiUtilityTab, string, typeof LinkIcon][] = [
  ["preview", "Preview", EyeIcon],
  ["flow", "Flow", WorkflowIcon],
  ["graph", "Graph", WaypointsIcon],
  ["links", "Links", LinkIcon],
  ["timeline", "Timeline", ClockIcon],
];

function relativeDate(iso: string) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function EmptyLine({ children }: { children: string }) {
  return <p className="px-3 py-6 text-center type-caption">{children}</p>;
}

function DocLinkRow({
  path,
  title,
  onOpen,
}: {
  path: string;
  title: string;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
      title={path}
    >
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate type-list">{title}</span>
        <span className="block truncate font-mono type-caption">{path}</span>
      </span>
    </button>
  );
}

function LinkSection({
  label,
  entries,
  emptyText,
  onOpen,
}: {
  label: string;
  entries: { path: string; title: string }[];
  emptyText: string;
  onOpen: (path: string) => void;
}) {
  return (
    <section className="mb-4">
      <header className="flex items-center gap-2 px-2 pb-1">
        <span className="type-label">{label}</span>
        <Badge variant="outline">{entries.length}</Badge>
      </header>
      {entries.length ? (
        entries.map((entry) => (
          <DocLinkRow key={entry.path} {...entry} onOpen={onOpen} />
        ))
      ) : (
        <p className="px-2 py-2 type-caption">{emptyText}</p>
      )}
    </section>
  );
}

/**
 * Right utility panel for the Wiki view — OK's editor-shell pattern: an
 * icon-tab strip (graph / links / clock) over a mono-caps section header
 * with a count badge (see design-language references/ok-patterns.md).
 */
export function WikiUtilityPanel({
  tab,
  onTabChange,
  activePath,
  activeContent,
  onOpen,
  refreshKey,
}: {
  tab: WikiUtilityTab;
  onTabChange: (tab: WikiUtilityTab) => void;
  activePath: string | null;
  /** The active document's live markdown (the editor's own value), so the
   *  Preview tab re-renders as the user types. */
  activeContent: string | null;
  onOpen: (path: string) => void;
  refreshKey: number;
}) {
  const [width, setWidth] = useState(() =>
    clampPanelWidth(
      Number(localStorage.getItem("usage-farm-wiki-panel-width")) ||
        PANEL_DEFAULT_PX,
    ),
  );
  const [graph, setGraph] = useState<WikiLinkGraph | null>(null);
  const [graphError, setGraphError] = useState(false);
  const [history, setHistory] = useState<WikiHistoryEntry[] | null>(null);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  // Flow tab: deterministic parse tracks the live document; an AI parse is
  // an explicit action and only sticks for the document it was run on.
  const [aiFlow, setAiFlow] = useState<{ path: string | null; flow: ParsedFlow } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const parsedFlow = useMemo(
    () => (activeContent ? parseFlowDeterministic(activeContent) : null),
    [activeContent],
  );
  const flow = aiFlow && aiFlow.path === activePath ? aiFlow.flow : parsedFlow;
  const runAiParse = async () => {
    if (!activeContent || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await parseFlowWithAI(activeContent, parsedFlow?.title ?? null);
      setAiFlow({ path: activePath, flow: result });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    invokeNative<WikiLinkGraph>("farm.workspace.links")
      .then((next) => {
        if (!cancelled) {
          setGraph(next);
          setGraphError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setGraphError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (tab !== "timeline" || !activePath) return;
    let cancelled = false;
    setHistory(null);
    setHistoryPath(activePath);
    invokeNative<{ path: string; entries: WikiHistoryEntry[] }>(
      "farm.workspace.fileHistory",
      { path: activePath },
    )
      .then((result) => {
        if (!cancelled) setHistory(result.entries);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, activePath, refreshKey]);

  // Graph tab shows the ACTIVE document's neighborhood, not the whole wiki —
  // 2D and 3D both render from this slice (TopologyGraph shares the props).
  const localGraph = useMemo(
    () => (graph && activePath ? localLinkGraph(graph, activePath) : null),
    [graph, activePath],
  );
  const titleByPath = useMemo(
    () => new Map((graph?.nodes || []).map((node) => [node.path, node.title])),
    [graph],
  );
  const outgoing = useMemo(
    () =>
      activePath && graph
        ? [
            ...new Set(
              graph.edges
                .filter((edge) => edge.source === activePath)
                .map((edge) => edge.target),
            ),
          ].map((path) => ({ path, title: titleByPath.get(path) || path }))
        : [],
    [graph, activePath, titleByPath],
  );
  const backlinks = useMemo(
    () =>
      activePath && graph
        ? [
            ...new Set(
              graph.edges
                .filter((edge) => edge.target === activePath)
                .map((edge) => edge.source),
            ),
          ].map((path) => ({ path, title: titleByPath.get(path) || path }))
        : [],
    [graph, activePath, titleByPath],
  );

  useEffect(() => {
    localStorage.setItem("usage-farm-wiki-panel-width", String(width));
  }, [width]);
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    // Dragging left widens the right-docked panel.
    const onMove = (move: PointerEvent) =>
      setWidth(clampPanelWidth(startWidth - (move.clientX - startX)));
    const onUp = () => {
      document.body.removeAttribute("data-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.dataset.resizing = "true";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Resolved per render (8 tiny canvas reads) so hues track the live theme.
  const palette = graphPalette();
  const headerCount =
    tab === "preview"
      ? null
      : tab === "flow"
        ? flow?.nodes.length || 0
        : tab === "graph"
        ? localGraph?.nodes.length || 0
        : tab === "links"
          ? outgoing.length + backlinks.length
          : history?.length || 0;

  return (
    <aside
      className="panel-depth relative flex shrink-0 flex-col border-l bg-card"
      style={{ width }}
    >
      <div
        role="separator"
        aria-label="Resize utility panel"
        aria-orientation="vertical"
        className="sidebar-resize-handle sidebar-resize-handle-right"
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(PANEL_DEFAULT_PX)}
      />
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <span className="type-label">
            {utilityTabs.find(([id]) => id === tab)?.[1]}
          </span>
          {headerCount !== null && <Badge variant="outline">{headerCount}</Badge>}
        </div>
        <div className="flex gap-0.5 rounded-lg border bg-muted/40 p-0.5">
          {utilityTabs.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              aria-label={label}
              aria-pressed={tab === id}
              title={label}
              className={cn(
                "grid size-6 place-items-center rounded-md transition-colors",
                tab === id
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>
      {tab === "preview" && (
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
          {activeContent === null ? (
            <EmptyLine>Open a document to preview it.</EmptyLine>
          ) : (
            <article className="agentic-markdown px-4 py-4">
              <MarkdownPreview content={activeContent} docPath={activePath ?? undefined} />
            </article>
          )}
        </div>
      )}
      {tab === "flow" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-3">
            {activeContent === null ? (
              <EmptyLine>Open a workflow or skill to see its flow.</EmptyLine>
            ) : flow ? (
              <FlowGraph flow={flow} />
            ) : (
              <EmptyLine>
                No process structure detected — try the AI parse below.
              </EmptyLine>
            )}
          </div>
          {activeContent !== null && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
              <span className="min-w-0 truncate type-caption">
                {aiError
                  ? aiError
                  : flow
                    ? flow.source === "ai"
                      ? "AI parse — non-deterministic"
                      : `Deterministic parse · ${Math.round(flow.confidence * 100)}% structure`
                    : "Nothing parsed yet"}
              </span>
              <Button size="xs" variant="outline" disabled={aiBusy} onClick={() => void runAiParse()}>
                <SparklesIcon className={cn("size-3", aiBusy && "animate-pulse")} />
                {aiBusy ? "Parsing…" : flow?.source === "ai" ? "Re-parse with AI" : "Parse with AI"}
              </Button>
            </div>
          )}
        </div>
      )}
      {tab === "graph" && (
        <div className="min-h-0 flex-1">
          {graphError ? (
            <EmptyLine>Link graph is unavailable in this environment.</EmptyLine>
          ) : !activePath ? (
            <EmptyLine>Open a document to see its graph.</EmptyLine>
          ) : !graph ? (
            <EmptyLine>Charting document links…</EmptyLine>
          ) : !localGraph?.edges.length ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <p className="type-list font-medium">This document isn't linked yet.</p>
                <p className="mx-auto mt-1.5 max-w-xs type-caption">
                  The graph shows the open document and every page it links to
                  or is linked from — write{" "}
                  <code className="rounded bg-muted px-1 font-mono text-xs">[[Doc Name]]</code>{" "}
                  or relative markdown links and its connections appear here.
                </p>
              </div>
            </div>
          ) : (
            <TopologyGraph
              nodes={localGraph.nodes.map((node) => {
                // Hue by top-level folder — the flat one-color cloud read as
                // dull and said nothing about where documents live. Folder
                // hues index the same token scale (--chart-1..8) the topology
                // graph colors kinds with, so 2D, 3D and topology match.
                const folder = node.path.includes("/") ? node.path.split("/")[0] : "";
                let hash = 0;
                for (const char of folder) hash = (hash * 31 + char.charCodeAt(0)) % 997;
                return {
                  id: node.path,
                  label: node.title,
                  kind: "document" as const,
                  detail: node.path,
                  color: palette[hash % palette.length],
                };
              })}
              edges={localGraph.edges.map((edge) => ({
                source: edge.source,
                target: edge.target,
                label: edge.kind,
              }))}
              selectedId={activePath}
              onSelect={(node) => onOpen(node.id)}
            />
          )}
        </div>
      )}
      {tab === "links" && (
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-1 py-3">
          {!activePath ? (
            <EmptyLine>Open a document to see its links.</EmptyLine>
          ) : (
            <>
              <LinkSection
                label="Outgoing"
                entries={outgoing}
                emptyText="This page doesn't link to anything yet."
                onOpen={onOpen}
              />
              <LinkSection
                label="Backlinks"
                entries={backlinks}
                emptyText="No pages link here yet."
                onOpen={onOpen}
              />
            </>
          )}
        </div>
      )}
      {tab === "timeline" && (
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-1 py-3">
          {!activePath ? (
            <EmptyLine>Open a document to see its history.</EmptyLine>
          ) : history === null || historyPath !== activePath ? (
            <EmptyLine>Reading git history…</EmptyLine>
          ) : !history.length ? (
            <EmptyLine>No git history for this document.</EmptyLine>
          ) : (
            history.map((entry) => (
              <article
                key={entry.hash}
                className="mb-1 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <p className="truncate type-list" title={entry.subject}>
                  {entry.subject}
                </p>
                <p className="flex items-center gap-2 type-caption">
                  <span className="min-w-0 truncate">
                    {entry.author} · {relativeDate(entry.date)}
                  </span>
                  <code className="ml-auto shrink-0 rounded border bg-muted/60 px-1 font-mono">
                    {entry.hash.slice(0, 7)}
                  </code>
                </p>
              </article>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
