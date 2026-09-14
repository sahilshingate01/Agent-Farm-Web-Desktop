import {
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  ActivityIcon,
  WheatIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CloudIcon,
  CopyIcon,
  CpuIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HistoryIcon,
  Layers3Icon,
  ListTodoIcon,
  LinkIcon,
  MessageSquareIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { getWorkspaceIndex } from "@/lib/workspace-cache";
import { AgenticSections } from "@/components/agentic-sections";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { vocab } from "@/lib/vocabulary";
import type { ChatSession, FarmAccount, FarmProfile, FarmdStatus, WorkspaceView } from "@/types/farm";

type SectionId = "projects" | "tasks" | "silos" | "profiles";

export type WorkspaceSidebarView = WorkspaceView;

export interface WorkspaceSidebarProps {
  projectName: string;
  projectPath?: string | null;
  sessions?: ChatSession[];
  activeSessionId?: string;
  accounts?: FarmAccount[];
  profiles?: FarmProfile[];
  search?: string;
  activeView?: WorkspaceSidebarView;
  gatewayRunning?: boolean;
  gatewayClients?: number;
  installReady?: boolean;
  theme?: "light" | "dark";
  onSearchChange?: (value: string) => void;
  onOpenSearch?: () => void;
  onSelectSession?: (id: string) => void;
  /** Commit a pending native peek into the Farm (double-click adopt). */
  onAdoptSession?: (id: string) => void;
  onSelectProfile?: (name: string) => void;
  onNewSession?: () => void;
  onNavigate?: (view: WorkspaceSidebarView) => void;
  onToggleTheme?: () => void;
  onUpdateSession?: (id: string, update: Partial<ChatSession>) => void;
  onDeleteSession?: (id: string) => void;
  onDuplicateSession?: (id: string) => void;
  onReorderSessions?: (ids: string[]) => void;
  onCollapseSidebar?: () => void;
  onBack?: () => void;
  onForward?: () => void;
  onResizeSidebar?: (event: React.PointerEvent<HTMLDivElement>) => void;
  footer?: ReactNode;
  className?: string;
  width?: number;
}

const sectionDefaults: Record<SectionId, boolean> = {
  projects: true,
  tasks: true,
  silos: false,
  profiles: false,
};

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

// Sits next to Gateway in the footer: navigation ONLY — the row opens farmd's
// home on the Gateway page, where status/URL/start-stop live. No daemon
// controls here: a one-click stop in the sidebar footer was too easy to hit
// by accident. Self-managed — farmd state isn't part of the bootstrap payload.
function FarmdFooterRow({ onNavigate }: { onNavigate?: (view: WorkspaceSidebarView) => void }) {
  const [status, setStatus] = useState<FarmdStatus | null>(null);

  useEffect(() => {
    if (!hasNativeBridge()) return;
    let alive = true;
    const load = async () => {
      try {
        const result = await invokeNative<FarmdStatus>("farm.farmd.status");
        if (alive) setStatus(result);
      } catch {
        /* daemon status is cosmetic here; retry on the next tick */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const running = status?.running ?? false;
  return (
    <button
      className="workspace-nav-item"
      title={running ? `farmd online · ${status?.url ?? ""}` : "farmd stopped"}
      onClick={() => onNavigate?.("gateway")}
    >
      <CloudIcon /> farmd
      {running && (
        <span className="ml-auto inline-flex items-center">
          <span className="size-1.5 rounded-full bg-primary" />
        </span>
      )}
    </button>
  );
}

function SidebarNavRow({
  label,
  icon,
  active = false,
  expanded,
  disclosure = false,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  expanded?: boolean;
  disclosure?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "workspace-nav-item workspace-sidebar-nav-control",
        disclosure && "workspace-sidebar-disclosure",
        active && "bg-accent text-accent-foreground",
      )}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {icon && <span className="workspace-sidebar-icon-slot">{icon}</span>}
      <span className={cn("min-w-0 truncate", !disclosure && "flex-1")}>{label}</span>
      <span className="workspace-sidebar-chevron-slot" aria-hidden={expanded === undefined}>
        {expanded !== undefined && (
          <ChevronRightIcon
            className={cn("transition-transform", expanded && "rotate-90")}
          />
        )}
      </span>
    </button>
  );
}

export function SidebarSection({
  id,
  label,
  icon,
  expanded,
  onToggle,
  actions,
  children,
  ...sectionProps
}: {
  id: string;
  label: string;
  icon?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">) {
  return (
    <section
      {...sectionProps}
      className={cn("workspace-sidebar-section", sectionProps.className)}
      data-section={id}
    >
      <SidebarSectionHeader actions={actions}>
        <SidebarNavRow
          label={label}
          icon={icon}
          expanded={expanded}
          disclosure
          onClick={onToggle}
        />
      </SidebarSectionHeader>
      <div
        className="workspace-sidebar-section-content"
        data-state={expanded ? "open" : "closed"}
        hidden={!expanded}
      >
        {children}
      </div>
    </section>
  );
}

function SidebarSectionHeader({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="group workspace-sidebar-section-header">
      {children}
      <div className="workspace-sidebar-section-actions">{actions}</div>
    </div>
  );
}

export function SidebarLeafRow({
  label,
  leading,
  active = false,
  muted = false,
  onClick,
  trailing,
  meta,
  ...rowProps
}: {
  label: string;
  leading?: ReactNode;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  /** Always-visible right-aligned muted mono metadata (e.g. "17 files"). */
  meta?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "onClick">) {
  return (
    <div
      {...rowProps}
      className={cn(
        "group workspace-sidebar-leaf-row",
        active && "bg-accent text-accent-foreground",
        rowProps.className,
      )}
      data-active={active || undefined}
    >
      <button
        type="button"
        className={cn(
          "workspace-sidebar-leaf-control",
          muted && "text-muted-foreground",
        )}
        onClick={onClick}
      >
        <span className="workspace-sidebar-icon-slot" aria-hidden={!leading}>
          {leading}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta !== undefined && (
          <span className="shrink-0 font-mono type-caption">{meta}</span>
        )}
      </button>
      <div className="workspace-sidebar-leaf-actions">{trailing}</div>
    </div>
  );
}

/** Wiki file tree in the MAIN sidebar (OK's pattern — the wiki view keeps
 *  full width for content; clicking a doc rides the wiki-bus open event). */
type WikiTreeNode = { name: string; path: string; file: boolean; children: WikiTreeNode[] };

function WikiTree({ onOpenDoc }: { onOpenDoc: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [tree, setTree] = useState<WikiTreeNode[]>([]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getWorkspaceIndex()
        .then((index) => {
          if (!cancelled) setFiles(index.files.map((file) => file.path));
        })
        .catch(() => {
          if (!cancelled) setFiles([]);
        });
    };
    load();
    window.addEventListener("agensis:workspace-root-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("agensis:workspace-root-changed", load);
    };
  }, []);

  useEffect(() => {
    if (!files) return;
    const worker = new Worker(new URL("../workers/wiki-tree.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WikiTreeNode[]>) => setTree(event.data);
    worker.postMessage({ paths: files });
    return () => worker.terminate();
  }, [files]);

  const renderNodes = (nodes: WikiTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => (
      <div key={node.path}>
        <SidebarLeafRow
          label={node.name}
          muted
          leading={node.file ? <FileTextIcon /> : <FolderOpenIcon />}
          style={{ paddingLeft: depth * 12 }}
          onClick={() => {
            if (node.file) {
              window.dispatchEvent(
                new CustomEvent("agensis:open-wiki-doc", { detail: { path: node.path } }),
              );
              onOpenDoc();
            } else {
              setOpenFolders((current) => {
                const next = new Set(current);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              });
            }
          }}
        />
        {!node.file && openFolders.has(node.path) && renderNodes(node.children, depth + 1)}
      </div>
    ));

  if (files === null) return <p className="px-3 py-1 type-caption">Loading wiki…</p>;
  if (!files.length) return <p className="px-3 py-1 type-caption">No docs yet.</p>;
  return <>{renderNodes(tree, 1)}</>;
}

type RecentWorkspace = { root: string; name: string };

function readRecentWorkspaces(): RecentWorkspace[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("agensis:recent-workspaces") || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.root === "string") : [];
  } catch {
    return [];
  }
}

function rememberWorkspace(entry: RecentWorkspace) {
  const next = [entry, ...readRecentWorkspaces().filter((item) => item.root !== entry.root)].slice(0, 8);
  window.localStorage.setItem("agensis:recent-workspaces", JSON.stringify(next));
}

/** OK-style project switcher pinned to the sidebar footer: current project +
 *  updown chevrons; opens an upward panel with search, recent projects
 *  (check on current), and a paste-a-path row. Switching persists the
 *  workspace root via farm.workspace.setRoot and notifies the app. */
function WorkspaceSwitcher({
  projectName,
  projectPath,
  installReady = false,
  onNavigate,
}: {
  projectName: string;
  projectPath?: string | null;
  installReady?: boolean;
  onNavigate?: (view: WorkspaceSidebarView) => void;
}) {
  const [open, setOpen] = useState(false);
  // null until the user switches — the trigger then tracks live props, so it
  // shows the real project name once bootstrap lands instead of freezing the
  // first-paint fallback ("Current project").
  const [switched, setSwitched] = useState<RecentWorkspace | null>(() => readRecentWorkspaces()[0] || null);
  const current = switched || { root: projectPath || "", name: projectName };
  const setCurrent = setSwitched;
  // Branch/worktree identity under the project name (OK switcher anatomy).
  const [checkout, setCheckout] = useState<{ branch: string | null; worktree: boolean } | null>(null);
  useEffect(() => {
    const fetchCheckout = () => {
      invokeNative<{ branch: string | null; worktree: boolean }>("farm.workspace.list")
        .then((result) => setCheckout({ branch: result.branch, worktree: result.worktree }))
        .catch(() => setCheckout(null));
    };
    fetchCheckout();
    window.addEventListener("agensis:workspace-root-changed", fetchCheckout);
    return () => window.removeEventListener("agensis:workspace-root-changed", fetchCheckout);
  }, []);
  const recents = useMemo(() => {
    const seed = projectPath ? [{ root: projectPath, name: projectName }] : [];
    const all = [...readRecentWorkspaces(), ...seed];
    return all.filter((item, index) => all.findIndex((other) => other.root === item.root) === index);
  }, [projectName, projectPath, open]);

  const switchTo = async (root: string, pick = false) => {
    try {
      const result = await invokeNative<RecentWorkspace>("farm.workspace.setRoot", pick ? { pick: true } : { root });
      rememberWorkspace(result);
      setCurrent(result);
      setOpen(false);
      window.dispatchEvent(new CustomEvent("agensis:workspace-root-changed", { detail: result }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("agensis:toast", { detail: { message: error instanceof Error ? error.message : String(error) } }));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="no-drag flex w-full min-w-0 items-center gap-2 border-t px-4 py-2.5 text-left hover:bg-muted" aria-label="Switch project">
          <span className="min-w-0 flex-1">
            <strong className="flex items-center gap-1.5 truncate text-sm font-medium">
              {current.name}
              <span
                title={installReady ? "CLI connected" : "CLI unavailable"}
                className={cn("size-1.5 shrink-0 rounded-full", installReady ? "bg-primary" : "bg-destructive")}
              />
            </strong>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              {checkout?.branch ? (
                <>
                  <GitBranchIcon className="size-3 shrink-0" />
                  {checkout.branch}
                  {checkout.worktree ? " · worktree" : ""}
                </>
              ) : (
                current.root
              )}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <Command>
          <CommandInput placeholder="Search projects..." />
          <CommandList>
            <CommandEmpty>No matching projects.</CommandEmpty>
            <CommandGroup>
              {recents.map((item) => (
                <CommandItem key={item.root} value={`${item.name} ${item.root}`} className="px-3 py-2" onSelect={() => void switchTo(item.root)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.root}</span>
                  </span>
                  {item.root === current.root && <CheckIcon className="size-3.5 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {/* OK switcher anatomy: quiet action rows under a separator; the
              folder row expands into a flat inline path field (there is no
              native picker on the bridge yet). */}
          <div className="border-t p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
              onClick={() => void switchTo("", true)}
            >
              <FolderOpenIcon className="size-4 text-muted-foreground" />
              Open folder…
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                setOpen(false);
                onNavigate?.("overview");
              }}
            >
              <GitBranchIcon className="size-4 text-muted-foreground" />
              {vocab.paddocks}…
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SessionMenu({
  session,
  projectPath,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  session: ChatSession;
  projectPath?: string | null;
  onUpdate?: (update: Partial<ChatSession>) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label={`Actions for ${session.title}`}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem onClick={() => onUpdate?.({ pinned: !session.pinned })}>
          {session.pinned ? <PinOffIcon /> : <PinIcon />}
          {session.pinned ? "Unpin" : "Pin"} {vocab.job.toLowerCase()}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const title = window
              .prompt(`Rename ${vocab.job.toLowerCase()}`, session.title)
              ?.trim();
            if (title) onUpdate?.({ title, updatedAt: new Date().toISOString() });
          }}
        >
          <FileTextIcon /> Rename {vocab.job.toLowerCase()}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            onUpdate?.({
              archived: !session.archived,
              updatedAt: new Date().toISOString(),
            })
          }
        >
          <ArchiveIcon /> {session.archived ? "Unarchive" : "Archive"}{" "}
          {vocab.job.toLowerCase()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onUpdate?.({ unread: !session.unread })}>
          <MessageSquareIcon /> {session.unread ? "Mark as read" : "Mark as unread"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <FolderOpenIcon /> Reveal in Finder
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!projectPath} onClick={() => copyText(projectPath || "")}>
          <CopyIcon /> Copy working directory
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copyText(session.id)}>
          <CopyIcon /> Copy session ID
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copyText(`agensis://session/${session.id}`)}>
          <ExternalLinkIcon /> Copy deeplink
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDuplicate}>
          <MessageSquareIcon /> Continue in new {vocab.job.toLowerCase()}
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <GitBranchIcon /> Continue in new worktree
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <ExternalLinkIcon /> Open in new window
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Adopted/pending rows keep the promise explicit: only the Farm copy
            goes — the provider's original transcript on disk is untouched. */}
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          {session.pending
            ? "Discard preview"
            : session.originPath
              ? "Remove from Farm (keeps original)"
              : `Delete ${vocab.job.toLowerCase()}`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectMenu({ projectName, projectPath }: { projectName: string; projectPath?: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem disabled><PinOffIcon /> Unpin project</DropdownMenuItem>
        <DropdownMenuItem disabled><FolderOpenIcon /> Reveal in Finder</DropdownMenuItem>
        <DropdownMenuItem disabled><GitBranchIcon /> Create permanent worktree</DropdownMenuItem>
        <DropdownMenuItem disabled><FileTextIcon /> Rename project</DropdownMenuItem>
        <DropdownMenuItem disabled><ArchiveIcon /> Archive {vocab.jobs.toLowerCase()}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled><Trash2Icon /> Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceSidebar({
  projectName,
  projectPath,
  sessions = [],
  activeSessionId,
  accounts = [],
  profiles = [],
  search = "",
  activeView,
  gatewayRunning = false,
  gatewayClients = 0,
  installReady = false,
  theme = "light",
  onSearchChange,
  onOpenSearch,
  onSelectSession,
  onAdoptSession,
  onSelectProfile,
  onNewSession,
  onNavigate,
  onToggleTheme,
  onUpdateSession,
  onDeleteSession,
  onDuplicateSession,
  onReorderSessions,
  onCollapseSidebar,
  onBack,
  onForward,
  onResizeSidebar,
  footer,
  className,
  width,
}: WorkspaceSidebarProps) {
  // Two-step kit deletion from the Equipment section's context menu.
  const [kitToDelete, setKitToDelete] = useState<string | null>(null);
  const [kitDeleteError, setKitDeleteError] = useState<string | null>(null);
  const [kitDeleting, setKitDeleting] = useState(false);
  const confirmKitDelete = async () => {
    if (!kitToDelete || kitDeleting) return;
    setKitDeleting(true);
    setKitDeleteError(null);
    try {
      await invokeNative("farm.profile.remove", { name: kitToDelete });
      setKitToDelete(null);
      window.dispatchEvent(new Event("agensis:data-changed"));
    } catch (error) {
      setKitDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setKitDeleting(false);
    }
  };
  const [expanded, setExpanded] = useState(sectionDefaults);
  const [wikiTreeOpen, setWikiTreeOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? sessions.filter((session) => `${session.title} ${session.model}`.toLowerCase().includes(query)) : sessions;
  }, [sessions, search]);
  const projectSessions = filtered.filter((session) => session.project === projectName);
  const tasks = filtered.filter((session) => !session.project);
  const activeTasks = tasks.filter((session) => !session.archived);
  const archivedTasks = tasks.filter((session) => session.archived);
  // A session must never be filter-invisible, but one tagged with ANOTHER
  // project is not this project's task — it gets its own labelled group rather
  // than being mixed into Tasks, where a single drag would silently retag it.
  const otherProjectTasks = filtered.filter(
    (session) =>
      session.project && session.project !== projectName && !session.archived,
  );
  const [showArchived, setShowArchived] = useState(false);

  const toggle = (id: SectionId) => setExpanded((value) => ({ ...value, [id]: !value[id] }));
  const moveSession = (id: string, project: string | null) => {
    onUpdateSession?.(id, { project, updatedAt: new Date().toISOString() });
    setDraggedId(null);
  };
  const openSearch = () => {
    if (onOpenSearch) {
      onOpenSearch();
      return;
    }
    window.dispatchEvent(new CustomEvent("agensis:open-search"));
  };
  const selectProfile = (name: string) => {
    if (onSelectProfile) {
      onSelectProfile(name);
      return;
    }
    window.dispatchEvent(new CustomEvent("agensis:select-profile", { detail: name }));
  };
  const reorder = (targetId: string, list: ChatSession[]) => {
    if (!draggedId || draggedId === targetId || !onReorderSessions) return;
    const ids = sessions.map((session) => session.id);
    const from = ids.indexOf(draggedId);
    const target = ids.indexOf(targetId);
    if (from < 0 || target < 0) return;
    ids.splice(from, 1);
    ids.splice(target, 0, draggedId);
    onReorderSessions(ids);
    setDraggedId(null);
  };
  const row = (session: ChatSession, list: ChatSession[]) => (
    <SidebarLeafRow
      key={session.id}
      draggable={!session.pending}
      onDragStart={(event) => {
        setDraggedId(session.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-agensis-session", session.id);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); reorder(session.id, list); }}
      // Pending native peek: italic + "pending", discarded on switch-away;
      // double-click commits it into the Farm (adopt-on-use).
      className={session.pending ? "italic" : undefined}
      onDoubleClick={
        session.pending ? () => onAdoptSession?.(session.id) : undefined
      }
      label={session.title}
      meta={session.pending ? "pending" : undefined}
      leading={<MessageSquareIcon />}
      active={activeSessionId === session.id}
      onClick={() => onSelectSession?.(session.id)}
      trailing={
        <>
          {session.unread && <span className="size-1.5 rounded-full bg-primary" />}
          <SessionMenu
            session={session}
            projectPath={session.project ? projectPath : null}
            onUpdate={(update) => onUpdateSession?.(session.id, update)}
            onDelete={() => onDeleteSession?.(session.id)}
            onDuplicate={() => onDuplicateSession?.(session.id)}
          />
        </>
      }
    />
  );

  return (
    <aside className={cn("workspace-rail flex min-h-0 flex-col border-r border-sidebar-border bg-sidebar", className)} style={width ? { width } : undefined}>
      <div className="drag-region flex h-[52px] shrink-0 items-center border-b pr-2">
        <div aria-hidden className="workspace-traffic-light-reserve shrink-0 self-stretch" />
        {onCollapseSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="no-drag [&_svg]:size-4.5"
            onClick={onCollapseSidebar}
            aria-label="Collapse sidebar"
          >
            <PanelLeftCloseIcon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="no-drag ml-auto [&_svg]:size-4.5"
          onClick={onBack}
          aria-label="Go back"
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="no-drag [&_svg]:size-4.5"
          onClick={onForward}
          aria-label="Go forward"
        >
          <ArrowRightIcon />
        </Button>
        {onToggleTheme && (
          <Button
            variant="ghost"
            size="icon"
            className="no-drag [&_svg]:size-4.5 text-muted-foreground"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
        )}
      </div>
      <div className="flex h-16 shrink-0 items-center px-2">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src="/brand/icon_black.png"
            alt=""
            aria-hidden
            className="size-[2.64rem] shrink-0 translate-x-[0.2rem] -translate-y-[0.2rem] dark:hidden"
          />
          <img
            src="/brand/icon_white.png"
            alt=""
            aria-hidden
            className="hidden size-[2.64rem] shrink-0 translate-x-[0.2rem] -translate-y-[0.2rem] dark:block"
          />
          <div className="min-w-0">
            <strong className="block type-display text-[1.2rem] leading-none">
              Agents{ /* <span className="brand-farm">Farm</span> */}
            </strong>
            <span className="mt-[0.1rem] block text-right text-[0.56rem] font-medium uppercase tracking-[0.20em] text-foreground/55">
              Farm
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          className="no-drag ml-auto size-8"
          onClick={openSearch}
          aria-label="Search Agent Farm"
          title="Search Agent Farm (⌘K)"
        >
          <SearchIcon />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="no-drag workspace-sidebar-navigation @container px-2 pb-4">
          {/* Crew / Harvest as a segmented tab pair — same anatomy and
              secondary face as the editor mode pill and 2d/3d toggle.
              Labels drop to icon-only below a 14rem container width (the
              sidebar is user-resizable) — the title carries the name. */}
          <div className="mb-2 flex gap-0.5 rounded-lg border bg-muted/40 p-0.5">
            {([
              ["overview", vocab.crew, ActivityIcon],
              ["harvest", vocab.harvest, WheatIcon],
            ] as const).map(([view, label, Icon]) => (
              <button
                key={view}
                type="button"
                aria-pressed={activeView === view}
                aria-label={label}
                title={label}
                onClick={() => onNavigate?.(view)}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-secondary text-[0.8rem] font-medium uppercase transition-colors",
                  activeView === view
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate @max-[14rem]:hidden">{label}</span>
              </button>
            ))}
          </div>
          <SidebarSection
            id="projects"
            label={projectName}
            icon={<FolderOpenIcon />}
            expanded={expanded.projects}
            onToggle={() => {
              toggle("projects");
              onNavigate?.("projects");
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedId) moveSession(draggedId, projectName);
            }}
            actions={
              <>
                <ProjectMenu projectName={projectName} projectPath={projectPath} />
                <Button variant="ghost" size="icon-xs" aria-label="Add project">
                  <PlusIcon />
                </Button>
              </>
            }
          >
            {projectSessions.map((session) => row(session, projectSessions))}
            <SidebarLeafRow
              label="Wiki"
              leading={<FileTextIcon />}
              muted
              active={activeView === "documents"}
              onClick={() => {
                setWikiTreeOpen((open) => !open);
                onNavigate?.("documents");
              }}
              trailing={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={wikiTreeOpen ? "Collapse wiki tree" : "Expand wiki tree"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setWikiTreeOpen((open) => !open);
                  }}
                >
                  <ChevronRightIcon className={cn("transition-transform", wikiTreeOpen && "rotate-90")} />
                </Button>
              }
            />
            {wikiTreeOpen && <WikiTree onOpenDoc={() => onNavigate?.("documents")} />}
          </SidebarSection>
          <SidebarNavRow
            label={vocab.chores}
            icon={<ListTodoIcon />}
            active={activeView === "chores"}
            onClick={() => onNavigate?.("chores")}
          />
          <SidebarSection
            id="tasks"
            label={vocab.jobs}
            icon={<HistoryIcon />}
            expanded={expanded.tasks}
            onToggle={() => {
              toggle("tasks");
              onNavigate?.("chat");
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedId) moveSession(draggedId, null);
            }}
            actions={
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onNewSession}
                aria-label="New job"
              >
                <PlusIcon />
              </Button>
            }
          >
            {activeTasks.some((session) => session.pinned) && (
              <>
                <p className="px-3 pb-0.5 pt-1 type-caption">Pinned</p>
                {activeTasks.filter((session) => session.pinned).map((session) => row(session, tasks))}
                {activeTasks.some((session) => !session.pinned) && (
                  <p className="px-3 pb-0.5 pt-2 type-caption">Recent</p>
                )}
              </>
            )}
            {activeTasks.filter((session) => !session.pinned).map((session) => row(session, tasks))}
            {otherProjectTasks.length > 0 && (
              <>
                <p className="px-3 pb-0.5 pt-2 type-caption">Other projects</p>
                {otherProjectTasks.map((session) =>
                  row(session, otherProjectTasks),
                )}
              </>
            )}
            {archivedTasks.length > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((value) => !value)}
                className="w-full px-3 pb-1 pt-2 text-left type-caption hover:text-foreground"
              >
                {showArchived
                  ? "Hide archived"
                  : `${archivedTasks.length} archived`}
              </button>
            )}
            {showArchived && (
              <div className="opacity-60">
                {archivedTasks.map((session) => row(session, tasks))}
              </div>
            )}
          </SidebarSection>
          <SidebarSection
            id="silos"
            label="Agent Silos"
            icon={<CpuIcon />}
            expanded={expanded.silos}
            onToggle={() => {
              toggle("silos");
              onNavigate?.("silos");
            }}
          >
            {accounts.map((account) => (
              <SidebarLeafRow
                key={account.name}
                label={account.name}
                leading={<CpuIcon />}
                onClick={() => onNavigate?.("silos")}
              />
            ))}
          </SidebarSection>
          <SidebarSection
            id="profiles"
            label={vocab.equipment}
            icon={<Layers3Icon />}
            expanded={expanded.profiles}
            onToggle={() => {
              toggle("profiles");
              onNavigate?.("profiles");
            }}
          >
            {profiles.map((profile) => (
              <ContextMenu key={profile.name}>
                <ContextMenuTrigger asChild>
                  <div>
                    <SidebarLeafRow
                      label={profile.name}
                      leading={<Layers3Icon />}
                      onClick={() => selectProfile(profile.name)}
                    />
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      void invokeNative("farm.profile.duplicate", { name: profile.name })
                        .then(() => window.dispatchEvent(new Event("agensis:data-changed")))
                        .catch(() => {});
                    }}
                  >
                    Duplicate kit
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    disabled={profile.source === "bundled"}
                    title={profile.source === "bundled" ? "Bundled kits can be duplicated but not deleted" : undefined}
                    onSelect={() => setKitToDelete(profile.name)}
                  >
                    Delete kit…
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </SidebarSection>
          <AgenticSections
            onActivateWiki={() => onNavigate?.("documents")}
            onManageWorktrees={() => onNavigate?.("worktrees")}
          />
        </nav>
      </ScrollArea>
      <Dialog open={kitToDelete !== null} onOpenChange={(open) => !open && setKitToDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete kit</DialogTitle>
            <DialogDescription>
              Delete the kit &apos;{kitToDelete}&apos;? The kit file is removed from your
              custom profiles — silos keep running, but nothing can equip it afterwards.
            </DialogDescription>
          </DialogHeader>
          {kitDeleteError && <p className="type-caption text-destructive">{kitDeleteError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setKitToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={kitDeleting} onClick={() => void confirmKitDelete()}>
              {kitDeleting ? "Deleting…" : "Delete kit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="no-drag flex flex-col gap-0.5 border-t px-2 py-2">
        <button className={cn("workspace-nav-item", activeView === "settings" && "bg-accent text-accent-foreground")} onClick={() => onNavigate?.("settings")}><SettingsIcon /> Settings</button>
        <button className={cn("workspace-nav-item", activeView === "gateway" && "bg-accent text-accent-foreground")} onClick={() => onNavigate?.("gateway")}>
          <ServerIcon /> Gateway
          {gatewayRunning && (
            <span className="ml-auto inline-flex items-center gap-1.5">
              {gatewayClients > 0 && (
                <span
                  className="inline-flex items-center gap-1 font-mono type-caption"
                  title={`${gatewayClients} client${gatewayClients > 1 ? "s" : ""} on the API in the last 10 minutes`}
                >
                  <LinkIcon className="size-3" />
                  {gatewayClients}
                </span>
              )}
              <span className="size-1.5 rounded-full bg-primary" />
            </span>
          )}
        </button>
        <FarmdFooterRow onNavigate={onNavigate} />
      </div>
      {footer}
      <WorkspaceSwitcher
        projectName={projectName}
        projectPath={projectPath}
        installReady={installReady}
        onNavigate={onNavigate}
      />
      {onResizeSidebar && <div role="separator" aria-label="Resize navigation sidebar" aria-orientation="vertical" className="sidebar-resize-handle sidebar-resize-handle-left" onPointerDown={onResizeSidebar} />}
    </aside>
  );
}
