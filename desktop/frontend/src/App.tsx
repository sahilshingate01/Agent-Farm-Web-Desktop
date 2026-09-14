import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import packageMetadata from "../package.json";
import {
  BarChart3Icon,
  BoxesIcon,
  CheckIcon,
  ChevronRightIcon,
  Clock3Icon,
  CoinsIcon,
  CopyIcon,
  CpuIcon,
  FileTextIcon,
  GripVerticalIcon,
  GaugeIcon,
  KeyRoundIcon,
  Layers3Icon,
  MessageSquareTextIcon,
  NetworkIcon,
  PlayIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  RouteIcon,
  SaveIcon,
  SearchIcon,
  ServerIcon,
  SquareIcon,
  SquareTerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { ChatWorkspace } from "@/components/chat-workspace";
import { GlobalCommandPalette } from "@/components/global-command-palette";
import { GatewayStatusOverview } from "@/components/gateway-status-overview";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import {
  SettingsWorkspace as SettingsWorkspaceSurface,
  type SettingsThemeMode,
} from "@/components/settings-workspace";
import { TokenChip } from "@/components/ui/token-chip";
import {
  WorkflowEditor,
  applyWorkflowToRoute,
  workflowFromRoute,
} from "@/components/workflow-editor";
import { AgenticWorkspace } from "@/components/agentic-workspace";
import { WorktreesWorkspace } from "@/components/worktrees-workspace";
import { ControlTower } from "@/components/control-tower";
import { HarvestView } from "@/components/harvest-view";
import { ChoresWorkspace } from "@/components/chores/chores-workspace";
import { DistributedSilosPanel } from "@/components/distributed-silos-panel";
import { vocab } from "@/lib/vocabulary";
import { planHandoff } from "@/lib/handoff-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { mergeCatalog } from "@/lib/model-catalog";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import { formatClock } from "@/lib/timezone";
import type {
  BootstrapData,
  ChatSession,
  FarmProfile,
  FarmdStatus,
  GatewayRoute,
  GatewaySettings,
  GatewayStatus,
  UsageWindow,
  WorkspaceView,
} from "@/types/farm";

type View = WorkspaceView;
type Theme = "light" | "dark";
type UiFont =
  | "geist"
  | "system"
  | "inter"
  | "helvetica"
  | "space-grotesk"
  | "manrope"
  | "dm-sans"
  | "work-sans"
  | "plus-jakarta";
type MonoFont =
  | "geist-mono"
  | "jetbrains"
  | "berkeley"
  | "sf-mono"
  | "menlo"
  | "ibm-plex"
  | "space-mono";

const DESIGN_FONT_VERSION = "open-knowledge-v2";

/** Saved font prefs are honored only if they were written by the current
 *  design version — older versions carried pre-OK defaults worth migrating
 *  away from once, not on every launch. */
function fontPrefsCurrent(): boolean {
  try { return localStorage.getItem("usage-farm-design-font-version") === DESIGN_FONT_VERSION; } catch { return false; }
}
const APP_SESSIONS_KEY = "usage-farm-chat-sessions-v2";
const APP_ACTIVE_SESSION_KEY = "usage-farm-active-session-v2";

function readSidebarSessions(): ChatSession[] {
  try {
    const value = JSON.parse(localStorage.getItem(APP_SESSIONS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const DevVisualTodoWidgetMount = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/visual-todo-widget-mount").then((module) => ({
        default: module.VisualTodoWidgetMount,
      })),
    )
  : null;

function defaultData(): BootstrapData {
  return {
    app: { version: packageMetadata.version, native: hasNativeBridge() },
    install: {
      cli: null,
      repo: null,
      state: "~/.usage-farm",
      ready: false,
      nativeCli: null,
    },
    accounts: [],
    profiles: [],
    catalog: { skills: [], agents: [], commands: [], mcp: [] },
    gateway: {
      running: false,
      pid: null,
      url: "http://127.0.0.1:4545",
      startedAt: null,
    },
    settings: { host: "127.0.0.1", port: 4545, routes: [] },
  };
}

function PageHeader({
  eyebrow,
  title,
  description,
  descriptionClassName,
  actions,
  contentStyle,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  descriptionClassName?: string;
  actions?: React.ReactNode;
  contentStyle?: React.CSSProperties;
}) {
  return (
    <header className="flex items-end justify-between gap-8 border-b bg-background/90 px-8 pb-6 pt-10">
      {/* OK page anatomy: title + caption only — no eyebrow line, blue is for actions. */}
      <div className="flex flex-col gap-1" style={contentStyle}>
        <h1 className="type-title leading-none">
          {title}
        </h1>
        <p
          className={cn(
            "mt-1 max-w-2xl type-caption",
            descriptionClassName,
          )}
        >
          {description}
        </p>
      </div>
      {actions && (
        <div className="no-drag flex items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

function HomeView({
  data,
  setView,
  runAction,
  refresh,
  notify,
  refreshedAt,
  pinging,
}: {
  data: BootstrapData;
  setView: (view: View) => void;
  runAction: (action: string, args?: string[]) => void;
  refresh: () => Promise<void> | void;
  notify: (message: string) => void;
  refreshedAt: number | null;
  pinging: boolean;
}) {
  const running = data.accounts.filter((account) => account.running).length;
  const usage = data.accounts.flatMap((account) => account.usage || []);
  // Availability rota (shared with the planner card): relay-coverage hours
  // for the next 24h and the tightest weekly ceiling across silo lanes.
  const rota = useMemo(() => planHandoff(data.accounts, new Date()), [data.accounts]);
  const relayHours = (rota.horizonMinutes - rota.uncovered) / 60;
  const weeklyLanes = rota.lanes.filter((lane) => lane.weeklyRemaining != null);
  const tightestWeekly = weeklyLanes.length
    ? Math.min(...weeklyLanes.map((lane) => lane.weeklyRemaining ?? 1))
    : null;
  const tokenTotal = (key: "tokens24h" | "tokens7d") =>
    usage.reduce((total, item) => total + (item[key] || 0), 0);
  const remainingFor = (pattern: RegExp) => {
    const values = usage.flatMap((item) =>
      item.windows
        .filter((window) => pattern.test(window.window))
        .map((window) => window.remainingPercent)
        .filter((value): value is number => value != null),
    );
    return values.length ? `${Math.round(Math.min(...values))}%` : "—";
  };
  const availability = (account: BootstrapData["accounts"][number]) =>
    account.usage?.flatMap((usage) =>
      usage.windows.map((window) => ({ ...window, provider: usage.provider })),
    ) || [];
  const usageRank = (account: BootstrapData["accounts"][number]) => {
    const windows = availability(account);
    const daily = windows.find((window) =>
      /day|daily|5h|7h|8h|hour/i.test(window.window),
    );
    return (
      daily?.remainingPercent ??
      Math.max(...windows.map((window) => window.remainingPercent ?? -1), -1)
    );
  };
  const usageWindowLabel = (window: UsageWindow & { provider: string }) => {
    const remaining =
      window.remainingPercent == null
        ? window.status || "not reported"
        : `${Math.round(window.remainingPercent)}% left`;
    const reset = window.resetsAt
      ? ` · ${formatClock(new Date(window.resetsAt))}`
      : "";
    return `${window.provider} ${window.window.replaceAll("_", " ")} · ${remaining}${reset}`;
  };
  const usageLabel = (account: BootstrapData["accounts"][number]) =>
    (account.usage || [])
      .map((usage) => {
        const window =
          usage.windows.find((item) => item.remainingPercent != null) ||
          usage.windows[0];
        if (window?.remainingPercent != null)
          return `${usage.provider}: ${Math.round(window.remainingPercent)}% left`;
        if (window?.status)
          return `${usage.provider}: ${window.status}${window.resetsAt ? ` until ${formatClock(new Date(window.resetsAt))}` : ""}`;
        if (usage.tokens24h != null)
          return `${usage.provider}: ${usage.tokens24h.toLocaleString()} tokens today`;
        return `${usage.provider}: quota not reported`;
      })
      .join(" · ");
  return (
    <>
      <PageHeader
        eyebrow="System map"
        title="Crew"
        description="Silos, equipment, paddocks and quota-aware rotation — the whole workforce in one place."
        actions={
          <>
            <Button size="sm" variant="outline" disabled={pinging} onClick={() => void refresh()}>
              <RefreshCwIcon data-icon="inline-start" className={cn(pinging && "animate-spin")} />
              {pinging ? "Pinging crew\u2026" : "Refresh"}
            </Button>
            <Button size="sm" onClick={() => setView("silos")}>
              Create silo
            </Button>
          </>
        }
      />
      <div className="scrollbar-none flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-[102rem] flex-col gap-6">
          <ControlTower
            accounts={data.accounts}
            profiles={data.profiles}
            elevators={data.settings.routes
              .filter((route) => route.transport === "hybrid")
              .map((route) => ({ id: route.id, label: route.label }))}
            catalog={{ commands: data.catalog.commands, agents: data.catalog.agents }}
            gatewayRunning={data.gateway.running}
            routeCount={data.settings.routes.length}
            onEquip={(silo, profile) =>
              runAction("equip", [silo, "--profile", profile])
            }
            onNavigate={setView}
            onNotify={notify}
            refreshedAt={refreshedAt}
            onRefreshUsage={() => void refresh()}
            pinging={pinging}
          />
        </div>
      </div>
    </>
  );
}

function AgentContainersView({
  data,
  refresh,
  notify,
  runAction,
  setView,
}: {
  data: BootstrapData;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  runAction: (action: string, args?: string[]) => void;
  setView: (view: View) => void;
}) {
  const groups = data.settings.routes.filter(
    (route) => route.transport === "hybrid",
  );
  const containers = data.accounts.flatMap((account) =>
    account.providers.map((provider) => ({
      id: `${provider}/${account.name}`,
      provider,
      account,
    })),
  );
  const catalog = useMemo(() => mergeCatalog(data.models), [data.models]);
  const [collapsedSilos, setCollapsedSilos] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleSilo = (name: string) =>
    setCollapsedSilos((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  // Model lists collapse per provider (default collapsed) — a models.json
  // override can make a provider's list run to hundreds of entries.
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleProvider = (id: string) =>
    setExpandedProviders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [selectedId, setSelectedId] = useState(
    () => groups[0]?.id || containers[0]?.id || "",
  );
  const selectedGroup = groups.find((group) => group.id === selectedId);
  const selectedContainer = containers.find(
    (container) => container.id === selectedId,
  );
  const [draftGroup, setDraftGroup] = useState<GatewayRoute | null>(
    selectedGroup ? structuredClone(selectedGroup) : null,
  );
  const [draftWorkflow, setDraftWorkflow] = useState(() =>
    selectedGroup
      ? workflowFromRoute(selectedGroup)
      : { kind: "parallel" as const, members: [], repeats: 1 },
  );
  const [newGroupId, setNewGroupId] = useState("");
  const [profileSelection, setProfileSelection] = useState("");
  const [treeWidth, setTreeWidth] = useState(() =>
    Math.min(
      520,
      Math.max(
        280,
        Number(localStorage.getItem("usage-farm-containers-tree-width")) || 360,
      ),
    ),
  );
  useEffect(
    () => setDraftGroup(selectedGroup ? structuredClone(selectedGroup) : null),
    [selectedGroup?.id],
  );
  useEffect(
    () =>
      setDraftWorkflow(
        selectedGroup
          ? workflowFromRoute(selectedGroup)
          : { kind: "parallel", members: [], repeats: 1 },
      ),
    [selectedGroup?.id],
  );
  useEffect(
    () => setProfileSelection(selectedContainer?.account.profile || ""),
    [selectedContainer?.id, selectedContainer?.account.profile],
  );
  useEffect(() => {
    localStorage.setItem("usage-farm-containers-tree-width", String(treeWidth));
  }, [treeWidth]);
  const startTreeResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeWidth;
    const onMove = (move: PointerEvent) =>
      setTreeWidth(
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
  const activeGroup = draftGroup || selectedGroup;
  const updateWorkflow = (workflow: ReturnType<typeof workflowFromRoute>) => {
    setDraftWorkflow(workflow);
    setDraftGroup((current) =>
      current ? { ...current, members: workflow.members || [] } : current,
    );
  };
  const saveGroup = async () => {
    if (!draftGroup) return;
    const routeWithWorkflow = applyWorkflowToRoute(draftGroup, draftWorkflow);
    await invokeNative("farm.gateway.save", {
      ...data.settings,
      routes: data.settings.routes.map((route) =>
        route.id === draftGroup.id ? routeWithWorkflow : route,
      ),
    });
    await refresh();
    notify(`Saved elevator ${draftGroup.id}.`);
  };
  const createGroup = async () => {
    const id = newGroupId.trim().toLowerCase().replace(/\s+/g, "-");
    if (!id) return notify("Enter an elevator ID first.");
    if (groups.some((group) => group.id === id))
      return notify(`An elevator named ${id} already exists.`);
    const route: GatewayRoute = {
      id,
      label: newGroupId.trim(),
      transport: "hybrid",
      members: [],
      strategy: "parallel",
      repeats: 1,
      workflow: { kind: "parallel", members: [], repeats: 1 },
      permissions: "ask",
    };
    await invokeNative("farm.gateway.save", {
      ...data.settings,
      routes: [...data.settings.routes, route],
    });
    setNewGroupId("");
    setSelectedId(id);
    await refresh();
    notify(`Created elevator ${id}.`);
  };
  const duplicateGroup = async () => {
    if (!activeGroup) return;
    const base = activeGroup.id.replace(/-copy(?:-\d+)?$/, "");
    let id = `${base}-copy`;
    let n = 2;
    while (groups.some((group) => group.id === id)) id = `${base}-copy-${n++}`;
    const route = {
      ...structuredClone(applyWorkflowToRoute(activeGroup, draftWorkflow)),
      id,
      label: `${activeGroup.label || activeGroup.id} copy`,
    };
    await invokeNative("farm.gateway.save", {
      ...data.settings,
      routes: [...data.settings.routes, route],
    });
    setSelectedId(id);
    await refresh();
    notify(`Duplicated ${activeGroup.id} as ${id}.`);
  };
  const deleteGroup = async () => {
    if (!activeGroup) return;
    if (
      !window.confirm(
        `Delete elevator “${activeGroup.label || activeGroup.id}”?`,
      )
    )
      return;
    await invokeNative("farm.gateway.save", {
      ...data.settings,
      routes: data.settings.routes.filter(
        (route) => route.id !== activeGroup.id,
      ),
    });
    setSelectedId(containers[0]?.id || "");
    await refresh();
    notify(`Deleted elevator ${activeGroup.id}.`);
  };
  const groupProfiles = activeGroup
    ? ((activeGroup.members || [])
        .map(
          (member) =>
            containers.find((container) => container.id === member)?.account
              .profile,
        )
        .filter(Boolean)
        .map((name) => data.profiles.find((profile) => profile.name === name))
        .filter(Boolean) as FarmProfile[])
    : [];
  const blendedSkills = [
    ...new Set([
      ...(activeGroup?.skills || []),
      ...groupProfiles.flatMap((profile) => profile.skills_from_host),
    ]),
  ];
  const blendedCommands = [
    ...new Set([
      ...(activeGroup?.tools || []),
      ...groupProfiles.flatMap((profile) => profile.commands_from_host),
    ]),
  ];
  const blendedMcp = [
    ...new Set([
      ...(activeGroup?.mcp || []),
      ...groupProfiles.flatMap((profile) => profile.mcp),
    ]),
  ];
  const equipmentSources = (
    kind: "skills" | "commands" | "mcp",
    value: string,
  ) => {
    const sources: string[] = [];
    if (activeGroup?.[kind === "commands" ? "tools" : kind]?.includes(value))
      sources.push("elevator");
    for (const member of activeGroup?.members || []) {
      const profileName = containers.find(
        (container) => container.id === member,
      )?.account.profile;
      const profile = data.profiles.find((item) => item.name === profileName);
      const values =
        kind === "skills"
          ? profile?.skills_from_host
          : kind === "commands"
            ? profile?.commands_from_host
            : profile?.mcp;
      if (values?.includes(value))
        sources.push(profileName ? `${member} · ${profileName}` : member);
    }
    return sources.join(" · ") || "unattributed";
  };
  return (
    <>
      <PageHeader
        eyebrow="Runtime"
        title="Agent Silos"
        description="Atomic provider homes and the elevators that route them."
        actions={
          <div className="flex items-center gap-2">
            {draftGroup && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => void duplicateGroup()}
                >
                  <CopyIcon data-icon="inline-start" />
                  Duplicate
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => void deleteGroup()}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Delete
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="text-xs"
                  onClick={() => void saveGroup()}
                >
                  <SaveIcon data-icon="inline-start" />
                  Save elevator
                </Button>
              </>
            )}
            {selectedContainer && (
              <Button
                type="button"
                size="sm"
                disabled={!profileSelection}
                onClick={() =>
                  runAction("equip", [
                    selectedContainer.account.name,
                    "--profile",
                    profileSelection,
                  ])
                }
              >
                <PlayIcon data-icon="inline-start" />
                Apply profile
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => setView("gateway")}
            >
              <RouteIcon data-icon="inline-start" />
              Gateway
            </Button>
          </div>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside
          className="relative shrink-0 overflow-y-auto border-r p-3"
          style={{ width: treeWidth }}
        >
          <p className="px-2 pb-2 type-label">
            Elevators
          </p>
          {groups.length ? (
            groups.map((group) => (
              <div key={group.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(group.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left type-list",
                    selectedId === group.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <Layers3Icon className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">
                    {group.label || group.id}
                  </span>
                </button>
                {selectedId === group.id && (
                  <div className="ml-5 border-l pl-2">
                    {(group.members || []).map((member) => (
                      <button
                        type="button"
                        key={member}
                        onClick={() => setSelectedId(member)}
                        className="flex w-full items-center gap-1 truncate rounded px-2 py-1 text-left type-list text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <CpuIcon className="size-2.5 shrink-0" />
                        {member}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="px-2 type-caption">
              No elevators configured.
            </p>
          )}
          <div className="mt-2 flex gap-1 px-1">
            <Input
              aria-label="New elevator ID"
              placeholder="new-elevator"
              value={newGroupId}
              onChange={(event) => setNewGroupId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createGroup();
              }}
              className="h-7 min-w-0 rounded-md px-2"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-7 shrink-0"
              aria-label="Create elevator"
              onClick={() => void createGroup()}
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
          <p className="mt-5 px-2 pb-2 type-label">
            Agent Silos
          </p>
          {data.accounts.map((account) => {
            const expanded = !collapsedSilos.has(account.name);
            return (
              <div key={account.name}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggleSilo(account.name)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left type-list hover:bg-muted"
                >
                  <ChevronRightIcon
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {account.name}
                  </span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      account.running ? "bg-primary" : "bg-muted-foreground",
                    )}
                  />
                </button>
                {expanded && (
                  <div className="ml-4 border-l pl-2">
                    {account.providers.map((provider) => {
                      const containerId = `${provider}/${account.name}`;
                      const models =
                        catalog.find((entry) => entry.id === provider)
                          ?.models || [];
                      const modelsExpanded = expandedProviders.has(containerId);
                      return (
                        <div key={containerId}>
                          <div
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md pr-2 type-list",
                              selectedId === containerId
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-muted",
                            )}
                          >
                            {models.length ? (
                              <button
                                type="button"
                                aria-expanded={modelsExpanded}
                                aria-label={`${modelsExpanded ? "Collapse" : "Expand"} ${provider} models`}
                                onClick={() => toggleProvider(containerId)}
                                className="shrink-0 py-1.5 pl-2"
                              >
                                <ChevronRightIcon
                                  className={cn(
                                    "size-3.5 text-muted-foreground transition-transform",
                                    modelsExpanded && "rotate-90",
                                  )}
                                />
                              </button>
                            ) : (
                              <span className="ml-2 size-3.5 shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedId(containerId)}
                              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                            >
                              <CpuIcon className="size-3.5 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">
                                {provider}
                              </span>
                            </button>
                            {!modelsExpanded && models.length > 0 && (
                              <span className="shrink-0 type-caption">
                                {models.length}{" "}
                                {models.length === 1 ? "model" : "models"}
                              </span>
                            )}
                            {account.profile && (
                              <span className="max-w-20 truncate type-caption">
                                {account.profile}
                              </span>
                            )}
                          </div>
                          {modelsExpanded &&
                            models.map((model) => (
                              <div
                                key={model.id}
                                className="flex items-baseline gap-1.5 py-1 pl-9.5 pr-2"
                              >
                                <span className="shrink-0 type-list">
                                  {model.label}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-mono type-caption">
                                  {model.id}
                                </span>
                                {model.efforts?.length ? (
                                  <span className="shrink-0 type-caption">
                                    {model.efforts[0]}…
                                    {model.efforts[model.efforts.length - 1]}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {data.accounts.length === 0 && (
            <p className="px-2 type-caption">
              No silos yet.
            </p>
          )}
          <div
            role="separator"
            aria-label="Resize silos sidebar"
            aria-orientation="vertical"
            className="sidebar-resize-handle sidebar-resize-handle-right"
            onPointerDown={startTreeResize}
            onDoubleClick={() => setTreeWidth(360)}
          />
        </aside>
        <main className="scrollbar-none min-w-0 flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-4xl">
            {draftGroup ? (
              <div className="flex flex-col gap-5">
                <div>
                  <div>
                    <p className="type-label">
                      Elevator
                    </p>
                    <h2 className="mt-2 type-title">
                      {draftGroup.label || draftGroup.id}
                    </h2>
                  </div>
                  <p className="mt-1 type-caption">
                    An elevator — a named group of silos exposed as one API model when
                    needed.
                  </p>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Elevator identity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel>Public ID</FieldLabel>
                        <Input value={draftGroup.id} disabled />
                      </Field>
                      <Field>
                        <FieldLabel>Name</FieldLabel>
                        <Input
                          value={draftGroup.label || ""}
                          onChange={(event) =>
                            setDraftGroup({
                              ...draftGroup,
                              label: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Description</FieldLabel>
                        <Textarea
                          value={draftGroup.description || ""}
                          onChange={(event) =>
                            setDraftGroup({
                              ...draftGroup,
                              description: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Execution</CardTitle>
                    <CardDescription>
                      How member Silos participate in a run.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <WorkflowEditor
                      value={draftWorkflow}
                      members={containers.map((container) => container.id)}
                      onChange={updateWorkflow}
                    />
                    <Field className="mt-4">
                      <FieldLabel>Elevator instruction</FieldLabel>
                      <Textarea
                        value={draftGroup.systemPrompt || ""}
                        onChange={(event) =>
                          setDraftGroup({
                            ...draftGroup,
                            systemPrompt: event.target.value,
                          })
                        }
                        placeholder="Instruction shared with every member container."
                      />
                    </Field>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Combines</CardTitle>
                    <CardDescription>
                      Effective skills, commands, and MCP servers from this
                      elevator and its child profiles. Each source remains
                      visible.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-5 md:grid-cols-3">
                      {(
                        [
                          ["Skills", "skills", blendedSkills],
                          ["Commands", "commands", blendedCommands],
                          ["MCP servers", "mcp", blendedMcp],
                        ] as const
                      ).map(([label, kind, values]) => (
                        <div key={label}>
                          <p className="mb-2 type-label">
                            {label}
                          </p>
                          <div className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto pr-1">
                            {values.length ? (
                              values.map((value) => (
                                <span
                                  key={value}
                                  className="block rounded-md border bg-muted px-2 py-2 type-list leading-snug"
                                >
                                  {value}
                                  <span className="ml-1.5 font-mono type-caption">
                                    {equipmentSources(kind, value)}
                                  </span>
                                </span>
                              ))
                            ) : (
                              <span className="type-caption">
                                Nothing configured.
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : selectedContainer ? (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="type-label">
                    Agent Silo
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    {selectedContainer.id}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Provider home and isolated runtime.
                  </p>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Container status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Account</dt>
                        <dd className="mt-1 font-medium">
                          {selectedContainer.account.name}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Provider</dt>
                        <dd className="mt-1 font-medium">
                          {selectedContainer.provider}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Runtime</dt>
                        <dd className="mt-1 font-medium">
                          {selectedContainer.account.running
                            ? "Running"
                            : "Stopped"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Profile</dt>
                        <dd className="mt-1 font-medium">
                          {selectedContainer.account.profile || "None assigned"}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Container profile</CardTitle>
                    <CardDescription>
                      Assign the reusable equipment bundle used by this
                      container.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <select
                        className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                        value={profileSelection}
                        onChange={(event) =>
                          setProfileSelection(event.target.value)
                        }
                      >
                        <option value="">No profile</option>
                        {data.profiles.map((profile) => (
                          <option key={profile.name}>{profile.name}</option>
                        ))}
                      </select>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="grid min-h-96 place-items-center text-sm text-muted-foreground">
                Select an elevator or a silo provider.
              </div>
            )}
            <div className="mt-6">
              <DistributedSilosPanel notify={notify} />
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

function ProjectsView({
  data,
  setView,
}: {
  data: BootstrapData;
  setView: (view: View) => void;
}) {
  const repository = data.install.repo || "Repository not detected";
  const projectName =
    data.install.repo?.split(/[\\/]/).filter(Boolean).pop() ||
    "Current project";
  const stateDirectory = data.install.state || "~/.usage-farm";
  const destinations: Array<{
    title: string;
    description: string;
    icon: typeof FileTextIcon;
    view: View;
  }> = [
    {
      title: "Wiki",
      description:
        "Browse the project knowledge base, documents, and working notes.",
      icon: FileTextIcon,
      view: "documents",
    },
    {
      title: "Profiles",
      description:
        "Choose the reusable agent equipment this project runs with.",
      icon: Layers3Icon,
      view: "profiles",
    },
    {
      title: "Sessions",
      description: "Open conversations and runs associated with this project.",
      icon: MessageSquareTextIcon,
      view: "chat",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Projects"
        title={projectName}
        description="A project is the shared filesystem and knowledge context for your profiles, containers, and sessions."
      />
      <div className="scrollbar-none flex-1 overflow-y-auto p-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xl">{projectName}</CardTitle>
              <CardDescription>
                This desktop app follows the repository and state directory
                already used by the CLI.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-1 pt-0">
              <div className="grid gap-0 rounded-lg border bg-background">
                <div className="grid grid-cols-[150px_1fr] items-center gap-4 px-4 py-3">
                  <span className="text-xs font-medium">Repository</span>
                  <code className="truncate text-right font-mono text-xs text-muted-foreground">
                    {repository}
                  </code>
                </div>
                <div className="grid grid-cols-[150px_1fr] items-center gap-4 border-t px-4 py-3">
                  <span className="text-xs font-medium">State directory</span>
                  <code className="truncate text-right font-mono text-xs text-muted-foreground">
                    {stateDirectory}
                  </code>
                </div>
                <div className="grid grid-cols-[150px_1fr] items-center gap-4 border-t px-4 py-3">
                  <span className="text-xs font-medium">CLI connection</span>
                  <span className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        data.install.ready ? "bg-primary" : "bg-destructive",
                      )}
                    />
                    {data.install.ready ? "Connected" : "Unavailable"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <section>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">Project surfaces</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Jump to the parts of this project you use most.
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {destinations.map((destination) => (
                <button
                  key={destination.title}
                  type="button"
                  onClick={() => setView(destination.view)}
                  className="group flex min-h-36 flex-col items-start panel-depth rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted"
                >
                  <div className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                    <destination.icon className="size-4" />
                  </div>
                  <strong className="mt-auto text-sm font-medium">
                    {destination.title}
                  </strong>
                  <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {destination.description}
                  </span>
                  <ChevronRightIcon className="mt-3 size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ElementBucket({
  title,
  hint,
  available,
  selected,
  onChange,
}: {
  title: string;
  hint: string;
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const add = (item: string) =>
    !selected.includes(item) && onChange([...selected, item]);
  const remove = (item: string) =>
    onChange(selected.filter((value) => value !== item));
  const beginDrag = (event: ReactDragEvent<HTMLElement>, item: string) => {
    setDragging(item);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-usage-farm-element", item);
    event.dataTransfer.setData("text/plain", item);
  };
  const receiveDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    const item =
      event.dataTransfer.getData("application/x-usage-farm-element") ||
      event.dataTransfer.getData("text/plain") ||
      dragging;
    if (item && available.includes(item)) add(item);
    setDragging(null);
  };
  return (
    <Field>
      <div>
        <FieldLabel>{title}</FieldLabel>
        <FieldDescription>{hint}</FieldDescription>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div
          className="min-h-28 rounded-lg border bg-muted/45 p-2"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={receiveDrop}
        >
          <p className="mb-2 type-label">
            Available
          </p>
          <div className="flex flex-wrap gap-1">
            {available
              .filter((item) => !selected.includes(item))
              .map((item) => (
                <span
                  key={item}
                  draggable
                  onDragStart={(event) => beginDrag(event, item)}
                  onDragEnd={() => setDragging(null)}
                  className={cn(
                    "cursor-grab active:cursor-grabbing",
                    dragging === item && "opacity-40",
                  )}
                >
                  <TokenChip onClick={() => add(item)}>{item}</TokenChip>
                </span>
              ))}
          </div>
        </div>
        <div
          className="min-h-28 rounded-lg border border-primary/40 bg-accent/45 p-2"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={receiveDrop}
        >
          <p className="mb-2 type-label">
            Configured
          </p>
          <div className="flex flex-wrap gap-1">
            {selected.map((item) => (
              <TokenChip
                onClick={() => remove(item)}
                key={item}
                selected
                className="gap-1"
              >
                {item}
                <XIcon className="size-3" />
              </TokenChip>
            ))}
          </div>
        </div>
      </div>
    </Field>
  );
}

function ProfilesView({
  data,
  refresh,
  notify,
  runAction,
  requestedProfileName,
  onSelectedProfileChange,
}: {
  data: BootstrapData;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  runAction: (action: string, args?: string[]) => void;
  requestedProfileName?: string;
  onSelectedProfileChange?: (name: string) => void;
}) {
  const [selectedName, setSelectedName] = useState(
    requestedProfileName ||
      window.localStorage.getItem("usage-farm-selected-profile") ||
      data.profiles[0]?.name ||
      "",
  );
  const selected =
    data.profiles.find((profile) => profile.name === selectedName) ||
    data.profiles[0];
  const [draft, setDraft] = useState<FarmProfile | null>(
    selected ? structuredClone(selected) : null,
  );
  const [account, setAccount] = useState(data.accounts[0]?.name || "");
  useEffect(() => {
    if (selected) setDraft(structuredClone(selected));
  }, [selected?.name]);
  useEffect(() => {
    if (!requestedProfileName || requestedProfileName === selectedName) return;
    setSelectedName(requestedProfileName);
  }, [requestedProfileName, selectedName]);
  useEffect(() => {
    if (!selectedName) return;
    window.localStorage.setItem("usage-farm-selected-profile", selectedName);
    onSelectedProfileChange?.(selectedName);
  }, [onSelectedProfileChange, selectedName]);
  const update = <K extends keyof FarmProfile>(key: K, value: FarmProfile[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const save = async () => {
    if (!draft) return;
    const profile = draft.readOnly
      ? {
          ...draft,
          name: `${draft.name}-custom`,
          readOnly: false,
          source: "custom" as const,
        }
      : draft;
    await invokeNative("farm.profile.save", { profile });
    await refresh();
    setSelectedName(profile.name);
    notify(`Saved ${profile.name}.`);
  };
  const duplicate = async (name: string) => {
    const result = await invokeNative<{ profile: FarmProfile }>(
      "farm.profile.duplicate",
      { name },
    );
    await refresh();
    setSelectedName(result.profile.name);
    notify(`Created ${result.profile.name}.`);
  };
  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Equipment"
        description="Build reusable equipment kits. Click or drag elements between the catalog and the selected profile."
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!account || !draft}
              onClick={() =>
                runAction("equip", [account, "--profile", draft?.name || ""])
              }
            >
              <PlayIcon data-icon="inline-start" />
              Apply to
            </Button>
            <select
              aria-label="Silo to equip"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              className="h-8 rounded-md border bg-background px-3 text-xs"
            >
              {data.accounts.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
            <Button size="sm" disabled={!draft} onClick={save}>
              <SaveIcon data-icon="inline-start" />
              Save kit
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-none flex-1 overflow-y-auto p-7">
          {draft ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-6 enter-panel">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="type-title">
                      {draft.name}
                    </h2>
                    <Badge
                      variant={
                        draft.source === "bundled" ? "secondary" : "accent"
                      }
                    >
                      {draft.source || "custom"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {draft.readOnly
                      ? "Saving creates an editable custom copy."
                      : "Changes are stored outside git in your farm state directory."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => duplicate(draft.name)}
                >
                  <CopyIcon data-icon="inline-start" />
                  Duplicate
                </Button>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Identity</CardTitle>
                  <CardDescription>
                    The name is used by `farm equip --profile`.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                      <Input
                        id="profile-name"
                        value={draft.name}
                        disabled={draft.readOnly}
                        onChange={(event) => update("name", event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="profile-description">
                        Description
                      </FieldLabel>
                      <Textarea
                        id="profile-description"
                        value={draft.description}
                        onChange={(event) =>
                          update("description", event.target.value)
                        }
                      />
                    </Field>
                  </FieldGroup>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Equipment canvas</CardTitle>
                  <CardDescription>
                    Order within each selected bucket is preserved.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <ElementBucket
                      title="Skills"
                      hint="Reusable task guidance copied from the host."
                      available={data.catalog.skills}
                      selected={draft.skills_from_host}
                      onChange={(value) => update("skills_from_host", value)}
                    />
                    <ElementBucket
                      title="Experts"
                      hint="Classic agent-file templates (personas / system prompts) available inside the account."
                      available={data.catalog.agents}
                      selected={draft.agents_from_host}
                      onChange={(value) => update("agents_from_host", value)}
                    />
                    <ElementBucket
                      title="Commands"
                      hint="Slash commands and repeatable workflows."
                      available={data.catalog.commands}
                      selected={draft.commands_from_host}
                      onChange={(value) => update("commands_from_host", value)}
                    />
                    <ElementBucket
                      title="MCP servers"
                      hint="Only container-safe entries from this repository."
                      available={data.catalog.mcp}
                      selected={draft.mcp}
                      onChange={(value) => update("mcp", value)}
                    />
                  </FieldGroup>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              No profiles found.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// farmd's home card: the distributed-silo daemon rides the Gateway page —
// the sidebar footer row only navigates here. Stopping the daemon is a
// deliberate act on this card, never a sidebar misclick.
function FarmdCard({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<FarmdStatus | null>(null);
  const [busy, setBusy] = useState(false);
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
  const toggle = async () => {
    if (!hasNativeBridge() || busy) return;
    setBusy(true);
    try {
      setStatus(
        await invokeNative<FarmdStatus>(running ? "farm.farmd.stop" : "farm.farmd.start"),
      );
      notify(running ? "farmd stopped." : "farmd started.");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardDescription>farmd</CardDescription>
        <CardTitle className="flex items-center gap-2">
          <span
            className={cn(
              "size-2.5 rounded-full",
              running ? "bg-primary" : "bg-muted-foreground",
            )}
          />
          {running ? "Online" : "Stopped"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {status?.url || "Distributed silo daemon"}
        </p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggle()}>
          {running ? "Stop" : "Start"}
        </Button>
      </CardContent>
    </Card>
  );
}

function GatewayView({
  data,
  refresh,
  notify,
}: {
  data: BootstrapData;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [settings, setSettings] = useState<GatewaySettings>(data.settings);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>(data.gateway);
  const [newRoute, setNewRoute] = useState<GatewayRoute>({
    id: "",
    transport: "openai",
    baseUrl: "https://api.openai.com",
    apiKeyEnv: "OPENAI_API_KEY",
    upstreamModel: "",
  });
  useEffect(() => setSettings(data.settings), [data.settings]);
  useEffect(() => setGatewayStatus(data.gateway), [data.gateway]);
  useEffect(() => {
    if (!hasNativeBridge()) return;
    let alive = true;
    const load = async () => {
      try {
        const next = await invokeNative<GatewayStatus>("farm.gateway.status");
        if (alive) setGatewayStatus(next);
      } catch {
        /* status polling is best-effort; bootstrap still owns durable state */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const save = async (next: GatewaySettings = settings) => {
    setSettings(next);
    await invokeNative("farm.gateway.save", next);
    await refresh();
    notify("Gateway settings saved.");
  };
  const toggle = async () => {
    const wasRunning = gatewayStatus.running;
    const next = await invokeNative<GatewayStatus>(
      wasRunning ? "farm.gateway.stop" : "farm.gateway.start",
      settings,
    );
    setGatewayStatus(next);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await refresh();
    notify(wasRunning ? "Gateway stopped." : "Gateway started.");
  };
  const addRoute = () => {
    if (!newRoute.id.trim() || !newRoute.baseUrl?.trim())
      return notify("A route ID and upstream URL are required.");
    if (
      newRoute.baseInputUsdPerMillion != null
      && !newRoute.upstreamModel?.trim()
    )
      return notify(
        "A pinned upstream model is required when a base input price is set.",
      );
    setSettings({
      ...settings,
      routes: [
        ...settings.routes.filter((route) => route.id !== newRoute.id),
        {
          ...newRoute,
          id: newRoute.id.trim(),
          baseUrl: newRoute.baseUrl.replace(/\/$/, ""),
        },
      ],
    });
    setNewRoute({
      id: "",
      transport: newRoute.transport,
      baseUrl:
        newRoute.transport === "anthropic"
          ? "https://api.anthropic.com"
          : "https://api.openai.com",
      apiKeyEnv:
        newRoute.transport === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : "OPENAI_API_KEY",
      upstreamModel: "",
      promptCaching:
        newRoute.transport === "anthropic" ? true : undefined,
    });
  };
  return (
    <>
      <PageHeader
        eyebrow="Inference router"
        title="Gateway"
        description="Live traffic, client connections, token usage, routing decisions, and access to the local inference gateway."
        descriptionClassName="text-sm"
        actions={
          <>
            <Button variant="outline" onClick={() => void save()}>
              <SaveIcon data-icon="inline-start" />
              Save
            </Button>
            <Button
              variant={gatewayStatus.running ? "destructive" : "default"}
              onClick={toggle}
            >
              {gatewayStatus.running ? (
                <SquareIcon data-icon="inline-start" />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {gatewayStatus.running ? "Stop" : "Start gateway"}
            </Button>
          </>
        }
      />
      <div className="scrollbar-none flex-1 overflow-y-auto p-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <GatewayStatusOverview
            status={gatewayStatus}
            settings={settings}
            onSaveSettings={save}
            notify={notify}
          />
          <div className="border-t pt-6">
            <h2 className="text-base font-semibold">Configuration</h2>
            <p className="mt-1 text-xs text-muted-foreground">Listener, routing policy, endpoint surface, and model mappings.</p>
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Listener</CardTitle>
              <CardDescription>
                Port changes require a restart. Managed key changes apply as soon as they are saved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="port">Port</FieldLabel>
                  <Input
                    id="port"
                    type="number"
                    min={1024}
                    max={65535}
                    value={settings.port}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        port: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <FieldDescription>
                  Use managed keys above for client authentication. Existing
                  legacy keys remain accepted but are never exposed to the
                  WebView; migrate them before publication.
                </FieldDescription>
              </FieldGroup>
            </CardContent>
          </Card>
          <FarmdCard notify={notify} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Crew rotation</CardTitle>
              <CardDescription>
                How the <code className="font-mono text-xs">rota</code> model
                picks a silo for each request. Weekly headroom drives the full
                reset, so Smart is the recommended default.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {([
                ["smart", "Smart (recommended)", "Burns the silo with the most usable headroom — min(session, weekly above reserve) — and stays sticky for warm context."],
                ["spread", "Spread", "Evens out weekly burn: always the silo with the most weekly allowance left."],
                ["round-robin", "Round robin", "Strict alternation across silos with any capacity. Quota-blind."],
                ["session-first", "Session first", "Chases the freshest 5-hour window; ignores weekly headroom."],
              ] as const).map(([value, label, caption]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSettings({ ...settings, rotaStrategy: value })}
                  className={cn(
                    "flex items-start gap-3 rounded-md border bg-background p-3 text-left transition-colors",
                    (settings.rotaStrategy || "smart") === value
                      ? "border-primary/40 bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-0.5 block type-caption">{caption}</span>
                  </span>
                  {(settings.rotaStrategy || "smart") === value && (
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    rotaAffinity:
                      (settings.rotaAffinity || "session") === "session"
                        ? "per-request"
                        : "session",
                  })
                }
                className={cn(
                  "mt-1 flex items-start gap-3 rounded-md border bg-background p-3 text-left transition-colors",
                  (settings.rotaAffinity || "session") === "session"
                    ? "border-primary/40 bg-primary/5"
                    : "hover:bg-muted/50",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    Keep one silo per conversation
                  </span>
                  <span className="mt-0.5 block type-caption">
                    A thread stays on the silo it started on instead of being
                    re-picked every request — switching silo mid-thread changes
                    org and throws away the provider's cached prefix. Released
                    when the silo runs out, gets rate-limited, or the thread
                    goes idle.
                  </span>
                </span>
                {(settings.rotaAffinity || "session") === "session" && (
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                )}
              </button>
              <FieldDescription>
                Applies on Save. Pin a specific silo any time by requesting its
                direct model id (for example{" "}
                <code className="font-mono text-xs">claude/gmail</code>).
              </FieldDescription>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Endpoint surface</CardTitle>
              <CardDescription>
                The gateway ships an OpenAPI document and the common model,
                chat, responses, and messages endpoints.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                ["GET", "/v1/models"],
                ["POST", "/v1/chat/completions"],
                ["POST", "/v1/responses"],
                ["POST", "/v1/messages"],
                ["GET", "/openapi.json"],
              ].map(([method, path]) => (
                <div
                  key={path}
                  className="flex items-center gap-2.5 rounded-md border bg-background px-2.5 py-1.5"
                >
                  <span className="inline-flex w-12 justify-center rounded bg-primary py-0.5 font-secondary text-[0.8rem] font-semibold text-primary-foreground">
                    {method}
                  </span>
                  <code className="font-mono text-sm">{path}</code>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Model mapping</CardTitle>
              <CardDescription>
                Map a name of your choosing to a real provider model. Example:
                map{" "}
                <code className="font-mono text-xs">fast</code>, set the base
                URL to{" "}
                <code className="font-mono text-xs">https://api.openai.com</code>{" "}
                and the provider model to{" "}
                <code className="font-mono text-xs">gpt-5-mini</code> — then
                any tool pointed at the gateway can request{" "}
                <code className="font-mono text-xs">fast</code> and get that
                model, with the provider's own tools and streaming untouched.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="route-id">Name (what callers request)</FieldLabel>
                    <Input
                      id="route-id"
                      placeholder="fast"
                      value={newRoute.id}
                      onChange={(event) =>
                        setNewRoute({ ...newRoute, id: event.target.value })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="route-transport">Protocol</FieldLabel>
                    <select
                      id="route-transport"
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      value={newRoute.transport}
                      onChange={(event) => {
                        const transport = event.target.value as
                          "openai" | "anthropic";
                        setNewRoute({
                          ...newRoute,
                          transport,
                          baseUrl:
                            transport === "anthropic"
                              ? "https://api.anthropic.com"
                              : "https://api.openai.com",
                          apiKeyEnv:
                            transport === "anthropic"
                              ? "ANTHROPIC_API_KEY"
                              : "OPENAI_API_KEY",
                          promptCaching:
                            transport === "anthropic" ? true : undefined,
                          baseInputUsdPerMillion:
                            transport === "anthropic"
                              ? newRoute.baseInputUsdPerMillion
                              : undefined,
                        });
                      }}
                    >
                      <option value="openai">OpenAI compatible</option>
                      <option value="anthropic">Anthropic compatible</option>
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="route-url">Base URL</FieldLabel>
                    <Input
                      id="route-url"
                      value={newRoute.baseUrl || ""}
                      onChange={(event) =>
                        setNewRoute({
                          ...newRoute,
                          baseUrl: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="route-model">
                      Provider model it maps to
                    </FieldLabel>
                    <Input
                      id="route-model"
                      placeholder="gpt-5-mini"
                      value={newRoute.upstreamModel || ""}
                      onChange={(event) =>
                        setNewRoute({
                          ...newRoute,
                          upstreamModel: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="route-key">
                      API key environment variable
                    </FieldLabel>
                    <Input
                      id="route-key"
                      value={newRoute.apiKeyEnv || ""}
                      onChange={(event) =>
                        setNewRoute({
                          ...newRoute,
                          apiKeyEnv: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="route-key-secret">
                      API key secret
                    </FieldLabel>
                    <Input
                      id="route-key-secret"
                      placeholder="anthropic-direct"
                      value={newRoute.apiKeySecret || ""}
                      onChange={(event) =>
                        setNewRoute({
                          ...newRoute,
                          apiKeySecret: event.target.value || undefined,
                        })
                      }
                    />
                    <FieldDescription>
                      Optional identifier for an owner-only
                      {" "}
                      {"<farm state>/secrets/<id>.key"}
                      {" "}
                      file. Arbitrary file paths are never accepted.
                    </FieldDescription>
                  </Field>
                  {newRoute.transport === "anthropic" && (
                    <Field>
                      <FieldLabel htmlFor="route-input-price">
                        Base input price (USD / MTok)
                      </FieldLabel>
                      <Input
                        id="route-input-price"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="5"
                        value={newRoute.baseInputUsdPerMillion ?? ""}
                        onChange={(event) =>
                          setNewRoute({
                            ...newRoute,
                            baseInputUsdPerMillion: event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          })
                        }
                      />
                      <FieldDescription>
                        Enables Anthropic dollar savings estimates without
                        hard-coding prices into the app. Requires a pinned
                        upstream model so one model&apos;s price cannot be
                        applied to another.
                      </FieldDescription>
                    </Field>
                  )}
                  {newRoute.transport === "anthropic" && (
                    <Field>
                      <FieldLabel>Prompt caching</FieldLabel>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={newRoute.promptCaching !== false}
                        className={cn(
                          "flex min-h-9 items-center gap-2 rounded-md border px-3 text-left text-sm transition-colors",
                          newRoute.promptCaching !== false
                            ? "border-primary/40 bg-primary/5"
                            : "bg-background hover:bg-muted/50",
                        )}
                        onClick={() =>
                          setNewRoute({
                            ...newRoute,
                            promptCaching: newRoute.promptCaching === false,
                          })
                        }
                      >
                        <span className="min-w-0 flex-1">
                          Explicit Anthropic breakpoints
                        </span>
                        {newRoute.promptCaching !== false && (
                          <CheckIcon className="size-4 shrink-0 text-primary" />
                        )}
                      </button>
                      <FieldDescription>
                        Marks the stable prefix and rolling conversation tail.
                        Direct Anthropic routes only.
                      </FieldDescription>
                    </Field>
                  )}
                </div>
                <div>
                  <Button type="button" onClick={addRoute}>
                    <PlusIcon data-icon="inline-start" />
                    Add mapping
                  </Button>
                </div>
                {settings.routes.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {settings.routes.map((route) => (
                      <div
                        key={route.id}
                        className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5"
                      >
                        <RouteIcon className="size-4 text-muted-foreground" />
                        <code className="font-mono text-sm font-semibold">
                          {route.id}
                        </code>
                        <span className="truncate text-xs text-muted-foreground">
                          {route.upstreamModel || route.baseUrl}
                        </span>
                        <Badge variant="secondary" className="ml-auto">
                          {route.transport}
                        </Badge>
                        {route.transport === "anthropic" && (
                          <Badge variant="outline">
                            cache {route.promptCaching === false ? "off" : "on"}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${route.id}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              routes: settings.routes.filter(
                                (item) => item.id !== route.id,
                              ),
                            })
                          }
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </FieldGroup>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Discovered CLI routes</CardTitle>
              <CardDescription>
                Actual provider model selection remains inside each CLI unless
                you add an explicit upstream model.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.accounts
                .flatMap((account) =>
                  account.providers.map((provider) => ({ account, provider })),
                )
                .map(({ account, provider }) => (
                  <div
                    key={`${provider}/${account.name}`}
                    className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5"
                  >
                    <SquareTerminalIcon className="size-4 text-muted-foreground" />
                    <code className="font-mono text-sm font-semibold">
                      {provider}/{account.name}
                    </code>
                    <span className="ml-auto text-sm text-muted-foreground">
                      text · stream · tools by prompt
                    </span>
                    <Badge variant="secondary">cli</Badge>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function App() {
  // View navigation with real back/forward history (the titlebar arrows) —
  // window.history is meaningless in this single-document app.
  const [view, setViewState] = useState<View>("overview");
  const viewHistory = useRef<{ stack: View[]; index: number }>({ stack: ["chat"], index: 0 });
  const setView = useCallback((next: View) => {
    setViewState((previous) => {
      if (next === previous) return previous;
      const history = viewHistory.current;
      history.stack = history.stack.slice(0, history.index + 1);
      history.stack.push(next);
      history.index += 1;
      return next;
    });
  }, []);
  const goBackView = useCallback(() => {
    const history = viewHistory.current;
    if (history.index === 0) return;
    history.index -= 1;
    setViewState(history.stack[history.index]);
  }, []);
  const goForwardView = useCallback(() => {
    const history = viewHistory.current;
    if (history.index >= history.stack.length - 1) return;
    history.index += 1;
    setViewState(history.stack[history.index]);
  }, []);
  const [primarySidebarOpen, setPrimarySidebarOpen] = useState(true);
  // Bumped when the sidebar switcher re-roots the workspace so the Wiki
  // view remounts against the new project.
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  useEffect(() => {
    const onRootChange = () => setWorkspaceEpoch((epoch) => epoch + 1);
    window.addEventListener("agensis:workspace-root-changed", onRootChange);
    return () => window.removeEventListener("agensis:workspace-root-changed", onRootChange);
  }, []);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarSessions, setSidebarSessions] = useState<ChatSession[]>(readSidebarSessions);
  const [sidebarActiveSessionId, setSidebarActiveSessionId] = useState(
    () => localStorage.getItem(APP_ACTIVE_SESSION_KEY) || "",
  );
  const [selectedProfileName, setSelectedProfileName] = useState(
    () => window.localStorage.getItem("usage-farm-selected-profile") || "",
  );
  const [theme, setTheme] = useState<Theme>(
    () =>
      (localStorage.getItem("usage-farm-theme") as Theme) ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  const [themeMode, setThemeMode] = useState<SettingsThemeMode>(() => {
    const stored = localStorage.getItem("usage-farm-theme-mode");
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : ((localStorage.getItem("usage-farm-theme") as Theme) || "system");
  });
  const [uiFont, setUiFont] = useState<UiFont>(
    () => (fontPrefsCurrent() && (localStorage.getItem("usage-farm-ui-font") as UiFont)) || "inter",
  );
  const [appTheme, setAppTheme] = useState<string>(
    () => localStorage.getItem("usage-farm-app-theme") || "azure",
  );
  const [secondaryFont, setSecondaryFont] = useState<string>(
    () => localStorage.getItem("usage-farm-secondary-font") || "jetbrains",
  );
  const [monoFont, setMonoFont] = useState<MonoFont>(
    () => (fontPrefsCurrent() && (localStorage.getItem("usage-farm-mono-font") as MonoFont)) || "jetbrains",
  );
  const [uiFontSize, setUiFontSize] = useState(
    () => (fontPrefsCurrent() && Number(localStorage.getItem("usage-farm-ui-font-size"))) || 14,
  );
  const [codeFontSize, setCodeFontSize] = useState(
    () => (fontPrefsCurrent() && Number(localStorage.getItem("usage-farm-code-font-size"))) || 10,
  );
  const [primarySidebarWidth, setPrimarySidebarWidth] = useState(() =>
    Math.min(
      640,
      Math.max(
        208,
        Number(localStorage.getItem("usage-farm-primary-sidebar-width")) || 262,
      ),
    ),
  );
  const [data, setData] = useState<BootstrapData>(defaultData);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  // The CURRENT workspace (the switcher's root), not the farm repo — the
  // sidebar project section must follow switches instead of pinning to
  // data.install.repo forever.
  const [workspaceInfo, setWorkspaceInfo] = useState<{ root: string; name: string } | null>(null);
  useEffect(() => {
    const fetchWorkspace = () => {
      invokeNative<{ root: string }>("farm.workspace.list")
        .then((result) => setWorkspaceInfo({ root: result.root, name: result.root.split("/").filter(Boolean).at(-1) || result.root }))
        .catch(() => setWorkspaceInfo(null));
    };
    fetchWorkspace();
    window.addEventListener("agensis:workspace-root-changed", fetchWorkspace);
    return () => window.removeEventListener("agensis:workspace-root-changed", fetchWorkspace);
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await invokeNative<BootstrapData>("farm.bootstrap"));
      setRefreshedAt(Date.now());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);
  // "Refresh usage" pings every silo CLI (fire-and-forget haiku calls) so
  // fresh evidence lands in the silo homes, then re-pulls in stages as the
  // transcripts arrive.
  const [pinging, setPinging] = useState(false);
  const refreshUsage = useCallback(async () => {
    setPinging(true);
    try {
      const result = await invokeNative<{ started: Array<unknown> }>("farm.usage.ping", {});
      if (result.started.length) setNotice(`Pinging ${result.started.length} silo CLI${result.started.length > 1 ? "s" : ""} for fresh stats\u2026`);
    } catch { /* no bridge \u2014 plain refresh still runs */ }
    void refresh();
    for (const delay of [12_000, 30_000, 60_000]) window.setTimeout(() => void refresh(), delay);
    window.setTimeout(() => setPinging(false), 35_000);
  }, [refresh]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      setTheme(
        themeMode === "system"
          ? media.matches
            ? "dark"
            : "light"
          : themeMode,
      );
    apply();
    localStorage.setItem("usage-farm-theme-mode", themeMode);
    if (themeMode !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("usage-farm-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.uiFont = uiFont;
    localStorage.setItem("usage-farm-ui-font", uiFont);
    localStorage.setItem("usage-farm-design-font-version", DESIGN_FONT_VERSION);
  }, [uiFont]);
  useEffect(() => {
    document.documentElement.dataset.monoFont = monoFont;
    localStorage.setItem("usage-farm-mono-font", monoFont);
  }, [monoFont]);
  useEffect(() => {
    document.documentElement.dataset.secondaryFont = secondaryFont;
    localStorage.setItem("usage-farm-secondary-font", secondaryFont);
  }, [secondaryFont]);
  useEffect(() => {
    if (appTheme === "azure") delete document.documentElement.dataset.appTheme;
    else document.documentElement.dataset.appTheme = appTheme;
    localStorage.setItem("usage-farm-app-theme", appTheme);
  }, [appTheme]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-font-size",
      `${uiFontSize}px`,
    );
    localStorage.setItem("usage-farm-ui-font-size", String(uiFontSize));
    localStorage.setItem("usage-farm-design-font-version", DESIGN_FONT_VERSION);
  }, [uiFontSize]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--code-font-size",
      `${codeFontSize}px`,
    );
    localStorage.setItem("usage-farm-code-font-size", String(codeFontSize));
  }, [codeFontSize]);
  useEffect(() => {
    localStorage.setItem(
      "usage-farm-primary-sidebar-width",
      String(primarySidebarWidth),
    );
  }, [primarySidebarWidth]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // Availability watcher: desktop notifications on rota transitions — gateway
  // dropping, a capped silo regaining session capacity, a weekly reserve
  // breach. First snapshot only primes the ref; no notification storm on boot.
  const rotaSnapshotRef = useRef<{ gateway: boolean; risk: Set<string>; capped: Set<string> } | null>(null);
  useEffect(() => {
    if (loading) return;
    const rota = planHandoff(data.accounts, new Date());
    const risk = new Set(
      rota.lanes
        .filter((lane) => lane.weeklyRemaining != null && lane.weeklyRemaining < 0.12)
        .map((lane) => lane.silo),
    );
    const capped = new Set(rota.lanes.filter((lane) => lane.usableNow <= 0.02).map((lane) => lane.silo));
    const previous = rotaSnapshotRef.current;
    rotaSnapshotRef.current = { gateway: data.gateway.running, risk, capped };
    if (!previous) return;
    const send = (title: string, body: string) =>
      invokeNative("farm.notify", { title, body }).catch(() => { /* browser dev — no bridge */ });
    if (previous.gateway && !data.gateway.running)
      send("Gateway stopped", "The farm gateway is no longer running.");
    for (const silo of previous.capped)
      if (!capped.has(silo)) send("Capacity restored", `${silo} has session capacity again — the rota can hand off to it.`);
    for (const silo of risk)
      if (!previous.risk.has(silo)) send("Weekly reserve breached", `${silo} weekly headroom fell below the protected reserve.`);
  }, [data, loading]);
  // Keep the rota honest: re-pull usage every 90 seconds (bootstrap is
  // local file reads — cheap), not just on the manual Refresh button.
  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), 90 * 1000);
    return () => window.clearInterval(interval);
  }, [refresh]);
  // Harvest heartbeat: kick a detached scan every 30 minutes (first run 3
  // minutes after boot). farm.harvest.scan returns immediately so the native
  // UI thread is never blocked for the LLM pass; we poll list until idle and
  // only notify when new proposals appear. Failures stay quiet in lastError.
  useEffect(() => {
    if (!hasNativeBridge()) return;
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const scan = async () => {
      try {
        const before = await invokeNative<{
          suggestions: Array<{ id: string; status: string }>;
          scanning?: boolean;
        }>("farm.harvest.list");
        if (cancelled) return;
        // Already running (manual scan or prior heartbeat) — don't double-start.
        if (before.scanning) return;
        const proposedBefore = new Set(
          before.suggestions.filter((item) => item.status === "proposed").map((item) => item.id),
        );
        await invokeNative<{ started?: boolean }>("farm.harvest.scan", {});
        if (cancelled) return;
        const deadline = Date.now() + 4 * 60 * 1000;
        let after = await invokeNative<{
          suggestions: Array<{ id: string; status: string }>;
          scanning?: boolean;
        }>("farm.harvest.list");
        while (!cancelled && after.scanning && Date.now() < deadline) {
          await sleep(1500);
          after = await invokeNative<{
            suggestions: Array<{ id: string; status: string }>;
            scanning?: boolean;
          }>("farm.harvest.list");
        }
        if (cancelled) return;
        const fresh = after.suggestions.filter(
          (item) => item.status === "proposed" && !proposedBefore.has(item.id),
        ).length;
        if (fresh > 0) {
          void invokeNative("farm.notify", {
            title: "Harvest",
            body: `${fresh} new capability suggestion${fresh > 1 ? "s" : ""} ready to review.`,
          }).catch(() => {});
        }
      } catch { /* heartbeat stays quiet */ }
    };
    const first = window.setTimeout(() => void scan(), 3 * 60 * 1000);
    const interval = window.setInterval(() => void scan(), 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    // Kbd hints stay hidden until a modifier is held (Codex/Linear behavior);
    // index.css keys the reveal off this root attribute.
    const setModifierHeld = (held: boolean) =>
      document.documentElement.toggleAttribute("data-modifier-held", held);
    const onKeyDown = (event: KeyboardEvent) => {
      setModifierHeld(event.metaKey || event.ctrlKey);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarSessions(readSidebarSessions());
        setCommandPaletteOpen((open) => !open);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => setModifierHeld(event.metaKey || event.ctrlKey);
    const onWindowBlur = () => setModifierHeld(false);
    const onStartJob = (event: Event) => {
      const detail = (event as CustomEvent<{ silo?: string; prompt?: string | null; title?: string }>).detail;
      if (!detail) return;
      localStorage.setItem("agensis:pending-job", JSON.stringify(detail));
      setView("chat");
      window.dispatchEvent(new CustomEvent("agensis:job-staged"));
    };
    // Wiki floating AI input → cheap model via the controller → response
    // event (the editor inserts it; the pill clears its pending state).
    const onEditorAiRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt: string; docPath: string; selection?: string }>).detail;
      if (!detail?.prompt) return;
      invokeNative<{ result: string; docPath: string }>("farm.editor.assist", detail)
        .then((response) =>
          window.dispatchEvent(
            new CustomEvent("agensis:editor-ai-response", {
              detail: { ok: true, result: response.result, docPath: response.docPath },
            }),
          ),
        )
        .catch((error) => {
          window.dispatchEvent(
            new CustomEvent("agensis:editor-ai-response", {
              detail: { ok: false, result: "", docPath: detail.docPath },
            }),
          );
          setNotice(error instanceof Error ? error.message : String(error));
        });
    };
    const onOpenSearch = () => {
      setSidebarSessions(readSidebarSessions());
      setCommandPaletteOpen(true);
    };
    const onSelectProfile = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (!name) return;
      setSelectedProfileName(name);
      window.localStorage.setItem("usage-farm-selected-profile", name);
      setView("profiles");
    };
    const onDataChanged = () => void refresh();
    const onSessionsChanged = (event: Event) => {
      const sessions = (event as CustomEvent<ChatSession[]>).detail;
      if (Array.isArray(sessions)) setSidebarSessions(sessions);
    };
    const onActiveSessionChanged = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) setSidebarActiveSessionId(id);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("agensis:start-job", onStartJob);
    window.addEventListener("agensis:editor-ai-request", onEditorAiRequest);
    window.addEventListener("agensis:open-search", onOpenSearch);
    window.addEventListener("agensis:select-profile", onSelectProfile);
    window.addEventListener("agensis:sessions-changed", onSessionsChanged);
    window.addEventListener("agensis:data-changed", onDataChanged);
    window.addEventListener("agensis:active-session-changed", onActiveSessionChanged);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("agensis:start-job", onStartJob);
      window.removeEventListener("agensis:editor-ai-request", onEditorAiRequest);
      window.removeEventListener("agensis:open-search", onOpenSearch);
      window.removeEventListener("agensis:select-profile", onSelectProfile);
      window.removeEventListener("agensis:sessions-changed", onSessionsChanged);
      window.removeEventListener("agensis:data-changed", onDataChanged);
      window.removeEventListener("agensis:active-session-changed", onActiveSessionChanged);
    };
  }, []);
  useEffect(() => {
    if (view === "chat") return;
    setSidebarSessions(readSidebarSessions());
    setSidebarActiveSessionId(localStorage.getItem(APP_ACTIVE_SESSION_KEY) || "");
  }, [view]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timeout);
  }, [notice]);
  const notify = (message: string) => setNotice(message);
  const persistSidebarSessions = (sessions: ChatSession[]) => {
    setSidebarSessions(sessions);
    localStorage.setItem(APP_SESSIONS_KEY, JSON.stringify(sessions));
  };
  const openSidebarSession = (id: string) => {
    setSidebarActiveSessionId(id);
    localStorage.setItem(APP_ACTIVE_SESSION_KEY, id);
    setView("chat");
    window.dispatchEvent(new CustomEvent("agensis:activate-session", { detail: id }));
  };
  const updateSidebarSession = (id: string, update: Partial<ChatSession>) => {
    persistSidebarSessions(
      sidebarSessions.map((session) =>
        session.id === id ? { ...session, ...update } : session,
      ),
    );
    // Keep the mounted chat workspace's copy in step — without this its next
    // flush overwrites the edit with a stale array.
    window.dispatchEvent(
      new CustomEvent("agensis:session-updated", { detail: { id, update } }),
    );
    // The sidebar mirror is meta-only — patch the FULL stored session, not
    // the stub, or the durable store rehydrates the old title/pin/project.
    if (hasNativeBridge())
      void invokeNative<ChatSession>("farm.session.get", { id })
        .then((full) =>
          invokeNative("farm.session.save", {
            session: { ...full, ...update },
          }),
        )
        .catch(() => {});
  };
  const deleteSidebarSession = (id: string) => {
    persistSidebarSessions(
      sidebarSessions.filter((session) => session.id !== id),
    );
    window.dispatchEvent(
      new CustomEvent("agensis:session-deleted", { detail: id }),
    );
    if (hasNativeBridge())
      void invokeNative("farm.session.remove", { id }).catch(() => {});
  };
  const duplicateSidebarSession = (id: string) => {
    const source = sidebarSessions.find((session) => session.id === id);
    if (!source) return;
    const now = new Date().toISOString();
    const copy = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} copy`,
      createdAt: now,
      updatedAt: now,
      messages: [],
      queue: [],
    };
    persistSidebarSessions([copy, ...sidebarSessions]);
    window.dispatchEvent(
      new CustomEvent("agensis:session-created", { detail: copy }),
    );
    if (hasNativeBridge())
      void invokeNative<ChatSession>("farm.session.get", { id })
        .then((full) =>
          invokeNative("farm.session.save", {
            session: { ...full, ...copy },
          }),
        )
        .catch(() => {});
  };
  const resizePrimarySidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = primarySidebarWidth;
    const onMove = (move: PointerEvent) =>
      setPrimarySidebarWidth(
        Math.min(
          640,
          Math.max(
            208,
            Math.min(
              window.innerWidth - 420,
              startWidth + move.clientX - startX,
            ),
          ),
        ),
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
  const runAction = async (action: string, args: string[] = []) => {
    try {
      await invokeNative("farm.action", { action, args });
      notify(`${action} started in the background.`);
      setTimeout(refresh, 800);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  const nativeHost = hasNativeBridge();
  useEffect(() => {
    document.documentElement.classList.toggle("native-shell", nativeHost);
    return () => document.documentElement.classList.remove("native-shell");
  }, [nativeHost]);
  const openProfile = useCallback((name: string) => {
    setSelectedProfileName(name);
    window.localStorage.setItem("usage-farm-selected-profile", name);
    setView("profiles");
  }, []);
  return (
    <div className={cn("agensis-shell flex h-screen text-foreground", nativeHost && "is-native-shell")}>
      {nativeHost && <div aria-hidden className="native-window-drag-strip" />}
      <GlobalCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        projectName={
          data.install.repo?.split(/[\\/]/).filter(Boolean).pop() ||
          "Current project"
        }
        sessions={sidebarSessions}
        accounts={data.accounts}
        profiles={data.profiles}
        onNavigate={setView}
        onSelectSession={openSidebarSession}
        onSelectProfile={openProfile}
      />
      {primarySidebarOpen && (
        <WorkspaceSidebar
          className="relative shrink-0"
          width={primarySidebarWidth}
          onBack={goBackView}
          onForward={goForwardView}
          projectName={
            workspaceInfo?.name ||
            data.install.repo?.split(/[\\/]/).filter(Boolean).pop() ||
            "Current project"
          }
          projectPath={workspaceInfo?.root || data.install.repo}
          sessions={sidebarSessions}
          activeSessionId={sidebarActiveSessionId}
          accounts={data.accounts}
          profiles={data.profiles}
          activeView={view}
          gatewayRunning={data.gateway.running}
          gatewayClients={data.gateway.clients?.length || 0}
          installReady={data.install.ready}
          theme={theme}
          onOpenSearch={() => setCommandPaletteOpen(true)}
          onSelectSession={openSidebarSession}
          onSelectProfile={openProfile}
          onNewSession={() => setView("chat")}
          onNavigate={setView}
          onToggleTheme={() => setThemeMode(theme === "dark" ? "light" : "dark")}
          onUpdateSession={updateSidebarSession}
          onDeleteSession={deleteSidebarSession}
          onDuplicateSession={duplicateSidebarSession}
          onReorderSessions={(ids) => {
            const byId = new Map(sidebarSessions.map((session) => [session.id, session]));
            persistSidebarSessions(ids.map((id) => byId.get(id)).filter(Boolean) as ChatSession[]);
            window.dispatchEvent(
              new CustomEvent("agensis:sessions-reordered", { detail: ids }),
            );
          }}
          onCollapseSidebar={() => setPrimarySidebarOpen(false)}
          onResizeSidebar={resizePrimarySidebar}
        />
      )}
      {!primarySidebarOpen && (
        <div className="drag-region fixed inset-x-0 top-0 z-50 flex h-[52px] items-center gap-1 border-b bg-background/90 pl-[var(--agensis-titlebar-reserve-left)] backdrop-blur [&_button]:no-drag">
          <Button
            variant="ghost"
            size="icon"
            className="[&_svg]:size-4.5"
            onClick={() => setPrimarySidebarOpen(true)}
            aria-label="Show sidebar"
          >
            <PanelLeftOpenIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="[&_svg]:size-4.5"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Search Agent Farm"
            title="Search Agent Farm (⌘K)"
          >
            <SearchIcon />
          </Button>
        </div>
      )}
      <main className={cn("flex min-w-0 flex-1 flex-col", !primarySidebarOpen && "pt-[52px]")}>
        {loading && (
          <div
            className={cn(
              "signal-line absolute right-0 top-0 h-0.5",
              view === "chat" ? "left-0" : "left-[240px]",
            )}
          />
        )}
        {view === "overview" && (
          <HomeView data={data} setView={setView} runAction={runAction} refresh={refreshUsage} notify={notify} refreshedAt={refreshedAt} pinging={pinging} />
        )}
        {view === "harvest" && (
          <>
            <PageHeader
              title={vocab.harvest}
              description="Capability mined from your working documents — skills, workflows, expert updates and wiki docs, ready to approve into the bank."
            />
            <div className="scrollbar-none flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-[102rem]">
                <HarvestView onNotify={notify} />
              </div>
            </div>
          </>
        )}
        {view === "projects" && <ProjectsView data={data} setView={setView} />}
        {view === "silos" && (
          <AgentContainersView
            data={data}
            refresh={refresh}
            notify={notify}
            runAction={runAction}
            setView={setView}
          />
        )}
        {view === "profiles" && (
          <ProfilesView
            data={data}
            refresh={refresh}
            notify={notify}
            runAction={runAction}
            requestedProfileName={selectedProfileName}
            onSelectedProfileChange={setSelectedProfileName}
          />
        )}
        {view === "worktrees" && (
          <WorktreesWorkspace accounts={data.accounts} onNotify={notify} />
        )}
        {view === "chores" && (
          <ChoresWorkspace accounts={data.accounts} models={data.models} notify={notify} />
        )}
        {view === "gateway" && (
          <GatewayView data={data} refresh={refresh} notify={notify} />
        )}
        {view === "chat" && (
          <ChatWorkspace
            data={data}
            refresh={refresh}
            notify={notify}
            navigate={setView}
            theme={theme}
            toggleTheme={() => setThemeMode(theme === "dark" ? "light" : "dark")}
            showNavigationSidebar={false}
          />
        )}
        {view === "documents" && (
          <AgenticWorkspace key={workspaceEpoch} openChat={() => setView("chat")} notify={notify} />
        )}
        {view === "settings" && (
          <SettingsWorkspaceSurface
            data={data}
            refresh={refresh}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            appTheme={appTheme}
            setAppTheme={setAppTheme}
            uiFont={uiFont}
            setUiFont={setUiFont}
            secondaryFont={secondaryFont}
            setSecondaryFont={setSecondaryFont}
            monoFont={monoFont}
            setMonoFont={setMonoFont}
            uiFontSize={uiFontSize}
            setUiFontSize={setUiFontSize}
            codeFontSize={codeFontSize}
            setCodeFontSize={setCodeFontSize}
          />
        )}
      </main>
      {notice && (
        <div
          role="status"
          className="workspace-toast fixed bottom-5 right-5 max-w-md border bg-popover px-4 py-3 text-sm text-popover-foreground"
        >
          {notice}
        </div>
      )}
      {DevVisualTodoWidgetMount && import.meta.env.DEV && (
        <Suspense fallback={null}>
          <DevVisualTodoWidgetMount
            projectRoot={workspaceInfo?.root || data.install.repo || undefined}
            webhookUrl={
              data.gateway.url
                ? `${data.gateway.url}/hooks/visual-todo`
                : undefined
            }
          />
        </Suspense>
      )}
    </div>
  );
}
