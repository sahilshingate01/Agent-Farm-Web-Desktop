#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  anthropicCachePrefix,
  applyAnthropicPromptCaching,
} from "./prompt-cache.mjs";
import { appVersion, SOURCE_URL } from "./app-version.mjs";
import {
  estimateCacheSavings,
  mergeUsageSnapshots,
  normalizeProviderUsage,
  sumTokenUsage,
} from "./token-usage.mjs";
import { readRouteApiKey } from "./route-secret.mjs";

const state = process.env.FARM_STATE || (existsSync(join(homedir(), ".usage-farm")) ? join(homedir(), ".usage-farm") : join(homedir(), ".claude-farm"));
const configPath = join(state, "gateway.json");
const logPath = process.env.USAGE_FARM_GATEWAY_LOG || join(state, "gateway.log");
const activityPath = join(state, "gateway-activity.jsonl");
const visualTodoWebhookPath = join(state, "visual-todo-webhook.jsonl");

function log(message) {
  try { writeFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { flag: "a" }); } catch { /* logging cannot break serving */ }
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function config() {
  return { host: "127.0.0.1", port: 4545, apiKey: "", routes: [], ...readJson(configPath, {}) };
}

/** Desktop workspace root (`workspace.json`) — the open project folder.
 *  Jobs and api-exec should land here, not in ~/.claude-farm/work. */
function workspaceRoot() {
  const configured = readJson(join(state, "workspace.json"), {}).root;
  const root = typeof configured === "string" ? configured.trim() : "";
  if (root && existsSync(root)) return root;
  return "";
}

function accounts() {
  const root = join(state, "accounts");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const providers = readdirSync(join(root, entry.name), { withFileTypes: true })
      .filter((child) => child.isDirectory() && child.name.endsWith("-home"))
      .map((child) => child.name.slice(0, -5));
    return providers.map((provider) => ({
      id: `${provider}/${entry.name}`,
      provider,
      account: entry.name,
      transport: "cli",
      upstreamModel: "",
      capabilities: ["text", "streaming", "system", "vision-prompt", "structured-prompt", "tools-prompt"],
    }));
  });
}

/** Host machine routes — provider CLIs on this Mac (not a silo). Detected by
 *  the presence of the user's native provider home; `farm api-exec <p> host`
 *  runs the host binary with those credentials. */
function hostAccounts() {
  if (process.env.USAGE_FARM_GATEWAY_TEST) return [];
  const homes = {
    claude: join(homedir(), ".claude"),
    codex: join(homedir(), ".codex"),
    grok: join(homedir(), ".grok"),
    gemini: join(homedir(), ".gemini"),
  };
  return Object.entries(homes)
    .filter(([, path]) => existsSync(path))
    .map(([provider]) => ({
      id: `${provider}/host`,
      provider,
      account: "host",
      transport: "cli",
      upstreamModel: "",
      capabilities: ["text", "streaming", "system", "vision-prompt", "structured-prompt", "tools-prompt"],
      description: "Host machine (this Mac — not a silo)",
      locality: "host",
    }));
}

function routes() {
  const explicit = Array.isArray(config().routes) ? config().routes : [];
  const map = new Map(accounts().map((route) => [route.id, route]));
  // Host routes are always available when the host home exists; explicit
  // config can still override fields but cannot remove the host target.
  for (const route of hostAccounts()) map.set(route.id, { ...map.get(route.id), ...route });
  for (const route of explicit) if (route?.id) map.set(route.id, { ...map.get(route.id), ...route });
  const list = [...map.values()];
  if (list.some((route) => route.provider === "claude" && route.account !== "host")) {
    list.unshift({ id: "rota", provider: "claude", account: "(rotating)", transport: "cli", upstreamModel: "", aliases: ["auto"], capabilities: ["text", "streaming", "system"], description: "Quota-aware rotation across every claude silo" });
  }
  return list;
}

/* ---- The rota: a virtual model that picks the best silo per request ----
   Point ANY OpenAI/Anthropic client at this gateway with model "rota" and
   each request lands on the silo the three-bucket doctrine says to burn:
   usableNow = min(session left, weekly left - 10% reserve), with a sticky
   bonus for the previous pick (warm context beats a marginal improvement).
   Usage evidence comes from state/usage/<name>/claude.json — the same files
   the app's OAuth ping refreshes. */
const ROTA_STICKY_BONUS = 0.12;
const rotaStatePath = () => join(state, "rota.json");
const ROTA_STRATEGIES = ["smart", "spread", "round-robin", "session-first"];

/** Gateway setting: how the rota picks. Default "smart" — the doctrine
 *  (weekly drives the full reset, so weekly headroom above reserve governs;
 *  sticky for warm context). Overrides:
 *    spread        — even out weekly burn: always the MOST weekly headroom
 *    round-robin   — strict alternation, quota-blind (except empty lanes)
 *    session-first — chase the freshest session window, ignore weekly
 */
function rotaStrategy() {
  const configured = String(config().rotaStrategy || "smart");
  return ROTA_STRATEGIES.includes(configured) ? configured : "smart";
}

function rotaLaneScore(name) {
  const live = readJson(join(state, "usage", name, "claude.json"), null);
  const windows = Array.isArray(live?.windows) ? live.windows : [];
  const remaining = (pattern) => {
    const window = windows.find((item) => pattern.test(item.window));
    return window?.remainingPercent != null ? window.remainingPercent / 100 : null;
  };
  const session = remaining(/session|five|hour/i);
  const weekly = remaining(/weekly all|week/i);
  // Unreported lanes score a conservative half-window so they are usable
  // but never beat a lane with proven headroom.
  if (session == null && weekly == null) return 0.5;
  const weeklyHeadroom = weekly == null ? 1 : Math.max(weekly - 0.1, 0);
  return Math.min(session ?? 1, weeklyHeadroom);
}

function rotaWindow(name, pattern) {
  const live = readJson(join(state, "usage", name, "claude.json"), null);
  const windows = Array.isArray(live?.windows) ? live.windows : [];
  const window = windows.find((item) => pattern.test(item.window));
  return window?.remainingPercent != null ? window.remainingPercent / 100 : null;
}

/** Epoch ms until which a lane is rate-limited, or 0 when it is open.
 *
 *  persistProviderUsage already writes the provider's rate_limit_event into
 *  the very file rotaLaneScore reads; nothing has ever acted on it.
 *
 *  TRAP: `overageStatus: "rejected"` is the NORMAL steady state — it means
 *  overage purchasing is off, not that the silo is blocked. Keying on it would
 *  black-hole the whole fleet. Only `status === "rejected"` is a block. */
function laneBlockedUntil(name) {
  const limit = readJson(join(state, "usage", name, "claude.json"), null)?.rateLimit;
  if (!limit || String(limit.status) !== "rejected") return 0;
  const raw = limit.resetsAt;
  // Providers report seconds; tolerate ISO strings too.
  const at = typeof raw === "number" ? raw * 1000 : Date.parse(raw || "");
  return Number.isFinite(at) && at > Date.now() ? at : 0;
}

// ---- Session affinity ------------------------------------------------------
// A conversation that hops silos mid-thread changes ORG, which throws away the
// provider's static prefix cache and makes the thread incoherent. The client
// already sends farm.session_id; the gateway simply never read it.
// Precedence: explicit route id -> blocked-lane veto -> session affinity -> score.
const rotaSessionsPath = () => join(state, "rota-sessions.json");
const ROTA_SESSION_MAX = 200;
const ROTA_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function rotaAffinityIdleMs() {
  const configured = Number(config().rotaAffinityIdleMs);
  // 30 min default: past that there is no warm prefix left to protect, so
  // re-optimising the lane is free. Judgement call, hence configurable.
  return Number.isFinite(configured) && configured >= 0 ? configured : 30 * 60 * 1000;
}

function rotaAffinityEnabled() {
  return String(config().rotaAffinity || "session") !== "per-request";
}

function readRotaSessions() {
  const stored = readJson(rotaSessionsPath(), null);
  return stored && typeof stored.sessions === "object" && stored.sessions ? stored.sessions : {};
}

function writeRotaSessions(sessions) {
  const now = Date.now();
  const live = Object.entries(sessions)
    .filter(([, entry]) => now - (Date.parse(entry?.lastUsedAt || "") || 0) < ROTA_SESSION_TTL_MS)
    .sort((a, b) => Date.parse(b[1].lastUsedAt || "") - Date.parse(a[1].lastUsedAt || ""))
    .slice(0, ROTA_SESSION_MAX);
  try {
    writeFileSync(rotaSessionsPath(), JSON.stringify({ updatedAt: new Date().toISOString(), sessions: Object.fromEntries(live) }, null, 2), { mode: 0o600 });
  } catch { /* affinity is an optimisation, never a hard dependency */ }
}

/** The pinned lane for this session, or null with the reason it was released. */
function rotaAffinityFor(sessionKey, lanes) {
  if (!sessionKey || !rotaAffinityEnabled()) return { lane: null, released: null };
  const entry = readRotaSessions()[sessionKey];
  if (!entry?.account) return { lane: null, released: null };
  const lane = lanes.find((item) => item.account === entry.account);
  if (!lane) return { lane: null, released: "gone" };
  if (laneBlockedUntil(entry.account)) return { lane: null, released: "rate-limit" };
  if (rotaLaneScore(entry.account) <= 0) return { lane: null, released: "exhausted" };
  const idleMs = Date.now() - (Date.parse(entry.lastUsedAt || "") || 0);
  if (idleMs > rotaAffinityIdleMs()) return { lane: null, released: "idle" };
  return { lane, released: null };
}

function releaseRotaAffinity(sessionKey) {
  if (!sessionKey) return;
  const sessions = readRotaSessions();
  if (!sessions[sessionKey]) return;
  delete sessions[sessionKey];
  writeRotaSessions(sessions);
  log(`rota: session ${sessionKey} released its lane (user)`);
}

function recordRotaAffinity(sessionKey, lane, reason) {
  if (!sessionKey || !lane) return;
  const sessions = readRotaSessions();
  const previous = sessions[sessionKey];
  const at = new Date().toISOString();
  sessions[sessionKey] = previous?.account === lane.account
    ? { ...previous, lastUsedAt: at, turns: (previous.turns || 0) + 1 }
    : { account: lane.account, provider: lane.provider, pinnedAt: at, lastUsedAt: at, turns: 1, reason: reason || "pinned" };
  writeRotaSessions(sessions);
}

function rotaPick(sessionKey = null, options = {}) {
  const all = accounts().filter((route) => route.provider === "claude");
  if (!all.length) return null;
  // Blocked lanes are vetoed — but if EVERY lane is blocked, degrade to the
  // full set rather than returning null and 404-ing the caller.
  const open = all.filter((lane) => !laneBlockedUntil(lane.account));
  const excluded = new Set(Array.isArray(options.exclude) ? options.exclude : []);
  const preferred = open.filter((lane) => !excluded.has(lane.account));
  const lanes = preferred.length ? preferred : (open.length ? open : all);
  if (open.length !== all.length) {
    log(`rota: ${all.length - open.length} lane(s) rate-limited${open.length ? "" : " — all blocked, degrading"}`);
  }

  const affinity = rotaAffinityFor(sessionKey, lanes);
  if (affinity.lane) {
    recordRotaAffinity(sessionKey, affinity.lane, "affinity");
    return { ...affinity.lane, id: "rota", aliases: ["auto"], label: `rota -> ${affinity.lane.account}` };
  }
  if (affinity.released) log(`rota: session ${sessionKey} released its lane (${affinity.released})`);

  const previous = readJson(rotaStatePath(), null);
  const strategy = rotaStrategy();
  const scored = lanes.map((lane) => {
    let score;
    switch (strategy) {
      case "spread":
        score = rotaWindow(lane.account, /weekly all|week/i) ?? 0.5;
        break;
      case "session-first":
        score = rotaWindow(lane.account, /session|five|hour/i) ?? 0.5;
        break;
      case "round-robin":
        // quota-blind except truly empty lanes; ordering handles the rest
        score = rotaLaneScore(lane.account) > 0 ? 1 : 0;
        break;
      default:
        score = rotaLaneScore(lane.account);
        if (previous?.account === lane.account) score += ROTA_STICKY_BONUS;
    }
    return { lane, score };
  });
  let best = null;
  if (strategy === "round-robin") {
    const usable = scored.filter((item) => item.score > 0);
    if (usable.length) {
      const previousIndex = usable.findIndex((item) => item.lane.account === previous?.account);
      best = usable[(previousIndex + 1) % usable.length];
    }
  } else {
    best = scored.reduce((top, item) => (item.score > (top?.score ?? -1) ? item : top), null);
  }
  if (!best) return null;
  if (previous?.account !== best.lane.account) {
    log(`rota[${strategy}]: handing off ${previous?.account || "(none)"} -> ${best.lane.account} (score ${best.score.toFixed(2)})`);
  }
  try {
    writeFileSync(rotaStatePath(), JSON.stringify({ account: best.lane.account, provider: best.lane.provider, strategy, pickedAt: new Date().toISOString(), score: best.score }));
  } catch { /* sticky state is best-effort */ }
  recordRotaAffinity(sessionKey, best.lane, affinity.released || "pinned");
  return { ...best.lane, id: "rota", aliases: ["auto"], label: `rota -> ${best.lane.account}` };
}

/** `sessionKey` pins the rota lane for one conversation. Callers with no
 *  session id (farm.sh, raw API clients) get exactly today's global behaviour. */
function routeFor(model, sessionKey = null, options = {}) {
  if (model === "rota" || model === "auto") return rotaPick(sessionKey, options);
  return routes().find((route) => route.id === model || route.aliases?.includes(model));
}

function send(res, status, value, headers = {}) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function apiError(res, status, message, type = "invalid_request_error") {
  if (status >= 400) markInferenceError(res, message);
  send(res, status, { error: { message, type, code: type } });
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error("Request body exceeds 10 MB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function receiveVisualTodoWebhook(req, res) {
  const payload = await body(req);
  mkdirSync(state, { recursive: true });
  appendFileSync(
    visualTodoWebhookPath,
    `${JSON.stringify({ receivedAt: new Date().toISOString(), ...payload })}\n`,
    { mode: 0o600 },
  );
  send(res, 202, { accepted: true, event: payload.event || "unknown" });
}

/* Recent API clients are a presence ledger, separate from the inference
   activity ledger below. Presence includes discovery calls; inference state
   is recorded only after a completion body has been parsed. */
const clientsPath = join(state, "gateway-clients.json");
const seenClients = new Map();
function clientIdentity(req) {
  return `${req.socket.remoteAddress || "?"} · ${(req.headers["user-agent"] || "unknown").slice(0, 80)}`;
}
function flushClients() {
  try {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [key, client] of seenClients) if (client.lastSeenMs < cutoff && client.inFlight === 0) seenClients.delete(key);
    writeFileSync(clientsPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      clients: [...seenClients.values()].map(({ lastSeenMs, firstSeenMs, ...client }) => ({
        ...client,
        firstSeenAt: new Date(firstSeenMs).toISOString(),
        lastSeenAt: new Date(lastSeenMs).toISOString(),
      })),
    }));
  } catch { /* tracking never breaks serving */ }
}
function trackClient(req, pathname, auth) {
  const id = clientIdentity(req);
  const now = Date.now();
  const previous = seenClients.get(id);
  seenClients.set(id, {
    client: id,
    firstSeenMs: previous?.firstSeenMs || now,
    lastSeenMs: now,
    requestCount: (previous?.requestCount || 0) + 1,
    inferenceCount: previous?.inferenceCount || 0,
    inFlight: previous?.inFlight || 0,
    lastPath: pathname,
    lastModel: previous?.lastModel || null,
    keyId: auth.keyId || null,
    keyName: auth.keyName || null,
  });
  flushClients();
  return id;
}
function markClientInference(req, model, delta) {
  const id = clientIdentity(req);
  const current = seenClients.get(id);
  if (!current) return;
  current.lastSeenMs = Date.now();
  current.lastModel = model || current.lastModel || null;
  current.inFlight = Math.max(0, current.inFlight + delta);
  if (delta > 0) current.inferenceCount += 1;
  flushClients();
}

function requestAuth(req) {
  const current = config();
  const configured = [
    ...(current.apiKey ? [{ id: "legacy", name: "Legacy key", key: current.apiKey }] : []),
    ...(Array.isArray(current.apiKeys) ? current.apiKeys : []),
  ].filter((entry) => typeof entry?.key === "string" && entry.key.length > 0);
  if (!configured.length) return { ok: true, keyId: null, keyName: "Local unauthenticated" };
  const presented = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-api-key"] || "";
  const match = configured.find((entry) => entry.key === presented);
  return match
    ? { ok: true, keyId: match.id || null, keyName: match.name || "API key" }
    : { ok: false, keyId: null, keyName: null };
}

function appendActivity(event) {
  try {
    mkdirSync(state, { recursive: true });
    if (existsSync(activityPath) && statSync(activityPath).size > 8 * 1024 * 1024) {
      const content = readFileSync(activityPath, "utf8");
      const tail = content.slice(-4 * 1024 * 1024);
      writeFileSync(activityPath, tail.slice(Math.max(0, tail.indexOf("\n") + 1)), { mode: 0o600 });
    }
    appendFileSync(activityPath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch { /* activity tracking never breaks inference */ }
}
/** Stable fingerprint of a prompt's leading bytes. Prompt caching can only hit
 *  when turn N+1 extends turn N's prefix, so a change here between two turns of
 *  one session is proof no cache was ever possible — see docs/prompt-cache-evidence.md. */
function promptPrefixSha(prompt) {
  return createHash("sha256").update(String(prompt || "").slice(0, 4096)).digest("hex").slice(0, 16);
}

function cachePrefixEvidence(body) {
  const prefix = anthropicCachePrefix(body);
  if (!prefix) return null;
  const automatic = body?.cache_control?.type === "ephemeral";
  return {
    cachePrefixChars: prefix.length,
    cachePrefixSha: createHash("sha256").update(prefix).digest("hex").slice(0, 16),
    // A block breakpoint identifies a stable prefix and is equality-comparable
    // across turns. Top-level automatic caching covers the growing request, so
    // its full-context fingerprint is diagnostic but not a stability signal.
    cachePrefixComparable: !automatic,
  };
}

function beginInference(req, res, protocol, pathname, request, route) {
  const startedAt = new Date().toISOString();
  // Flattened once per request and reused by `completion`, so instrumentation
  // does not add another pass over a prompt that can be megabytes. Guarded:
  // measurement must never be able to fail a request.
  let promptText = "";
  try { promptText = promptFrom(request, protocol); } catch { /* unmeasured, still served */ }
  const activity = {
    requestId: randomUUID(),
    event: "started",
    occurredAt: startedAt,
    startedAt,
    client: clientIdentity(req),
    keyId: req.farmAuth?.keyId || null,
    keyName: req.farmAuth?.keyName || null,
    method: req.method || "POST",
    path: pathname,
    protocol,
    model: String(request.model || ""),
    route: route?.id || String(request.model || ""),
    provider: route?.provider || route?.transport || "unknown",
    account: route?.account || null,
    transport: route?.transport || null,
    // Cache-evidence join keys. The client already sends session_id
    // (chat-workspace.tsx) — the gateway simply never recorded it.
    sessionId: request.farm?.session_id || null,
    promptChars: promptText.length,
    promptPrefixSha: promptPrefixSha(promptText),
    usageDialect: usageDialectForRoute(route),
    cacheMode: route?.transport === "anthropic"
      ? (route.promptCaching === false ? "off" : "explicit")
      : "provider-managed",
    cacheCapable: route?.transport === "anthropic",
    cacheRequested: route?.transport === "anthropic" && route.promptCaching !== false,
    baseInputUsdPerMillion: String(route?.upstreamModel || "").trim()
      && Number.isFinite(Number(route?.baseInputUsdPerMillion))
      ? Number(route.baseInputUsdPerMillion)
      : null,
    cacheWriteMultiplier: route?.transport === "anthropic" && route.promptCaching !== false
      ? 1.25
      : null,
  };
  const state = { ...activity, startedMs: Date.now(), finished: false, usage: null, error: null, promptText };
  res.farmActivity = state;
  appendActivity(activity);
  markClientInference(req, activity.model, 1);
  const finish = (aborted = false) => {
    if (state.finished) return;
    state.finished = true;
    markClientInference(req, activity.model, -1);
    const failed = aborted || Boolean(state.error) || res.statusCode >= 400;
    appendActivity({
      ...activity,
      event: aborted ? "aborted" : failed ? "failed" : "completed",
      occurredAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - state.startedMs,
      statusCode: res.statusCode,
      usage: state.usage || null,
      cachePrefixChars: state.cachePrefixChars || null,
      cachePrefixSha: state.cachePrefixSha || null,
      cachePrefixComparable: state.cachePrefixComparable ?? null,
      error: state.error || (aborted ? "Client disconnected before completion." : null),
    });
  };
  res.once("finish", () => finish(false));
  res.once("close", () => { if (!res.writableEnded) finish(true); });
}
function setInferenceUsage(res, value) {
  if (!res.farmActivity || !value) return;
  const savings = res.farmActivity.cacheMode === "explicit"
    ? estimateCacheSavings(value, {
      baseInputUsdPerMillion: res.farmActivity.baseInputUsdPerMillion,
      cacheWriteMultiplier: res.farmActivity.cacheWriteMultiplier,
    })
    : null;
  res.farmActivity.usage = savings ? { ...value, ...savings } : value;
}
function setInferenceCachePrefix(res, evidence) {
  if (!res.farmActivity || !evidence) return;
  res.farmActivity.cachePrefixChars = evidence.cachePrefixChars;
  res.farmActivity.cachePrefixSha = evidence.cachePrefixSha;
  res.farmActivity.cachePrefixComparable = evidence.cachePrefixComparable;
}
function markInferenceError(res, value) {
  if (res.farmActivity) res.farmActivity.error = String(value || "Inference failed.").slice(0, 500);
}

/** Describe an image for a TEXT prompt without inlining its bytes.
 *
 *  Every caller of textPart is building a plain string — CLI stdin, command
 *  stdin, or the adapted upstream body — so a base64 data URL pasted in here
 *  never functions as an image, it is just characters. A screenshot could add
 *  ~350k tokens of base64 to EVERY subsequent turn of the conversation for
 *  zero benefit. (Native vision is unaffected: proxyUpstream passes the
 *  original body through and never calls textPart.)
 *
 *  The descriptor is deterministic so it does not break the prompt prefix
 *  between turns — see docs/prompt-cache-evidence.md. */
function imageReference(url) {
  const value = String(url || "");
  if (!value) return "[Image: attached]";
  if (!value.startsWith("data:")) return `[Image: ${value}]`;
  const mime = value.slice(5, value.indexOf(";") === -1 ? 5 : value.indexOf(";")) || "image";
  const base64 = value.slice(value.indexOf(",") + 1);
  const bytes = Math.floor(base64.length * 0.75);
  return `[Image: ${mime}, ${bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`} — inline image data is not carried to this route]`;
}

function textPart(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part.type === "text" || part.type === "input_text") return part.text || "";
    if (part.type === "image_url") return imageReference(part.image_url?.url || part.image_url);
    if (part.type === "image" || part.type === "input_image") return imageReference(part.source?.url || part.image_url);
    if (part.type === "tool_result") return `[Tool result ${part.tool_use_id || ""}]\n${textPart(part.content)}`;
    return `[${part.type || "content"}: ${JSON.stringify(part)}]`;
  }).join("\n");
}

function promptFrom(request, protocol) {
  const messages = protocol === "responses"
    ? (typeof request.input === "string" ? [{ role: "user", content: request.input }] : request.input || [])
    : request.messages || [];
  const lines = [];
  const system = request.system || request.instructions;
  if (system) lines.push(`SYSTEM\n${textPart(system)}`);
  for (const message of messages) lines.push(`${String(message.role || "user").toUpperCase()}\n${textPart(message.content)}`);
  if (request.tools?.length) {
    lines.push(`AVAILABLE CLIENT TOOLS\n${JSON.stringify(request.tools)}\nIf a tool is needed, respond with a tool call object compatible with the caller's protocol. Do not execute these client-owned tools yourself.`);
  }
  if (request.response_format || request.text?.format) {
    lines.push(`RESPONSE FORMAT\n${JSON.stringify(request.response_format || request.text?.format)}`);
  }
  return lines.join("\n\n");
}

function farmPath() {
  return process.env.FARM_CLI || "farm";
}

function numberValue(...values) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function usageDialectForRoute(route) {
  const configured = String(route?.usageDialect || "");
  if (["anthropic-exclusive", "openai-inclusive", "auto"].includes(configured)) return configured;
  if (route?.transport === "anthropic" || route?.provider === "claude") return "anthropic-exclusive";
  if (route?.transport === "openai") return "openai-inclusive";
  return "auto";
}

function normalizeUsage(value, dialect = "auto") {
  return normalizeProviderUsage(value, dialect);
}

function sumUsage(values) {
  return sumTokenUsage(values);
}

/** Convert the gateway's canonical inclusive usage back to Anthropic's wire
 * shape, where input_tokens excludes cache reads and writes. */
function anthropicWireUsage(tokens, { output = true } = {}) {
  const read = Number(tokens?.cached_input_tokens || 0);
  const write = Number(tokens?.cache_creation_input_tokens || 0);
  const usage = {
    input_tokens: Math.max(0, Number(tokens?.input_tokens || 0) - read - write),
    output_tokens: output ? Number(tokens?.output_tokens || 0) : 0,
  };
  if (tokens?.cached_input_tokens_reported) usage.cache_read_input_tokens = read;
  if (tokens?.cache_creation_input_tokens_reported) usage.cache_creation_input_tokens = write;
  return usage;
}

function isGenericToolName(name) {
  const value = String(name || "").trim().toLowerCase();
  return !value || value === "tool" || value === "tool result" || value === "tool_result" || value === "tool_use" || value === "function";
}

function pickToolName(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && !isGenericToolName(candidate)) return candidate.trim();
  }
  return "";
}

/** Infer Claude Code tool names when the wire event only carries a tool_result. */
function inferToolNameFromPayload(input, output) {
  const inObj = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (inObj) {
    if (typeof inObj.command === "string") return "Bash";
    if (typeof inObj.pattern === "string" || typeof inObj.regex === "string") return "Grep";
    if (typeof inObj.glob === "string" || typeof inObj.glob_pattern === "string") return "Glob";
    if (typeof inObj.old_string === "string" || typeof inObj.new_string === "string") return "Edit";
    if (typeof inObj.file_path === "string" || typeof inObj.path === "string") {
      if (typeof inObj.content === "string") return "Write";
      return "Read";
    }
    if (typeof inObj.skill === "string") return "Skill";
    if (typeof inObj.query === "string") return "Search";
  }
  const text = typeof output === "string" ? output
    : Array.isArray(output) ? output.map((part) => (part && part.text) || "").join("\n")
    : output && typeof output === "object" && typeof output.content === "string" ? output.content
    : "";
  if (!text) return "";
  if (/^Launching skill:/i.test(text)) return "Skill";
  if (/^Exit code\b/m.test(text)) return "Bash";
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length && lines.filter((line) => /^[^:\n]+:\d+:/.test(line)).length >= Math.max(1, Math.ceil(lines.length * 0.4))) return "Grep";
  if (lines.length >= 2 && lines.every((line) => /^[./~]/.test(line.trim()) && !line.includes(": "))) return "Glob";
  if (lines.length === 1 && /^[./~]/.test(lines[0].trim()) && !lines[0].includes(" ")) return "Bash";
  if (/\n\s*\d+[\t|]/.test(text) || /^\s*\d+→/.test(text) || /^\s*\d+\t/.test(text)) return "Read";
  return "";
}

function contentParts(event, inner) {
  if (Array.isArray(event.message?.content)) return event.message.content;
  if (Array.isArray(inner.message?.content)) return inner.message.content;
  if (Array.isArray(event.content)) return event.content;
  if (Array.isArray(inner.content)) return inner.content;
  return [];
}

function toolFromPart(part, event, inner, type) {
  if (!part || typeof part !== "object") return null;
  const partType = String(part.type || "").toLowerCase();
  if (!["tool_use", "tool_result", "function_call", "function_response"].includes(partType) && !part.name && !part.tool_use_id) {
    return null;
  }
  const id = String(part.tool_use_id || part.id || event.tool_use_id || event.toolId || event.tool_id || randomUUID());
  const input = part.input || part.arguments || inner.input || event.input || event.parameters || null;
  const output = part.content ?? part.output ?? inner.output ?? event.output ?? event.result ?? event.error ?? null;
  const isResult = partType.includes("result") || partType.includes("response") || output != null && partType !== "tool_use";
  let name = pickToolName(
    part.name,
    part.tool_name,
    event.toolName,
    event.tool_name,
    inner.name,
    event.name,
    inner.tool?.name,
    event.tool?.name,
  );
  if (!name) name = inferToolNameFromPayload(input, output);
  if (!name) name = isResult ? "tool result" : "tool";
  const status = type.includes("error") || part.status === "failed" ? "error"
    : type.includes("denied") ? "denied"
    : isResult || part.status === "completed" || type.includes("result") || type.includes("complete") ? "completed"
    : "running";
  return { id, name, status, input, output };
}

function normalizeProviderEvent(event, usageDialect = "auto") {
  if (!event || typeof event !== "object") return null;
  const inner = event.event && typeof event.event === "object" ? event.event : event;
  const type = [event.type, event.subtype, inner.type, inner.subtype, inner.delta?.type].filter(Boolean).join(".").toLowerCase();
  const reasoningDelta = [
    inner.delta?.thinking,
    inner.delta?.reasoning,
    inner.thinking,
    inner.reasoning,
    event.thinking,
    event.reasoning,
    // Claude text deltas — surface as reasoning live so the trace is not empty.
    (inner.delta?.type === "text_delta" || inner.delta?.type === "input_json_delta") ? null : inner.delta?.text,
    typeof inner.delta?.text === "string" && (type.includes("thinking") || type.includes("reasoning")) ? inner.delta.text : null,
  ].find((value) => typeof value === "string" && value.length) || "";
  // Live assistant text (not thinking) — callers may stream as content.
  const textDelta = (() => {
    if (typeof inner.delta?.text === "string" && (inner.delta?.type === "text_delta" || type.includes("text_delta") || type.includes("content_block_delta"))) {
      if (type.includes("thinking") || type.includes("reasoning")) return "";
      return inner.delta.text;
    }
    return "";
  })();

  const tools = [];
  const parts = contentParts(event, inner);
  for (const part of parts) {
    const tool = toolFromPart(part, event, inner, type);
    if (tool) tools.push(tool);
  }
  const block = inner.content_block || event.content_block;
  if (block && (block.type === "tool_use" || block.type === "tool_result")) {
    const tool = toolFromPart(block, event, inner, type);
    if (tool && !tools.some((item) => item.id === tool.id && item.name === tool.name)) tools.push(tool);
  }
  const item = inner.item || event.item;
  if (item && /tool|command|function/.test(String(item.type || item.name || "").toLowerCase())) {
    const tool = toolFromPart({ ...item, type: item.type || "tool_use" }, event, inner, type);
    if (tool) tools.push(tool);
  }
  if (!tools.length && (type.includes("tool") || event.toolName || event.tool_name || event.tool || inner.tool)) {
    const tool = toolFromPart({
      type: type.includes("result") ? "tool_result" : "tool_use",
      id: event.tool_use_id || event.toolId || event.tool_id,
      tool_use_id: event.tool_use_id,
      name: event.toolName || event.tool_name || inner.name || event.name,
      input: inner.input || event.input || event.parameters,
      content: inner.output || event.output || event.result || event.error,
    }, event, inner, type);
    if (tool) tools.push(tool);
  }

  const rateLimit = event.type === "rate_limit_event" ? {
    status: event.rate_limit_info?.status,
    window: event.rate_limit_info?.rateLimitType,
    resetsAt: event.rate_limit_info?.resetsAt,
    overageStatus: event.rate_limit_info?.overageStatus,
  } : undefined;
  const models = event.modelUsage && typeof event.modelUsage === "object"
    ? Object.entries(event.modelUsage).map(([model, item]) => ({ model, usage: normalizeUsage({ usage: item }, usageDialect), costUsd: item?.costUSD, contextWindow: item?.contextWindow }))
    : undefined;

  if (!tools.length && !reasoningDelta && !textDelta && !rateLimit && !models && !normalizeUsage(event, usageDialect)) {
    // Keep non-empty provider noise out of the trace unless it is usage-related.
    if (!type || type === "stream_event" || type === "event") return null;
  }

  return {
    type: "provider_event",
    eventType: type || "event",
    reasoningDelta,
    textDelta,
    tool: tools[0] || undefined,
    tools,
    usage: normalizeUsage(event, usageDialect),
    model: inner.message?.model || inner.model || event.model,
    permissionMode: event.permissionMode || inner.permissionMode,
    models,
    rateLimit,
    costUsd: numberValue(event.total_cost_usd, event.cost_usd, event.costUSD),
    durationMs: numberValue(event.duration_ms, event.durationMs),
    ttftMs: numberValue(event.ttft_ms, event.ttftMs),
    timestamp: new Date().toISOString(),
  };
}

function persistProviderUsage(route, event) {
  if (!route?.provider || !route?.account || (!event?.rateLimit && !event?.usage)) return;
  const directory = join(state, "usage", route.account);
  const path = join(directory, `${route.provider}.json`);
  mkdirSync(directory, { recursive: true });
  const previous = readJson(path, {});
  writeFileSync(path, JSON.stringify({
    ...previous,
    provider: route.provider,
    account: route.account,
    updatedAt: new Date().toISOString(),
    source: "live-event",
    usage: event.usage || previous.usage,
    rateLimit: event.rateLimit || previous.rateLimit,
    models: event.models || previous.models,
    costUsd: event.costUsd ?? previous.costUsd,
  }, null, 2));
}

/** Strip Claude CLI scaffolding that must never surface as the user-visible reply. */
function scrubAssistantText(text) {
  if (!text || typeof text !== "string") return "";
  let value = text
    // system-reminder blocks (user echo, skill instructions, …)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    // truncated scaffolding that starts mid-sentence (seen when a later event
    // overwrote the real answer with a skill-list fragment)
    .replace(/^[\s\S]*?-facing instructions for the user-invocable commands[\s\S]*?(?=\n\n|$)/i, "")
    .replace(/Do not invoke a skill unless it is listed above[\s\S]*?(?=\n\n|$)/gi, "")
    .trim();
  // If scrubbing emptied a pure-scaffolding payload, keep empty so caller can fall back.
  if (/^the user has sent the following message:/i.test(value)) return "";
  return value;
}

function textFromContentParts(content) {
  if (typeof content === "string") return scrubAssistantText(content);
  if (!Array.isArray(content)) return "";
  const joined = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      // Only plain assistant text — never tool_use / tool_result bodies.
      if (part.type && part.type !== "text") return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .join("");
  return scrubAssistantText(joined);
}

function providerOutput(stdout, usageDialect = "auto") {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  // Prefer Claude CLI's terminal `result` event; never last-write-wins on every line
  // (that was promoting system-reminder / skill scaffolding into the chat body).
  let resultText = "";
  let assistantText = "";
  let streamedText = "";
  const reasoning = [];
  const tools = [];
  let latestUsage = null;
  let rateLimit;
  let models;
  let costUsd;
  let durationMs;
  let ttftMs;
  for (const line of lines) {
    try {
      const source = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!source || source === "[DONE]") continue;
      const event = JSON.parse(source);
      const normalized = normalizeProviderEvent(event, usageDialect);
      if (normalized?.usage) latestUsage = normalized.usage;
      if (normalized?.rateLimit) rateLimit = normalized.rateLimit;
      if (normalized?.models?.length) models = normalized.models;
      if (normalized?.costUsd != null) costUsd = normalized.costUsd;
      if (normalized?.durationMs != null) durationMs = normalized.durationMs;
      if (normalized?.ttftMs != null) ttftMs = normalized.ttftMs;
      if (normalized?.reasoningDelta) reasoning.push(normalized.reasoningDelta);

      const type = String(event.type || "").toLowerCase();
      const role = String(event.message?.role || event.role || "").toLowerCase();

      // 1) Official CLI completion event — highest priority.
      if (typeof event.result === "string" && event.result.length) {
        const cleaned = scrubAssistantText(event.result);
        if (cleaned) resultText = cleaned;
      }

      // 2) Assistant messages (full or partial) — accumulate text parts only.
      if ((type === "assistant" || role === "assistant") && event.message?.content != null) {
        const piece = textFromContentParts(event.message.content);
        if (piece) assistantText = piece; // latest complete assistant message wins
      } else if (event.item?.type === "agent_message" && typeof event.item.text === "string") {
        const cleaned = scrubAssistantText(event.item.text);
        if (cleaned) assistantText = cleaned;
      } else if (typeof event.text === "string" && event.text.length) {
        const cleaned = scrubAssistantText(event.text);
        if (cleaned) assistantText = cleaned;
      }

      // 3) Streamed text deltas from content_block_delta (not thinking).
      if (normalized?.textDelta) streamedText += normalized.textDelta;

      // Tools — prefer the structured normalize path when present.
      if (normalized?.tools?.length) {
        for (const tool of normalized.tools) {
          const idx = tools.findIndex((item) => item.id === tool.id);
          if (idx >= 0) tools[idx] = { ...tools[idx], ...tool };
          else tools.push(tool);
        }
      }
    } catch {
      // Ignore non-JSON noise; never promote raw lines to final answer.
    }
  }

  const text = scrubAssistantText(resultText || assistantText || streamedText);
  return {
    text,
    reasoning: reasoning.join(""),
    tools,
    usage: latestUsage,
    rateLimit,
    models,
    costUsd,
    durationMs,
    ttftMs,
  };
}

function extractText(stdout) {
  return providerOutput(stdout).text;
}

function decodeCommandChunk(format, state, chunk, flush = false) {
  if (format === "text") return { text: String(chunk), reasoning: "", tools: [] };
  state.buffer += String(chunk);
  const lines = state.buffer.split(/\r?\n/);
  state.buffer = flush ? "" : (lines.pop() || "");
  if (flush && state.buffer) lines.push(state.buffer);
  const decoded = lines
    .map((line) => line.trim())
    .filter((line) => line && (format !== "sse" || line.startsWith("data:")))
    .map(providerOutput);
  return {
    text: decoded.map((item) => item.text).filter(Boolean).join(""),
    reasoning: decoded.map((item) => item.reasoning).filter(Boolean).join("\n"),
    tools: decoded.flatMap((item) => item.tools),
  };
}

/** api-exec argv for a CLI route — pure so tests can pin the mapping.
 *  Catalog model/effort from the composer cascade win over the route's
 *  pinned upstream model (spec D 2026-07-15). */
function cliArgs(route, request) {
  const args = ["api-exec", route.provider, route.account];
  const catalogModel = String(request.farm?.model || "").trim();
  if (catalogModel) args.push("--model", catalogModel);
  else if (route.upstreamModel) args.push("--model", route.upstreamModel);
  const effort = String(request.farm?.effort || "").trim();
  if (effort) args.push("--effort", effort);
  args.push("--permissions", String(request.farm?.permissions || route.permissions || "ask"));
  args.push("--sandbox", String(request.farm?.sandbox || "workspace-write"));
  args.push("--network", String(request.farm?.network || "ask"));
  const toolPermissions = request.farm?.tool_permissions || {};
  const allowedTools = Object.entries(toolPermissions).filter(([, policy]) => policy === "allow").map(([name]) => name);
  const deniedTools = Object.entries(toolPermissions).filter(([, policy]) => policy === "deny").map(([name]) => name);
  if (allowedTools.length) args.push("--allowed-tools", allowedTools.join(","));
  if (deniedTools.length) args.push("--disallowed-tools", deniedTools.join(","));
  // Project folder: request wins, then desktop workspace.json, then route.cwd.
  // Absolute paths land api-exec in that directory (not ~/.claude-farm/work).
  const cwd = String(
    request.farm?.cwd || request.farm?.projectRoot || route.cwd || workspaceRoot() || "",
  ).trim();
  if (cwd) args.push("--dir", cwd);
  return args;
}

function runCli(route, request, protocol, signal, onEvent) {
  return new Promise((resolve, reject) => {
    const args = cliArgs(route, request);
    const child = spawn(farmPath(), args, { env: { ...process.env, FARM_STATE: state }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let lineBuffer = "";
    // tool_use id → human name. Claude's tool_result events only carry tool_use_id.
    const toolNamesById = new Map();
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    const observe = (chunk, flush = false) => {
      lineBuffer += String(chunk);
      const lines = lineBuffer.split(/\r?\n/);
      const remainder = lines.pop() || "";
      lineBuffer = flush ? "" : remainder;
      if (flush && remainder) lines.push(remainder);
      for (const line of lines) {
        const source = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
        if (!source || source === "[DONE]") continue;
        try {
          const normalized = normalizeProviderEvent(JSON.parse(source), usageDialectForRoute(route));
          if (normalized) {
            const list = Array.isArray(normalized.tools) && normalized.tools.length
              ? normalized.tools
              : (normalized.tool ? [normalized.tool] : []);
            for (const tool of list) {
              if (!tool?.id) continue;
              if (!isGenericToolName(tool.name)) toolNamesById.set(tool.id, tool.name);
              else if (toolNamesById.has(tool.id)) tool.name = toolNamesById.get(tool.id);
              else {
                const inferred = inferToolNameFromPayload(tool.input, tool.output);
                if (inferred) {
                  tool.name = inferred;
                  toolNamesById.set(tool.id, inferred);
                }
              }
            }
            persistProviderUsage(route, normalized);
            if (list.length) {
              for (const tool of list) onEvent?.({ ...normalized, tool, tools: undefined });
            } else {
              onEvent?.(normalized);
            }
          }
        } catch { onEvent?.({ type: "provider_event", eventType: "stdout", timestamp: new Date().toISOString() }); }
      }
    };
    child.stdout.on("data", (chunk) => { stdout += chunk; observe(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      observe("", true);
      if (signal?.aborted) return reject(new Error("Request stopped."));
      if (code !== 0) reject(new Error(stderr.trim() || `Provider exited with code ${code}.`));
      else resolve({ ...providerOutput(stdout, usageDialectForRoute(route)), raw: stdout });
    });
    child.stdin.end(promptFrom(request, protocol));
  });
}

function commandParts(route, prompt) {
  const args = Array.isArray(route.args) ? route.args.map(String) : [];
  if (route.inputMode === "argument") {
    let replaced = false;
    const next = args.map((arg) => {
      if (!arg.includes("{{prompt}}")) return arg;
      replaced = true;
      return arg.replaceAll("{{prompt}}", prompt);
    });
    if (!replaced) next.push(prompt);
    return next;
  }
  return args;
}

function runCommand(route, request, protocol, signal) {
  return new Promise((resolve, reject) => {
    const executable = String(route.command || "").trim();
    if (!executable) return reject(new Error(`Command route '${route.id}' has no executable.`));
    const prompt = promptFrom(request, protocol);
    const child = spawn(executable, commandParts(route, prompt), {
      cwd: route.cwd || process.cwd(),
      env: { ...process.env, FARM_STATE: state, USAGE_FARM_MODEL: route.id, USAGE_FARM_PERMISSIONS: request.farm?.permissions || route.permissions || "ask" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("Request stopped."));
      if (code !== 0) reject(new Error(stderr.trim() || `Command exited with code ${code}.`));
      else resolve({ ...providerOutput(stdout), raw: stdout });
    });
    if (route.inputMode === "argument") child.stdin.end();
    else child.stdin.end(prompt);
  });
}

function routeRequest(route, request) {
  const toolsAllowed = request.farm?.tools !== false;
  const mode = String(request.farm?.mode || "chat");
  const equipment = [
    mode === "configure" ? "Configuration mode: focus on inspecting and improving account, profile, route, skill, tool, and MCP configuration. Explain consequential changes." : "",
    mode === "test" ? "Test mode: exercise the selected route critically, make checks observable, and distinguish verified behavior from assumptions." : "",
    route.systemPrompt,
    route.skills?.length ? `Enabled skills: ${route.skills.join(", ")}` : "",
    toolsAllowed && route.tools?.length ? `Enabled tools: ${route.tools.join(", ")}` : "",
    !toolsAllowed ? "Tools are disabled for this turn. Do not invoke tools or MCP servers." : "",
    toolsAllowed && route.mcp?.length ? `Enabled MCP servers: ${route.mcp.join(", ")}` : "",
    route.permissions ? `Permission policy: ${route.permissions}` : "",
    `Filesystem sandbox: ${request.farm?.sandbox || "workspace-write"}.`,
    `Network policy: ${request.farm?.network || "ask"}.`,
    Object.keys(request.farm?.tool_permissions || {}).length ? `Per-tool policy: ${JSON.stringify(request.farm.tool_permissions)}. Denied tools must not be invoked; tools marked ask require approval.` : "",
  ].filter(Boolean).join("\n");
  return { ...request, tools: toolsAllowed ? request.tools : [], system: [equipment, request.system].filter(Boolean).join("\n\n"), instructions: [equipment, request.instructions].filter(Boolean).join("\n\n") };
}

// ---- Anchor workflow -------------------------------------------------------
// One pinned member owns the conversation and decides what to hand out; workers
// execute self-contained briefs and never see the transcript. The win is
// VOLUME, not caching — see docs/prompt-cache-evidence.md.

const ANCHOR_FOLD_CHAR_CAP = 24_000;
const ANCHOR_BRIEF_CHAR_CAP = 24_000;

const ANCHOR_CHARTER = [
  "You are the anchor for this conversation. You hold the full history; the specialists you delegate to hold none of it.",
  "When a self-contained piece of work would be better executed by a specialist, emit a delegation block:",
  "```farm-delegate",
  '{"id":"t1","objective":"...","context":"...","constraints":"...","deliverable":"..."}',
  "```",
  "The specialist sees ONLY those four fields — never this conversation, never the user's earlier messages, never your reasoning. Anything it needs must be written into `context` verbatim.",
  "Emit the block only when it genuinely helps; answer directly otherwise. Never emit more than one block per reply.",
  "After a WORKER RESULT is folded in, use it to answer the user. Do not delegate the same work twice.",
].join("\n");

const WORKER_CONTRACT = [
  "You are executing one scoped task for an orchestrator that holds the full conversation.",
  "Everything you need is below — you cannot see the conversation, and you must not ask for it.",
  "Do the task and report the deliverable. State assumptions instead of asking clarifying questions.",
  "Do not restate the task and do not propose follow-up work.",
].join(" ");

/** Pull the first delegation directive out of an anchor reply.
 *  Never throws: a malformed block simply means "no delegation", which
 *  degrades to a plain single-model answer. */
function parseDelegate(text) {
  const match = /```farm-delegate\s*([\s\S]*?)```/.exec(String(text || ""));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed !== "object") return null;
    const objective = String(parsed.objective || "").trim();
    if (!objective) return null;
    return {
      id: String(parsed.id || "t1").slice(0, 40),
      objective,
      context: String(parsed.context || "").trim(),
      constraints: String(parsed.constraints || "").trim(),
      deliverable: String(parsed.deliverable || "").trim(),
      route: typeof parsed.route === "string" ? parsed.route : null,
    };
  } catch {
    log("anchor: delegation block was not valid JSON — answering without a worker");
    return null;
  }
}

function stripDelegateBlocks(text) {
  return String(text || "").replace(/```farm-delegate\s*[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function clampText(value, cap) {
  const text = String(value || "");
  if (text.length <= cap) return text;
  const head = Math.floor(cap * 0.7);
  const tail = cap - head;
  return `${text.slice(0, head)}\n\n…[${text.length - cap} characters elided]…\n\n${text.slice(-tail)}`;
}

/** The ENTIRE prompt a worker receives. No transcript, by construction — this
 *  is the mechanism the whole design exists for. */
function buildBrief(directive) {
  return clampText([
    `TASK ${directive.id}`,
    directive.objective,
    "",
    "CONTEXT",
    directive.context || "(none supplied)",
    "",
    "CONSTRAINTS",
    directive.constraints || "(none)",
    "",
    "DELIVERABLE",
    directive.deliverable || "The completed work.",
  ].join("\n"), ANCHOR_BRIEF_CHAR_CAP);
}

async function runAnchorWorkflow({ route, workflow, workflowMembers, prepared, request, runMember, signal }) {
  const anchorId = workflow.anchor || workflowMembers[0];
  const declaredWorkers = (Array.isArray(workflow.workers) && workflow.workers.length
    ? workflow.workers
    : workflowMembers.filter((id) => id !== anchorId));
  // `rota` as the default pool is the point: the anchor stays put, the silo
  // under each worker rotates.
  const workers = declaredWorkers.length ? declaredWorkers : ["rota"];
  const maxDelegations = Math.min(3, Math.max(0, Number(workflow.maxDelegations ?? 1)));
  const foldCap = Number(workflow.foldCharCap) > 0 ? Number(workflow.foldCharCap) : ANCHOR_FOLD_CHAR_CAP;
  const readOnly = workflow.anchorReadOnly !== false;
  const sessionKey = request.farm?.session_id || null;

  // The anchor's request: charter in the system block, its own pinned model,
  // and plan mode so it cannot quietly do the work itself.
  const anchorRequest = (conversation) => ({
    ...conversation,
    system: [ANCHOR_CHARTER, conversation.system].filter(Boolean).join("\n\n"),
    instructions: [ANCHOR_CHARTER, conversation.instructions].filter(Boolean).join("\n\n"),
    farm: {
      ...conversation.farm,
      ...(workflow.anchorModel ? { model: workflow.anchorModel } : {}),
      ...(readOnly ? { permissions: "read-only" } : {}),
    },
  });

  let conversation = prepared;
  let anchorTurn = await runMember({ id: anchorId, index: 0, role: "anchor", request: anchorRequest(conversation), sessionKey });
  const results = [anchorTurn];

  for (let round = 0; round < maxDelegations; round += 1) {
    if (signal?.aborted) throw new Error("Request stopped.");
    const directive = parseDelegate(anchorTurn.text);
    if (!directive) break;

    const brief = buildBrief(directive);
    const workerId = directive.route || workers[round % workers.length];
    const worker = await runMember({
      id: workerId,
      index: round,
      role: "worker",
      request: {
        ...prepared,
        // History-REPLACING, exactly like the existing synthesize pass.
        system: WORKER_CONTRACT,
        instructions: WORKER_CONTRACT,
        messages: [{ role: "user", content: brief }],
        input: brief,
        tools: [],
        farm: { ...prepared.farm, ...(workflow.workerModel ? { model: workflow.workerModel } : {}) },
      },
    });
    results.push(worker);

    // Append-only fold-back: the anchor's own turn verbatim, then the result.
    conversation = {
      ...conversation,
      messages: [
        ...(conversation.messages || []),
        { role: "assistant", content: anchorTurn.text || "" },
        { role: "user", content: `WORKER RESULT (${worker.account || workerId} · task ${directive.id})\n\n${clampText(worker.text, foldCap)}` },
      ],
    };
    anchorTurn = await runMember({ id: anchorId, index: round + 1, role: "anchor", request: anchorRequest(conversation), sessionKey });
    results.push(anchorTurn);
  }

  return {
    ...anchorTurn,
    text: stripDelegateBlocks(anchorTurn.text) || anchorTurn.text,
    usage: sumUsage(results.map((item) => item.usage)),
  };
}

async function executeRoute(route, request, protocol, signal, stack = [], onEvent) {
  if (signal?.aborted) throw new Error("Request stopped.");
  if (stack.includes(route.id)) throw new Error(`Hybrid route cycle: ${[...stack, route.id].join(" -> ")}`);
  const prepared = routeRequest(route, request);
  if (route.transport === "cli") return runCli(route, prepared, protocol, signal, onEvent);
  if (route.transport === "command") return runCommand(route, prepared, protocol, signal);
  if (route.transport !== "hybrid") return runUpstreamAdapted(route, prepared, protocol);

  const workflow = route.workflow && typeof route.workflow === "object" ? route.workflow : {};
  const members = Array.isArray(route.members) ? route.members : [];
  const workflowMembers = Array.isArray(workflow.members) && workflow.members.length ? workflow.members : members;
  if (!workflowMembers.length) throw new Error(`Hybrid route '${route.id}' has no members.`);
  const workflowKind = workflow.kind || route.strategy || "parallel";
  const repeats = Math.min(8, Math.max(1, Number(workflow.repeats || route.repeats || 1)));
  const jobs = workflowMembers.flatMap((id) => Array.from({ length: repeats }, (_, index) => ({ id, index })));
  const runMember = async ({ id, index, request = prepared, role = "member", sessionKey = null }) => {
    // Workers resolve `rota` per dispatch, so a worker pool of ["rota"] rotates
    // for free. sessionKey is deliberately NOT passed for workers — pinning
    // them would defeat rotation.
    const member = routeFor(id, sessionKey);
    if (!member) throw new Error(`Hybrid member '${id}' was not found.`);
    const memberId = `${id}:${index + 1}`;
    const startedAt = new Date().toISOString();
    onEvent?.({ type: "member_start", memberId, route: id, run: index + 1, role, status: "running", startedAt });
    try {
      const result = await executeRoute(member, request, protocol, signal, [...stack, route.id], (event) => onEvent?.({ ...event, memberId, route: id, run: index + 1, role }));
      onEvent?.({ type: "member_done", memberId, route: id, run: index + 1, role, status: "completed", output: result.text, usage: result.usage, rateLimit: result.rateLimit, models: result.models, costUsd: result.costUsd, durationMs: result.durationMs, ttftMs: result.ttftMs, completedAt: new Date().toISOString() });
      return { ...result, id, index, account: member.account || null };
    } catch (error) {
      onEvent?.({ type: "member_error", memberId, route: id, run: index + 1, role, status: signal?.aborted ? "stopped" : "error", error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() });
      throw error;
    }
  };
  if (workflowKind === "anchor") return await runAnchorWorkflow({ route, workflow, workflowMembers, prepared, request, runMember, signal });
  if (workflowKind === "single") return await runMember({ id: workflow.activeMember || workflowMembers[0], index: 0 });
  if (workflowKind === "cascade") {
    const errors = [];
    for (const id of workflowMembers) {
      try {
        return await runMember({ id, index: 0 });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(errors.filter(Boolean).join("; ") || "Every cascade member failed.");
  }
  if (workflowKind === "chain") {
    let current = prepared;
    let finalResult;
    const results = [];
    for (const id of workflowMembers) {
      const result = await runMember({ id, index: 0, request: current });
      results.push(result);
      finalResult = result;
      const previous = String(result.text || result.raw || "");
      current = {
        ...prepared,
        messages: [...(prepared.messages || []), { role: "user", content: `Previous workflow stage output:\n\n${previous}` }],
        input: [prepared.input, `Previous workflow stage output:\n\n${previous}`].filter(Boolean).join("\n\n"),
      };
    }
    return { ...finalResult, usage: sumUsage(results.map((result) => result.usage)) };
  }
  if (workflowKind === "race") return Promise.any(jobs.map(runMember));
  const settled = await Promise.allSettled(jobs.map(runMember));
  const results = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
  if (!results.length) throw new Error(settled.map((item) => item.status === "rejected" ? item.reason?.message : "").filter(Boolean).join("; ") || "Every hybrid member failed.");
  const panel = results.map((result) => `## ${result.id}${repeats > 1 ? ` · run ${result.index + 1}` : ""}\n\n${result.text}`).join("\n\n---\n\n");
  const memberUsage = sumUsage(results.map((result) => result.usage));
  if (workflowKind !== "synthesize") return { text: panel, raw: panel, usage: memberUsage };
  const synthId = workflow.synthesizer || route.synthesizer || workflowMembers[0];
  const synthesizer = routeFor(synthId);
  if (!synthesizer) throw new Error(`Synthesizer '${synthId}' was not found.`);
  const synthesis = { ...prepared, messages: [{ role: "user", content: `Synthesize the following specialist outputs into one answer. Preserve disagreements and attribute material claims.\n\n${panel}` }], input: `Synthesize the following specialist outputs into one answer. Preserve disagreements and attribute material claims.\n\n${panel}` };
  const memberId = `synthesis:${synthId}`;
  onEvent?.({ type: "member_start", memberId, route: synthId, run: 1, role: "synthesizer", status: "running", startedAt: new Date().toISOString() });
  try {
    const result = await executeRoute(synthesizer, synthesis, protocol, signal, [...stack, route.id], (event) => onEvent?.({ ...event, memberId, route: synthId, run: 1, role: "synthesizer" }));
    onEvent?.({ type: "member_done", memberId, route: synthId, run: 1, role: "synthesizer", status: "completed", output: result.text, usage: result.usage, rateLimit: result.rateLimit, models: result.models, costUsd: result.costUsd, durationMs: result.durationMs, ttftMs: result.ttftMs, completedAt: new Date().toISOString() });
    return { ...result, usage: sumUsage([memberUsage, result.usage]) };
  } catch (error) {
    onEvent?.({ type: "member_error", memberId, route: synthId, run: 1, role: "synthesizer", status: signal?.aborted ? "stopped" : "error", error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() });
    throw error;
  }
}

function usageFromUpstreamBody(text, dialect) {
  let usage = null;
  const observe = (value) => {
    usage = mergeUsageSnapshots(usage, normalizeUsage(value, dialect));
  };
  try {
    observe(JSON.parse(text));
    return usage;
  } catch { /* a streaming response is SSE, not one JSON object */ }
  for (const line of String(text || "").split(/\r?\n/)) {
    const source = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!source || source === "[DONE]") continue;
    try { observe(JSON.parse(source)); } catch { /* provider event without JSON */ }
  }
  return usage;
}

async function proxyUpstream(req, res, route, suffix, requestBody) {
  const base = String(route.baseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error(`Route '${route.id}' has no baseUrl.`);
  const key = readRouteApiKey(route, process.env, { stateRoot: state });
  const headers = { "content-type": "application/json" };
  const dialect = usageDialectForRoute(route);
  const body = route.transport === "anthropic"
    ? applyAnthropicPromptCaching(requestBody, { enabled: route.promptCaching !== false })
    : requestBody;
  if (route.transport === "anthropic") {
    setInferenceCachePrefix(res, cachePrefixEvidence(body));
  }
  if (route.transport === "anthropic") {
    if (key) headers["x-api-key"] = key;
    headers["anthropic-version"] = req.headers["anthropic-version"] || "2023-06-01";
  } else if (key) headers.authorization = `Bearer ${key}`;
  const upstream = await fetch(`${base}${suffix}`, { method: "POST", headers, body: JSON.stringify({ ...body, model: route.upstreamModel || body.model }) });
  res.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([name]) => !["content-encoding", "content-length", "transfer-encoding"].includes(name.toLowerCase()))));
  let observed = "";
  const decoder = new TextDecoder();
  if (upstream.body) {
    for await (const chunk of upstream.body) {
      if (observed.length < 8 * 1024 * 1024) observed += decoder.decode(chunk, { stream: true });
      res.write(chunk);
    }
    if (observed.length < 8 * 1024 * 1024) observed += decoder.decode();
  }
  const usage = usageFromUpstreamBody(observed, dialect);
  if (usage) setInferenceUsage(res, usage);
  res.end();
}

async function runUpstreamAdapted(route, request, protocol) {
  const base = String(route.baseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error(`Route '${route.id}' has no baseUrl.`);
  const key = readRouteApiKey(route, process.env, { stateRoot: state });

  if (route.transport === "openai") {
    const sourceMessages = protocol === "responses"
      ? (typeof request.input === "string" ? [{ role: "user", content: request.input }] : request.input || [])
      : request.messages || [];
    const messages = [];
    if (request.system) messages.push({ role: "system", content: textPart(request.system) });
    for (const message of sourceMessages) messages.push({ role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user", content: textPart(message.content) });
    const tools = request.tools?.map((tool) => tool.type === "function" ? tool : ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema || { type: "object" } } }));
    const headers = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const upstream = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: route.upstreamModel || request.model, messages, tools, tool_choice: request.tool_choice, max_tokens: request.max_tokens || request.max_output_tokens, temperature: request.temperature, stream: false }),
    });
    const value = await upstream.json();
    if (!upstream.ok) throw new Error(value?.error?.message || `OpenAI upstream returned ${upstream.status}.`);
    return { text: textPart(value.choices?.[0]?.message?.content), raw: JSON.stringify(value), usage: normalizeUsage(value, usageDialectForRoute(route)) };
  }

  const sourceMessages = protocol === "responses"
    ? (typeof request.input === "string" ? [{ role: "user", content: request.input }] : request.input || [])
    : request.messages || [];
  const systemParts = [];
  const messages = [];
  if (request.instructions || request.system) systemParts.push(textPart(request.instructions || request.system));
  for (const message of sourceMessages) {
    if (message.role === "system") systemParts.push(textPart(message.content));
    else messages.push({ role: message.role === "assistant" ? "assistant" : "user", content: textPart(message.content) });
  }
  const tools = request.tools?.map((tool) => tool.type === "function"
    ? { name: tool.function?.name || tool.name, description: tool.function?.description || tool.description, input_schema: tool.function?.parameters || tool.parameters || { type: "object" } }
    : tool);
  const body = applyAnthropicPromptCaching({
    model: route.upstreamModel || request.model,
    messages,
    system: systemParts.join("\n\n") || undefined,
    tools,
    tool_choice: request.tool_choice,
    max_tokens: request.max_tokens || request.max_output_tokens || 4096,
    temperature: request.temperature,
    stream: false,
  }, { enabled: route.promptCaching !== false });
  const headers = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (key) headers["x-api-key"] = key;
  const upstream = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const value = await upstream.json();
  if (!upstream.ok) throw new Error(value?.error?.message || `Anthropic upstream returned ${upstream.status}.`);
  return {
    text: textPart(value.content),
    raw: JSON.stringify(value),
    usage: normalizeUsage(value, usageDialectForRoute(route)),
    cachePrefix: cachePrefixEvidence(body),
  };
}

function usage(input, output) {
  const count = (value) => Math.ceil(String(value || "").length / 4);
  return {
    input_tokens: count(input),
    output_tokens: count(output),
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    total_tokens: count(input) + count(output),
    cached_input_tokens_reported: false,
    cache_creation_input_tokens_reported: false,
    total_tokens_reported: false,
    usage_dialect: "auto",
    cache_status: "unreported",
    estimated: true,
  };
}

function chunks(text, size = 56) {
  const result = [];
  for (let i = 0; i < text.length; i += size) result.push(text.slice(i, i + size));
  return result.length ? result : [""];
}

function sseHeaders(res) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
}

function streamChat(res, model, text, input, farm = {}) {
  setInferenceUsage(res, farm.usage || usage(input, text));
  sseHeaders(res);
  const id = `chatcmpl_${randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(Date.now() / 1000);
  const event = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  event({ role: "assistant", content: "", farm });
  for (const delta of chunks(text)) event({ content: delta });
  event({}, "stop");
  res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage: farm.usage || usage(input, text) })}\n\n`);
  res.end("data: [DONE]\n\n");
}

function streamObservedChat(req, res, route, request) {
  sseHeaders(res);
  const id = `chatcmpl_${randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  let finished = false;
  const event = (delta, finish_reason = null) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  };
  const observed = (farmEvent) => event({ content: "", farm: { event: farmEvent } });
  const run = async () => {
    event({ role: "assistant", content: "", farm: { trace: true } });
    let result;
    try {
      if (route.transport === "hybrid") {
        result = await executeRoute(route, request, "chat", controller.signal, [], observed);
      } else {
        const memberId = `${route.id}:1`;
        observed({ type: "member_start", memberId, route: route.id, run: 1, role: "member", status: "running", startedAt: new Date().toISOString() });
        result = await executeRoute(route, request, "chat", controller.signal, [], (providerEvent) => observed({ ...providerEvent, memberId, route: route.id, run: 1, role: "member" }));
        observed({ type: "member_done", memberId, route: route.id, run: 1, role: "member", status: "completed", output: result.text, usage: result.usage, rateLimit: result.rateLimit, models: result.models, costUsd: result.costUsd, durationMs: result.durationMs, ttftMs: result.ttftMs, completedAt: new Date().toISOString() });
      }
      for (const delta of chunks(result.text)) event({ content: delta });
      event({}, "stop");
      const input = promptFrom(request, "chat");
      if (!res.writableEnded) {
        const tokens = result.usage || usage(input, result.text);
        setInferenceUsage(res, tokens);
        res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: request.model, choices: [], usage: tokens })}\n\n`);
        res.end("data: [DONE]\n\n");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markInferenceError(res, message);
      observed({ type: "trace_error", status: controller.signal.aborted ? "stopped" : "error", error: message, completedAt: new Date().toISOString() });
      event({ content: controller.signal.aborted ? "Response stopped." : `Gateway error: ${message}` });
      event({}, "stop");
      if (!res.writableEnded) res.end("data: [DONE]\n\n");
    } finally {
      finished = true;
    }
  };
  res.on("close", () => { if (!finished) controller.abort(); });
  void run();
}

function streamCommandChat(req, res, route, request) {
  sseHeaders(res);
  const id = `chatcmpl_${randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(Date.now() / 1000);
  const prepared = routeRequest(route, request);
  const prompt = promptFrom(prepared, "chat");
  const executable = String(route.command || "").trim();
  if (!executable) {
    markInferenceError(res, `Command route '${route.id}' has no executable.`);
    return res.end(`data: ${JSON.stringify({ error: { message: `Command route '${route.id}' has no executable.`, type: "gateway_error" } })}\n\ndata: [DONE]\n\n`);
  }
  const child = spawn(executable, commandParts(route, prompt), {
    cwd: route.cwd || process.cwd(),
    env: { ...process.env, FARM_STATE: state, USAGE_FARM_MODEL: route.id, USAGE_FARM_PERMISSIONS: request.farm?.permissions || route.permissions || "ask" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const parser = { buffer: "" }; let output = ""; let stderr = ""; let finished = false;
  const event = (delta, finish_reason = null) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  };
  const emitDecoded = (decoded) => {
    if (decoded.reasoning || decoded.tools.length) event({ content: "", farm: { reasoning: decoded.reasoning, tools: decoded.tools } });
    if (decoded.text) { output += decoded.text; event({ content: decoded.text }); }
  };
  const finish = (reason = "stop") => {
    if (finished) return; finished = true;
    emitDecoded(decodeCommandChunk(route.streamFormat || "ndjson", parser, "", true));
    event({}, reason);
    if (!res.writableEnded) {
      const tokens = usage(prompt, output);
      setInferenceUsage(res, tokens);
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: request.model, choices: [], usage: tokens })}\n\n`);
      res.end("data: [DONE]\n\n");
    }
  };
  event({ role: "assistant", content: "", farm: { reasoning: "", tools: [] } });
  child.stdout.on("data", (chunk) => emitDecoded(decodeCommandChunk(route.streamFormat || "ndjson", parser, chunk)));
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    markInferenceError(res, error.message);
    event({ content: `Command error: ${error.message}` });
    finish("stop");
  });
  child.on("close", (code) => {
    if (code !== 0) markInferenceError(res, stderr.trim() || `Command exited with status ${code}.`);
    if (code !== 0 && stderr.trim()) event({ content: `\n\nCommand error: ${stderr.trim()}` });
    finish(code === 0 ? "stop" : "stop");
  });
  res.on("close", () => { if (!finished) child.kill("SIGTERM"); });
  if (route.inputMode === "argument") child.stdin.end(); else child.stdin.end(prompt);
}

function streamResponses(res, model, text, input, tokens = usage(input, text)) {
  setInferenceUsage(res, tokens);
  sseHeaders(res);
  const id = `resp_${randomUUID().replaceAll("-", "")}`;
  const itemId = `msg_${randomUUID().replaceAll("-", "")}`;
  const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const base = { id, object: "response", created_at: Math.floor(Date.now() / 1000), status: "in_progress", model, output: [] };
  emit("response.created", { response: base });
  emit("response.output_item.added", { output_index: 0, item: { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] } });
  emit("response.content_part.added", { item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
  for (const delta of chunks(text)) emit("response.output_text.delta", { item_id: itemId, output_index: 0, content_index: 0, delta });
  const output = [{ id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }];
  emit("response.output_text.done", { item_id: itemId, output_index: 0, content_index: 0, text });
  emit("response.completed", { response: { ...base, status: "completed", output, usage: tokens } });
  res.end();
}

function streamAnthropic(res, model, text, input, tokens = usage(input, text)) {
  setInferenceUsage(res, tokens);
  sseHeaders(res);
  const id = `msg_${randomUUID().replaceAll("-", "")}`;
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  emit("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: anthropicWireUsage(tokens, { output: false }) } });
  emit("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  for (const delta of chunks(text)) emit("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } });
  emit("content_block_stop", { type: "content_block_stop", index: 0 });
  emit("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: tokens.output_tokens } });
  emit("message_stop", { type: "message_stop" });
  res.end();
}

async function completion(req, res, protocol, pathname) {
  const request = await body(req);
  // farm.rotate forces a fresh pick — the explicit "give me a different silo"
  // escape hatch, which also clears the affinity entry.
  if (request.farm?.rotate === true && request.farm?.session_id) releaseRotaAffinity(request.farm.session_id);
  const route = routeFor(request.model, request.farm?.session_id || null);
  beginInference(req, res, protocol, pathname, request, route);
  if (!route) return apiError(res, 404, `Model route '${request.model || ""}' was not found. Use GET /v1/models to list routes.`, "model_not_found");

  const nativeSuffix = protocol === "anthropic" ? "/v1/messages" : protocol === "responses" ? "/v1/responses" : "/v1/chat/completions";
  if ((route.transport === "openai" && protocol !== "anthropic") || (route.transport === "anthropic" && protocol === "anthropic")) {
    return proxyUpstream(req, res, route, nativeSuffix, request);
  }
  if (route.transport === "command" && protocol === "chat" && request.stream) return streamCommandChat(req, res, route, request);
  if (["cli", "hybrid"].includes(route.transport) && protocol === "chat" && request.stream) return streamObservedChat(req, res, route, request);

  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  const result = await executeRoute(route, request, protocol, controller.signal);
  // `||` not `??`: an empty string means measurement was skipped or failed,
  // so fall back to the original computation rather than reporting zero tokens.
  const input = res.farmActivity?.promptText || promptFrom(request, protocol);
  const tokens = result.usage || usage(input, result.text);
  setInferenceUsage(res, tokens);
  setInferenceCachePrefix(res, result.cachePrefix);
  if (request.stream) {
    if (protocol === "anthropic") return streamAnthropic(res, request.model, result.text, input, tokens);
    if (protocol === "responses") return streamResponses(res, request.model, result.text, input, tokens);
    return streamChat(res, request.model, result.text, input, { reasoning: result.reasoning || "", tools: result.tools || [], usage: tokens });
  }

  if (protocol === "anthropic") {
    return send(res, 200, { id: `msg_${randomUUID().replaceAll("-", "")}`, type: "message", role: "assistant", model: request.model, content: [{ type: "text", text: result.text }], stop_reason: "end_turn", stop_sequence: null, usage: anthropicWireUsage(tokens), farm: { reasoning: result.reasoning || "", tools: result.tools || [] } });
  }
  if (protocol === "responses") {
    const id = `resp_${randomUUID().replaceAll("-", "")}`;
    return send(res, 200, { id, object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed", model: request.model, output: [{ id: `msg_${randomUUID().replaceAll("-", "")}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: result.text, annotations: [] }] }], output_text: result.text, usage: tokens, farm: { reasoning: result.reasoning || "", tools: result.tools || [] } });
  }
  return send(res, 200, { id: `chatcmpl_${randomUUID().replaceAll("-", "")}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: request.model, choices: [{ index: 0, message: { role: "assistant", content: result.text, refusal: null }, finish_reason: "stop" }], usage: tokens, farm: { reasoning: result.reasoning || "", tools: result.tools || [] } });
}

function modelsResponse() {
  return { object: "list", data: routes().map((route) => ({ id: route.id, object: "model", created: 0, owned_by: `usage-farm:${route.provider || route.transport}`, farm: { label: route.label, description: route.description, provider: route.provider, account: route.account, transport: route.transport, promptCaching: route.transport === "anthropic" ? route.promptCaching !== false : undefined, usageDialect: usageDialectForRoute(route), capabilities: route.capabilities || [], members: route.members || [], workflow: route.workflow || (route.strategy ? { kind: route.strategy, members: route.members || [], repeats: route.repeats || 1, synthesizer: route.synthesizer } : undefined), tools: route.tools || [], skills: route.skills || [], mcp: route.mcp || [] } })) };
}

function anthropicModelsResponse() {
  const data = routes().map((route) => ({ id: route.id, type: "model", display_name: route.id, created_at: "1970-01-01T00:00:00Z", max_input_tokens: null, max_tokens: null, capabilities: {} }));
  return { data, first_id: data[0]?.id || null, has_more: false, last_id: data.at(-1)?.id || null };
}

function openApi() {
  const server = `http://${config().host}:${config().port}/v1`;
  return {
    openapi: "3.1.0",
    info: {
      title: "Usage Farm Compatibility API",
      version: appVersion(),
      description: `Local OpenAI and Anthropic compatible routes backed by usage-farm accounts or configured upstreams. Corresponding Source (AGPL-3.0-or-later): ${SOURCE_URL}`,
    },
    externalDocs: { description: "Corresponding Source (AGPL-3.0-or-later)", url: SOURCE_URL },
    servers: [{ url: server }],
    paths: {
      "/models": { get: { summary: "List model routes", responses: { 200: { description: "Model list" } } } },
      "/chat/completions": { post: { summary: "OpenAI-compatible chat completions", responses: { 200: { description: "Completion or SSE stream" } } } },
      "/responses": { post: { summary: "OpenAI-compatible responses", responses: { 200: { description: "Response or SSE stream" } } } },
      "/messages": { post: { summary: "Anthropic-compatible messages", responses: { 200: { description: "Message or SSE stream" } } } },
    },
  };
}

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, x-api-key, anthropic-version");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/" || url.pathname === "/health") return send(res, 200, {
      status: "ok",
      service: "usage-farm-gateway",
      version: appVersion(),
      models: routes().length,
      source: { license: "AGPL-3.0-or-later", url: SOURCE_URL },
    });
    if (url.pathname === "/openapi.json") return send(res, 200, openApi());
    if (req.method === "POST" && url.pathname === "/hooks/visual-todo") return await receiveVisualTodoWebhook(req, res);
    const auth = requestAuth(req);
    req.farmAuth = auth;
    if (!auth.ok) return apiError(res, 401, "Invalid API key.", "authentication_error");
    trackClient(req, url.pathname, auth);
    const wantsAnthropic = Boolean(req.headers["anthropic-version"] || req.headers["x-api-key"]);
    if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) return send(res, 200, wantsAnthropic ? anthropicModelsResponse() : modelsResponse());
    if (req.method === "GET" && url.pathname.startsWith("/v1/models/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/models/".length));
      const model = (wantsAnthropic ? anthropicModelsResponse() : modelsResponse()).data.find((entry) => entry.id === id);
      return model ? send(res, 200, model) : apiError(res, 404, `Model '${id}' was not found.`, "model_not_found");
    }
    if (req.method === "POST" && ["/v1/chat/completions", "/chat/completions"].includes(url.pathname)) return await completion(req, res, "chat", url.pathname);
    if (req.method === "POST" && ["/v1/responses", "/responses"].includes(url.pathname)) return await completion(req, res, "responses", url.pathname);
    if (req.method === "POST" && ["/v1/messages", "/messages"].includes(url.pathname)) return await completion(req, res, "anthropic", url.pathname);
    return apiError(res, 404, `No route for ${req.method} ${url.pathname}.`, "not_found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(error?.stack || String(error));
    markInferenceError(res, message);
    if (!res.headersSent) apiError(res, 500, message, "gateway_error");
    else res.end();
  }
});

export { anthropicModelsResponse, anthropicWireUsage, cliArgs, decodeCommandChunk, executeRoute, extractText, imageReference, modelsResponse, normalizeProviderEvent, normalizeUsage, openApi, promptFrom, promptPrefixSha, requestAuth, routeFor, routeRequest, routes, streamChat, sumUsage, usage, usageFromUpstreamBody };

if (process.env.USAGE_FARM_GATEWAY_TEST !== "1") {
  const current = config();
  server.on("error", (error) => log(`listen failed: ${error.message}`));
  server.listen(current.port, current.host, () => log(`listening http://${current.host}:${current.port}`));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
}
