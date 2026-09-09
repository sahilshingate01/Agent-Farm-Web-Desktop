import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  FileTextIcon,
  FolderIcon,
  HistoryIcon,
  LetterTextIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  SquareCodeIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { CodeDocumentView } from "@/components/code-document-view";
import { MarkdownPreview } from "@/components/markdown-preview";
import { WikiAiInput } from "@/components/wiki-ai-input";
import { OkMarkdownEditor } from "@/editor-ok/OkMarkdownEditor";
import { isMarkdownPath } from "@/lib/document-language";
import {
  DockDropTarget,
  DockTabs,
  type DockDropZone,
} from "@/components/dock-tabs";
import {
  WikiUtilityPanel,
  type WikiUtilityTab,
} from "@/components/wiki-utility-panel";
import { subscribeWiki, type WikiRequest } from "@/components/wiki-bus";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import { getWorkspaceIndex } from "@/lib/workspace-cache";
import type {
  AgentSessionIndex,
  AgentSessionSummary,
  MarkdownDocument,
  MarkdownWorkspaceIndex,
} from "@/types/farm";

type Tab = MarkdownDocument & { dirty?: boolean; pinned?: boolean; readOnly?: boolean };

type FileTreeNode = {
  name: string;
  path: string;
  file?: boolean;
  children: FileTreeNode[];
};

const groupFor = (path: string) =>
  /(^|\/)(agents|claude|soul|memory|skill)(\.|$)/i.test(path)
    ? "Expert controls"
    : "Project docs";

function buildFileTree(paths: string[]): FileTreeNode[] {
  const roots: FileTreeNode[] = [];
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    let nodes = roots;
    let parent = "";
    parts.forEach((name, index) => {
      const pathForNode = parent ? `${parent}/${name}` : name;
      let node = nodes.find((candidate) => candidate.name === name);
      if (!node) {
        node = {
          name,
          path: pathForNode,
          file: index === parts.length - 1,
          children: [],
        };
        nodes.push(node);
      }
      node.file = index === parts.length - 1;
      parent = pathForNode;
      nodes = node.children;
    });
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort(
      (a, b) =>
        Number(Boolean(a.file)) - Number(Boolean(b.file)) ||
        a.name.localeCompare(b.name),
    );
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

function compactParentPath(path: string) {
  const parent = path.slice(0, path.lastIndexOf("/"));
  if (!parent) return "";
  const parts = parent.split("/").filter(Boolean);
  if (parent.length <= 48) return parent;
  return `…/${parts.slice(-3).join("/")}`;
}

/** OK segmented icon pill: WYSIWYG editor vs raw markdown source. */
function ModePill({
  source,
  onChange,
}: {
  source: boolean;
  onChange: (source: boolean) => void;
}) {
  const segments: [boolean, string, typeof SquareCodeIcon][] = [
    [false, "Editor", LetterTextIcon],
    [true, "Source", SquareCodeIcon],
  ];
  return (
    <div className="flex gap-0.5 rounded-lg border bg-muted/40 p-0.5">
      {segments.map(([isSource, label, Icon]) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={`${label} mode`}
          aria-pressed={source === isSource}
          onClick={() => onChange(isSource)}
          className={cn(
            "grid size-6 place-items-center rounded-md transition-colors",
            source === isSource
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

/** OK tab anatomy: muted path prefix + bold leaf ("wiki/**concepts**"). */
function TabPathLabel({ path }: { path: string }) {
  const separatorAt = path.lastIndexOf("/");
  const prefix = separatorAt >= 0 ? path.slice(0, separatorAt + 1) : "";
  const leaf = separatorAt >= 0 ? path.slice(separatorAt + 1) : path;
  return (
    <span className="truncate">
      {prefix && <span className="text-muted-foreground">{prefix}</span>}
      <span className="font-semibold">{leaf}</span>
    </span>
  );
}

export function AgenticWorkspace({
  openChat,
  notify,
}: {
  openChat: () => void;
  notify: (message: string) => void;
}) {
  const [index, setIndex] = useState<MarkdownWorkspaceIndex | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [splitPath, setSplitPath] = useState<string | null>(null);
  const [splitSide, setSplitSide] = useState<
    "left" | "right" | "top" | "bottom"
  >("right");
  const [splitPercent, setSplitPercent] = useState(42);
  // Left panes are always editors ("edit left, multi-view right"); these
  // flags flip a pane between WYSIWYG and raw markdown source.
  const [sourceMode, setSourceMode] = useState(false);
  const [splitSourceMode, setSplitSourceMode] = useState(false);
  // The main sidebar now carries the wiki tree (OK IA), so the inner tree
  // column is opt-in.
  const [treeOpen, setTreeOpen] = useState(
    () => localStorage.getItem("usage-farm-wiki-tree") === "open",
  );
  const [fileQuery, setFileQuery] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"documents" | "sessions">(
    "documents",
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem("usage-farm-wiki-panel") !== "closed",
  );
  const [panelTab, setPanelTab] = useState<WikiUtilityTab>("preview");
  // WYSIWYG already IS a preview — showing the Preview tab beside it doubles
  // the page. Source mode pairs with Preview; editor mode pairs with Graph.
  useEffect(() => {
    setPanelTab((tab) => {
      if (!sourceMode && tab === "preview") return "graph";
      if (sourceMode && tab === "graph") return "preview";
      return tab;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);
  const [quickOpen, setQuickOpen] = useState(false);
  // null = quick-open list; a string = inline "New page" path draft.
  const [newPagePath, setNewPagePath] = useState<string | null>(null);
  // Bumped after every reload/save so the utility panel refetches the link
  // graph and git history.
  const [refreshKey, setRefreshKey] = useState(0);
  const [history, setHistory] = useState<AgentSessionIndex | null>(null);
  const [activeSession, setActiveSession] =
    useState<AgentSessionSummary | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionProvider, setSessionProvider] = useState("all");
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Math.min(
      520,
      Math.max(
        280,
        Number(localStorage.getItem("usage-farm-agentic-sidebar-width")) || 360,
      ),
    ),
  );
  const active = tabs.find((tab) => tab.path === activePath) || null;
  const splitActive = tabs.find((tab) => tab.path === splitPath) || null;
  // Pinned tabs stay at the front of the strip; ⌘1..⌘9 index this order.
  const orderedTabs = useMemo(
    () => [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)],
    [tabs],
  );
  const groups = useMemo(() => {
    const result = new Map<string, string[]>();
    const query = fileQuery.trim().toLowerCase();
    for (const entry of index?.files || []) {
      if (query && !entry.path.toLowerCase().includes(query)) continue;
      result.set(groupFor(entry.path), [
        ...(result.get(groupFor(entry.path)) || []),
        entry.path,
      ]);
    }
    return [...result.entries()];
  }, [fileQuery, index]);
  const fileTrees = useMemo(
    () =>
      groups.map(([group, files]) => [group, buildFileTree(files)] as const),
    [groups],
  );
  const sessionProviders = useMemo(
    () =>
      [
        ...new Set(history?.sessions.map((session) => session.provider) || []),
      ].sort(),
    [history],
  );
  const visibleSessions = useMemo(
    () =>
      (history?.sessions || []).filter((session) => {
        const searchable =
          `${session.provider} ${session.account} ${session.prompt || ""}`.toLowerCase();
        return (
          (sessionProvider === "all" || session.provider === sessionProvider) &&
          searchable.includes(sessionQuery.toLowerCase())
        );
      }),
    [history, sessionProvider, sessionQuery],
  );
  const reload = async () => {
    setLoading(true);
    try {
      const [nextIndex, nextHistory] = await Promise.all([
        getWorkspaceIndex(),
        invokeNative<AgentSessionIndex>("farm.history.list"),
      ]);
      setIndex(nextIndex);
      setHistory(nextHistory);
      setExpandedFolders((current) => {
        const next = new Set(current);
        for (const entry of nextIndex.files) {
          const parts = entry.path.split("/");
          for (let part = 1; part < parts.length; part += 1)
            next.add(parts.slice(0, part).join("/"));
        }
        return next;
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshKey((key) => key + 1);
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  const open = async (path: string) => {
    if (tabs.some((tab) => tab.path === path)) {
      setActivePath(path);
      return;
    }
    try {
      const document = await invokeNative<MarkdownDocument>(
        "farm.workspace.read",
        { path },
      );
      setTabs((current) => [...current, document]);
      setActivePath(path);
      setActiveSession(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  // Global-scope / memory items from the sidebar: absolute paths readable
  // only through farm.agentic.read — rendered as read-only tabs.
  const openReadOnly = async (path: string) => {
    if (tabs.some((tab) => tab.path === path)) {
      setActivePath(path);
      return;
    }
    try {
      const document = await invokeNative<{
        path: string;
        content: string;
        modifiedAt: string;
      }>("farm.agentic.read", { path });
      setTabs((current) => [
        ...current,
        { root: "", ...document, readOnly: true },
      ]);
      setActivePath(document.path);
      setActiveSession(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  const createPage = async (rawPath: string) => {
    const trimmed = rawPath.trim().replace(/^\/+/, "");
    if (!trimmed) return;
    const path = /\.mdx?$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
    const leaf = path.split("/").at(-1)?.replace(/\.mdx?$/i, "") || "Title";
    try {
      const document = await invokeNative<MarkdownDocument>(
        "farm.workspace.write",
        { path, content: `# ${leaf}\n` },
      );
      setTabs((current) =>
        current.some((tab) => tab.path === document.path)
          ? current
          : [...current, document],
      );
      setActivePath(document.path);
      setActiveSession(null);
      setQuickOpen(false);
      notify(`Created ${document.path}`);
      void reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  const save = async () => {
    if (!active || active.readOnly) return;
    try {
      const document = await invokeNative<MarkdownDocument>(
        "farm.workspace.write",
        { path: active.path, content: active.content },
      );
      setTabs((current) =>
        current.map((tab) =>
          tab.path === document.path ? { ...document, dirty: false } : tab,
        ),
      );
      notify(`Saved ${document.path}`);
      void reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  const updatePath = (path: string, content: string) =>
    setTabs((current) =>
      current.map((tab) =>
        tab.path === path ? { ...tab, content, dirty: true } : tab,
      ),
    );
  const update = (content: string) => {
    if (activePath) updatePath(activePath, content);
  };
  // Floating AI input: splice the assistant's markdown into the doc it was
  // asked about — replace the snapshotted selection when present, else
  // append. Content is the source of truth for both editor modes, so the
  // WYSIWYG/source views pick the change up through their value sync.
  const aiRequestRef = useRef<{ docPath: string; selection: string } | null>(null);
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ docPath?: string; selection?: string }>).detail;
      if (detail?.docPath)
        aiRequestRef.current = { docPath: detail.docPath, selection: detail.selection || "" };
    };
    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<{ ok?: boolean; result?: string; docPath?: string }>).detail;
      if (!detail?.ok || !detail.result || !detail.docPath) return;
      const request = aiRequestRef.current;
      const selection = request?.docPath === detail.docPath ? request.selection : "";
      aiRequestRef.current = null;
      setTabs((current) =>
        current.map((tab) => {
          if (tab.path !== detail.docPath || tab.readOnly) return tab;
          const content =
            selection && tab.content.includes(selection)
              ? tab.content.replace(selection, detail.result as string)
              : `${tab.content.replace(/\n*$/, "")}\n\n${detail.result}\n`;
          return { ...tab, content, dirty: true };
        }),
      );
    };
    window.addEventListener("agensis:editor-ai-request", onRequest);
    window.addEventListener("agensis:editor-ai-response", onResponse);
    return () => {
      window.removeEventListener("agensis:editor-ai-request", onRequest);
      window.removeEventListener("agensis:editor-ai-response", onResponse);
    };
  }, []);
  const close = (path: string) => {
    const next = tabs.filter((tab) => tab.path !== path);
    setTabs(next);
    if (activePath === path) setActivePath(next.at(-1)?.path || null);
    if (splitPath === path) setSplitPath(null);
  };
  // Pinned tabs survive bulk close, matching the OK tab context menu.
  const closeOthers = (path: string) => {
    const next = tabs.filter((tab) => tab.path === path || tab.pinned);
    setTabs(next);
    setActivePath(path);
    if (splitPath && !next.some((tab) => tab.path === splitPath))
      setSplitPath(null);
  };
  const closeAll = () => {
    const next = tabs.filter((tab) => tab.pinned);
    setTabs(next);
    if (activePath && !next.some((tab) => tab.path === activePath))
      setActivePath(next.at(-1)?.path || null);
    if (splitPath && !next.some((tab) => tab.path === splitPath))
      setSplitPath(null);
  };
  const togglePin = (path: string) =>
    setTabs((current) =>
      current.map((tab) =>
        tab.path === path ? { ...tab, pinned: !tab.pinned } : tab,
      ),
    );
  // ⌘1..⌘9 (Ctrl on non-mac) activate tabs in strip order.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey)
        return;
      const digit = Number(event.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      const target = orderedTabs[digit - 1];
      if (!target) return;
      event.preventDefault();
      setActivePath(target.path);
      setActiveSession(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orderedTabs]);
  useEffect(() => {
    localStorage.setItem("usage-farm-wiki-panel", panelOpen ? "open" : "closed");
  }, [panelOpen]);
  useEffect(() => {
    localStorage.setItem("usage-farm-wiki-tree", treeOpen ? "open" : "closed");
  }, [treeOpen]);
  // Sidebar agentic sections route open/create requests here through the
  // wiki bus (they live outside this subtree). Handler rides a ref so the
  // one-time subscription always sees fresh state.
  const wikiRequestRef = useRef<(request: WikiRequest) => void>(() => {});
  wikiRequestRef.current = (request) => {
    if (request.kind === "open") {
      setSidebarTab("documents");
      void open(request.path);
    } else if (request.kind === "open-readonly") {
      setSidebarTab("documents");
      void openReadOnly(request.path);
    } else {
      setQuickOpen(true);
      setNewPagePath(request.prefix);
    }
  };
  useEffect(
    () => subscribeWiki((request) => wikiRequestRef.current(request)),
    [],
  );
  useEffect(() => {
    localStorage.setItem(
      "usage-farm-agentic-sidebar-width",
      String(sidebarWidth),
    );
  }, [sidebarWidth]);
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (move: PointerEvent) =>
      setSidebarWidth(
        Math.min(520, Math.max(280, startWidth + move.clientX - startX)),
      );
    const onUp = () => {
      document.body.removeAttribute("data-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.dataset.resizing = "true";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const start =
      splitSide === "left" || splitSide === "right"
        ? event.clientX
        : event.clientY;
    const startPercent = splitPercent;
    const span =
      splitSide === "left" || splitSide === "right"
        ? bounds.width
        : bounds.height;
    const direction = splitSide === "left" || splitSide === "top" ? 1 : -1;
    const onMove = (move: PointerEvent) => {
      const coordinate =
        splitSide === "left" || splitSide === "right"
          ? move.clientX
          : move.clientY;
      setSplitPercent(
        Math.min(
          70,
          Math.max(
            25,
            startPercent +
              direction * ((coordinate - start) / Math.max(span, 1)) * 100,
          ),
        ),
      );
    };
    const onUp = () => {
      document.body.removeAttribute("data-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.dataset.resizing = "true";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <div className="flex min-h-0 flex-1 bg-background">
      {treeOpen && (
      <aside
        className="agentic-file-sidebar relative flex shrink-0 flex-col border-r bg-card"
        style={{ width: sidebarWidth }}
      >
        <div
          className="flex h-12 items-center justify-between border-b px-4"
          style={{
            paddingLeft: "calc(1rem + var(--agensis-titlebar-reserve-left))",
          }}
        >
          <div className="min-w-0">
            <strong className="text-sm">Wiki</strong>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {index?.root || "Loading scope…"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={() => void reload()}
            aria-label="Refresh wiki"
          >
            <RefreshCwIcon
              className={cn("size-3.5", loading && "animate-spin")}
            />
          </Button>
        </div>
        <div className="mx-2 mt-2 flex gap-1 rounded-lg border bg-muted/40 p-0.5">
          {(
            [
              ["documents", "Wiki", FileTextIcon],
              ["sessions", "Jobs", HistoryIcon],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSidebarTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-base font-medium transition-colors",
                sidebarTab === id
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
        {sidebarTab === "documents" && (
          <label className="agentic-file-search mx-2 mt-2">
            <SearchIcon className="size-3.5 shrink-0" />
            <input
              value={fileQuery}
              onChange={(event) => setFileQuery(event.target.value)}
              placeholder="Search wiki"
              aria-label="Search wiki"
            />
          </label>
        )}
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {sidebarTab === "documents" &&
            fileTrees.map(([group, tree]) => (
            <section key={group} className="mb-5">
              <p className="px-2 pb-1 type-label">
                {group}
              </p>
              {tree.map((root) => {
                const renderNode = (
                  node: FileTreeNode,
                  depth: number,
                ): ReactNode => {
                  if (node.file)
                    return (
                      <button
                        key={node.path}
                        onClick={() => void open(node.path)}
                        className={cn(
                          "agentic-file-row",
                          activePath === node.path && "agentic-file-row-active",
                        )}
                        style={{ paddingLeft: `${8 + depth * 14}px` }}
                        title={node.path}
                      >
                        <FileTextIcon className="size-3.5 shrink-0" />
                        <span className="agentic-file-name min-w-0 truncate">
                          {node.name}
                        </span>
                        {depth > 0 && (
                          <span className="min-w-0 flex-1 truncate font-mono type-caption">
                            {compactParentPath(node.path)}
                          </span>
                        )}
                      </button>
                    );
                  // Compact single-child folder chains into one row so a folder
                  // that just contains another folder doesn't nest endlessly.
                  let folder = node;
                  let label = node.name;
                  while (
                    folder.children.length === 1 &&
                    !folder.children[0].file
                  ) {
                    folder = folder.children[0];
                    label = `${label}/${folder.name}`;
                  }
                  const expanded =
                    expandedFolders.has(folder.path) || Boolean(fileQuery);
                  return (
                    <div key={node.path}>
                      <button
                        type="button"
                        className="agentic-file-row agentic-file-folder"
                        style={{ paddingLeft: `${8 + depth * 14}px` }}
                        onClick={() =>
                          setExpandedFolders((current) => {
                            const next = new Set(current);
                            if (next.has(folder.path)) next.delete(folder.path);
                            else next.add(folder.path);
                            return next;
                          })
                        }
                      >
                        <FolderIcon className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {label}
                        </span>
                      </button>
                      {expanded &&
                        folder.children.map((child) =>
                          renderNode(child, depth + 1),
                        )}
                    </div>
                  );
                };
                return renderNode(root, 0);
              })}
            </section>
          ))}
          {sidebarTab === "sessions" && (
          <section className="mb-5">
            <p className="px-2 pb-1 type-label">
              Project sessions · {history?.sessions.length || 0}
            </p>
            <label className="agentic-session-search">
              <SearchIcon className="size-3.5" />
              <input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="Filter sessions"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1 px-2">
              <button
                onClick={() => setSessionProvider("all")}
                className={cn(
                  "agentic-session-filter",
                  sessionProvider === "all" && "agentic-session-filter-active",
                )}
              >
                All
              </button>
              {sessionProviders.map((provider) => (
                <button
                  key={provider}
                  onClick={() => setSessionProvider(provider)}
                  className={cn(
                    "agentic-session-filter",
                    sessionProvider === provider &&
                      "agentic-session-filter-active",
                  )}
                >
                  {provider}
                </button>
              ))}
            </div>
            {visibleSessions.slice(0, 24).map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  setActiveSession(session);
                  setActivePath(null);
                }}
                className={cn(
                  "agentic-file-row",
                  activeSession?.id === session.id && "agentic-file-row-active",
                )}
              >
                <HistoryIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-xs">
                    {session.provider} · {session.account}
                  </strong>
                  <span className="block truncate font-mono text-[0.6rem] text-muted-foreground">
                    {session.prompt ||
                      new Date(session.updatedAt).toLocaleString()}
                  </span>
                </span>
              </button>
            ))}
            {history && !visibleSessions.length && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No scoped sessions match this filter.
              </p>
            )}
          </section>
          )}
          {sidebarTab === "documents" && !loading && !index?.files.length && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              <FolderIcon className="mx-auto mb-2 size-5" />
              No project documents found.
            </p>
          )}
        </div>
        <div
          role="separator"
          aria-label="Resize wiki sidebar"
          aria-orientation="vertical"
          className="sidebar-resize-handle sidebar-resize-handle-left"
          onPointerDown={startSidebarResize}
          onDoubleClick={() => setSidebarWidth(360)}
        />
      </aside>
      )}
      <DockDropTarget
        className={cn(
          "flex min-h-0 min-w-0 flex-1",
          splitActive && (splitSide === "top" || splitSide === "bottom")
            ? "flex-col"
            : "flex-row",
        )}
        onDrop={(id, zone: DockDropZone) => {
          if (tabs.some((tab) => tab.path === id)) {
            if (zone === "move") {
              setActivePath(id);
              setActiveSession(null);
            } else {
              setSplitPath(id);
              setSplitSide(zone.replace("split-", "") as typeof splitSide);
            }
          }
        }}
      >
        <div
          className={cn(
            "relative flex min-h-0 flex-1 flex-col",
            splitActive && (splitSide === "left" || splitSide === "right")
              ? "min-w-56"
              : "min-w-64",
            splitActive &&
              (splitSide === "left" || splitSide === "top") &&
              "order-last",
          )}
        >
          <DockTabs
            ariaLabel="Wiki document"
            tabs={orderedTabs.map((tab, index) => ({
              id: tab.path,
              label: <TabPathLabel path={tab.path} />,
              icon: <FileTextIcon className="size-3 shrink-0" />,
              dirty: tab.dirty,
              pinned: tab.pinned,
              badge:
                index < 9 ? (
                  <kbd className="shrink-0 rounded border bg-muted/60 px-1 font-mono type-label normal-case">
                    ⌘{index + 1}
                  </kbd>
                ) : undefined,
            }))}
            activeId={activePath}
            onActivate={(path) => {
              setActivePath(path);
              setActiveSession(null);
            }}
            onClose={close}
            onReorder={(dragged, target) =>
              setTabs((current) => {
                const from = current.findIndex((tab) => tab.path === dragged);
                const to = current.findIndex((tab) => tab.path === target);
                if (from < 0 || to < 0 || from === to) return current;
                const next = [...current];
                next.splice(to, 0, next.splice(from, 1)[0]);
                return next;
              })
            }
            renderTabMenu={(path) => {
              const tab = tabs.find((item) => item.path === path);
              return (
                <>
                  <ContextMenuItem onSelect={() => close(path)}>
                    <XIcon />
                    Close
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => closeOthers(path)}>
                    Close others
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={closeAll}>
                    Close all
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => togglePin(path)}>
                    {tab?.pinned ? <PinOffIcon /> : <PinIcon />}
                    {tab?.pinned ? "Unpin tab" : "Pin tab"}
                  </ContextMenuItem>
                </>
              );
            }}
            trailing={
              <Popover
                open={quickOpen}
                onOpenChange={(open) => {
                  setQuickOpen(open);
                  if (!open) setNewPagePath(null);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Open document in new tab"
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                  {newPagePath !== null ? (
                    <div className="p-3">
                      <p className="pb-2 type-label">New page</p>
                      <Input
                        autoFocus
                        value={newPagePath}
                        placeholder="notes/new-page.md"
                        aria-label="New page path"
                        onChange={(event) => setNewPagePath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void createPage(newPagePath);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setNewPagePath(null);
                          }
                        }}
                      />
                      <p className="pt-1.5 type-caption">
                        Workspace-relative path; .md is added for you.
                      </p>
                      <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setNewPagePath(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={!newPagePath.trim()}
                          onClick={() => void createPage(newPagePath)}
                        >
                          Create
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Command>
                      <CommandInput placeholder="Open document…" />
                      <CommandList>
                        <CommandEmpty>No matching documents.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="new page create document"
                            onSelect={() => setNewPagePath("")}
                          >
                            <PlusIcon className="size-3.5" />
                            New page…
                          </CommandItem>
                          {(index?.files || [])
                            .filter(
                              (entry) =>
                                !tabs.some((tab) => tab.path === entry.path),
                            )
                            .map((entry) => (
                              <CommandItem
                                key={entry.path}
                                value={entry.path}
                                onSelect={() => {
                                  setQuickOpen(false);
                                  void open(entry.path);
                                }}
                              >
                                <FileTextIcon className="size-3.5" />
                                <span className="truncate">{entry.path}</span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  )}
                </PopoverContent>
              </Popover>
            }
            actions={
              <>
                {active?.readOnly && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Read-only
                  </Badge>
                )}
                {active && !active.readOnly && (
                  <>
                    {isMarkdownPath(active.path) && (
                      <ModePill source={sourceMode} onChange={setSourceMode} />
                    )}
                    <Button
                      size="sm"
                      variant={active.dirty ? "default" : "outline"}
                      disabled={!active.dirty}
                      onClick={() => void save()}
                    >
                      <SaveIcon className="size-3.5" />
                      Save
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Toggle file tree"
                  aria-pressed={treeOpen}
                  className={cn(treeOpen && "bg-accent text-accent-foreground")}
                  onClick={() => setTreeOpen((open) => !open)}
                >
                  <PanelLeftIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Toggle utility panel"
                  aria-pressed={panelOpen}
                  className={cn(panelOpen && "bg-accent text-accent-foreground")}
                  onClick={() => setPanelOpen((open) => !open)}
                >
                  <PanelRightIcon className="size-3.5" />
                </Button>
              </>
            }
          />
          {active ? (
            <div
              className="scrollbar-none min-h-0 flex-1 overflow-y-auto"
              data-testid="editor-scroll-container"
            >
              {active.readOnly ? (
                isMarkdownPath(active.path) ? (
                  <article className="agentic-markdown mx-auto max-w-4xl px-10 py-10">
                    <MarkdownPreview content={active.content} docPath={active.path} />
                  </article>
                ) : (
                  <CodeDocumentView path={active.path} content={active.content} />
                )
              ) : !isMarkdownPath(active.path) || sourceMode ? (
                // Non-markdown project files always open as source; markdown
                // uses the ModePill to toggle WYSIWYG vs raw.
                <textarea
                  className="agentic-source-editor"
                  value={active.content}
                  onChange={(event) => update(event.target.value)}
                  spellCheck={false}
                  aria-label={`Edit ${active.path}`}
                />
              ) : (
                <OkMarkdownEditor
                  key={active.path}
                  value={active.content}
                  onChange={update}
                  ariaLabel={`Edit ${active.path}`}
                />
              )}
            </div>
          ) : activeSession ? (
            <article className="mx-auto w-full max-w-4xl px-10 py-10">
              <p className="type-label">
                Session evidence
              </p>
              <h1 className="mt-2 text-2xl font-semibold">
                {activeSession.account} · {activeSession.provider}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {new Date(activeSession.updatedAt).toLocaleString()} ·{" "}
                {activeSession.eventCount} archived events
              </p>
              <div className="mt-8 grid gap-5">
                <section className="rounded-lg border p-5">
                  <h2 className="text-sm font-semibold">Starting prompt</h2>
                  <pre className="mt-3 whitespace-pre-wrap font-mono text-sm leading-relaxed text-muted-foreground">
                    {activeSession.prompt ||
                      "No prompt text was recoverable from this archive."}
                  </pre>
                </section>
                <section className="rounded-lg border p-5">
                  <h2 className="text-sm font-semibold">Latest output</h2>
                  <pre className="mt-3 whitespace-pre-wrap font-mono text-sm leading-relaxed text-muted-foreground">
                    {activeSession.output ||
                      "No output text was recoverable from this archive."}
                  </pre>
                </section>
              </div>
              <Button className="mt-6" size="sm" onClick={openChat}>
                <SparklesIcon className="size-3.5" />
                Build context map
              </Button>
            </article>
          ) : (
            <div className="m-auto max-w-md text-center">
              <FolderIcon className="mx-auto size-7 text-muted-foreground" />
              <h2 className="mt-4 type-heading">
                Choose a document or session
              </h2>
              <p className="mt-2 type-caption leading-relaxed">
                Inspect Markdown, skills, memory, soul, and instruction
                documents alongside every relevant agent session.
              </p>
              <Button size="sm" className="mt-6" onClick={openChat}>
                <SparklesIcon />
                Open sessions
              </Button>
            </div>
          )}
          {active && !active.readOnly && <WikiAiInput docPath={active.path} />}
        </div>
        {splitActive && (
          <aside
            data-dock-side={splitSide}
            className={cn(
              "workspace-split-pane relative min-h-0 shrink-0 bg-card",
              splitSide === "left" || splitSide === "right"
                ? "min-w-56"
                : "min-h-32 min-w-0",
              splitSide === "left" || splitSide === "right"
                ? "border-l"
                : "border-t",
              splitSide === "left" && "order-first border-l-0 border-r",
              splitSide === "top" && "order-first border-t-0 border-b",
            )}
            style={
              splitSide === "left" || splitSide === "right"
                ? { width: `${splitPercent}%` }
                : { height: `${splitPercent}%` }
            }
          >
            <div
              role="separator"
              aria-label="Resize split document"
              aria-orientation={
                splitSide === "left" || splitSide === "right"
                  ? "vertical"
                  : "horizontal"
              }
              className={cn(
                "workspace-split-resizer",
                (splitSide === "top" || splitSide === "bottom") &&
                  "workspace-split-resizer-horizontal",
              )}
              onPointerDown={startSplitResize}
              onDoubleClick={() => setSplitPercent(42)}
            />
            <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                {splitActive.path.split("/").at(-1) || splitActive.path}
              </span>
              {!splitActive.readOnly && (
                <ModePill
                  source={splitSourceMode}
                  onChange={setSplitSourceMode}
                />
              )}
              <button
                type="button"
                onClick={() => setSplitPath(null)}
                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close split document"
              >
                ×
              </button>
            </div>
            <div
              className="scrollbar-none min-h-0 flex-1 overflow-y-auto"
              data-testid="editor-scroll-container"
            >
              {splitActive.readOnly ? (
                isMarkdownPath(splitActive.path) ? (
                  <article className="agentic-markdown mx-auto max-w-4xl px-8 py-8">
                    <MarkdownPreview content={splitActive.content} docPath={splitActive.path} />
                  </article>
                ) : (
                  <CodeDocumentView path={splitActive.path} content={splitActive.content} className="px-8 py-8" />
                )
              ) : !isMarkdownPath(splitActive.path) || splitSourceMode ? (
                <textarea
                  className="agentic-source-editor"
                  value={splitActive.content}
                  onChange={(event) =>
                    updatePath(splitActive.path, event.target.value)
                  }
                  spellCheck={false}
                  aria-label={`Edit ${splitActive.path}`}
                />
              ) : (
                <OkMarkdownEditor
                  key={splitActive.path}
                  value={splitActive.content}
                  onChange={(markdown) =>
                    updatePath(splitActive.path, markdown)
                  }
                  ariaLabel={`Edit ${splitActive.path}`}
                />
              )}
            </div>
          </aside>
        )}
      </DockDropTarget>
      {panelOpen && (
        <WikiUtilityPanel
          tab={panelTab}
          onTabChange={setPanelTab}
          activePath={activePath}
          activeContent={active?.content ?? null}
          onOpen={(path) => void open(path)}
          refreshKey={refreshKey}
        />
      )}
    </div>
  );
}
