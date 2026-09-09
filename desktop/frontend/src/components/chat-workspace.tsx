import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ActivityIcon,
  ArrowDownUpIcon,
  AtSignIcon,
  BoxesIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleHelpIcon,
  CopyIcon,
  Edit3Icon,
  FileIcon,
  FileDiffIcon,
  FileTextIcon,
  GitBranchIcon,
  HistoryIcon,
  ListPlusIcon,
  ListFilterIcon,
  MessageSquarePlusIcon,
  PaperclipIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  Columns2Icon,
  Layers3Icon,
  MoonIcon,
  MoreHorizontalIcon,
  Maximize2Icon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
  ShieldIcon,
  ShieldCheckIcon,
  SlashIcon,
  CpuIcon,
  GaugeIcon,
  PackageIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  TerminalIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Trash2Icon,
  UsersIcon,
  WheatIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageMeta,
  MessageResponse,
} from "@/components/ai-elements/message";
import { ModelTrace } from "@/components/ai-elements/model-trace";
import { ComposerAdvanced } from "@/components/composer-advanced";
import { SiloAvatar } from "@/components/silo-avatar";

/** Codex-style approvals chip: shield + current level on the composer's left.
 *  Uses shadcn RadioGroup (same primitive family as AI Elements Confirmation)
 *  for choosing how tools are allowed to run. */
function ApprovalsChip({
  value,
  onChange,
  catalog,
  providerId,
}: {
  value: ChatSession["permissions"];
  onChange: (value: FarmPermission) => void;
  catalog: CatalogProvider[];
  providerId: string | null;
}) {
  const current =
    PERMISSION_PRINCIPLES.find((principle) => principle.value === (value || "ask")) ||
    PERMISSION_PRINCIPLES[0];
  const selectedValue = value || "ask";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Approval mode"
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted/60 px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
        >
          <ShieldIcon className="size-4" />
          <span className="hidden truncate lg:inline">{current.title}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-96 p-3">
        <p className="type-caption mb-2">How should agent actions be approved?</p>
        <RadioGroup
          value={selectedValue}
          onValueChange={(next) => onChange(next as FarmPermission)}
          className="gap-2"
        >
          {PERMISSION_PRINCIPLES.map((principle) => {
            const selected = principle.value === selectedValue;
            const subtitle = selected
              ? permissionSubtitle(catalog, providerId, principle.value)
              : null;
            const id = `approval-${principle.value}`;
            return (
              <label
                key={principle.value}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "border-primary/50 bg-muted"
                    : "border-transparent hover:bg-muted/60",
                )}
              >
                <RadioGroupItem
                  value={principle.value}
                  id={id}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{principle.title}</span>
                  <span className="block type-caption">{principle.description}</span>
                  {subtitle ? (
                    <span className="mt-0.5 block truncate type-caption">
                      {providerId}: {subtitle}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  );
}
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Queue, QueueHeader, QueueItem } from "@/components/ai-elements/queue";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { GroupedTools } from "@/components/ai-elements/tool";
import { TerminalPane } from "@/components/terminal-pane";
import {
  ReviewCommentChip,
  ReviewSummaryCard,
  ReviewSurface,
} from "@/components/review-surface";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import {
  DockDropTarget,
  DockTabs,
  type DockDropZone,
} from "@/components/dock-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TokenChip } from "@/components/ui/token-chip";
import {
  TopologyGraph,
  type TopologyEdge,
  type TopologyNode,
} from "@/components/topology-graph";
import { JobSummaryPanel } from "@/components/job-summary-panel";
import { JobsList } from "@/components/jobs-list";
import { cn } from "@/lib/utils";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import { vocab } from "@/lib/vocabulary";
import { PERMISSION_PRINCIPLES, permissionSubtitle } from "@/lib/permissions";
import {
  catalogModel,
  catalogProvider,
  mergeCatalog,
  type CatalogProvider,
} from "@/lib/model-catalog";
import {
  recommendSelection,
  SELECTION_MODES,
  type SelectionMode,
} from "@/lib/selection-advisor";
import { mergeToolEvents, parseSseFrames } from "@/lib/chat-stream";
import type { HarvestState, HarvestSuggestion } from "@/components/harvest-view";
import type { CrewAssignment } from "@/components/crew-board";
import type {
  AgentSessionSummary,
  BootstrapData,
  ChatAttachment,
  ChatMemberTrace,
  ChatMessage,
  ChatModelUsage,
  ChatSession,
  ChatToolEvent,
  ChatUsage,
  FarmPermission,
  FarmSessionMeta,
  GatewayRoute,
  ReviewComment,
  UsageWindow,
  WorkspaceDiffSnapshot,
  WorkspaceView as FarmWorkspaceView,
} from "@/types/farm";

const SESSIONS_KEY = "usage-farm-chat-sessions-v2";
const ACTIVE_KEY = "usage-farm-active-session-v2";
const JOBS_PANEL_KEY = "usage-farm-jobs-panel-open";
const JOBS_PANEL_WIDTH_KEY = "usage-farm-jobs-panel-width";
const JOBS_PANEL_DEFAULT_WIDTH = 256;
const JOBS_PANEL_MIN_WIDTH = 208;
const JOBS_PANEL_MAX_WIDTH = 480;
/** Bridge session-store paging + write-through debounce (spec B). */
const FARM_PAGE_SIZE = 60;
/** Background pages fetched after the first one. Each is a blocking bridge
 *  call, so this caps the mount cost; "load more" covers the rest. */
const FARM_MAX_BACKGROUND_PAGES = 12;
const FARM_SAVE_DEBOUNCE_MS = 1000;
const LEFT_SIDEBAR_KEY = "usage-farm-workspace-left-width";
const RIGHT_SIDEBAR_KEY = "usage-farm-workspace-right-width";
const SPLIT_PANE_WIDTH_KEY = "usage-farm-workspace-split-width";
const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 440;
const MIN_WORKSPACE_WIDTH = 420;
const COMPOSER_HINT_HOLD_MS = 5200;
const COMPOSER_HINT_FADE_MS = 500;
/** Native drop cap — one drop attaches at most this many files (task #10). */
const MAX_DROPPED_FILES = 10;

function nowIso() {
  return new Date().toISOString();
}
function uid() {
  return crypto.randomUUID();
}
function sidebarWidth(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed))
    : fallback;
}
function clampJobsPanelWidth(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(JOBS_PANEL_MAX_WIDTH, Math.max(JOBS_PANEL_MIN_WIDTH, parsed))
    : JOBS_PANEL_DEFAULT_WIDTH;
}
function useRotatingComposerHint(hints: readonly string[], enabled: boolean) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    if (visible) {
      const timeout = window.setTimeout(
        () => setVisible(false),
        COMPOSER_HINT_HOLD_MS,
      );
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => {
      setIndex((current) => current + 1);
      setVisible(true);
    }, COMPOSER_HINT_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [enabled, visible]);
  if (!enabled) return { text: hints[0] || "", visible: true };
  return {
    text: hints[hints.length ? index % hints.length : 0] || "",
    visible,
  };
}
function relativeTime(value: string, now = Date.now()) {
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(value).getTime()) / 1000),
  );
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString();
}

/** Starter-card subtitles show the lead sentence, not the whole summary —
 *  paragraphs made the empty-state cards render as tall towers (task #8). */
function firstSentence(text: string) {
  const index = text.indexOf(". ");
  return index === -1 ? text : text.slice(0, index + 1);
}

function messageHasFileEdits(message: ChatMessage) {
  const tools = [
    ...(message.tools || []),
    ...(message.members || []).flatMap((member) => member.tools || []),
  ];
  // Split camelCase first — "NotebookEdit" has no separator for the boundary
  // class to catch (gap found by the summary-panel verification).
  return tools.some((tool) =>
    /(?:^|[\s_.:/-])(edit|write|patch|apply|replace|create|delete)(?:$|[\s_.:/-])/i.test(
      tool.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2"),
    ),
  );
}

/** Default title for a blank session — vocab-derived so the Jobs→Sessions
 *  rename holds everywhere; "New job" survives only as a legacy comparison. */
const NEW_SESSION_TITLE = `New ${vocab.job.toLowerCase()}`;

function makeSession(model = ""): ChatSession {
  const createdAt = nowIso();
  return {
    id: uid(),
    title: NEW_SESSION_TITLE,
    model,
    createdAt,
    updatedAt: createdAt,
    permissions: "ask",
    sandbox: "workspace-write",
    network: "ask",
    toolPermissions: {},
    mode: "chat",
    toolsEnabled: true,
    messages: [],
    queue: [],
  };
}

function readMirror(): ChatSession[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function loadSessions(model: string): ChatSession[] {
  const raw = localStorage.getItem(SESSIONS_KEY);
  try {
    const stored = JSON.parse(raw || "[]");
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    // Keep an unreadable mirror around for recovery — the next persist flush
    // would otherwise overwrite every mirror-only session with a blank one.
    // Never at the cost of booting though: the mirror holds base64
    // attachments, so a second copy can blow the quota, and this runs inside
    // a useState initializer where a throw is a white screen.
    if (raw)
      try {
        localStorage.setItem(`${SESSIONS_KEY}.corrupt`, raw);
      } catch {
        /* no room to keep a copy — booting matters more */
      }
  }
  return [makeSession(model)];
}

function attachmentContent(message: ChatMessage) {
  if (!message.attachments?.length) return message.content;
  return [
    { type: "text", text: message.content },
    ...message.attachments.map((file) =>
      file.mediaType.startsWith("image/")
        ? { type: "image_url", image_url: { url: file.url } }
        : {
            type: "text",
            text: `[Attachment: ${file.name}; ${file.mediaType}; ${file.size} bytes]`,
          },
    ),
  ];
}

function chatUsage(value: any): ChatUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  return {
    inputTokens: Number(
      value.input_tokens || value.inputTokens || value.prompt_tokens || 0,
    ),
    outputTokens: Number(
      value.output_tokens || value.outputTokens || value.completion_tokens || 0,
    ),
    cachedInputTokens: Number(
      value.cached_input_tokens ||
        value.cachedInputTokens ||
        value.cache_read_input_tokens ||
        0,
    ),
    cacheCreationInputTokens: Number(
      value.cache_creation_input_tokens || value.cacheCreationInputTokens || 0,
    ),
    totalTokens: Number(value.total_tokens || value.totalTokens || 0),
    cachedInputTokensReported: Boolean(
      value.cached_input_tokens_reported ?? value.cachedInputTokensReported,
    ),
    cacheCreationInputTokensReported: Boolean(
      value.cache_creation_input_tokens_reported ??
        value.cacheCreationInputTokensReported,
    ),
    totalTokensReported: Boolean(
      value.total_tokens_reported ?? value.totalTokensReported,
    ),
    cacheStatus: value.cache_status || value.cacheStatus,
    estimated: Boolean(value.estimated),
  };
}

function usageWindow(value: any): UsageWindow | undefined {
  if (!value) return undefined;
  const reset = value.resetsAt;
  return {
    window: String(value.window || "quota"),
    status: value.status,
    usedPercent: value.usedPercent,
    remainingPercent: value.remainingPercent,
    resetsAt:
      reset == null
        ? undefined
        : new Date(
            typeof reset === "number" && reset < 1e12 ? reset * 1000 : reset,
          ).toISOString(),
  };
}

function traceModels(value: any): ChatModelUsage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => ({
    model: String(item.model),
    usage: chatUsage(item.usage),
    costUsd: item.costUsd,
    contextWindow: item.contextWindow,
  }));
}

function applyTraceEvent(
  current: ChatMemberTrace[],
  event: any,
): ChatMemberTrace[] {
  if (!event?.memberId) return current;
  const existing = current.find((member) => member.id === event.memberId);
  if (event.type === "member_start" && !existing)
    return [
      ...current,
      {
        id: event.memberId,
        route: event.route,
        run: event.run || 1,
        role: event.role || "member",
        status: "running",
        reasoning: "",
        tools: [],
        eventCount: 1,
        eventTypes: ["member_start"],
        startedAt: event.startedAt,
      },
    ];
  if (!existing) return current;
  return current.map((member) => {
    if (member.id !== event.memberId) return member;
    const tool = event.tool as ChatToolEvent | undefined;
    // tool_result events often arrive as name "tool result" — keep the real
    // name from the earlier tool_use with the same id.
    const tools = tool
      ? (() => {
          const previous = member.tools.find((item) => item.id === tool.id);
          const generic =
            !tool.name ||
            /^(tool|tool result|tool_result|tool_use)$/i.test(tool.name);
          const mergedName =
            generic && previous?.name && !/^(tool|tool result)$/i.test(previous.name)
              ? previous.name
              : tool.name;
          const merged: ChatToolEvent = {
            ...previous,
            ...tool,
            name: mergedName,
            input: tool.input ?? previous?.input,
            output: tool.output ?? previous?.output,
          };
          return [...member.tools.filter((item) => item.id !== tool.id), merged];
        })()
      : member.tools;
    const eventType = String(event.eventType || event.type || "event");
    return {
      ...member,
      status: event.status || member.status,
      reasoning: `${member.reasoning}${event.reasoningDelta || ""}`,
      tools,
      eventCount: member.eventCount + 1,
      eventTypes: member.eventTypes.includes(eventType)
        ? member.eventTypes
        : [...member.eventTypes, eventType],
      output: event.output ?? member.output,
      usage: chatUsage(event.usage) || member.usage,
      models: traceModels(event.models) || member.models,
      rateLimit: usageWindow(event.rateLimit) || member.rateLimit,
      costUsd: event.costUsd ?? member.costUsd,
      durationMs: event.durationMs ?? member.durationMs,
      ttftMs: event.ttftMs ?? member.ttftMs,
      permissionMode: event.permissionMode ?? member.permissionMode,
      completedAt: event.completedAt ?? member.completedAt,
      error: event.error ?? member.error,
    };
  });
}

/** Auto routes are synthesised by the gateway, not stored in settings.routes,
 *  so they never appeared in this list — which is why "auto silo mode" was
 *  invisible in the composer. `rota` exists whenever there is a claude silo to
 *  rotate between (gateway.mjs routes()). */
const AUTO_ROUTE_IDS = ["rota"];

function hasRotaLanes(data: BootstrapData) {
  return data.accounts.some((account) => account.providers.includes("claude"));
}

function routeModels(data: BootstrapData) {
  return [
    ...new Set(
      [
        ...(hasRotaLanes(data) ? AUTO_ROUTE_IDS : []),
        ...(data.host?.providers || []).map((provider) => `${provider}/host`),
        ...data.accounts.flatMap((account) =>
          account.providers.map((provider) => `${provider}/${account.name}`),
        ),
        ...data.settings.routes.map((route) => route.id),
      ].filter(Boolean),
    ),
  ];
}

/** Provider segment of a direct silo route ("claude/sahil" -> "claude").
 *  Null for elevator/command routes: the route decides internally, so no
 *  provider-specific subtitle or catalog cascade applies.
 *
 *  `rota` resolves to "claude" so the model/effort cascade stays live while the
 *  SILO rotates — pin the model, let the system pick the lane. Returning null
 *  here (the old behaviour for any id without a "/") nulled dispatchPick, so no
 *  farm.model was sent at all. Safe: rotaPick is claude-only by construction. */
function routeProviderId(data: BootstrapData, model: string): string | null {
  if (!model || data.settings.routes.some((route) => route.id === model)) return null;
  if (AUTO_ROUTE_IDS.includes(model) || model === "auto") return "claude";
  return model.includes("/") ? model.split("/")[0] : null;
}

/** Account segment of a direct route ("claude/sahil" -> "sahil", "claude/host" -> "host").
 *  Null for elevator/command route ids that are not provider/account pairs. */
function routeAccountId(data: BootstrapData, model: string): string | null {
  if (!model || data.settings.routes.some((route) => route.id === model)) return null;
  if (!model.includes("/")) return null;
  return model.slice(model.indexOf("/") + 1) || null;
}

/** Terminal / shell target for a session: silo name, or null for host/elevator. */
function sessionShellAccount(data: BootstrapData, model: string): string | null {
  const account = routeAccountId(data, model);
  if (!account || account === "host") return null;
  // Only real silos get `farm shell`; elevators resolve as hybrid routes above.
  if (data.accounts.some((item) => item.name === account)) return account;
  return null;
}

function effortLabel(value: string) {
  return value.replace(/^./, (c) => c.toUpperCase());
}

type DraftRoute = GatewayRoute & { memberSearch?: string };

function RouteStudio({
  data,
  refresh,
  notify,
}: {
  data: BootstrapData;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const models = routeModels(data).filter(
    (id) =>
      data.settings.routes.find((route) => route.id === id)?.transport !==
      "hybrid",
  );
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"hybrid" | "command">("hybrid");
  const [section, setSection] = useState<
    "general" | "agents" | "skills" | "tools" | "commands" | "memory" | "mcp"
  >("general");
  const [draft, setDraft] = useState<DraftRoute>({
    id: "",
    transport: "hybrid",
    members: [],
    strategy: "parallel",
    repeats: 1,
    tools: [],
    skills: [],
    mcp: [],
    permissions: "ask",
  });
  const reset = (next: "hybrid" | "command") => {
    setKind(next);
    setDraft(
      next === "hybrid"
        ? {
            id: "",
            transport: "hybrid",
            members: [],
            strategy: "parallel",
            repeats: 1,
            tools: [],
            skills: [],
            mcp: [],
            permissions: "ask",
          }
        : {
            id: "",
            transport: "command",
            command: "",
            args: [],
            inputMode: "stdin",
            streamFormat: "ndjson",
            capabilities: ["text", "streaming"],
          },
    );
  };
  const toggle = (
    field: "members" | "tools" | "skills" | "mcp",
    value: string,
  ) =>
    setDraft((current) => ({
      ...current,
      [field]: current[field]?.includes(value)
        ? current[field]?.filter((item) => item !== value)
        : [...(current[field] || []), value],
    }));
  const save = async () => {
    if (!draft.id.trim()) return notify("Give this route a public model ID.");
    if (kind === "hybrid" && !draft.members?.length)
      return notify("Choose at least one member route.");
    if (kind === "command" && !draft.command?.trim())
      return notify("Choose a CLI executable.");
    const route: GatewayRoute = {
      ...draft,
      id: draft.id.trim(),
      label: draft.label?.trim() || draft.id.trim(),
      description: draft.description?.trim(),
      args: draft.args?.filter(Boolean),
    };
    const routes = [
      ...data.settings.routes.filter((item) => item.id !== route.id),
      route,
    ];
    await invokeNative("farm.gateway.save", { ...data.settings, routes });
    await refresh();
    setOpen(false);
    notify(`${route.id} is available as a container group route.`);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <SparklesIcon data-icon="inline-start" />
          Container group
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[84vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Elevator</DialogTitle>
          <DialogDescription>
            Compose silos into an elevator, or register a direct CLI
            route that accepts a prompt and streams stdout.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={kind === "hybrid" ? "default" : "outline"}
            onClick={() => reset("hybrid")}
          >
            <UsersIcon data-icon="inline-start" />
            Multi-container group
          </Button>
          <Button
            type="button"
            size="sm"
            variant={kind === "command" ? "default" : "outline"}
            onClick={() => reset("command")}
          >
            <TerminalIcon data-icon="inline-start" />
            Direct CLI route
          </Button>
        </div>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Public model ID</FieldLabel>
              <Input
                value={draft.id}
                placeholder={
                  kind === "hybrid" ? "research-council" : "agensis-local"
                }
                onChange={(event) =>
                  setDraft({ ...draft, id: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel>Display name</FieldLabel>
              <Input
                value={draft.label || ""}
                placeholder="Optional"
                onChange={(event) =>
                  setDraft({ ...draft, label: event.target.value })
                }
              />
            </Field>
          </div>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Input
              value={draft.description || ""}
              placeholder="What this route is best at"
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </Field>
          {kind === "hybrid" ? (
            <>
              <Field>
                <FieldLabel>Members</FieldLabel>
                <FieldDescription>
                  Each member can run more than once. Results are labeled so
                  provenance remains visible.
                </FieldDescription>
                <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/35 p-3">
                  {models.map((model) => (
                    <button
                      type="button"
                      key={model}
                      onClick={() => toggle("members", model)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs font-medium leading-tight transition-colors",
                        draft.members?.includes(model)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted",
                      )}
                    >
                      {draft.members?.includes(model) && (
                        <CheckIcon className="mr-1 inline size-3" />
                      )}
                      {model}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field>
                  <FieldLabel>Execution workflow</FieldLabel>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={draft.strategy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        strategy: event.target
                          .value as GatewayRoute["strategy"],
                      })
                    }
                  >
                    <option value="parallel">Parallel panel</option>
                    <option value="race">First successful</option>
                    <option value="synthesize">Synthesize</option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel>Runs per member</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    max={8}
                    value={draft.repeats || 1}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        repeats: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>Synthesizer</FieldLabel>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={draft.synthesizer || ""}
                    disabled={draft.strategy !== "synthesize"}
                    onChange={(event) =>
                      setDraft({ ...draft, synthesizer: event.target.value })
                    }
                  >
                    <option value="">First member</option>
                    {draft.members?.map((model) => (
                      <option key={model}>{model}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field>
                <FieldLabel>Specialist instruction</FieldLabel>
                <textarea
                  className="min-h-20 rounded-md border bg-background p-3 text-sm"
                  value={draft.systemPrompt || ""}
                  onChange={(event) =>
                    setDraft({ ...draft, systemPrompt: event.target.value })
                  }
                  placeholder="Shared instruction added before each member runs."
                />
              </Field>
              {(
                [
                  ["skills", data.catalog.skills],
                  ["tools", data.catalog.commands],
                  ["mcp", data.catalog.mcp],
                ] as const
              ).map(([field, values]) => (
                <Field key={field}>
                  <FieldLabel>
                    {field === "mcp"
                      ? "MCP servers"
                      : field[0].toUpperCase() + field.slice(1)}
                  </FieldLabel>
                  <div className="flex min-h-12 flex-wrap gap-1.5 rounded-lg border bg-muted/35 p-2">
                    {values.length ? (
                      values.map((value) => (
                        <button
                          type="button"
                          key={value}
                          onClick={() => toggle(field, value)}
                          className={cn(
                            "rounded-md px-2 py-1 text-xs",
                            draft[field]?.includes(value)
                              ? "bg-primary text-primary-foreground"
                              : "border bg-background",
                          )}
                        >
                          {value}
                        </button>
                      ))
                    ) : (
                      <span className="p-1 text-xs text-muted-foreground">
                        Nothing discovered yet.
                      </span>
                    )}
                  </div>
                </Field>
              ))}
            </>
          ) : (
            <>
              <Field>
                <FieldLabel>Executable</FieldLabel>
                <Input
                  value={draft.command || ""}
                  placeholder="agensis-cli, codesurf, or an absolute path"
                  onChange={(event) =>
                    setDraft({ ...draft, command: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Arguments</FieldLabel>
                <Input
                  value={(draft.args || []).join(" ")}
                  placeholder="chat --provider codex"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      args: event.target.value.split(/\s+/).filter(Boolean),
                    })
                  }
                />
                <FieldDescription>
                  Use <code>{"{{prompt}}"}</code> in an argument for argument
                  mode; otherwise the prompt is written to stdin.
                </FieldDescription>
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field>
                  <FieldLabel>Input</FieldLabel>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={draft.inputMode}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        inputMode: event.target
                          .value as GatewayRoute["inputMode"],
                      })
                    }
                  >
                    <option value="stdin">stdin</option>
                    <option value="argument">argument</option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel>Stream format</FieldLabel>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={draft.streamFormat}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        streamFormat: event.target
                          .value as GatewayRoute["streamFormat"],
                      })
                    }
                  >
                    <option value="ndjson">NDJSON</option>
                    <option value="sse">SSE</option>
                    <option value="text">Plain text</option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel>Working directory</FieldLabel>
                  <Input
                    value={draft.cwd || ""}
                    placeholder="Current directory"
                    onChange={(event) =>
                      setDraft({ ...draft, cwd: event.target.value })
                    }
                  />
                </Field>
              </div>
            </>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>
            <PlusIcon data-icon="inline-start" />
            Save route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type WorkspaceView = FarmWorkspaceView;

function PermissionStudio({
  data,
  session,
  update,
}: {
  data: BootstrapData;
  session: ChatSession;
  update: (next: Partial<ChatSession>) => void;
}) {
  const route = (data.settings.routes || []).find(
    (item) => item.id === session.model,
  );
  const catalog = useMemo(() => mergeCatalog(data.models), [data.models]);
  const providerId = routeProviderId(data, session.model);
  const approvalPrinciple =
    PERMISSION_PRINCIPLES.find(
      (principle) => principle.value === session.permissions,
    ) || PERMISSION_PRINCIPLES[0];
  const approvalSubtitle = permissionSubtitle(
    catalog,
    providerId,
    approvalPrinciple.value,
  );
  const entries = [
    ...new Set([
      ...(route?.tools || []),
      ...(route?.mcp || []).map((name) => `mcp:${name}`),
      ...data.catalog.commands,
    ]),
  ].sort();
  const policy = (name: string) => session.toolPermissions?.[name] || "ask";
  const setPolicy = (name: string, value: "deny" | "ask" | "allow") =>
    update({
      toolPermissions: { ...(session.toolPermissions || {}), [name]: value },
    });
  return (
    <TooltipProvider>
      <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label="Permissions and sandbox"
        >
          <ShieldCheckIcon className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[82vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permissions and sandbox</DialogTitle>
          <DialogDescription>
            Set the hard execution boundary and the policy sent to the selected
            provider for this session.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel>Filesystem sandbox</FieldLabel>
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={session.sandbox || "workspace-write"}
                onChange={(event) =>
                  update({
                    sandbox: event.target.value as ChatSession["sandbox"],
                  })
                }
              >
                <option value="read-only">Read only</option>
                <option value="workspace-write">Workspace write</option>
                <option value="danger-full-access">
                  Container full access
                </option>
              </select>
            </Field>
            <Field>
              <FieldLabel>Approvals</FieldLabel>
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={session.permissions}
                onChange={(event) =>
                  update({
                    permissions: event.target
                      .value as ChatSession["permissions"],
                  })
                }
              >
                {PERMISSION_PRINCIPLES.map((principle) => (
                  <option key={principle.value} value={principle.value}>
                    {principle.title}
                  </option>
                ))}
              </select>
              <FieldDescription>
                {approvalPrinciple.description}
                {approvalSubtitle ? ` ${providerId}: ${approvalSubtitle}.` : ""}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Network</FieldLabel>
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={session.network || "ask"}
                onChange={(event) =>
                  update({
                    network: event.target.value as ChatSession["network"],
                  })
                }
              >
                <option value="deny">Deny</option>
                <option value="ask">Ask</option>
                <option value="allow">Allow</option>
              </select>
            </Field>
          </div>
          <div className="rounded-lg border bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Enforcement:</strong> the Apple
            container is the outer boundary. Claude and Codex receive native
            sandbox/approval flags where supported. Network and per-tool rules
            are also included in the route policy; unsupported CLIs report
            policy-only enforcement.
          </div>
          <Field>
            <FieldLabel>Tool and MCP overrides</FieldLabel>
            <FieldDescription>
              Unlisted tools use Ask. Deny always wins over the routeâs
              configured equipment.
            </FieldDescription>
            <div className="mt-2 divide-y overflow-hidden rounded-xl border bg-background">
              {entries.length ? (
                entries.map((name) => (
                  <div key={name} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {name}
                    </span>
                    <div className="flex rounded-lg border p-1">
                      {(
                        [
                          { value: "deny", label: "Deny", icon: XIcon },
                          {
                            value: "ask",
                            label: "Ask every time",
                            icon: CircleHelpIcon,
                          },
                          { value: "allow", label: "Allow", icon: CheckIcon },
                        ] as const
                      ).map(({ value, label, icon: Icon }) => (
                        <Tooltip key={value}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={label}
                              onClick={() => setPolicy(name, value)}
                              className={cn(
                                "grid size-7 place-items-center rounded-md",
                                policy(name) === value
                                  ? value === "deny"
                                    ? "bg-destructive text-destructive-foreground"
                                    : "bg-accent text-accent-foreground"
                                  : "text-muted-foreground hover:bg-muted",
                              )}
                            >
                              <Icon className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{label}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-3 text-xs text-muted-foreground">
                  This route has no discovered tool or MCP entries.
                </p>
              )}
            </div>
          </Field>
        </FieldGroup>
      </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

export function ChatWorkspace({
  data,
  refresh,
  notify,
  navigate,
  theme,
  toggleTheme,
  showNavigationSidebar = true,
}: {
  data: BootstrapData;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  navigate: (view: WorkspaceView) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  showNavigationSidebar?: boolean;
}) {
  const models = useMemo(() => routeModels(data), [data]);
  const catalog = useMemo(() => mergeCatalog(data.models), [data.models]);
  // Catalog model choice per session (composer cascade, spec D) lives ON the
  // session as `catalogModel` — see types/farm.ts. Held as UI-only state it
  // silently reverted every reload to the route's pinned upstreamModel while
  // `effort` (which IS persisted) stayed put.
  // AUTO/BEST/ECO selection mode per session (task #7). "manual" keeps the
  // advisor hands-off; any explicit cascade pick flips a session back here.
  const [selectionModes, setSelectionModes] = useState<
    Record<string, SelectionMode>
  >({});
  const setSelectionMode = (sessionId: string, mode: SelectionMode) =>
    setSelectionModes((current) => ({ ...current, [sessionId]: mode }));
  // Workspace-scoped empty state (task #8): workspace name plus the live
  // recommendation sources, fetched once per mount over the bridge.
  // workspaceRoot is the open project folder — terminals and host jobs land here,
  // never forced to ~/.claude-farm/work.
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [harvestProposed, setHarvestProposed] = useState<HarvestSuggestion[]>(
    [],
  );
  const [crewUnfinished, setCrewUnfinished] = useState<CrewAssignment[]>([]);
  // Native file drops (task #10): ring the active pane while a Files drag is
  // over the chat surface.
  const [dropActive, setDropActive] = useState(false);
  const projectName =
    data.install.repo?.split(/[\\/]/).filter(Boolean).pop() ||
    "Current project";
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    loadSessions(models[0] || ""),
  );
  const [activeId, setActiveId] = useState(
    () => localStorage.getItem(ACTIVE_KEY) || sessions[0]?.id || "",
  );
  const [sessionHistory, setSessionHistory] = useState<string[]>(() =>
    activeId ? [activeId] : [],
  );
  const [sessionHistoryIndex, setSessionHistoryIndex] = useState(0);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextSearch, setContextSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState<
    "all" | "agents" | "custom"
  >("all");
  const [sessionSort, setSessionSort] = useState<"recent" | "oldest" | "title">(
    "recent",
  );
  const [sessionLimit, setSessionLimit] = useState(40);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [rightTab, setRightTab] = useState<"session" | "access" | "summary">("session");
  const [splitPane, setSplitPane] = useState<
    "empty" | "session" | "documents" | "topology" | "review" | "terminal" | null
  >(null);
  const [splitSide, setSplitSide] = useState<"left" | "right" | "top" | "bottom">("right");
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null);
  const [reviewSnapshot, setReviewSnapshot] =
    useState<WorkspaceDiffSnapshot | null>(null);
  const [reviewSelectedPath, setReviewSelectedPath] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewCommentsBySession, setReviewCommentsBySession] = useState<
    Record<string, ReviewComment[]>
  >({});
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(() =>
    sidebarWidth(localStorage.getItem(LEFT_SIDEBAR_KEY), 262),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    sidebarWidth(localStorage.getItem(RIGHT_SIDEBAR_KEY), 244),
  );
  const [splitWidth, setSplitWidth] = useState(() =>
    Math.min(900, Math.max(280, Number(localStorage.getItem(SPLIT_PANE_WIDTH_KEY)) || 420)),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const active =
    sessions.find((session) => session.id === activeId) || sessions[0];

  // ---- Farm session store (spec B) ----------------------------------------
  // With the native bridge present the ~/.claude-farm/sessions store is the
  // source of truth; localStorage stays the no-bridge fallback and offline
  // mirror. Metas hydrate as content-less stubs, filled by farm.session.get
  // on open; edits write through with a per-session debounce.
  const bridge = hasNativeBridge();
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  /** Ids hydrated from store metas without content — never written back. */
  const stubIdsRef = useRef(new Set<string>());
  /** The mirror as it stood at mount: the only content those stubs have until
   *  farm.session.get fills them, so the persist flush reuses it instead of
   *  writing message-less stubs over the offline copy. */
  const mirrorAtMountRef = useRef<Map<string, ChatSession> | null>(null);
  const mirrorAtMount = () => {
    if (!mirrorAtMountRef.current)
      mirrorAtMountRef.current = new Map(
        readMirror().map((session) => [session.id, session]),
      );
    return mirrorAtMountRef.current;
  };
  /** Peeked native transcripts: read-only previews, persisted nowhere until
   *  the first send adopts them (spec B, adopt-on-use). */
  const peekInfoRef = useRef(
    new Map<string, { path: string; provider: string; account: string }>(),
  );
  /** Last object identity synced with the store, per session id. */
  const lastSyncedRef = useRef(new Map<string, ChatSession>());
  const saveTimersRef = useRef(new Map<string, number>());
  const farmReadyRef = useRef(false);
  const farmLoadingRef = useRef(false);
  const [farmPage, setFarmPage] = useState<{
    offset: number;
    total: number;
  } | null>(null);
  const [jobsPanelOpen, setJobsPanelOpen] = useState(
    () => localStorage.getItem(JOBS_PANEL_KEY) !== "0",
  );
  useEffect(() => {
    localStorage.setItem(JOBS_PANEL_KEY, jobsPanelOpen ? "1" : "0");
  }, [jobsPanelOpen]);
  const [jobsPanelWidth, setJobsPanelWidth] = useState(() =>
    clampJobsPanelWidth(localStorage.getItem(JOBS_PANEL_WIDTH_KEY)),
  );
  useEffect(() => {
    localStorage.setItem(JOBS_PANEL_WIDTH_KEY, String(jobsPanelWidth));
  }, [jobsPanelWidth]);
  // Empty-state sources (task #8). No bridge → all three stay empty and the
  // copy falls back to the route-scoped question.
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const applyWorkspace = (root: string | undefined) => {
      if (!root) return;
      setWorkspaceRoot(root);
      const name = root.split(/[\\/]/).filter(Boolean).pop();
      if (name) setWorkspaceName(name);
    };
    invokeNative<{ root: string }>("farm.workspace.list")
      .then((result) => {
        if (cancelled) return;
        applyWorkspace(result.root);
      })
      .catch(() => {});
    const onRootChange = () => {
      invokeNative<{ root: string }>("farm.workspace.list")
        .then((result) => {
          if (!cancelled) applyWorkspace(result.root);
        })
        .catch(() => {});
    };
    window.addEventListener("agensis:workspace-root-changed", onRootChange);
    invokeNative<HarvestState>("farm.harvest.list")
      .then((state) => {
        if (cancelled) return;
        setHarvestProposed(
          (state.suggestions || []).filter(
            (suggestion) => suggestion.status === "proposed",
          ),
        );
      })
      .catch(() => {});
    invokeNative<{ assignments: CrewAssignment[] }>("farm.crew.list")
      .then((result) => {
        if (cancelled) return;
        setCrewUnfinished(
          (result.assignments || []).filter(
            (assignment) => assignment.status !== "done",
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      window.removeEventListener("agensis:workspace-root-changed", onRootChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metaToStub = (meta: FarmSessionMeta): ChatSession => ({
    id: meta.id,
    title: meta.title,
    model: meta.model || "",
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    project: meta.project ?? null,
    archived: meta.archived,
    pinned: meta.pinned,
    permissions: meta.permissions,
    effort: meta.effort,
    catalogModel: meta.catalogModel,
    source: meta.source,
    originPath: meta.originPath,
    importedAt: meta.importedAt,
    toolPermissions: {},
    mode: "chat",
    toolsEnabled: true,
    messages: [],
    queue: [],
  });

  /** Fold one store page into local state: unknown ids arrive as stubs,
   *  known ids keep local content while newer store bookkeeping wins. */
  const mergeFarmMetas = (metas: FarmSessionMeta[], sort = false) => {
    const known = new Set(sessionsRef.current.map((session) => session.id));
    for (const meta of metas)
      if (!known.has(meta.id)) stubIdsRef.current.add(meta.id);
    setSessions((current) => {
      const next = [...current];
      const indexById = new Map(next.map((session, index) => [session.id, index]));
      for (const meta of metas) {
        const index = indexById.get(meta.id);
        if (index === undefined) {
          next.push(metaToStub(meta));
        } else if (meta.updatedAt > next[index].updatedAt) {
          next[index] = {
            ...next[index],
            title: meta.title,
            model: meta.model || next[index].model,
            updatedAt: meta.updatedAt,
            project: meta.project ?? null,
            archived: meta.archived,
            pinned: meta.pinned,
            permissions: meta.permissions,
            effort: meta.effort,
            catalogModel: meta.catalogModel,
            source: meta.source,
            originPath: meta.originPath,
            importedAt: meta.importedAt,
          };
        }
      }
      if (sort) next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return next;
    });
  };

  const loadFarmSession = async (id: string) => {
    if (!bridge || !stubIdsRef.current.has(id)) return;
    try {
      const full = await invokeNative<ChatSession>("farm.session.get", { id });
      const base = sessionsRef.current.find((session) => session.id === id);
      const merged: ChatSession = {
        ...(base || full),
        ...full,
        messages: full.messages || [],
        queue: full.queue || [],
        toolsEnabled: full.toolsEnabled ?? true,
      };
      stubIdsRef.current.delete(id);
      lastSyncedRef.current.set(id, merged);
      setSessions((current) =>
        current.map((session) => (session.id === id ? merged : session)),
      );
    } catch {
      /* the row stays a stub; the next open retries */
    }
  };

  const saveFarmSessionNow = (id: string) => {
    const session = sessionsRef.current.find((item) => item.id === id);
    if (
      !session ||
      stubIdsRef.current.has(id) ||
      peekInfoRef.current.has(id)
    )
      return;
    // Untouched blank jobs stay out of the store until they gain content or
    // a name — the localStorage mirror already holds them.
    if (
      !session.messages.length &&
      !session.queue.length &&
      (session.title === NEW_SESSION_TITLE || session.title === "New job")
    )
      return;
    lastSyncedRef.current.set(id, session);
    void invokeNative("farm.session.save", { session }).catch(() => {});
  };

  const scheduleFarmSave = (id: string) => {
    const timers = saveTimersRef.current;
    const pending = timers.get(id);
    if (pending) window.clearTimeout(pending);
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        saveFarmSessionNow(id);
      }, FARM_SAVE_DEBOUNCE_MS),
    );
  };

  // Hydrate from the Farm store once per mount. A first-ever bridge run
  // (empty store, local history present) migrates localStorage sessions
  // through farm.session.save, then proceeds bridge-first.
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await invokeNative<{
          sessions: FarmSessionMeta[];
          total: number;
        }>("farm.session.list", { offset: 0, limit: FARM_PAGE_SIZE });
        if (cancelled) return;
        for (const session of sessionsRef.current)
          lastSyncedRef.current.set(session.id, session);
        if (!result.total) {
          for (const session of sessionsRef.current) {
            if (!session.messages.length && !session.queue.length) continue;
            void invokeNative("farm.session.save", { session }).catch(() => {});
          }
          farmReadyRef.current = true;
          setFarmPage({ offset: 0, total: 0 });
          return;
        }
        mergeFarmMetas(result.sessions, true);
        farmReadyRef.current = true;
        setFarmPage({ offset: result.sessions.length, total: result.total });
        const activeNow = localStorage.getItem(ACTIVE_KEY) || "";
        if (activeNow) void loadFarmSession(activeNow);
        // Page the rest of the store in the background — sessions beyond the
        // first page were invisible until "load more" was clicked.
        const storeIds = new Set(result.sessions.map((meta) => meta.id));
        let offset = result.sessions.length;
        let total = result.total;
        // Every farm.session.list is a blocking bridge round-trip, so yield to
        // the event loop between pages and give up after a bounded number of
        // them rather than freezing the app against an unbounded store.
        let enumerated = true;
        farmLoadingRef.current = true;
        try {
          for (let page = 0; !cancelled && offset < total; page += 1) {
            if (page >= FARM_MAX_BACKGROUND_PAGES) {
              enumerated = false;
              break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            if (cancelled) break;
            const next = await invokeNative<{
              sessions: FarmSessionMeta[];
              total: number;
            }>("farm.session.list", { offset, limit: FARM_PAGE_SIZE });
            if (cancelled) break;
            if (!next.sessions.length) {
              enumerated = false;
              break;
            }
            // Sort on every page — appended pages arrive in store order, so
            // without it the list stops being newest-first past page one.
            mergeFarmMetas(next.sessions, true);
            for (const meta of next.sessions) storeIds.add(meta.id);
            offset += next.sessions.length;
            total = next.total;
            setFarmPage({ offset, total });
          }
        } catch {
          enumerated = false;
        } finally {
          farmLoadingRef.current = false;
        }
        if (cancelled) return;
        // Migrate mirror-only sessions with content on every mount — the old
        // one-shot migration only ran while the store was completely empty.
        // Only safe once the WHOLE store is known: a partial storeIds set
        // would read sessions that already exist as mirror-only and overwrite
        // the store copy with the local one.
        if (!enumerated || cancelled) return;
        for (const session of sessionsRef.current) {
          if (storeIds.has(session.id)) continue;
          if (stubIdsRef.current.has(session.id)) continue;
          if (peekInfoRef.current.has(session.id)) continue;
          if (!session.messages.length && !session.queue.length) continue;
          void invokeNative("farm.session.save", { session }).catch(() => {});
        }
      } catch {
        /* store unavailable — localStorage rules this run */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigating to another view unmounts this workspace — flush any pending
  // debounced writes so the store never trails the mirror.
  useEffect(
    () => () => {
      for (const [id, timer] of saveTimersRef.current) {
        window.clearTimeout(timer);
        saveFarmSessionNow(id);
      }
      saveTimersRef.current.clear();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const loadMoreFarm = async () => {
    if (!bridge || !farmPage || farmLoadingRef.current) return;
    if (farmPage.offset >= farmPage.total) return;
    farmLoadingRef.current = true;
    try {
      const result = await invokeNative<{
        sessions: FarmSessionMeta[];
        total: number;
      }>("farm.session.list", {
        offset: farmPage.offset,
        limit: FARM_PAGE_SIZE,
      });
      mergeFarmMetas(result.sessions);
      setFarmPage({
        offset: farmPage.offset + result.sessions.length,
        // An empty page despite offset < total means rows vanished under us
        // (deletes); close the window so the sentinel stops retrying.
        total: result.sessions.length ? result.total : farmPage.offset,
      });
    } catch {
      /* the sentinel retries on the next intersection */
    } finally {
      farmLoadingRef.current = false;
    }
  };

  /** Commit a pending peek into the Farm store (idempotent — the id is a
   *  stable hash of the origin path). Double-click and first-send both land
   *  here; the pending flag ends with adoption. Null on failure. */
  const adoptPeekedSession = async (
    sessionId: string,
  ): Promise<ChatSession | null> => {
    const peek = peekInfoRef.current.get(sessionId);
    const source = sessionsRef.current.find((item) => item.id === sessionId);
    if (!source) return null;
    if (!peek) return source;
    try {
      const meta = await invokeNative<FarmSessionMeta>("farm.session.adopt", {
        path: peek.path,
        provider: peek.provider,
        account: peek.account,
      });
      peekInfoRef.current.delete(sessionId);
      const adopted: ChatSession = {
        ...source,
        pending: undefined,
        source: meta.source,
        originPath: meta.originPath,
        importedAt: meta.importedAt,
      };
      // Adopt just wrote this exact content — mark it synced so the
      // write-through only fires for changes made after adoption.
      lastSyncedRef.current.set(sessionId, adopted);
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId ? adopted : session,
        ),
      );
      return adopted;
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const openNativeSession = async (
    summary: AgentSessionSummary,
    options: { adopt?: boolean } = {},
  ) => {
    const adopted = sessionsRef.current.find(
      (session) => session.originPath === summary.sourcePath,
    );
    if (adopted) {
      activateSession(adopted.id);
      void loadFarmSession(adopted.id);
      return;
    }
    try {
      const peeked = await invokeNative<ChatSession>("farm.session.peek", {
        path: summary.sourcePath,
        provider: summary.provider,
        account: summary.account,
      });
      const session: ChatSession = {
        ...peeked,
        model: peeked.model || `${summary.provider}/${summary.account}`,
        messages: peeked.messages || [],
        queue: peeked.queue || [],
        toolsEnabled: peeked.toolsEnabled ?? true,
      };
      const existing = sessionsRef.current.find(
        (item) => item.id === session.id,
      );
      if (existing) {
        // The transcript was adopted earlier — the peek returned the stored
        // session; fill the local row and open it as a normal Farm session.
        stubIdsRef.current.delete(session.id);
        lastSyncedRef.current.set(session.id, session);
        setSessions((current) =>
          current.map((item) => (item.id === session.id ? session : item)),
        );
      } else {
        peekInfoRef.current.set(session.id, {
          path: summary.sourcePath,
          provider: summary.provider,
          account: summary.account,
        });
        // Pending until adopted: italic in every list, discarded on
        // switch-away, committed by double-click or first send.
        setSessions((current) => [{ ...session, pending: true }, ...current]);
      }
      activateSession(session.id);
      if (options.adopt) await adoptPeekedSession(session.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  // ---- end Farm session store ----------------------------------------------

  const activateSession = (id: string, recordHistory = true) => {
    if (!id) return;
    // A pending peek is a preview, not a commitment: switching off it
    // discards it (adopt-on-use). Double-click or send is the way in.
    if (activeId && activeId !== id && peekInfoRef.current.has(activeId)) {
      peekInfoRef.current.delete(activeId);
      setSessions((current) =>
        current.filter((session) => session.id !== activeId),
      );
    }
    setActiveId(id);
    void loadFarmSession(id);
    if (!recordHistory) return;
    setSessionHistory((current) => {
      const retained = current.slice(0, sessionHistoryIndex + 1);
      if (retained.at(-1) === id) return current;
      const next = [...retained, id];
      setSessionHistoryIndex(next.length - 1);
      return next;
    });
  };

  const goBack = () => {
    const nextIndex = Math.max(0, sessionHistoryIndex - 1);
    const id = sessionHistory[nextIndex];
    if (!id || nextIndex === sessionHistoryIndex) return;
    setSessionHistoryIndex(nextIndex);
    activateSession(id, false);
  };

  const goForward = () => {
    const nextIndex = Math.min(sessionHistory.length - 1, sessionHistoryIndex + 1);
    const id = sessionHistory[nextIndex];
    if (!id || nextIndex === sessionHistoryIndex) return;
    setSessionHistoryIndex(nextIndex);
    activateSession(id, false);
  };

  useEffect(() => {
    // Peeked native previews never reach the mirror — adoption is the only
    // path into persistence (spec B). Store STUBS are excluded too: they carry
    // no messages, so writing them would hollow out the offline mirror the
    // "store unavailable" path falls back on. Their previous mirror entry is
    // kept verbatim instead.
    const mirrored = mirrorAtMount();
    const persistable = sessions
      .filter((session) => !peekInfoRef.current.has(session.id))
      .map((session) => {
        if (!stubIdsRef.current.has(session.id)) return session;
        const held = mirrored.get(session.id);
        // Live meta, mirrored content — the stub itself has neither.
        return held
          ? { ...session, messages: held.messages, queue: held.queue }
          : session;
      });
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(persistable));
    window.dispatchEvent(
      new CustomEvent("agensis:sessions-changed", { detail: sessions }),
    );
    if (!bridge || !farmReadyRef.current) return;
    // Write-through to the Farm store, debounced per session so streaming
    // token updates coalesce into one save.
    for (const session of sessions) {
      if (
        stubIdsRef.current.has(session.id) ||
        peekInfoRef.current.has(session.id)
      )
        continue;
      if (lastSyncedRef.current.get(session.id) === session) continue;
      scheduleFarmSave(session.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);
  useEffect(() => {
    if (activeId) {
      localStorage.setItem(ACTIVE_KEY, activeId);
      window.dispatchEvent(
        new CustomEvent("agensis:active-session-changed", { detail: activeId }),
      );
    }
  }, [activeId]);
  useEffect(() => {
    const selectSession = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id && sessions.some((session) => session.id === id)) activateSession(id);
    };
    window.addEventListener("agensis:activate-session", selectSession);
    return () => window.removeEventListener("agensis:activate-session", selectSession);
  }, [sessions, sessionHistoryIndex]);
  // Crew board staffing: App stages the job in localStorage (the workspace may
  // not be mounted when Start is clicked) and pings; consume once on mount and
  // on every ping while mounted.
  useEffect(() => {
    const consumeStagedJob = () => {
      let staged: { silo?: string; prompt?: string | null; title?: string } | null = null;
      try { staged = JSON.parse(localStorage.getItem("agensis:pending-job") || "null"); } catch { /* corrupt */ }
      if (!staged) return;
      localStorage.removeItem("agensis:pending-job");
      const siloModel = staged.silo
        ? models.find((model) => model.toLowerCase().includes(staged!.silo!.toLowerCase()))
        : undefined;
      const session = {
        ...makeSession(siloModel || active?.model || models[0] || ""),
        title: staged.title || NEW_SESSION_TITLE,
      };
      setSessions((current) => [session, ...current]);
      activateSession(session.id);
      setInput(staged.prompt || "");
      setAttachments([]);
    };
    consumeStagedJob();
    window.addEventListener("agensis:job-staged", consumeStagedJob);
    return () => window.removeEventListener("agensis:job-staged", consumeStagedJob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);
  useEffect(() => {
    localStorage.setItem(LEFT_SIDEBAR_KEY, String(leftWidth));
  }, [leftWidth]);
  useEffect(() => {
    localStorage.setItem(RIGHT_SIDEBAR_KEY, String(rightWidth));
  }, [rightWidth]);
  useEffect(() => {
    localStorage.setItem(SPLIT_PANE_WIDTH_KEY, String(splitWidth));
  }, [splitWidth]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (active && !active.model && models[0])
      updateSession(active.id, (session) => ({ ...session, model: models[0] }));
  }, [models.join("|")]);

  const updateSession = (
    id: string,
    updater: (session: ChatSession) => ChatSession,
  ) =>
    setSessions((current) =>
      current.map((session) =>
        session.id === id ? updater(session) : session,
      ),
    );
  // Advisor happy path (task #7). Manual sessions still get a recommendation
  // (scored as "auto") so the cascade can mark the best rows green.
  const activeSelectionMode: SelectionMode =
    (active && selectionModes[active.id]) || "manual";
  const activeRecommendation = useMemo(
    () =>
      recommendSelection(
        activeSelectionMode === "manual" ? "auto" : activeSelectionMode,
        data.accounts,
        catalog,
      ),
    [activeSelectionMode, data.accounts, catalog],
  );
  // While a non-manual mode is on, the recommendation drives the active
  // session's route, catalog pick, and effort; the guard keeps the applied
  // state from re-triggering the effect.
  useEffect(() => {
    if (!active || activeSelectionMode === "manual") return;
    const rec = activeRecommendation;
    if (!rec.account || !rec.provider) return;
    const route = `${rec.provider}/${rec.account}`;
    if (
      active.model === route &&
      (active.catalogModel ?? null) === rec.modelId &&
      (active.effort ?? null) === rec.effort
    )
      return;
    // One write — route, pick, and effort all live on the session now, so the
    // guard above sees a single settled state instead of racing two setters.
    updateSession(active.id, (session) => ({
      ...session,
      model: route,
      catalogModel: rec.modelId || undefined,
      effort: rec.effort || undefined,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeSelectionMode,
    activeRecommendation,
    active?.id,
    active?.model,
    active?.effort,
    active?.catalogModel,
  ]);
  const newSession = (model = active?.model || models[0] || "") => {
    const session = makeSession(model);
    setSessions((current) => [session, ...current]);
    activateSession(session.id);
    setInput("");
    setAttachments([]);
  };
  const deleteSession = (id: string) => {
    const wasPeek = peekInfoRef.current.delete(id);
    const timer = saveTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      saveTimersRef.current.delete(id);
    }
    stubIdsRef.current.delete(id);
    lastSyncedRef.current.delete(id);
    // Peeks were never persisted; everything else leaves the store too.
    if (bridge && !wasPeek) {
      const removed = sessions.find((session) => session.id === id);
      void invokeNative("farm.session.remove", { id }).catch(() => {});
      // Adopted rows: deleting the Farm copy must never read as deleting
      // the provider's transcript — say so.
      if (removed?.originPath)
        notify("Removed from Farm — the original native transcript stays on disk.");
    }
    const rest = sessions.filter((session) => session.id !== id);
    const next = rest.length ? rest : [makeSession(models[0] || "")];
    setSessions(next);
    if (activeId === id) activateSession(next[0].id);
  };
  const duplicateSessionById = (id: string) => {
    const source = sessions.find((session) => session.id === id);
    if (!source) return;
    const createdAt = nowIso();
    const copy: ChatSession = {
      ...source,
      id: uid(),
      title: `${source.title} copy`,
      createdAt,
      updatedAt: createdAt,
      messages: [...source.messages],
      queue: [],
    };
    setSessions((current) => [copy, ...current]);
    setActiveId(copy.id);
  };
  // App's sidebar mutates sessions while this workspace is mounted; apply its
  // granular events here so the next persist flush can't clobber the edit
  // (or resurrect a deleted session) with this component's stale copy.
  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; update: Partial<ChatSession> }>)
        .detail;
      if (!detail?.id || !detail.update) return;
      updateSession(detail.id, (session) => ({ ...session, ...detail.update }));
    };
    const onDeleted = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id && sessions.some((session) => session.id === id)) deleteSession(id);
    };
    const onCreated = (event: Event) => {
      const session = (event as CustomEvent<ChatSession>).detail;
      if (!session?.id) return;
      setSessions((current) =>
        current.some((item) => item.id === session.id)
          ? current
          : [session, ...current],
      );
    };
    const onReordered = (event: Event) => {
      const ids = (event as CustomEvent<string[]>).detail;
      if (!Array.isArray(ids) || !ids.length) return;
      setSessions((current) => {
        const byId = new Map(current.map((session) => [session.id, session]));
        const ordered = ids
          .map((id) => byId.get(id))
          .filter(Boolean) as ChatSession[];
        const seen = new Set(ids);
        for (const session of current)
          if (!seen.has(session.id)) ordered.push(session);
        return ordered;
      });
    };
    window.addEventListener("agensis:session-updated", onUpdated);
    window.addEventListener("agensis:session-deleted", onDeleted);
    window.addEventListener("agensis:session-created", onCreated);
    window.addEventListener("agensis:sessions-reordered", onReordered);
    return () => {
      window.removeEventListener("agensis:session-updated", onUpdated);
      window.removeEventListener("agensis:session-deleted", onDeleted);
      window.removeEventListener("agensis:session-created", onCreated);
      window.removeEventListener("agensis:sessions-reordered", onReordered);
    };
  });
  const openSplitForSession = (
    id: string,
    side: "left" | "right" | "top" | "bottom" = splitSide,
  ) => {
    setSplitSessionId(id);
    setSplitSide(side);
    setSplitPane("session");
    void loadFarmSession(id);
  };
  const refreshReview = async (preferredPath?: string) => {
    setReviewLoading(true);
    setReviewError(null);
    try {
      const snapshot = await invokeNative<WorkspaceDiffSnapshot>(
        "farm.workspace.diff",
      );
      setReviewSnapshot(snapshot);
      const nextPath =
        preferredPath && snapshot.files.some((file) => file.path === preferredPath)
          ? preferredPath
          : snapshot.files.some((file) => file.path === reviewSelectedPath)
            ? reviewSelectedPath
            : snapshot.files[0]?.path || null;
      setReviewSelectedPath(nextPath);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setReviewLoading(false);
    }
  };
  const openReview = (path?: string) => {
    if (path) setReviewSelectedPath(path);
    setSplitPane("review");
    void refreshReview(path);
  };
  const addReviewComment = (sessionId: string, comment: ReviewComment) => {
    setReviewCommentsBySession((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] || []), comment],
    }));
  };
  const removeReviewComment = (sessionId: string, commentId: string) => {
    setReviewCommentsBySession((current) => ({
      ...current,
      [sessionId]: (current[sessionId] || []).filter(
        (comment) => comment.id !== commentId,
      ),
    }));
  };
  const activeEditFingerprint = (active?.messages || [])
    .filter(messageHasFileEdits)
    .flatMap((message) => [
      message.id,
      message.updatedAt || message.createdAt,
      message.status || "",
    ])
    .join(":");
  useEffect(() => {
    if (activeEditFingerprint) void refreshReview();
  }, [activeEditFingerprint]);
  const updateMessage = (
    sessionId: string,
    messageId: string,
    update: Partial<ChatMessage>,
  ) =>
    updateSession(sessionId, (session) => ({
      ...session,
      updatedAt: nowIso(),
      messages: session.messages.map((message) =>
        message.id === messageId ? { ...message, ...update } : message,
      ),
    }));

  const ensureGateway = async () => {
    if (data.gateway.running) return;
    await invokeNative("farm.gateway.start", data.settings);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await refresh();
  };

  const execute = async (
    sessionId: string,
    text: string,
    files: ChatAttachment[] = [],
  ) => {
    let source = sessions.find((session) => session.id === sessionId);
    if (!source?.model || !text.trim()) return;
    // Adopt-on-use (spec B): the first send into a peeked native transcript
    // captures it as a Farm session, then the normal send flow continues.
    if (peekInfoRef.current.has(sessionId)) {
      const adopted = await adoptPeekedSession(sessionId);
      if (!adopted) return;
      source = adopted;
    }
    const createdAt = nowIso();
    const user: ChatMessage = {
      id: uid(),
      role: "user",
      content: text.trim(),
      attachments: files,
      createdAt,
      model: source.model,
      status: "complete",
    };
    const assistant: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: "",
      createdAt: nowIso(),
      model: source.model,
      status: "streaming",
      members: [],
    };
    const history = [...source.messages, user];
    // Catalog cascade extras (spec D): only a pick that is valid for the
    // route's provider rides along — elevator/command routes send neither.
    const dispatchProvider = routeProviderId(data, source.model);
    const dispatchPick = dispatchProvider
      ? catalogModel(catalog, dispatchProvider, source.catalogModel || "")
      : null;
    // Send the effort the composer is SHOWING. It displays the model's
    // defaultEffort when the session has no explicit tier, so dispatching only
    // `source.effort` meant the picker read "High" while the request carried
    // no --effort at all.
    const dispatchEffort = dispatchPick
      ? source.effort && dispatchPick.efforts?.includes(source.effort)
        ? source.effort
        : dispatchPick.defaultEffort || ""
      : source.effort || "";
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.messages.length ? session.title : text.trim().slice(0, 52),
      updatedAt: createdAt,
      messages: [...session.messages, user, assistant],
    }));
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Hoisted so a mid-stream failure (or a stop) can KEEP what already
    // streamed instead of replacing the whole message with an error line.
    let content = "";
    let members: ChatMemberTrace[] = [];
    let finalUsage: ChatUsage | undefined;
    // Reasoning and tools arrive as DELTAS on the chunks that carry them —
    // the gateway sends bare {content} chunks in between. Accumulate here;
    // writing `farm?.reasoning` straight through erased the trace on the
    // very next token.
    let reasoning = "";
    let tools: ChatToolEvent[] = [];
    try {
      await ensureGateway();
      const response = await fetch(`${data.gateway.url}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(data.settings.apiKeys?.[0]?.key
            ? { authorization: `Bearer ${data.settings.apiKeys[0].key}` }
            : {}),
        },
        body: JSON.stringify({
          model: source.model,
          stream: true,
          messages: history.map((message) => ({
            role: message.role,
            content: attachmentContent(message),
          })),
          farm: {
            session_id: sessionId,
            permissions: source.permissions,
            sandbox: source.sandbox || "workspace-write",
            network: source.network || "ask",
            tool_permissions: source.toolPermissions || {},
            tools: source.toolsEnabled,
            mode: source.mode || "chat",
            thinking: source.thinking || "auto",
            // Land the agent in the open project — not ~/.claude-farm/work.
            ...(workspaceRoot ? { cwd: workspaceRoot } : {}),
            ...(dispatchPick ? { model: dispatchPick.id } : {}),
            ...(dispatchEffort ? { effort: dispatchEffort } : {}),
          },
        }),
      });
      if (!response.ok || !response.body) {
        const raw = await response.text();
        let message = raw || `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(raw);
          message = parsed?.error?.message || message;
        } catch {
          /* preserve plain-text errors */
        }
        throw new Error(message);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const split = parseSseFrames(buffer);
        buffer = split.rest;
        for (const frame of split.frames) {
          const chunk = frame as any;
          const delta = chunk.choices?.[0]?.delta || {};
          content += delta.content || "";
          const farm = delta.farm;
          if (farm?.event) members = applyTraceEvent(members, farm.event);
          if (farm?.reasoning) reasoning += farm.reasoning;
          if (farm?.tools?.length) tools = mergeToolEvents(tools, farm.tools);
          if (chunk.usage) finalUsage = chatUsage(chunk.usage);
          updateMessage(sessionId, assistant.id, {
            content,
            reasoning,
            tools,
            members,
            usage: finalUsage,
            status: "streaming",
            updatedAt: nowIso(),
          });
        }
      }
      updateMessage(sessionId, assistant.id, {
        content: content || "The route completed without text output.",
        reasoning,
        tools,
        members,
        usage: finalUsage,
        status: "complete",
        updatedAt: nowIso(),
      });
    } catch (error) {
      const stopped = controller.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      const note = stopped ? "Response stopped." : `Gateway error: ${message}`;
      updateMessage(sessionId, assistant.id, {
        // Keep the partial answer and append the reason — a failure after 2k
        // streamed tokens used to throw all of them away.
        content: content ? `${content}\n\n_${note}_` : note,
        reasoning,
        tools,
        members,
        usage: finalUsage,
        status: stopped ? "stopped" : "error",
        updatedAt: nowIso(),
      });
      if (!stopped) notify(message);
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  useEffect(() => {
    if (streaming || !active?.queue.length) return;
    const next = active.queue[0];
    const timer = window.setTimeout(() => {
      updateSession(active.id, (session) => ({
        ...session,
        queue: session.queue.slice(1),
      }));
      void execute(active.id, next.text, next.attachments);
    }, 80);
    return () => clearTimeout(timer);
  }, [streaming, active?.id, active?.queue.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!active || !input.trim()) return;
    if (editingId) {
      updateMessage(active.id, editingId, {
        content: input.trim(),
        updatedAt: nowIso(),
      });
      setEditingId(null);
      setInput("");
      return;
    }
    const text = input.trim();
    const files = attachments;
    setInput("");
    setAttachments([]);
    if (streaming)
      updateSession(active.id, (session) => ({
        ...session,
        queue: [
          ...session.queue,
          { id: uid(), text, attachments: files, createdAt: nowIso() },
        ],
      }));
    else void execute(active.id, text, files);
  };
  const stop = () => abortRef.current?.abort();
  const steer = (id: string) => {
    if (!active) return;
    const item = active.queue.find((queued) => queued.id === id);
    if (!item) return;
    updateSession(active.id, (session) => ({
      ...session,
      queue: session.queue.filter((queued) => queued.id !== id),
    }));
    abortRef.current?.abort();
    window.setTimeout(
      () => void execute(active.id, item.text, item.attachments),
      120,
    );
  };
  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next = await Promise.all(
      [...list].map(
        (file) =>
          new Promise<ChatAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () =>
              resolve({
                id: uid(),
                name: file.name,
                mediaType: file.type || "application/octet-stream",
                url: String(reader.result),
                size: file.size,
              });
            reader.readAsDataURL(file);
          }),
      ),
    );
    setAttachments((current) => [...current, ...next]);
  };
  // Native file drops (task #10): the shell swallows macOS drops and re-emits
  // them over the SDK event bus as "drop:files" with absolute host paths; the
  // bridge reads each file so it joins the same attachment flow as browser
  // drops.
  const attachDroppedPaths = async (paths: string[]) => {
    const batch = paths.slice(0, MAX_DROPPED_FILES);
    if (paths.length > batch.length)
      notify(
        `Attached the first ${MAX_DROPPED_FILES} of ${paths.length} dropped files.`,
      );
    const results = await Promise.all(
      batch.map(async (path): Promise<ChatAttachment | null> => {
        const basename = path.split(/[\\/]/).filter(Boolean).pop() || path;
        try {
          const file = await invokeNative<{
            name: string;
            mime: string;
            size?: number;
            base64: string;
          }>("farm.file.read", { path });
          const mediaType = file.mime || "application/octet-stream";
          return {
            id: uid(),
            name: file.name || basename,
            mediaType,
            url: `data:${mediaType};base64,${file.base64}`,
            size:
              typeof file.size === "number"
                ? file.size
                : Math.floor(((file.base64 || "").length * 3) / 4),
          };
        } catch (error) {
          notify(
            `${basename}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
      }),
    );
    const next = results.filter(
      (file): file is ChatAttachment => file !== null,
    );
    if (next.length) setAttachments((current) => [...current, ...next]);
  };
  useEffect(() => {
    // lib/native.ts only declares invoke — widen the on/off event surface
    // locally instead of touching the shared declaration.
    const zero = window.zero as
      | (NonNullable<typeof window.zero> & {
          on?: (name: string, cb: (detail: unknown) => void) => void;
          off?: (name: string, cb: (detail: unknown) => void) => void;
        })
      | undefined;
    if (!zero?.on) return;
    const onFilesDropped = (detail: unknown) => {
      const paths = (detail as { paths?: unknown } | null)?.paths;
      if (!Array.isArray(paths)) return;
      const usable = paths.filter(
        (path): path is string => typeof path === "string" && path.length > 0,
      );
      if (usable.length) void attachDroppedPaths(usable);
    };
    zero.on("drop:files", onFilesDropped);
    return () => zero.off?.("drop:files", onFilesDropped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const slash = input.match(/(?:^|\s)\/([\w-]*)$/)?.[1];
  const mention = input.match(/(?:^|\s)@([\w/-]*)$/)?.[1];
  const commands = [
    { id: "new", label: "New session" },
    { id: "clear", label: "Clear messages" },
    { id: "stop", label: "Stop response" },
    { id: "permissions", label: "Set permissions" },
  ].filter((item) => slash == null || item.id.includes(slash));
  const applyCommand = (id: string) => {
    setInput((value) => value.replace(/(?:^|\s)\/[\w-]*$/, "").trimStart());
    if (id === "new") newSession();
    if (id === "clear" && active)
      updateSession(active.id, (session) => ({
        ...session,
        messages: [],
        queue: [],
      }));
    if (id === "stop") stop();
  };
  const duplicateSession = () => {
    const createdAt = nowIso();
    const copy: ChatSession = {
      ...structuredClone(active),
      id: uid(),
      title: `${active.title} copy`,
      createdAt,
      updatedAt: createdAt,
      queue: [],
    };
    setSessions((current) => [copy, ...current]);
    setActiveId(copy.id);
  };
  const startResize = (
    side: "left" | "right",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const companionWidth = side === "left" ? rightWidth : leftWidth;
    const setWidth = side === "left" ? setLeftWidth : setRightWidth;
    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX;
      const desired = startWidth + (side === "left" ? delta : -delta);
      const maximum = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(
          MAX_SIDEBAR_WIDTH,
          window.innerWidth - companionWidth - MIN_WORKSPACE_WIDTH,
        ),
      );
      setWidth(Math.min(maximum, Math.max(MIN_SIDEBAR_WIDTH, desired)));
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
  const startJobsResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = jobsPanelWidth;
    const onMove = (move: PointerEvent) => {
      const desired = startWidth + (move.clientX - startX);
      setJobsPanelWidth(
        Math.min(JOBS_PANEL_MAX_WIDTH, Math.max(JOBS_PANEL_MIN_WIDTH, desired)),
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
  const startSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const horizontal = splitSide === "top" || splitSide === "bottom";
    const startCoordinate = horizontal ? event.clientY : event.clientX;
    const startWidth = splitWidth;
    const direction = splitSide === "left" || splitSide === "top" ? 1 : -1;
    const onMove = (move: PointerEvent) => {
      const coordinate = horizontal ? move.clientY : move.clientX;
      const desired = startWidth + (coordinate - startCoordinate) * direction;
      const maximum = horizontal
        ? Math.max(320, window.innerHeight - 220)
        : Math.max(320, window.innerWidth - leftWidth - rightWidth - 420);
      setSplitWidth(Math.min(maximum, Math.max(280, desired)));
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
  // Codex-style starter cards: colored glyph + short category, prefilling a
  // concrete prompt.
  const suggestions = [
    {
      icon: Columns2Icon,
      color: "text-primary",
      text: "Explore and understand code",
      prompt: "Explore this codebase and explain how it fits together",
    },
    {
      icon: SparklesIcon,
      color: "text-[#8c63e8]",
      text: "Build a new feature, app, or tool",
      prompt: "Build a new feature: ",
    },
    {
      icon: ShieldCheckIcon,
      color: "text-success",
      text: "Review code and suggest changes",
      prompt: "Review the latest changes and suggest improvements",
    },
    {
      icon: PaperclipIcon,
      color: "text-signal",
      text: "Fix issues and failures",
      prompt: "Find and fix the failing parts of this project",
    },
  ];
  const composerHint = useRotatingComposerHint(
    [
      "Compare these routes and show where they disagree",
      "Design a specialist route for this codebase",
      "Audit the active route's tools and MCP access",
      "Test this route with a structured answer",
    ],
    !input && attachments.length === 0 && !editingId,
  );
  // Farm rows for the unified Jobs list: every known session except the
  // read-only native peeks, reshaped into store-meta rows (spec B).
  const jobsFarmRows = useMemo<FarmSessionMeta[]>(
    () =>
      sessions
        .filter((session) => !peekInfoRef.current.has(session.id))
        .map((session) => ({
          id: session.id,
          title: session.title,
          model: session.model,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          project: session.project ?? null,
          pinned: Boolean(session.pinned),
          permissions: session.permissions,
          effort: session.effort,
          source: session.source,
          originPath: session.originPath,
          importedAt: session.importedAt,
          messageCount: session.messages.length,
        })),
    [sessions],
  );
  const visibleSessions = [...sessions]
    .filter((session) =>
      `${session.title} ${session.model}`
        .toLowerCase()
        .includes(sessionSearch.trim().toLowerCase()),
    )
    .filter(
      (session) =>
        sessionFilter === "all" ||
        (sessionFilter === "custom"
          ? data.settings.routes.some(
              (route) =>
                route.id === session.model && route.transport === "hybrid",
            )
          : !data.settings.routes.some(
              (route) =>
                route.id === session.model && route.transport === "hybrid",
            )),
    )
    .sort((a, b) =>
      sessionSort === "title"
        ? a.title.localeCompare(b.title)
        : sessionSort === "oldest"
          ? a.updatedAt.localeCompare(b.updatedAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const loadedSessions = visibleSessions.slice(0, sessionLimit);
  const visibleAccounts = data.accounts.filter((account) =>
    account.name.toLowerCase().includes(workspaceSearch.trim().toLowerCase()),
  );
  // Host first (this Mac), then elevators, then silos — group labels render
  // as type-label eyebrows in the composer's silo submenu.
  const hostProviders = data.host?.providers?.length
    ? data.host.providers
    : [];
  const containerChoices = [
    // Auto leads: it is the recommended target, and it is the only one where
    // the silo is chosen for you while your model pick still applies.
    ...(hasRotaLanes(data)
      ? [
          {
            id: "rota",
            label: "Auto — rotate silos",
            group: "Auto",
            providers: ["claude"],
          },
        ]
      : []),
    ...(hostProviders.length
      ? [
          {
            id: "host",
            label: "Host (this Mac)",
            group: "Host",
            providers: hostProviders,
          },
        ]
      : []),
    ...data.settings.routes
      .filter((route) => route.transport === "hybrid")
      .map((route) => ({
        id: route.id,
        label: route.label || route.id,
        group: "Elevators",
        providers: route.members || [],
      })),
    ...data.accounts.map((account) => ({
      id: account.name,
      label: account.name,
      group: "Silos",
      providers: account.providers,
    })),
  ];
  // New-job menu groups (task #9): elevators first, then one group per silo
  // with its provider routes; direct CLI/custom routes keep a tail group so
  // nothing the flat list offered goes missing.
  const elevatorRoutes = data.settings.routes.filter(
    (route) => route.transport === "hybrid",
  );
  const otherRoutes = data.settings.routes.filter(
    (route) => route.transport !== "hybrid",
  );
  const activeContainer = active.model.includes("/")
    ? active.model.slice(active.model.indexOf("/") + 1)
    : active.model;
  const activeIsHost = activeContainer === "host";
  const activeAccount = data.accounts.find(
    (account) => account.name === activeContainer,
  );
  const activeGroupRoute = data.settings.routes.find(
    (route) => route.id === active.model && route.transport === "hybrid",
  );
  const modelChoices = activeGroupRoute?.members?.length
    ? activeGroupRoute.members
    : activeIsHost
      ? hostProviders.map((provider) => `${provider}/host`)
      : activeAccount?.providers.map(
          (provider) => `${provider}/${activeAccount.name}`,
        ) || models;
  const setContainer = (containerId: string) => {
    // Auto routes ARE the route id — there is no provider/account to compose.
    if (AUTO_ROUTE_IDS.includes(containerId))
      return updateSession(active.id, (session) => ({
        ...session,
        model: containerId,
      }));
    if (containerId === "host") {
      const provider = hostProviders[0];
      if (!provider) return;
      return updateSession(active.id, (session) => ({
        ...session,
        model: `${provider}/host`,
      }));
    }
    const group = data.settings.routes.find(
      (route) => route.id === containerId && route.transport === "hybrid",
    );
    if (group)
      return updateSession(active.id, (session) => ({
        ...session,
        model: group.id,
      }));
    const account = data.accounts.find((item) => item.name === containerId);
    if (account?.providers[0])
      updateSession(active.id, (session) => ({
        ...session,
        model: `${account.providers[0]}/${account.name}`,
      }));
  };
  const splitSession =
    sessions.find((session) => session.id === splitSessionId) || active;
  // The ACTIVE session's real execution graph — session → route → only the
  // silos that route actually reaches → each silo's equipped kit. Nothing
  // decorative: every node here answers "what runs this job".
  const activeGroupRouteForGraph = data.settings.routes.find(
    (route) => route.id === active.model && route.transport === "hybrid",
  );
  const involvedSiloNames = activeGroupRouteForGraph?.members?.length
    ? activeGroupRouteForGraph.members.map((member) =>
        member.includes("/") ? member.slice(member.indexOf("/") + 1) : member)
    : active.model
      ? [active.model.includes("/") ? active.model.slice(active.model.indexOf("/") + 1) : active.model]
      : [];
  const involvedAccounts = data.accounts.filter((account) => involvedSiloNames.includes(account.name));
  const topologyNodes: TopologyNode[] = [
    {
      id: "session",
      label: active.title,
      kind: "session",
      detail: active.model,
    },
    ...(active.model
      ? [
          {
            id: "route",
            label: active.model,
            kind: "route" as const,
            detail: activeGroupRouteForGraph ? "Group route" : "Direct silo route",
          },
        ]
      : []),
    ...involvedAccounts.map((account) => ({
      id: `account:${account.name}`,
      label: account.name,
      kind: "account" as const,
      detail: account.providers.join(" · "),
    })),
    ...involvedAccounts
      .filter((account) => account.profile)
      .map((account) => ({
        id: `kit:${account.profile}`,
        label: account.profile as string,
        kind: "skill" as const,
        detail: "Equipment kit",
      })),
  ];
  const topologyEdges: TopologyEdge[] = [
    ...(active.model
      ? [{ source: "session", target: "route", label: "runs" }]
      : []),
    ...involvedAccounts.map((account) => ({
      source: "route",
      target: `account:${account.name}`,
      label: activeGroupRouteForGraph ? "member" : "runs on",
    })),
    ...involvedAccounts
      .filter((account) => account.profile)
      .map((account) => ({
        source: `account:${account.name}`,
        target: `kit:${account.profile}`,
        label: "equipped",
      })),
  ];
  if (!active) return null;


  const renderConversationPane = (paneSession: ChatSession) => {
    const paneReviewComments = reviewCommentsBySession[paneSession.id] || [];
    const latestEditedMessageId = [...paneSession.messages]
      .reverse()
      .find(messageHasFileEdits)?.id;
    const paneContainer = paneSession.model.includes("/")
      ? paneSession.model.slice(paneSession.model.indexOf("/") + 1)
      : paneSession.model;
    const paneIsHost = paneContainer === "host";
    // Auto routes have no account to look up — the gateway picks the silo per
    // request. The model/effort cascade must still render, which is the whole
    // point of "rotate the silo, keep my model".
    const paneIsAuto = AUTO_ROUTE_IDS.includes(paneSession.model);
    const paneAccount = paneIsHost
      ? {
          name: "host",
          providers: hostProviders,
          profile: null,
          appliedAt: null,
          running: true,
        }
      : data.accounts.find((account) => account.name === paneContainer);
    const paneGroupRoute = data.settings.routes.find(
      (route) =>
        route.id === paneSession.model && route.transport === "hybrid",
    );
    const activeContainer = paneContainer;
    const activeGroupRoute = paneGroupRoute;
    const modelChoices = paneGroupRoute?.members?.length
      ? paneGroupRoute.members
      : paneIsHost
        ? hostProviders.map((provider) => `${provider}/host`)
        : paneAccount?.providers.map(
            (provider) => `${provider}/${paneAccount.name}`,
          ) || models;
    // Composer cascade (spec D): silo → provider → model → effort. Elevator
    // and command routes have no provider segment, so the cascade collapses
    // to the silo row alone (the route decides internally).
    const paneRoute = data.settings.routes.find(
      (route) => route.id === paneSession.model,
    );
    const paneProviderId = routeProviderId(data, paneSession.model);
    const paneCatalogProvider = paneProviderId
      ? catalogProvider(catalog, paneProviderId)
      : null;
    const panePick = paneProviderId
      ? catalogModel(catalog, paneProviderId, paneSession.catalogModel || "")
      : null;
    const paneEfforts = panePick?.efforts || [];
    const paneEffort =
      paneSession.effort && paneEfforts.includes(paneSession.effort)
        ? paneSession.effort
        : panePick?.defaultEffort || "";
    // Green happy path (task #7): manual panes score as "auto" so the
    // recommended rows stay marked even before the user opts in.
    const paneSelectionMode: SelectionMode =
      selectionModes[paneSession.id] || "manual";
    const paneRecommendation =
      paneSession.id === active.id
        ? activeRecommendation
        : recommendSelection(
            paneSelectionMode === "manual" ? "auto" : paneSelectionMode,
            data.accounts,
            catalog,
          );
    const setPaneModel = (model: string) => {
      // An explicit route pick always returns the session to manual mode.
      setSelectionMode(paneSession.id, "manual");
      // Silo/provider moves keep the catalog pick only while it stays valid
      // for the new route's provider; effort follows the same rule.
      const nextProvider = routeProviderId(data, model);
      const nextPick = nextProvider
        ? catalogModel(catalog, nextProvider, paneSession.catalogModel || "")
        : null;
      updateSession(paneSession.id, (session) => ({
        ...session,
        model,
        catalogModel: nextPick ? session.catalogModel : undefined,
        effort:
          session.effort && nextPick?.efforts?.includes(session.effort)
            ? session.effort
            : undefined,
      }));
    };
    const setContainerPane = (containerId: string) => {
      if (AUTO_ROUTE_IDS.includes(containerId)) return setPaneModel(containerId);
      if (containerId === "host") {
        const provider = hostProviders.includes(paneProviderId || "")
          ? paneProviderId
          : hostProviders[0];
        if (provider) setPaneModel(`${provider}/host`);
        return;
      }
      const group = data.settings.routes.find(
        (route) => route.id === containerId && route.transport === "hybrid",
      );
      if (group) return setPaneModel(group.id);
      const account = data.accounts.find((item) => item.name === containerId);
      const provider = account?.providers.includes(paneProviderId || "")
        ? paneProviderId
        : account?.providers[0];
      if (account && provider) setPaneModel(`${provider}/${account.name}`);
    };
    const submitPane = (event: FormEvent) => {
      event.preventDefault();
      if (!input.trim() && !paneReviewComments.length) return;
      if (editingId) {
        updateMessage(paneSession.id, editingId, {
          content: input.trim(),
          updatedAt: nowIso(),
        });
        setEditingId(null);
        setInput("");
        return;
      }
      const commentContext = paneReviewComments.length
        ? [
            "Review comments:",
            ...paneReviewComments.map(
              (comment) =>
                `- ${comment.file}:R${comment.line} (${comment.side}) â ${comment.body}`,
            ),
          ].join("\n")
        : "";
      const text = [input.trim(), commentContext].filter(Boolean).join("\n\n");
      const files = attachments;
      setInput("");
      setAttachments([]);
      if (paneReviewComments.length) {
        setReviewCommentsBySession((current) => ({
          ...current,
          [paneSession.id]: [],
        }));
      }
      if (streaming) {
        updateSession(paneSession.id, (session) => ({
          ...session,
          queue: [
            ...session.queue,
            { id: uid(), text, attachments: files, createdAt: nowIso() },
          ],
        }));
      } else {
        void execute(paneSession.id, text, files);
      }
    };
    const steerPane = (id: string) => {
      const item = paneSession.queue.find((queued) => queued.id === id);
      if (!item) return;
      updateSession(paneSession.id, (session) => ({
        ...session,
        queue: session.queue.filter((queued) => queued.id !== id),
      }));
      abortRef.current?.abort();
      window.setTimeout(
        () => void execute(paneSession.id, item.text, item.attachments),
        120,
      );
    };
    // Workspace starters (task #8): live recommendations lead — proposed
    // harvest suggestions, unfinished crew assignments, jobs with queued
    // work — and the generic prompts fill whatever slots remain.
    const queuedStarterSessions = sessions.filter(
      (session) => session.queue.length > 0 && session.id !== paneSession.id,
    );
    const liveStarters = [
      ...harvestProposed.map((suggestion) => ({
        key: `harvest:${suggestion.id}`,
        icon: WheatIcon,
        color: "text-success",
        text: suggestion.title,
        caption: firstSentence(suggestion.summary),
        onClick: () =>
          setInput(
            `Act on this ${vocab.harvest.toLowerCase()} suggestion: ${suggestion.title} - ${suggestion.summary}`,
          ),
      })),
      ...crewUnfinished.map((assignment) => ({
        key: `crew:${assignment.id}`,
        icon: UsersIcon,
        color: "text-primary",
        text: `Continue: ${assignment.title}`,
        caption: [assignment.silo, assignment.status]
          .filter(Boolean)
          .join(" · "),
        onClick: () => {
          setContainerPane(assignment.silo);
          setInput(`Continue: ${assignment.title}`);
        },
      })),
      ...queuedStarterSessions.map((session) => ({
        key: `queued:${session.id}`,
        icon: HistoryIcon,
        color: "text-signal",
        text: session.title,
        caption: `${session.queue.length} queued · ${relativeTime(session.updatedAt, clock)}`,
        onClick: () => activateSession(session.id),
      })),
    ];
    const starterCards = [
      ...liveStarters,
      ...suggestions.map((suggestion) => ({
        key: suggestion.text,
        icon: suggestion.icon,
        color: suggestion.color,
        text: suggestion.text,
        caption: "",
        onClick: () => setInput(suggestion.prompt),
      })),
    ].slice(0, liveStarters.length ? 6 : 4);

    return (
                <div
                  className={cn(
                    "relative flex min-w-0 flex-1 flex-col",
                    dropActive && "ring-1 ring-inset ring-primary/60",
                  )}
                  onDragOver={(event) => {
                    // Best effort — native drops are re-emitted by the shell
                    // and may never fire dragover; browser drags do.
                    if (!event.dataTransfer.types.includes("Files")) return;
                    event.preventDefault();
                    setDropActive(true);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    )
                      setDropActive(false);
                  }}
                  onDrop={(event) => {
                    setDropActive(false);
                    if (event.defaultPrevented) return;
                    if (event.dataTransfer.files.length) {
                      event.preventDefault();
                      void addFiles(event.dataTransfer.files);
                    }
                  }}
                >
                  <Conversation key={paneSession.id} className="scrollbar-none">
                    <ConversationContent
                      className="mx-auto w-full max-w-[960px] gap-10 px-8 pb-48 pt-12"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        if (!event.dataTransfer.files.length) return;
                        event.preventDefault();
                        void addFiles(event.dataTransfer.files);
                      }}
                    >
                      {paneSession.messages.length ? (
                        paneSession.messages.map((message) => (
                          <Message
                            key={message.id}
                            from={message.role}
                            className="max-w-full"
                          >
                            {message.attachments?.length ? (
                              <div className="flex flex-wrap justify-end gap-2">
                                {message.attachments.map((file) => (
                                  <div
                                    key={file.id}
                                    className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-xs"
                                  >
                                    {file.mediaType.startsWith("image/") ? (
                                      <img
                                        src={file.url}
                                        alt={file.name}
                                        className="size-9 rounded object-cover"
                                      />
                                    ) : (
                                      <FileIcon className="size-4" />
                                    )}
                                    <span className="max-w-40 truncate">
                                      {file.name}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <MessageContent>
                              {message.members?.length ? (
                                <ModelTrace
                                  members={message.members}
                                  usage={message.usage}
                                  streaming={message.status === "streaming"}
                                />
                              ) : message.reasoning ? (
                                <Reasoning streaming={message.status === "streaming"}>
                                  <ReasoningTrigger
                                    streaming={message.status === "streaming"}
                                  />
                                  <ReasoningContent>
                                    {message.reasoning}
                                  </ReasoningContent>
                                </Reasoning>
                              ) : null}
                              {message.tools?.length ? (
                                <GroupedTools tools={message.tools} />
                              ) : null}
                              {message.role === "assistant" ? (
                                <MessageResponse>
                                  {message.content ||
                                    (message.status === "streaming"
                                      ? ""
                                      : "No output")}
                                </MessageResponse>
                              ) : (
                                <div className="whitespace-pre-wrap">
                                  {message.content}
                                </div>
                              )}
                            </MessageContent>
                            {message.id === latestEditedMessageId &&
                            reviewSnapshot?.files.length ? (
                              <ReviewSummaryCard
                                snapshot={reviewSnapshot}
                                onReview={openReview}
                              />
                            ) : null}
                            <div
                              className={cn(
                                "flex items-center gap-2",
                                message.role === "user" && "justify-end",
                              )}
                            >
                              <MessageMeta
                                title={new Date(message.createdAt).toLocaleString()}
                              >
                                {relativeTime(message.createdAt, clock)}
                                {message.model ? ` · ${message.model}` : ""}
                                {message.usage
                                  ? ` · ${message.usage.estimated ? "about " : ""}${message.usage.totalTokens.toLocaleString()} tokens`
                                  : ""}
                                {message.status && message.status !== "complete"
                                  ? ` · ${message.status}`
                                  : ""}
                              </MessageMeta>
                              <MessageActions>
                                <MessageAction
                                  label="Copy"
                                  onClick={() =>
                                    navigator.clipboard.writeText(message.content)
                                  }
                                >
                                  <CopyIcon />
                                </MessageAction>
                                <MessageAction
                                  label="Helpful"
                                  className={cn(message.feedback === "up" && "bg-muted text-foreground")}
                                  onClick={() =>
                                    updateMessage(paneSession.id, message.id, {
                                      feedback: message.feedback === "up" ? undefined : "up",
                                    })
                                  }
                                >
                                  <ThumbsUpIcon />
                                </MessageAction>
                                <MessageAction
                                  label="Not helpful"
                                  className={cn(message.feedback === "down" && "bg-muted text-foreground")}
                                  onClick={() =>
                                    updateMessage(paneSession.id, message.id, {
                                      feedback: message.feedback === "down" ? undefined : "down",
                                    })
                                  }
                                >
                                  <ThumbsDownIcon />
                                </MessageAction>
                                <MessageAction
                                  label="Open in side panel"
                                  onClick={() => openSplitForSession(paneSession.id)}
                                >
                                  <Maximize2Icon />
                                </MessageAction>
                              </MessageActions>
                            </div>
                          </Message>
                        ))
                      ) : (
                        <div className="m-auto flex w-full max-w-2xl flex-col items-center pb-20 text-center">
                          <h2 className="text-balance type-title">
                            {workspaceName ? (
                              <>
                                What should we do next in{" "}
                                <span className="border-b border-dotted border-muted-foreground">
                                  {workspaceName}
                                </span>
                                ?
                              </>
                            ) : (
                              <>
                                What should{" "}
                                <span className="border-b border-dotted border-muted-foreground">
                                  {paneSession.model || "this route"}
                                </span>{" "}
                                do?
                              </>
                            )}
                          </h2>
                          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                            Use an account directly, compose a specialist, or exercise
                            any streamable CLI. This session keeps its own mode,
                            permissions, tools, and queue.
                          </p>
                          <div
                            className={cn(
                              "mt-8 grid w-full grid-cols-2 gap-3 text-left",
                              starterCards.length > 4
                                ? "lg:grid-cols-3"
                                : "lg:grid-cols-4",
                            )}
                          >
                            {starterCards.map((card) => {
                              const CardIcon = card.icon;
                              return (
                                <button
                                  key={card.key}
                                  onClick={card.onClick}
                                  className="flex items-start gap-3 panel-depth rounded-lg border bg-card px-3.5 py-3 text-left transition-shadow hover:shadow-md hover:shadow-black/10"
                                >
                                  <CardIcon className={cn("mt-0.5 size-4 shrink-0", card.color)} />
                                  <span className="min-w-0 flex-1">
                                    <span className="line-clamp-2 type-list leading-snug">
                                      {card.text}
                                    </span>
                                    {card.caption && (
                                      <span className="mt-0.5 line-clamp-2 type-caption">
                                        {card.caption}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </ConversationContent>
                  </Conversation>

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/95 to-transparent px-5 pb-5 pt-16">
                    <div className="pointer-events-auto mx-auto flex max-w-[760px] flex-col gap-2">
                      {paneSession.queue.length > 0 && (
                        <Queue>
                          <QueueHeader count={paneSession.queue.length} />
                          {paneSession.queue.map((item) => (
                            <QueueItem
                              key={item.id}
                              actions={
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => steerPane(item.id)}
                                  >
                                    Steer now
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Remove queued message"
                                    onClick={() =>
                                      updateSession(paneSession.id, (session) => ({
                                        ...session,
                                        queue: session.queue.filter(
                                          (queued) => queued.id !== item.id,
                                        ),
                                      }))
                                    }
                                  >
                                    <XIcon />
                                  </Button>
                                </>
                              }
                            >
                              {item.text}
                            </QueueItem>
                          ))}
                        </Queue>
                      )}
                      {(slash != null || mention != null) && (
                        <div className="overflow-hidden rounded-lg border bg-popover p-1 shadow-xl">
                          {slash != null
                            ? commands.map((command) => (
                                <button
                                  key={command.id}
                                  type="button"
                                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                                  onClick={() => applyCommand(command.id)}
                                >
                                  <SlashIcon className="size-4 text-muted-foreground" />
                                  <span>
                                    <strong>/{command.id}</strong>{" "}
                                    <span className="text-muted-foreground">
                                      {command.label}
                                    </span>
                                  </span>
                                </button>
                              ))
                            : models
                                .filter((model) => model.includes(mention || ""))
                                .slice(0, 8)
                                .map((model) => (
                                  <button
                                    key={model}
                                    type="button"
                                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                                    onClick={() => {
                                      setSelectionMode(paneSession.id, "manual");
                                      updateSession(paneSession.id, (session) => ({
                                        ...session,
                                        model,
                                      }));
                                      setInput((value) =>
                                        value
                                          .replace(/(?:^|\s)@[\w/-]*$/, "")
                                          .trimStart(),
                                      );
                                    }}
                                  >
                                    <AtSignIcon className="size-4 text-muted-foreground" />
                                    <span className="font-mono text-xs">{model}</span>
                                  </button>
                                ))}
                        </div>
                      )}
                      <PromptInput
                        onSubmit={
                          streaming && !input.trim() && !paneReviewComments.length
                            ? (event) => {
                                event.preventDefault();
                                stop();
                              }
                            : submitPane
                        }
                        className="workspace-composer rounded-2xl bg-card p-2.5"
                      >
                        {(attachments.length > 0 || paneReviewComments.length > 0) && (
                          <div className="flex flex-wrap gap-1.5 px-1 pb-1">
                            {attachments.map((file) => (
                              <div
                                key={file.id}
                                className="attachment-context-chip group/chip"
                              >
                                <button
                                  type="button"
                                  aria-label={`Remove ${file.name}`}
                                  onClick={() =>
                                    setAttachments((current) =>
                                      current.filter((item) => item.id !== file.id),
                                    )
                                  }
                                  className="attachment-context-remove"
                                >
                                  <PaperclipIcon className="attachment-context-icon" />
                                  <XIcon className="attachment-context-x" />
                                </button>
                                <span className="max-w-48 truncate">{file.name}</span>
                              </div>
                            ))}
                            {paneReviewComments.map((comment) => (
                              <ReviewCommentChip
                                key={comment.id}
                                comment={comment}
                                onRemove={() =>
                                  removeReviewComment(paneSession.id, comment.id)
                                }
                              />
                            ))}
                          </div>
                        )}
                        <input
                          ref={fileRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(event) => void addFiles(event.target.files)}
                        />
                        <div className="relative">
                          <PromptInputTextarea
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            disabled={!paneSession.model}
                            placeholder=""
                          />
                          {!input && !attachments.length && !paneReviewComments.length && (
                            <div
                              aria-hidden
                              className={cn(
                                "composer-hint",
                                composerHint.visible ? "opacity-100" : "opacity-0",
                              )}
                            >
                              {paneSession.model
                                ? composerHint.text
                                : "Create or select a silo or elevator"}
                            </div>
                          )}
                        </div>
                        <PromptInputFooter>
                          <div className="flex items-center gap-1">
                            <Popover open={contextOpen} onOpenChange={setContextOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="size-7"
                                  aria-label="Add context"
                                >
                                  <PlusIcon className="size-4" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                side="top"
                                align="start"
                                className="max-h-80 w-80 overflow-hidden rounded-lg p-1.5"
                              >
                                <div className="flex items-center gap-2 border-b px-2 py-1.5">
                                  <SearchIcon className="size-3.5 text-muted-foreground" />
                                  <input
                                    autoFocus
                                    value={contextSearch}
                                    onChange={(event) =>
                                      setContextSearch(event.target.value)
                                    }
                                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                                    placeholder="Search context, routes, and tools"
                                  />
                                </div>
                                <div className="scrollbar-none max-h-64 overflow-y-auto py-1">
                                  <button
                                    onClick={() => {
                                      fileRef.current?.click();
                                      setContextOpen(false);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                                  >
                                    <PaperclipIcon className="size-3.5" />
                                    Files and folders
                                  </button>
                                  {[
                                    {
                                      label: "Routes",
                                      values: models,
                                      icon: AtSignIcon,
                                      // Same path as the cascade's silo row —
                                      // a raw `model:` write would leave the
                                      // catalog pick and effort pointing at
                                      // the previous route's provider.
                                      select: setPaneModel,
                                    },
                                    {
                                      label: "Skills",
                                      values: data.catalog.skills,
                                      icon: SlashIcon,
                                      select: (value: string) =>
                                        setInput(
                                          (current) =>
                                            `${current}${current && !current.endsWith(" ") ? " " : ""}/${value} `,
                                        ),
                                    },
                                    {
                                      label: "Tools and MCP",
                                      values: [
                                        ...data.catalog.commands,
                                        ...data.catalog.mcp.map(
                                          (item) => `mcp:${item}`,
                                        ),
                                      ],
                                      icon: WrenchIcon,
                                      select: (value: string) =>
                                        updateSession(paneSession.id, (session) => ({
                                          ...session,
                                          toolPermissions: {
                                            ...(session.toolPermissions || {}),
                                            [value]: "allow",
                                          },
                                        })),
                                    },
                                  ].map((group) => {
                                    const values = group.values
                                      .filter((value) =>
                                        value
                                          .toLowerCase()
                                          .includes(contextSearch.toLowerCase()),
                                      )
                                      .slice(0, 8);
                                    if (!values.length) return null;
                                    return (
                                      <div
                                        key={group.label}
                                        className="mt-1 border-t pt-1"
                                      >
                                        <p className="px-2 py-1 type-label">
                                          {group.label}
                                        </p>
                                        {values.map((value) => (
                                          <button
                                            key={value}
                                            onClick={() => {
                                              group.select(value);
                                              setContextOpen(false);
                                              setContextSearch("");
                                            }}
                                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                                          >
                                            <group.icon className="size-3.5 text-muted-foreground" />
                                            <span className="truncate">{value}</span>
                                          </button>
                                        ))}
                                      </div>
                                    );
                                  })}
                                </div>
                              </PopoverContent>
                            </Popover>
                            <ApprovalsChip
                              value={paneSession.permissions}
                              catalog={catalog}
                              providerId={paneProviderId}
                              onChange={(permissions) =>
                                updateSession(paneSession.id, (session) => ({
                                  ...session,
                                  permissions,
                                }))
                              }
                            />
                            {streaming && (
                              <span className="hidden text-[0.6rem] text-muted-foreground xl:inline">
                                Enter queues
                              </span>
                            )}
                            <div className="ml-auto flex items-center gap-1">
                              {(() => {
                                // Mode toggle (task #7): cycles Auto → Best →
                                // Eco → Manual; the title carries the advisor's
                                // current reasoning.
                                const modeIndex = SELECTION_MODES.findIndex(
                                  (mode) => mode.value === paneSelectionMode,
                                );
                                const current =
                                  SELECTION_MODES[Math.max(0, modeIndex)];
                                const next =
                                  SELECTION_MODES[
                                    (Math.max(0, modeIndex) + 1) %
                                      SELECTION_MODES.length
                                  ];
                                return (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectionMode(
                                        paneSession.id,
                                        next.value,
                                      )
                                    }
                                    title={`${current.description} ${paneRecommendation.reason}`}
                                    aria-label={`Selection mode: ${current.title}. Switch to ${next.title}.`}
                                    className={cn(
                                      "inline-flex h-8 items-center gap-1.5 rounded-full bg-muted/60 px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                                      paneSelectionMode !== "manual" &&
                                        "text-foreground",
                                    )}
                                  >
                                    {paneSelectionMode !== "manual" && (
                                      <span className="size-1.5 shrink-0 rounded-full bg-(--success)" />
                                    )}
                                    {current.title}
                                  </button>
                                );
                              })()}
                              <ComposerAdvanced
                                leading={(() => {
                                  const stack = activeGroupRoute?.members?.length
                                    ? activeGroupRoute.members
                                    : [activeContainer].filter(Boolean);
                                  if (!stack.length) return null;
                                  return (
                                    <span className="flex shrink-0 -space-x-1.5">
                                      {stack.slice(0, 3).map((name) => (
                                        <SiloAvatar
                                          key={name}
                                          name={String(name)}
                                          size="sm"
                                          className="rounded-full border border-background"
                                        />
                                      ))}
                                      {stack.length > 3 && (
                                        <span className="grid size-4.5 place-items-center rounded-full border border-background bg-muted text-[0.55rem] font-medium text-muted-foreground">
                                          +{stack.length - 3}
                                        </span>
                                      )}
                                    </span>
                                  );
                                })()}
                                onReset={() => {
                                  setSelectionMode(paneSession.id, "manual");
                                  updateSession(paneSession.id, (session) => ({
                                    ...session,
                                    model: modelChoices[0] || session.model,
                                    thinking: "auto",
                                    catalogModel: undefined,
                                    effort: undefined,
                                  }));
                                }}
                                triggerLabel={[
                                  containerChoices.find(
                                    (container) =>
                                      container.id ===
                                      (activeGroupRoute?.id || activeContainer),
                                  )?.label ||
                                    (paneIsHost ? "Host" : "silo"),
                                  paneRoute
                                    ? null
                                    : panePick?.label ||
                                      paneCatalogProvider?.label ||
                                      paneProviderId,
                                  paneRoute || !paneEffort
                                    ? null
                                    : effortLabel(paneEffort),
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                                rows={[
                                  {
                                    key: "silo",
                                    label: paneIsHost ? "Target" : "Silo",
                                    icon: <CpuIcon />,
                                    value: activeGroupRoute?.id || activeContainer,
                                    valueLabel:
                                      containerChoices.find(
                                        (container) =>
                                          container.id ===
                                          (activeGroupRoute?.id || activeContainer),
                                      )?.label || "—",
                                    options: containerChoices.map((container) => ({
                                      value: container.id,
                                      label: container.label,
                                      group: container.group,
                                      // Advisor picks are silo-level, so the
                                      // dot never lands on elevator/host rows.
                                      recommended:
                                        container.group === "Silos" &&
                                        container.id ===
                                          paneRecommendation.account,
                                    })),
                                    onChange: setContainerPane,
                                  },
                                  // Elevator/command routes decide provider,
                                  // model, and effort internally — the cascade
                                  // below only exists for direct silo/host routes.
                                  ...(!paneRoute && (paneAccount || paneIsAuto)
                                    ? [
                                        // Auto is claude-only by construction
                                        // (gateway rotaPick), so there is no
                                        // provider to choose — skip straight to
                                        // the model.
                                        ...(paneAccount
                                          ? [{
                                          key: "provider",
                                          label: "Provider",
                                          icon: <PackageIcon />,
                                          value: paneProviderId || "",
                                          valueLabel:
                                            paneCatalogProvider?.label ||
                                            paneProviderId ||
                                            "—",
                                          options: paneAccount.providers.map(
                                            (provider) => ({
                                              value: provider,
                                              label:
                                                catalogProvider(catalog, provider)
                                                  ?.label || provider,
                                              recommended:
                                                !paneIsHost &&
                                                paneAccount.name ===
                                                  paneRecommendation.account &&
                                                provider ===
                                                  paneRecommendation.provider,
                                            }),
                                          ),
                                          onChange: (provider: string) =>
                                            setPaneModel(
                                              `${provider}/${paneAccount.name}`,
                                            ),
                                        }]
                                          : []),
                                        ...(paneCatalogProvider?.models.length
                                          ? [
                                              {
                                                key: "model",
                                                label: "Model",
                                                icon: <SparklesIcon />,
                                                value: panePick?.id || "",
                                                valueLabel:
                                                  panePick?.label || "Default",
                                                options:
                                                  paneCatalogProvider.models.map(
                                                    (model) => ({
                                                      value: model.id,
                                                      label: model.label,
                                                      description: model.id,
                                                      recommended:
                                                        paneProviderId ===
                                                          paneRecommendation.provider &&
                                                        model.id ===
                                                          paneRecommendation.modelId,
                                                    }),
                                                  ),
                                                onChange: (modelId: string) => {
                                                  setSelectionMode(
                                                    paneSession.id,
                                                    "manual",
                                                  );
                                                  const efforts =
                                                    catalogModel(
                                                      catalog,
                                                      paneProviderId || "",
                                                      modelId,
                                                    )?.efforts || [];
                                                  updateSession(
                                                    paneSession.id,
                                                    (session) => ({
                                                      ...session,
                                                      catalogModel: modelId,
                                                      effort:
                                                        session.effort &&
                                                        efforts.includes(
                                                          session.effort,
                                                        )
                                                          ? session.effort
                                                          : undefined,
                                                    }),
                                                  );
                                                },
                                              },
                                            ]
                                          : []),
                                        ...(paneEfforts.length
                                          ? [
                                              {
                                                key: "effort",
                                                label: "Effort",
                                                icon: <GaugeIcon />,
                                                value: paneEffort,
                                                valueLabel: paneEffort
                                                  ? effortLabel(paneEffort)
                                                  : "—",
                                                options: paneEfforts.map(
                                                  (effort) => ({
                                                    value: effort,
                                                    label: effortLabel(effort),
                                                    recommended:
                                                      paneProviderId ===
                                                        paneRecommendation.provider &&
                                                      panePick?.id ===
                                                        paneRecommendation.modelId &&
                                                      effort ===
                                                        paneRecommendation.effort,
                                                  }),
                                                ),
                                                onChange: (effort: string) => {
                                                  setSelectionMode(
                                                    paneSession.id,
                                                    "manual",
                                                  );
                                                  updateSession(
                                                    paneSession.id,
                                                    (session) => ({
                                                      ...session,
                                                      effort,
                                                    }),
                                                  );
                                                },
                                              },
                                            ]
                                          : []),
                                      ]
                                    : []),
                                ]}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {streaming && input.trim() && (
                              <Badge variant="secondary">
                                <ListPlusIcon className="size-3" />
                                will queue
                              </Badge>
                            )}
                            {streaming && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                onClick={stop}
                                aria-label="Stop response"
                              >
                                <SquareIcon />
                              </Button>
                            )}
                            <PromptInputSubmit
                              status="ready"
                              disabled={
                                (!input.trim() && !paneReviewComments.length) ||
                                !paneSession.model
                              }
                            >
                              {streaming ? <ListPlusIcon /> : <SendIcon />}
                            </PromptInputSubmit>
                          </div>
                        </PromptInputFooter>
                      </PromptInput>
                      {editingId && (
                        <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
                          <span>Editing message. Enter saves the change.</span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setInput("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
    );
  };


  return (
    <div className="flex min-h-0 flex-1 bg-background">
      {showNavigationSidebar && leftSidebarOpen && (
        <WorkspaceSidebar
          className="relative shrink-0"
          width={leftWidth}
          projectName={projectName}
          projectPath={data.install.repo}
          sessions={visibleSessions}
          activeSessionId={active.id}
          accounts={data.accounts}
          profiles={data.profiles}
          search={sessionSearch}
          activeView="chat"
          gatewayRunning={data.gateway.running}
          installReady={data.install.ready}
          theme={theme}
          onSearchChange={(value) => {
            setSessionSearch(value);
            setSessionLimit(40);
          }}
          onSelectSession={activateSession}
          onAdoptSession={(id) => void adoptPeekedSession(id)}
          onNewSession={() => newSession()}
          onNavigate={navigate}
          onToggleTheme={toggleTheme}
          onUpdateSession={(id, update) =>
            updateSession(id, (session) => ({ ...session, ...update }))
          }
          onDeleteSession={deleteSession}
          onDuplicateSession={duplicateSessionById}
          onReorderSessions={(ids) =>
            setSessions((current) => {
              const byId = new Map(current.map((session) => [session.id, session]));
              return ids.map((id) => byId.get(id)).filter(Boolean) as ChatSession[];
            })
          }
          onCollapseSidebar={() => setLeftSidebarOpen(false)}
          onResizeSidebar={(event) => startResize("left", event)}
        />
      )}

      {jobsPanelOpen && (
        <aside
          className="relative flex shrink-0 flex-col border-r bg-sidebar"
          style={{ width: jobsPanelWidth }}
        >
          <JobsList
            rows={jobsFarmRows}
            activeId={active.id}
            activeOriginPath={
              peekInfoRef.current.has(active.id) ? active.originPath : undefined
            }
            hasMore={Boolean(farmPage && farmPage.offset < farmPage.total)}
            onLoadMore={() => void loadMoreFarm()}
            onOpen={activateSession}
            onOpenNative={(summary) => void openNativeSession(summary)}
            onAdoptNative={(summary) =>
              void openNativeSession(summary, { adopt: true })
            }
            notify={notify}
          />
          <div
            role="separator"
            aria-label={`Resize ${vocab.jobs} panel`}
            aria-orientation="vertical"
            className="sidebar-resize-handle sidebar-resize-handle-left"
            onPointerDown={startJobsResize}
            onDoubleClick={() => setJobsPanelWidth(JOBS_PANEL_DEFAULT_WIDTH)}
          />
        </aside>
      )}

      <DockDropTarget
        className="relative flex min-w-0 flex-1 flex-col"
        onDrop={(id, zone: DockDropZone) => {
          if (!sessions.some((session) => session.id === id)) return;
          if (zone === "move") {
            activateSession(id);
          } else {
            openSplitForSession(id, zone.replace("split-", "") as "left" | "right" | "top" | "bottom");
          }
        }}
      >
        <header className="drag-region flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
          {showNavigationSidebar && !leftSidebarOpen && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="no-drag shrink-0"
              onClick={() => setLeftSidebarOpen(true)}
              aria-label="Show sidebar"
            >
              <PanelLeftOpenIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="no-drag shrink-0"
            onClick={() => setJobsPanelOpen((open) => !open)}
            aria-label={
              jobsPanelOpen ? `Hide ${vocab.jobs} list` : `Show ${vocab.jobs} list`
            }
          >
            <HistoryIcon className="size-3.5" />
          </Button>
          <DockTabs
            className="no-drag min-w-0 flex-1 border-b-0"
            ariaLabel="Jobs"
            tabs={sessions.map((session) => ({
              id: session.id,
              label: session.title,
              badge:
                session.queue.length > 0 ? (
                  <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-muted px-1 font-mono text-[0.65rem] leading-none text-muted-foreground">
                    {session.queue.length}
                  </span>
                ) : undefined,
            }))}
            activeId={active.id}
            onActivate={activateSession}
            onClose={deleteSession}
            onReorder={(dragged, target) =>
              setSessions((current) => {
                const from = current.findIndex((session) => session.id === dragged);
                const to = current.findIndex((session) => session.id === target);
                if (from < 0 || to < 0 || from === to) return current;
                const next = [...current];
                next.splice(to, 0, next.splice(from, 1)[0]);
                return next;
              })
            }
            onDoubleClick={openSplitForSession}
          />
          <div className="no-drag shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="workspace-new-session"
                  aria-label="Create session with agent"
                >
                  <PlusIcon className="size-3.5" />
                  <ChevronDownIcon className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-96 w-64 overflow-y-auto"
              >
                <DropdownMenuLabel>New {vocab.job.toLowerCase()}</DropdownMenuLabel>
                {hostProviders.length > 0 && (
                  <>
                    <p className="px-2 pb-1 pt-2 type-label">Host</p>
                    {hostProviders.map((provider) => {
                      const route = `${provider}/host`;
                      return (
                        <DropdownMenuItem
                          key={route}
                          onClick={() => newSession(route)}
                        >
                          <TerminalIcon className="size-4" />
                          <span className="min-w-0 flex-1 truncate">
                            {catalogProvider(catalog, provider)?.label ||
                              provider}{" "}
                            · this Mac
                          </span>
                          {active.model === route && (
                            <CheckIcon className="size-3.5" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </>
                )}
                {elevatorRoutes.length > 0 && (
                  <p className="px-2 pb-1 pt-2 type-label">
                    {vocab.siloGroups}
                  </p>
                )}
                {elevatorRoutes.map((route) => (
                  <DropdownMenuItem
                    key={route.id}
                    onClick={() => newSession(route.id)}
                  >
                    <BoxesIcon className="size-4" />
                    <span className="min-w-0 flex-1 truncate">
                      {route.label || route.id}
                    </span>
                    {active.model === route.id && (
                      <CheckIcon className="size-3.5" />
                    )}
                  </DropdownMenuItem>
                ))}
                {data.accounts.map((account) => (
                  <Fragment key={account.name}>
                    <p className="px-2 pb-1 pt-2 type-label">{account.name}</p>
                    {account.providers.map((provider) => {
                      const route = `${provider}/${account.name}`;
                      return (
                        <DropdownMenuItem
                          key={route}
                          onClick={() => newSession(route)}
                        >
                          <TerminalIcon className="size-4" />
                          <span className="min-w-0 flex-1 truncate">
                            {catalogProvider(catalog, provider)?.label ||
                              provider}
                          </span>
                          {active.model === route && (
                            <CheckIcon className="size-3.5" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </Fragment>
                ))}
                {otherRoutes.length > 0 && (
                  <p className="px-2 pb-1 pt-2 type-label">Routes</p>
                )}
                {otherRoutes.map((route) => (
                  <DropdownMenuItem
                    key={route.id}
                    onClick={() => newSession(route.id)}
                  >
                    <TerminalIcon className="size-4" />
                    <span className="min-w-0 flex-1 truncate">
                      {route.label || route.id}
                    </span>
                    {active.model === route.id && (
                      <CheckIcon className="size-3.5" />
                    )}
                  </DropdownMenuItem>
                ))}
                {!models.length && (
                  <DropdownMenuItem disabled>
                    No agents available
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="no-drag ml-auto flex items-center gap-1">
            <div className="flex max-w-52 items-center gap-2 px-2 text-xs text-muted-foreground" aria-label="Active silo">
              <span className={cn("size-1.5 rounded-full", data.gateway.running ? "bg-primary" : "bg-muted-foreground")} />
              <TerminalIcon className="size-3.5" />
              <span className="truncate">{active.model || "No silo selected"}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              aria-label="Split view"
              onClick={() => setSplitPane("empty")}
            >
              <Columns2Icon className="size-3.5" />
            </Button>
            <PermissionStudio
              data={data}
              session={active}
              update={(next) =>
                updateSession(active.id, (session) => ({ ...session, ...next }))
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label="Session actions"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={duplicateSession}>
                  <CopyIcon />
                  Duplicate session
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    updateSession(active.id, (session) => ({
                      ...session,
                      messages: [],
                      queue: [],
                    }))
                  }
                >
                  <RefreshCwIcon />
                  Clear messages
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("profiles")}>
                  <Layers3Icon />
                  Configure profiles
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("gateway")}>
                  <RouteIcon />
                  Manage gateway
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => deleteSession(active.id)}
                >
                  <Trash2Icon />
                  Delete session
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div
          className={cn(
            "relative flex min-h-0 flex-1",
            splitSide === "top" || splitSide === "bottom"
              ? "flex-col"
              : "flex-row",
          )}
        >
          {renderConversationPane(active)}
          {splitPane && (
            <aside
              data-dock-side={splitSide}
              className={cn(
                "workspace-split-pane bg-card",
                splitSide === "left" || splitSide === "right"
                  ? "border-l"
                  : "border-t",
                splitSide === "left" && "order-first border-l-0 border-r",
                splitSide === "top" && "order-first border-t-0 border-b",
              )}
              style={
                splitSide === "left" || splitSide === "right"
                  ? { width: splitWidth }
                  : { width: "100%", height: splitWidth }
              }
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const dragged = event.dataTransfer.getData("text/plain");
                if (
                  dragged &&
                  sessions.some((session) => session.id === dragged)
                ) {
                  openSplitForSession(dragged);
                }
              }}
            >
              <div
                className={cn(
                  "workspace-split-resizer",
                  (splitSide === "top" || splitSide === "bottom") &&
                    "workspace-split-resizer-horizontal",
                )}
                role="separator"
                aria-label="Resize split pane"
                aria-orientation={
                  splitSide === "top" || splitSide === "bottom"
                    ? "horizontal"
                    : "vertical"
                }
                onPointerDown={startSplitResize}
              />
              <div className="flex h-12 items-center justify-between border-b px-3">
                <span className="text-xs font-semibold">
                  {splitPane === "empty" ? "Open in pane" : splitPane}
                </span>
                <button
                  type="button"
                  onClick={() => setSplitPane(null)}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close split pane"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
              {splitPane === "empty" ? (
                <div className="grid h-full place-items-center p-6">
                  <div className="w-full max-w-xs">
                    <Columns2Icon className="mb-4 size-6 text-muted-foreground" />
                    <h2 className="text-base font-semibold">
                      Choose what to open
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      A split starts empty. Open another working surface without
                      changing this session.
                    </p>
                    <div className="mt-5 grid gap-1.5">
                      {[
                        {
                          id: "session",
                          label: "Session",
                          icon: MessageSquarePlusIcon,
                        },
                        {
                          id: "documents",
                          label: "Agentic files",
                          icon: FileTextIcon,
                        },
                        {
                          id: "topology",
                          label: "Topology",
                          icon: GitBranchIcon,
                        },
                        {
                          id: "terminal",
                          label: "Terminal",
                          icon: TerminalIcon,
                        },
                        {
                          id: "review",
                          label: "Review changes",
                          icon: FileDiffIcon,
                        },
                      ].map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() =>
                            id === "review"
                              ? openReview()
                              : setSplitPane(id as typeof splitPane)
                          }
                          className="flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-left text-xs hover:bg-muted"
                        >
                          <Icon className="size-3.5 text-muted-foreground" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : splitPane === "session" ? (
                splitSession ? (
                  renderConversationPane(splitSession)
                ) : (
                  <ConversationEmptyState
                    icon={<MessageSquarePlusIcon className="size-5" />}
                    title="Drop a session tab here"
                    description="The docked pane renders the complete conversation."
                  />
                )
              ) : splitPane === "documents" ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="border-b px-3 py-2">
                    <p className="type-label">
                      Agentic files
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Project context available to this session.
                    </p>
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="grid gap-1 p-2">
                      {(
                        [
                          ["Skills", data.catalog.skills],
                          ["Experts", data.catalog.agents],
                          ["Commands", data.catalog.commands],
                          ["MCP servers", data.catalog.mcp],
                        ] as const
                      ).map(([label, values]) => (
                        <section key={label} className="rounded-md border p-2">
                          <p className="type-label">
                            {label}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(values as string[]).slice(0, 20).map((value) => (
                              <span
                                key={value}
                                className="element-chip border bg-background px-1.5 py-1"
                              >
                                {value}
                              </span>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : splitPane === "topology" ? (
                <div className="flex min-h-0 flex-1 flex-col p-3">
                  <p className="type-label">
                    Session topology
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Accounts, skills, and the selected agent relationship.
                  </p>
                  <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
                    <TopologyGraph
                      nodes={topologyNodes}
                      edges={topologyEdges}
                    />
                  </div>
                </div>
              ) : splitPane === "review" ? (
                <ReviewSurface
                  snapshot={reviewSnapshot}
                  selectedPath={reviewSelectedPath}
                  onSelectedPathChange={setReviewSelectedPath}
                  comments={reviewCommentsBySession[active.id] || []}
                  onAddComment={(comment) =>
                    addReviewComment(active.id, comment)
                  }
                  onRefresh={() => void refreshReview()}
                  loading={reviewLoading}
                  error={reviewError}
                />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col bg-background">
                  <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium">
                      {(() => {
                        const shell = sessionShellAccount(data, active.model);
                        return shell
                          ? `Terminal · farm shell ${shell}`
                          : active.model.endsWith("/host") ||
                              active.model === "host"
                            ? "Terminal · host"
                            : "Terminal";
                      })()}
                      <button
                        type="button"
                        aria-label="Close terminal"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setSplitPane(null)}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </span>
                    <div className="ml-auto">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Collapse terminal"
                        onClick={() => setSplitPane(null)}
                      >
                        <ChevronDownIcon />
                      </Button>
                    </div>
                  </div>
                  <TerminalPane
                    projectRoot={
                      workspaceRoot || data.install.repo || undefined
                    }
                    sessionId={active.id || "default"}
                    shellAccount={sessionShellAccount(data, active.model)}
                  />
                </div>
              )}
            </aside>
          )}
        </div>
      </DockDropTarget>

      <aside
        className="relative flex shrink-0 flex-col border-l bg-card"
        style={{ width: rightWidth }}
      >
        <div className="flex h-12 shrink-0 items-center border-b px-3">
          <button
            type="button"
            className="workspace-tab"
            data-active={rightTab === "session"}
            onClick={() => setRightTab("session")}
          >
            Session
          </button>
          <button
            type="button"
            className="workspace-tab"
            data-active={rightTab === "access"}
            onClick={() => setRightTab("access")}
          >
            Access
          </button>
          <button
            type="button"
            className="workspace-tab"
            data-active={rightTab === "summary"}
            onClick={() => setRightTab("summary")}
          >
            Summary
          </button>
        </div>
        <div className="scrollbar-none flex-1 overflow-y-auto p-3">
          {rightTab === "summary" ? (
            <JobSummaryPanel session={active} />
          ) : rightTab === "session" ? (
            <div className="flex flex-col gap-5">
              <div>
                <p className="type-label">
                  Agent
                </p>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        "[aria-label='Session actions']",
                      )
                      ?.click()
                  }
                  className="mt-2 flex w-full items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-left hover:bg-accent"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      data.gateway.running ? "bg-primary" : "bg-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {active.model || "No agent selected"}
                  </span>
                  <ChevronDownIcon className="size-3 text-muted-foreground" />
                </button>
              </div>
              <div className="border-t pt-4">
                <p className="type-label">
                  Session details
                </p>
                <dl className="mt-3 space-y-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Messages</dt>
                    <dd>{active.messages.length}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Mode</dt>
                    <dd className="capitalize">{active.mode || "chat"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd>{relativeTime(active.updatedAt, clock)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <p className="type-label">
                  Tool permissions
                </p>
                <p className="mt-1 type-caption">
                  How tools may run for this session.
                </p>
                <RadioGroup
                  value={active.permissions || "ask"}
                  onValueChange={(next) =>
                    updateSession(active.id, (session) => ({
                      ...session,
                      permissions: next as FarmPermission,
                    }))
                  }
                  className="mt-3 gap-2"
                >
                  {PERMISSION_PRINCIPLES.map((principle) => {
                    const selected = active.permissions === principle.value;
                    const id = `session-perm-${principle.value}`;
                    const providerId = routeProviderId(data, active.model);
                    const subtitle = selected
                      ? permissionSubtitle(catalog, providerId, principle.value)
                      : null;
                    return (
                      <label
                        key={principle.value}
                        htmlFor={id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                          selected
                            ? "border-primary/50 bg-muted"
                            : "border-border bg-background hover:bg-muted/50",
                        )}
                      >
                        <RadioGroupItem
                          value={principle.value}
                          id={id}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium">
                            {principle.title}
                          </span>
                          <span className="block type-caption">
                            {principle.description}
                          </span>
                          {subtitle ? (
                            <span className="mt-0.5 block truncate type-caption">
                              {providerId}: {subtitle}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </RadioGroup>
              </div>
              <div className="border-t pt-4">
                <button
                  type="button"
                  onClick={() =>
                    updateSession(active.id, (session) => ({
                      ...session,
                      toolsEnabled: !session.toolsEnabled,
                    }))
                  }
                  className="flex w-full items-center gap-2 rounded-lg border bg-background p-3 text-left hover:bg-accent"
                >
                  <WrenchIcon className="size-3.5" />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-medium">Tools and MCP</strong>
                    <span className="text-xs text-muted-foreground">
                      {active.toolsEnabled
                        ? "Available to this route"
                        : "Disabled for this session"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "relative h-3.5 w-6 rounded-full",
                      active.toolsEnabled ? "bg-primary" : "bg-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-2.5 rounded-full bg-white transition-transform",
                        active.toolsEnabled
                          ? "translate-x-3"
                          : "translate-x-0.5",
                      )}
                    />
                  </span>
                </button>
                {active.toolsEnabled &&
                  (() => {
                    const route = data.settings.routes.find(
                      (item) => item.id === active.model,
                    );
                    const mcpNames = route?.mcp?.length
                      ? route.mcp
                      : data.catalog.mcp;
                    const items = [
                      ...(route?.tools || []),
                      ...mcpNames.map((name) => `mcp:${name}`),
                    ];
                    return items.length ? (
                      <ul className="mt-2 space-y-1">
                        {items.map((name) => (
                          <li
                            key={name}
                            className="truncate rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
                          >
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 px-2.5 text-[0.65rem] text-muted-foreground">
                        No tools or MCP configured for this route.
                      </p>
                    );
                  })()}
              </div>
            </div>
          )}
        </div>
        <div
          role="separator"
          aria-label="Resize inspector sidebar"
          aria-orientation="vertical"
          className="sidebar-resize-handle sidebar-resize-handle-right"
          onPointerDown={(event) => startResize("right", event)}
          onDoubleClick={() => setRightWidth(244)}
        />
      </aside>
    </div>
  );
}
