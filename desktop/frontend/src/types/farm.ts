export interface FarmProfile {
  name: string;
  description: string;
  skills_packages: Array<{ source: string; skills: string[] }>;
  skills_from_host: string[];
  agents_from_host: string[];
  commands_from_host: string[];
  mcp: string[];
  source?: "bundled" | "custom";
  readOnly?: boolean;
  path?: string;
}

export interface FarmAccount {
  name: string;
  providers: string[];
  profile: string | null;
  appliedAt: string | null;
  running: boolean;
  usage?: FarmProviderUsage[];
}

export interface UsageWindow {
  window: string;
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
  status?: string;
}

export interface FarmProviderUsage {
  provider: string;
  updatedAt?: string;
  source: "live-event" | "session-archive" | "transcripts" | "unavailable";
  windows: UsageWindow[];
  tokens24h?: number;
  tokens7d?: number;
  tokens30d?: number;
}

/**
 * How a container group dispatches work to its members.
 *
 * `strategy` remains on GatewayRoute as a backwards-compatible shorthand;
 * new callers should prefer `workflow`, which can grow without adding more
 * route-level fields.
 */
export type ExecutionWorkflowKind =
  "single" | "parallel" | "race" | "synthesize" | "chain" | "cascade" | "anchor";

export interface ExecutionWorkflowStage {
  id: string;
  kind: ExecutionWorkflowKind;
  members?: string[];
  synthesizer?: string;
  /** Nested stages allow workflows to grow into a graph without changing route shape. */
  stages?: ExecutionWorkflowStage[];
}

export interface ExecutionWorkflow {
  kind: ExecutionWorkflowKind;
  /** Ordered member ids. A group falls back to GatewayRoute.members. */
  members?: string[];
  /** Number of attempts for each member in parallel/race/synthesize modes. */
  repeats?: number;
  /** Member id used for the synthesis pass. */
  synthesizer?: string;
  /** The one member to execute when kind is `single`; other members remain available context. */
  activeMember?: string;
  /** Optional stage metadata reserved for richer workflow graphs. */
  stages?: ExecutionWorkflowStage[];

  // ---- kind: "anchor" ------------------------------------------------------
  // One pinned member owns the conversation; rotating workers execute scoped
  // briefs. The point is VOLUME: a worker sees a self-contained task, never the
  // transcript. See docs/prompt-cache-evidence.md for why this is framed as
  // sending less rather than caching more.
  /** Route id that holds the conversation. Defaults to the first member. */
  anchor?: string;
  /** Upstream model for the anchor — wants a large context window. */
  anchorModel?: string;
  /** Upstream model for workers. Falls back to the request's own pick. */
  workerModel?: string;
  /** Worker pool. `rota` here means "a rotating silo". Defaults to the
   *  non-anchor members, then to `rota`. */
  workers?: string[];
  /** Delegation rounds per turn. Each round is anchor -> worker -> anchor, so
   *  the default is deliberately 1: latency is the real cost here. */
  maxDelegations?: number;
  /** Run the anchor in plan mode so it cannot do the work itself and must
   *  delegate. Defaults to true. */
  anchorReadOnly?: boolean;
  /** Cap on a worker result folded back into the anchor's context. */
  foldCharCap?: number;
}

export interface GatewayRoute {
  id: string;
  label?: string;
  description?: string;
  provider?: string;
  account?: string;
  transport: "cli" | "openai" | "anthropic" | "command" | "hybrid";
  baseUrl?: string;
  apiKeyEnv?: string;
  /** Identifier of an owner-only `<state>/secrets/<id>.key` file. The route
   * never carries an arbitrary filesystem path. */
  apiKeySecret?: string;
  upstreamModel?: string;
  /** Current standard base-input list price, used only to estimate cache
   * savings. Kept in route config so pricing changes do not require a build. */
  baseInputUsdPerMillion?: number;
  /** Explicit Anthropic cache breakpoints on direct `anthropic` routes.
   *  Defaults to true; has no effect on CLI routes, whose provider process owns
   *  the wire request. */
  promptCaching?: boolean;
  /** Override only when an upstream wraps one provider's usage shape in
   *  another protocol envelope. */
  usageDialect?: "auto" | "anthropic-exclusive" | "openai-inclusive";
  capabilities?: string[];
  command?: string;
  args?: string[];
  cwd?: string;
  inputMode?: "stdin" | "argument";
  streamFormat?: "text" | "ndjson" | "sse";
  members?: string[];
  strategy?: "parallel" | "race" | "chain" | "cascade" | "synthesize";
  /** Extensible workflow definition. `strategy` is retained for old configs. */
  workflow?: ExecutionWorkflow;
  synthesizer?: string;
  repeats?: number;
  systemPrompt?: string;
  tools?: string[];
  skills?: string[];
  mcp?: string[];
  permissions?: FarmPermission;
}

/** The four permission principles — the ONLY permission vocabulary. Providers
 *  name these differently (subtitle via the model catalog); the values and
 *  main titles never vary. */
export type FarmPermission = "read-only" | "ask" | "auto" | "full";

export interface GatewayApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
}

export interface GatewaySettings {
  host: string;
  port: number;
  apiKeys?: GatewayApiKey[];
  /** How the virtual "rota" model picks a silo per request. */
  rotaStrategy?: "smart" | "spread" | "round-robin" | "session-first";
  /** "session" (default) pins one silo per conversation so a thread stops
   *  hopping orgs mid-flow; "per-request" restores per-request picking.
   *  Callers that send no session id are unaffected either way. */
  rotaAffinity?: "session" | "per-request";
  /** Idle time before a pinned lane is released and re-optimised (ms). */
  rotaAffinityIdleMs?: number;
  routes: GatewayRoute[];
}

export interface GatewayTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_5m_input_tokens?: number;
  cache_creation_1h_input_tokens?: number;
  total_tokens: number;
  cached_input_tokens_reported?: boolean;
  cache_creation_input_tokens_reported?: boolean;
  cache_creation_5m_input_tokens_reported?: boolean;
  cache_creation_1h_input_tokens_reported?: boolean;
  total_tokens_reported?: boolean;
  usage_dialect?: "auto" | "anthropic-exclusive" | "openai-inclusive" | "mixed";
  cache_status?: "hit" | "write" | "miss" | "unreported";
  cacheable_input_tokens?: number;
  cache_net_input_tokens_saved?: number;
  cache_savings_rate?: number;
  cache_savings_usd?: number | null;
  cache_write_multiplier?: number;
  cache_write_5m_multiplier?: number;
  cache_write_1h_multiplier?: number;
  cache_read_multiplier?: number;
  cache_savings_estimated?: boolean;
  estimated?: boolean;
}

export interface GatewayRequestActivity {
  requestId: string;
  state: "active" | "completed" | "failed" | "aborted";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  statusCode?: number;
  method: string;
  path: string;
  protocol: "chat" | "responses" | "anthropic";
  client: string;
  keyId?: string | null;
  keyName?: string | null;
  model: string;
  route: string;
  provider: string;
  account?: string | null;
  transport?: string | null;
  usageDialect?: string;
  cacheMode?: "explicit" | "off" | "provider-managed";
  cacheCapable?: boolean;
  cacheRequested?: boolean;
  cachePrefixChars?: number | null;
  cachePrefixSha?: string | null;
  /** False for full-context automatic-cache fingerprints, which naturally
   * change as a conversation grows and must not be treated as prefix breaks. */
  cachePrefixComparable?: boolean | null;
  baseInputUsdPerMillion?: number | null;
  cacheWriteMultiplier?: number | null;
  usage?: GatewayTokenUsage | null;
  error?: string | null;
}

export interface GatewayTrafficRank {
  id: string;
  requests: number;
  tokens: number;
}

export interface GatewayTrafficWindow {
  id: "1h" | "4h" | "8h" | "24h" | "7d" | "30d";
  label: string;
  requests: number;
  errors: number;
  active: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHits: number;
  cacheWrites: number;
  cacheMisses: number;
  cacheUnreported: number;
  cacheNetInputTokensSaved: number;
  cacheSavingsUsd: number;
  cachePricedRequests: number;
  estimatedRequests: number;
  topModels: GatewayTrafficRank[];
  topEndpoints: GatewayTrafficRank[];
  topProviders: GatewayTrafficRank[];
}

export interface GatewayClientStatus {
  client: string;
  firstSeenAt?: string;
  lastSeenAt: string;
  requestCount?: number;
  inferenceCount?: number;
  inFlight?: number;
  lastPath?: string;
  lastModel?: string | null;
  keyId?: string | null;
  keyName?: string | null;
}

export interface GatewayStatus {
  running: boolean;
  stale?: boolean;
  revision?: string;
  pid: number | null;
  url: string;
  startedAt: string | null;
  /** Clients seen on the API in the last 10 minutes (gateway ledger). */
  clients?: GatewayClientStatus[];
  activeRequests?: GatewayRequestActivity[];
  recentRequests?: GatewayRequestActivity[];
  recentErrors?: GatewayRequestActivity[];
  lastInferenceAt?: string | null;
  trafficWindows?: GatewayTrafficWindow[];
  runtimeLogs?: string[];
  rota?: {
    account?: string;
    provider?: string;
    strategy?: GatewaySettings["rotaStrategy"];
    pickedAt?: string;
    score?: number;
  };
}

export interface DistributedSilo {
  id: string;
  name: string;
  runtime: "agensis-agent" | "external-agent" | "e2b" | "daytona" | string;
  management: "managed" | "external" | string;
  locality: "local" | "remote" | "cloud" | string;
  lifecycle: "running" | "paused" | "offline" | "deleted" | string;
  status?: string;
  workspaceId?: string;
  agentId?: string;
  capabilities?: {
    codingRoute?: boolean;
    shared?: boolean;
    sharedModels?: Array<{ id: string; name?: string; provider?: string }>;
  };
}

export interface FarmdStatus {
  running: boolean;
  pid: number | null;
  url: string;
  startedAt: string | null;
}

export interface AgensisPairing {
  baseUrl: string;
  deviceCode: string;
  userCode: string;
  /** Browser URL to approve the device code (usually agensis.io/integrations/farm?code=…). */
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Extra host folder shared into every local silo via virtiofs
 *  (`farm add-host-dir` / `~/.usage-farm/host-dirs`). */
export interface FarmHostDir {
  host: string;
  target: string;
  mode: "rw" | "ro";
}

/** Host machine (this Mac) — not a silo. Provider CLIs use the user's own
 *  ~/.claude / ~/.codex homes; gateway route id is `provider/host`. */
export interface FarmHostInfo {
  providers: string[];
}

export interface BootstrapData {
  app: { version: string; native: boolean };
  install: {
    cli: string | null;
    repo: string | null;
    state: string;
    ready: boolean;
    nativeCli: string | null;
  };
  accounts: FarmAccount[];
  /** Host-mode providers available on this machine (empty when none detected). */
  host?: FarmHostInfo;
  /** Shared host directories currently registered for local silos. */
  hostDirs?: FarmHostDir[];
  profiles: FarmProfile[];
  catalog: {
    skills: string[];
    agents: string[];
    commands: string[];
    mcp: string[];
  };
  /** Optional model-catalog override from ~/.claude-farm/models.json —
   *  merged into the built-in catalog by lib/model-catalog.ts mergeCatalog. */
  models?: unknown;
  gateway: GatewayStatus;
  distributed?: FarmdStatus;
  settings: GatewaySettings;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mediaType: string;
  url: string;
  size: number;
}

export interface MarkdownWorkspaceFile {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface MarkdownWorkspaceIndex {
  root: string;
  files: MarkdownWorkspaceFile[];
}

export interface MarkdownDocument {
  root: string;
  path: string;
  content: string;
  modifiedAt: string;
}

export interface AgentSessionSummary {
  id: string;
  provider: string;
  account: string;
  sourcePath: string;
  cwd: string | null;
  startedAt: string;
  updatedAt: string;
  prompt: string;
  output: string;
  eventCount: number;
}

export interface AgentSessionIndex {
  root: string;
  sessions: AgentSessionSummary[];
}

export interface ChatToolEvent {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error" | "denied";
  input?: unknown;
  output?: unknown;
}

export interface WorkspaceDiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  patch: string;
  totalLines: number;
}

export interface WorkspaceDiffSnapshot {
  root: string;
  generatedAt: string;
  additions: number;
  deletions: number;
  files: WorkspaceDiffFile[];
}

export interface ReviewComment {
  id: string;
  file: string;
  line: number;
  side: "old" | "new";
  body: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  cachedInputTokensReported?: boolean;
  cacheCreationInputTokensReported?: boolean;
  totalTokensReported?: boolean;
  cacheStatus?: "hit" | "write" | "miss" | "unreported";
  estimated?: boolean;
}

export interface ChatModelUsage {
  model: string;
  usage?: ChatUsage;
  costUsd?: number;
  contextWindow?: number;
}

export interface ChatMemberTrace {
  id: string;
  route: string;
  run: number;
  role: "member" | "synthesizer" | "anchor" | "worker";
  status: "queued" | "running" | "completed" | "error" | "stopped";
  reasoning: string;
  tools: ChatToolEvent[];
  eventCount: number;
  eventTypes: string[];
  output?: string;
  usage?: ChatUsage;
  models?: ChatModelUsage[];
  rateLimit?: UsageWindow;
  costUsd?: number;
  durationMs?: number;
  ttftMs?: number;
  permissionMode?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  updatedAt?: string;
  model?: string;
  status?: "queued" | "streaming" | "complete" | "stopped" | "error";
  attachments?: ChatAttachment[];
  reasoning?: string;
  tools?: ChatToolEvent[];
  usage?: ChatUsage;
  members?: ChatMemberTrace[];
  feedback?: "up" | "down";
}

/** What `farm.session.list` returns per row — a ChatSession minus its
 *  messages/queue payload, plus the counts the Jobs list renders. */
export interface FarmSessionMeta {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  project?: string | null;
  pinned?: boolean;
  archived?: boolean;
  permissions: FarmPermission;
  effort?: string;
  catalogModel?: string;
  source?: "farm" | "claude" | "codex";
  originPath?: string;
  importedAt?: string;
  messageCount: number;
}

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  /** Project membership. Null/undefined sessions appear in the global Tasks section. */
  project?: string | null;
  pinned?: boolean;
  unread?: boolean;
  /** Archived sessions hide from default lists but stay in the store. */
  archived?: boolean;
  permissions: FarmPermission;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  network?: "deny" | "ask" | "allow";
  thinking?: "auto" | "low" | "medium" | "high";
  /** Catalog effort tier for the selected model (composer cascade). */
  effort?: string;
  /** Catalog model id picked in the composer cascade — rides the farm request
   *  as `farm.model`. `model` above stays the ROUTE (provider/account); this is
   *  the upstream model inside it. Persisted so a reload cannot silently fall
   *  back to the route's pinned `upstreamModel`. */
  catalogModel?: string;
  /** Provenance: absent/"farm" = born ours; a provider id = adopted from that
   *  CLI's native transcript on first use (spec B, adopt-on-use). */
  source?: "farm" | "claude" | "codex";
  originPath?: string;
  importedAt?: string;
  /** Transient native peek: shown italic/"pending", never persisted, and
   *  discarded on switch-away. Double-click or first send adopts (clears). */
  pending?: boolean;
  toolPermissions?: Record<string, "deny" | "ask" | "allow">;
  mode?: "chat" | "configure" | "test";
  toolsEnabled: boolean;
  messages: ChatMessage[];
  queue: Array<{
    id: string;
    text: string;
    attachments: ChatAttachment[];
    createdAt: string;
  }>;
}

/** The one view id union — sidebar, command palette, and workspaces all
 *  navigate with these ids. One name per concept (design-language skill). */
export type WorkspaceView =
  | "overview"
  | "harvest"
  | "projects"
  | "silos"
  | "profiles"
  | "worktrees"
  | "chores"
  | "gateway"
  | "chat"
  | "documents"
  | "settings";

/* ---------------- Chores: the task planner (spec 2026-07-20) ------------ */

/** Same enum as visualTodo visual todos — model-instance todo lists stay
 *  compatible by construction. */
export type ChoreStatus = "todo" | "in-progress" | "done";
export type ChoreLifecycle = "logged" | "queued" | "in-progress" | "done";

export interface ChoreAttachment {
  id: string;
  name: string;
  kind: "image" | "file";
  addedAt: string;
}

export interface ChoreRun {
  jobId: string;
  silo: string | null;
  provider: string | null;
  model: string | null;
  startedAt: string;
  finishedAt?: string | null;
  outcome?: "done" | "failed" | null;
}

export interface ChoreAssignee {
  silo: string | null;
  provider: string | null;
  model: string | null;
}

export interface ChoreTask {
  id: string;
  title: string;
  /** Markdown body. */
  notes: string;
  /** Subtasks form a tree; null = top level. */
  parentId: string | null;
  tags: string[];
  status: ChoreStatus;
  lifecycle: ChoreLifecycle;
  assignee: ChoreAssignee;
  /** Finish-to-start dependencies (task ids). "Blocked" is derived. */
  dependsOn: string[];
  /** Planned ISO dates for the timeline. */
  start: string | null;
  due: string | null;
  estimateHours: number | null;
  attachments: ChoreAttachment[];
  /** Freeform additional key-values. */
  data: Record<string, string>;
  runs: ChoreRun[];
  /** Manual sort among siblings / within a column. */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChoreBoardSettings {
  autoRun: boolean;
  concurrency: number;
}

export interface ChoresSnapshot {
  root: string;
  tasks: ChoreTask[];
  settings: ChoreBoardSettings;
  /** Ids whose dependencies are not all done (derived server-side too). */
  blocked: string[];
}
