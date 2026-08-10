#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateCacheSavings, normalizeProviderUsage } from "./token-usage.mjs";
import { appVersion } from "./app-version.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function gatewayRevision() {
 try {
  const hash = createHash("sha256");
  for (const name of ["app-version.mjs", "gateway.mjs", "prompt-cache.mjs", "route-secret.mjs", "token-usage.mjs"]) {
   hash.update(name);
   hash.update("\0");
   hash.update(readFileSync(join(here, name)));
   hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
 } catch {
  return "unknown";
 }
}

function processAlive(pid) {
 if (!pid) return false;
 try { process.kill(pid, 0); return true; } catch { return false; }
}

function processZombie(pid) {
 try {
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
   encoding: "utf8",
   timeout: 500,
  });
  return result.status === 0 && /^Z/.test(String(result.stdout || "").trim());
 } catch {
  return false;
 }
}

function waitForExit(pid, timeoutMs = 1500) {
 const until = Date.now() + timeoutMs;
 const sleeper = new Int32Array(new SharedArrayBuffer(4));
 let checks = 0;
 while (processAlive(pid) && Date.now() < until) {
  // A process killed by a different process remains visible to kill(pid, 0)
  // as a zombie until its parent reaps it. Treat that as exited so stale
  // gateway replacement does not block for the full timeout.
  if (checks % 5 === 0 && processZombie(pid)) return;
  checks += 1;
  Atomics.wait(sleeper, 0, 0, 40);
 }
}

function jsonFile(path, fallback = null) {
 try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function stateRoot() {
 if (process.env.FARM_STATE) return process.env.FARM_STATE;
 const current = join(homedir(), ".usage-farm");
 const legacy = join(homedir(), ".claude-farm");
 return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

function findUp(start, target, depth = 8) {
 let cursor = resolve(start);
 for (let i = 0; i < depth; i += 1) {
  const candidate = join(cursor, target);
  if (existsSync(candidate)) return candidate;
  const parent = dirname(cursor);
  if (parent === cursor) break;
  cursor = parent;
 }
 return null;
}

function executableOnPath(name) {
 const extensions = process.platform === "win32"
  ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
  : [""];
 for (const directory of String(process.env.PATH || "").split(delimiter).filter(Boolean)) {
  for (const extension of extensions) {
   const candidate = join(directory, `${name}${extension}`);
   try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate; } catch { /* PATH entry changed */ }
  }
 }
 return null;
}

function farmCli() {
 if (process.env.FARM_CLI && existsSync(process.env.FARM_CLI)) return process.env.FARM_CLI;
 const local = findUp(process.cwd(), "farm.sh") || findUp(here, "farm.sh", 10);
 if (local) return local;
 return executableOnPath("farm");
}

function farmRepo() {
 const cli = farmCli();
 return cli && basename(cli) === "farm.sh" ? dirname(cli) : null;
}

function safeName(value) {
 const name = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
 if (!name || name.length > 80) throw new Error("Use a profile name with letters, numbers, dots, dashes, or underscores.");
 return name;
}

function listDirectories(path) {
 if (!existsSync(path)) return [];
 return readdirSync(path).filter((entry) => {
  try { return statSync(join(path, entry)).isDirectory(); } catch { return false; }
 }).sort();
}

function listProfiles() {
 const roots = [];
 const repo = farmRepo();
 if (repo) roots.push({ path: join(repo, "profiles"), source: "bundled", readOnly: true });
 roots.push({ path: join(stateRoot(), "profiles"), source: "custom", readOnly: false });
 const byName = new Map();
 for (const root of roots) {
  if (!existsSync(root.path)) continue;
  for (const file of readdirSync(root.path).filter((name) => name.endsWith(".json")).sort()) {
   const profile = jsonFile(join(root.path, file));
   if (!profile || typeof profile !== "object") continue;
   const name = profile.name || file.slice(0, -5);
   byName.set(name, { ...profile, name, source: root.source, readOnly: root.readOnly, path: join(root.path, file) });
  }
 }
 const order = jsonFile(join(stateRoot(), "profile-order.json"), []);
 const profiles = [...byName.values()];
 profiles.sort((a, b) => {
  const ai = order.indexOf(a.name); const bi = order.indexOf(b.name);
  if (ai >= 0 || bi >= 0) return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
  return a.name.localeCompare(b.name);
 });
 return profiles;
}

function containerStates() {
 const result = spawnSync("container", ["list"], { encoding: "utf8", timeout: 1500 });
 if (result.status !== 0) return new Set();
 // Columns: ID IMAGE OS ARCH STATE ... — only STATE "running" counts; a
 // stopped container still appears in the listing.
 return new Set(
  result.stdout
   .split(/\r?\n/)
   .slice(1)
   .map((line) => line.trim().split(/\s+/))
   .filter((columns) => columns[4] === "running")
   .map((columns) => columns[0])
   .filter(Boolean),
 );
}

function recentJsonl(root, limit = 40) {
 if (!existsSync(root)) return [];
 const files = [];
 const walk = (path) => {
  let entries = [];
  try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
   const child = join(path, entry.name);
   if (entry.isDirectory()) walk(child);
   else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
    try { files.push({ path: child, mtimeMs: statSync(child).mtimeMs }); } catch { /* file moved during scan */ }
   }
  }
 };
 walk(root);
 return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit).map((item) => item.path);
}

function totalFromUsage(usage) {
 if (!usage || typeof usage !== "object") return 0;
 return Number(usage.total_tokens || usage.totalTokens || 0)
  || Number(usage.input_tokens || usage.inputTokens || 0)
  + Number(usage.output_tokens || usage.outputTokens || 0)
  + Number(usage.cache_read_input_tokens || usage.cached_input_tokens || usage.cachedInputTokens || 0)
  + Number(usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0);
}

function isoReset(value) {
 if (value == null) return undefined;
 let input = value;
 if (typeof value === "number") input = value < 1e12 ? value * 1000 : value;
 // Provider stamps without a zone are UTC instants — parsing them as local
 // shifts every reset by the user's offset (BST rendered resets an hour off).
 else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value)) input = `${value.replace(" ", "T")}Z`;
 const date = new Date(input);
 return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function codexUsage(home) {
 const now = Date.now(); const sessions = [];
 for (const path of recentJsonl(join(home, "sessions"))) {
  let latest = null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
   if (!line.trim()) continue;
   try {
    const record = JSON.parse(line); const payload = record.type === "event_msg" ? record.payload : null;
    if (payload?.type !== "token_count") continue;
    const info = payload.info || {};
    const totalUsage = info.total_token_usage || info.totalTokenUsage || info.total || payload.total_token_usage || payload.totalTokenUsage || payload.total || {};
    const timestamp = Date.parse(record.timestamp || payload.timestamp || "") || statSync(path).mtimeMs;
    latest = { timestamp, total: totalFromUsage(totalUsage) || Number(info.total_tokens || payload.total_tokens || 0), limits: payload.rate_limits || payload.rateLimits };
   } catch { /* ignore incomplete transcript lines */ }
  }
  if (latest) sessions.push(latest);
 }
 if (!sessions.length) return null;
 const newest = sessions.sort((a, b) => b.timestamp - a.timestamp)[0];
 const windows = [];
 for (const [label, source] of [["5h", newest.limits?.primary], ["Weekly", newest.limits?.secondary]]) {
  if (!source) continue;
  const usedPercent = Number(source.used_percent ?? source.usedPercent);
  windows.push({ window: label, usedPercent: Number.isFinite(usedPercent) ? usedPercent : undefined, remainingPercent: Number.isFinite(usedPercent) ? Math.max(0, 100 - usedPercent) : undefined, resetsAt: isoReset(source.resets_at ?? source.resetsAt) });
 }
 const sum = (days) => sessions.filter((item) => item.timestamp >= now - days * 86400000).reduce((total, item) => total + item.total, 0);
 return { provider: "codex", updatedAt: new Date(newest.timestamp).toISOString(), source: "session-archive", windows, tokens24h: sum(1), tokens7d: sum(7), tokens30d: sum(30) };
}

function claudeUsage(home) {
 const now = Date.now(); const samples = []; const seen = new Set();
 for (const path of recentJsonl(join(home, "projects"))) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
   if (!line.trim()) continue;
   try {
    const record = JSON.parse(line); if (record.type !== "assistant" || !record.message?.usage) continue;
    const key = record.requestId || record.message.id || record.uuid; if (key && seen.has(key)) continue; if (key) seen.add(key);
    samples.push({ timestamp: Date.parse(record.timestamp || "") || statSync(path).mtimeMs, total: totalFromUsage(record.message.usage) });
   } catch { /* ignore incomplete transcript lines */ }
  }
 }
 if (!samples.length) return null;
 const latest = Math.max(...samples.map((sample) => sample.timestamp));
 const sum = (days) => samples.filter((item) => item.timestamp >= now - days * 86400000).reduce((total, item) => total + item.total, 0);
 return { provider: "claude", updatedAt: new Date(latest).toISOString(), source: "transcripts", windows: [], tokens24h: sum(1), tokens7d: sum(7), tokens30d: sum(30) };
}

function accountUsage(name, accountPath, providers) {
 return providers.map((provider) => {
  const archive = provider === "codex" ? codexUsage(join(accountPath, "codex-home")) : provider === "claude" ? claudeUsage(join(accountPath, "claude-home")) : null;
  const live = jsonFile(join(stateRoot(), "usage", name, `${provider}.json`), null);
  if (!archive && !live) return { provider, source: "unavailable", windows: [] };
  const rate = live?.rateLimit;
  // Prefer the OAuth report (full session/weekly/per-model windows); the
  // single binding-window rate-limit event is the fallback.
  const liveWindows = Array.isArray(live?.windows) && live.windows.length
   ? live.windows
   : rate
    ? [{ window: String(rate.window || "quota").replaceAll("_", " "), status: rate.status, resetsAt: isoReset(rate.resetsAt) }]
    : [];
  return { ...(archive || {}), provider, source: live ? "live-event" : archive.source, updatedAt: live?.updatedAt || archive?.updatedAt, windows: liveWindows.length ? liveWindows : (archive?.windows || []) };
 });
}

function listAccounts() {
 const root = join(stateRoot(), "accounts");
 const running = containerStates();
 return listDirectories(root).map((name) => {
  const accountPath = join(root, name);
  const providers = listDirectories(accountPath).filter((entry) => entry.endsWith("-home")).map((entry) => entry.slice(0, -5));
  const stamp = jsonFile(join(accountPath, "profile.json"), {});
  return {
   name,
   providers,
   profile: stamp?.name || null,
   appliedAt: stamp?._applied_at || null,
   running: running.has(`usage-${name}`) || running.has(`claude-${name}`),
   usage: accountUsage(name, accountPath, providers),
  };
 });
}

function listNamed(path, stripMd = false) {
 if (!path || !existsSync(path)) return [];
 return readdirSync(path).filter((name) => !name.startsWith(".")).map((name) => stripMd ? name.replace(/\.md$/, "") : name).sort();
}

// The workspace intentionally includes both ordinary Markdown and the
// instruction/memory documents agents rely on. Some of those conventions use
// extensionless names (SOUL, MEMORY, SKILL); they remain subject to the same
// repository-root containment checks as every other file.
const WORKSPACE_DOCUMENT = /(?:\.(md|mdx|markdown|txt)$|(?:^|\/)(?:agents|claude|soul|memory|skill)(?:\.(?:md|mdx|markdown|txt))?$)/i;
const WORKSPACE_IGNORED_DIRECTORIES = new Set([
 ".git",
 ".cache",
 ".next",
 // Agent-host projections and agentic config are NOT wiki content — they
 // surface in the sidebar's Skills/Commands/Agents/Workflows/Memory
 // sections instead (design-language IA).
 ".claude",
 ".codex",
 ".cursor",
 ".opencode",
 ".pi",
 ".agents",
 ".ok",
 ".agensis",
 ".playwright-mcp",
 ".turbo",
 ".vite",
 ".zig-cache",
 "build",
 "coverage",
 "dist",
 "node_modules",
 "out",
 "release",
 "target",
 "tmp",
 "zig-out",
]);
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_FILE_BYTES = 1024 * 1024;

function workspaceRoot() {
 // The coding repository is the default workspace. A persisted override is
 // intentionally accepted only when it remains a real directory; reads and
 // writes below are still constrained to this resolved root.
 const configured = jsonFile(join(stateRoot(), "workspace.json"), {}).root;
 const fallback = farmRepo() || process.cwd();
 const root = resolve(configured || fallback);
 if (!existsSync(root) || !statSync(root).isDirectory()) return resolve(fallback);
 return root;
}

function setWorkspaceRoot(payload) {
 const fallback = farmRepo() || process.cwd();
 let requested = String(payload.root || "").trim();
 if (payload.pick) {
  // Real macOS folder picker — the shell has no dialog API, but this node
  // process does. Cancel (osascript exit 1) surfaces as a quiet error.
  const picked = spawnSync("osascript", ["-e", 'POSIX path of (choose folder with prompt "Open project folder")'], {
   encoding: "utf8",
   timeout: 120000,
  });
  if (picked.status !== 0) throw new Error("Folder picker cancelled.");
  requested = picked.stdout.trim().replace(/\/$/, "");
 }
 const root = resolve(requested || fallback);
 if (!existsSync(root) || !statSync(root).isDirectory()) {
  throw new Error("Choose a folder that exists to use as the project workspace.");
 }
 const statePath = join(stateRoot(), "workspace.json");
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(statePath, JSON.stringify({ root }, null, 2));
 return { root, name: basename(root) };
}

function workspacePath(root, relativePath) {
 const relative = String(relativePath || "").replace(/\\/g, "/");
 if (!relative || relative.startsWith("/") || relative.split("/").includes("..") || !WORKSPACE_DOCUMENT.test(relative)) {
  throw new Error("Choose a workspace document inside the current repository.");
 }
 const target = resolve(root, relative);
 if (target !== root && !target.startsWith(`${root}/`)) throw new Error("File is outside the current workspace.");
 return target;
}

function workspaceFilePath(root, relativePath) {
 const relative = String(relativePath || "").replace(/\\/g, "/");
 if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) {
  throw new Error("Choose a file inside the current repository.");
 }
 const target = resolve(root, relative);
 if (target !== root && !target.startsWith(`${root}/`)) throw new Error("File is outside the current workspace.");
 return target;
}

function git(root, args, options = {}) {
 return spawnSync("git", ["-C", root, ...args], {
  encoding: "utf8",
  maxBuffer: MAX_DIFF_BYTES,
  ...options,
 });
}

function diffStatus(code) {
 if (code === "??") return "untracked";
 if (code.includes("R")) return "renamed";
 if (code.includes("A")) return "added";
 if (code.includes("D")) return "deleted";
 return "modified";
}

function untrackedPatch(path, content) {
 const lines = content ? content.replace(/\n$/, "").split("\n") : [];
 return [
  `diff --git a/${path} b/${path}`,
  "new file mode 100644",
  "--- /dev/null",
  `+++ b/${path}`,
  `@@ -0,0 +1,${lines.length} @@`,
  ...lines.map((line) => `+${line}`),
  "",
 ].join("\n");
}

function workspaceDiff(payload = {}) {
 const configuredRoot = workspaceRoot();
 const topLevel = git(configuredRoot, ["rev-parse", "--show-toplevel"]);
 if (topLevel.status !== 0) throw new Error("The current workspace is not a Git repository.");
 const root = realpathSync(resolve(topLevel.stdout.trim()));
 const canonicalConfiguredRoot = realpathSync(configuredRoot);
 if (root !== canonicalConfiguredRoot && !canonicalConfiguredRoot.startsWith(`${root}/`) && !root.startsWith(`${canonicalConfiguredRoot}/`)) {
  throw new Error("The Git repository is outside the current workspace.");
 }
 const requestedPath = payload.path ? String(payload.path).replace(/\\/g, "/") : null;
 if (requestedPath) workspaceFilePath(root, requestedPath);
 const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...(requestedPath ? [requestedPath] : [])]);
 if (status.status !== 0) throw new Error(status.stderr.trim() || "Could not read repository changes.");
 const entries = status.stdout.split("\0").filter(Boolean);
 const files = [];
 for (let index = 0; index < entries.length; index += 1) {
  const entry = entries[index];
  const code = entry.slice(0, 2);
  const path = entry.slice(3);
  if (!path) continue;
  if (code.includes("R") || code.includes("C")) index += 1;
  const absolute = workspaceFilePath(root, path);
  const fileStatus = diffStatus(code);
  let patch = "";
  let additions = 0;
  let deletions = 0;
  let totalLines = 0;
  if (fileStatus === "untracked") {
   let content = "";
   try {
    const stat = statSync(absolute);
    if (stat.size <= MAX_DIFF_FILE_BYTES) {
     const raw = readFileSync(absolute);
     if (!raw.includes(0)) content = raw.toString("utf8");
    }
   } catch { /* The file changed after status was read. */ }
   totalLines = content ? content.replace(/\n$/, "").split("\n").length : 0;
   additions = totalLines;
   patch = content ? untrackedPatch(path, content) : "";
  } else {
   const result = git(root, ["diff", "--no-ext-diff", "--no-color", "--find-renames", "--unified=3", "HEAD", "--", path]);
   patch = result.status === 0 ? result.stdout.slice(0, MAX_DIFF_FILE_BYTES) : "";
   const stats = git(root, ["diff", "--numstat", "HEAD", "--", path]);
   const columns = stats.status === 0 ? stats.stdout.trim().split(/\s+/) : [];
   additions = Number(columns[0]) || 0;
   deletions = Number(columns[1]) || 0;
   try {
    if (existsSync(absolute) && statSync(absolute).isFile() && statSync(absolute).size <= MAX_DIFF_FILE_BYTES) {
     const content = readFileSync(absolute, "utf8");
     totalLines = content ? content.replace(/\n$/, "").split("\n").length : 0;
    }
   } catch { /* Binary, deleted, or concurrently changed file. */ }
  }
  files.push({ path, status: fileStatus, additions, deletions, patch, totalLines });
 }
 files.sort((left, right) => left.path.localeCompare(right.path));
 return {
  root,
  generatedAt: new Date().toISOString(),
  additions: files.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  files,
 };
}

function listMarkdownWorkspace() {
 const root = workspaceRoot();
 const files = [];
 const walk = (directory, prefix = "") => {
  let entries = [];
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
   if (entry.isDirectory()) {
    if (!WORKSPACE_IGNORED_DIRECTORIES.has(entry.name) && ![".app", ".dSYM", ".xcarchive", ".framework"].some((suffix) => entry.name.endsWith(suffix))) walk(join(directory, entry.name), `${prefix}${entry.name}/`);
    continue;
   }
   if (!entry.isFile() || !WORKSPACE_DOCUMENT.test(`${prefix}${entry.name}`)) continue;
   const path = join(directory, entry.name);
   try {
    const stat = statSync(path);
    if (stat.size <= MAX_MARKDOWN_BYTES) files.push({ path: `${prefix}${entry.name}`, size: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() });
   } catch { /* file changed while scanning */ }
  }
 };
 walk(root);
 // Branch/worktree identity for the project switcher — cheap and honest:
 // absent entirely when the workspace is not a git checkout.
 let branch = null;
 let worktree = false;
 const head = spawnSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 3000 });
 if (head.status === 0) {
  branch = head.stdout.trim() || null;
  const gitDir = spawnSync("git", ["-C", root, "rev-parse", "--git-dir"], { encoding: "utf8", timeout: 3000 });
  worktree = gitDir.status === 0 && gitDir.stdout.includes("/worktrees/");
 }
 return { root, branch, worktree, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

/** Wiki link graph: every workspace doc is a node; [[Wiki Links]] and
 *  relative markdown links are edges. Wiki names resolve to files by
 *  basename (case-insensitive, extension-less). */
function workspaceLinkGraph() {
 const { root, files } = listMarkdownWorkspace();
 const byBasename = new Map();
 for (const file of files) {
  const base = file.path.split("/").pop().replace(/\.mdx?$/i, "").toLowerCase();
  if (!byBasename.has(base)) byBasename.set(base, file.path);
 }
 const nodes = files.map((file) => ({
  path: file.path,
  title: file.path.split("/").pop().replace(/\.mdx?$/i, ""),
 }));
 const edges = [];
 const seen = new Set();
 for (const file of files) {
  let content = "";
  try { content = readFileSync(join(root, file.path), "utf8"); } catch { continue; }
  const push = (target, kind) => {
   if (!target || target === file.path) return;
   const key = `${file.path}\0${target}\0${kind}`;
   if (seen.has(key)) return;
   seen.add(key);
   edges.push({ source: file.path, target, kind });
  };
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
   const target = byBasename.get(match[1].trim().toLowerCase());
   if (target) push(target, "wiki");
  }
  for (const match of content.matchAll(/\]\(([^)\s#]+\.mdx?)(?:#[^)]*)?\)/gi)) {
   const raw = match[1];
   if (/^[a-z]+:\/\//i.test(raw)) continue;
   const resolved = raw.startsWith("/")
    ? raw.slice(1)
    : join(dirname(file.path), raw).replaceAll("\\", "/");
   const normalized = resolved.split("/").filter((part) => part !== ".").join("/");
   if (files.some((item) => item.path === normalized)) push(normalized, "md");
  }
 }
 return { root, nodes, edges };
}

/** Git history for one workspace doc (timeline panel). Graceful empty result
 *  outside a git repository. */
function workspaceFileHistory(payload) {
 const root = workspaceRoot();
 const path = workspacePath(root, payload.path);
 if (!existsSync(path)) throw new Error("Workspace document was not found.");
 const result = spawnSync(
  "git",
  ["log", "--follow", "-n", "50", "--date=iso-strict", "--pretty=format:%H\u0001%ad\u0001%an\u0001%s", "--", String(payload.path)],
  { cwd: root, encoding: "utf8" },
 );
 if (result.status !== 0) return { path: String(payload.path), entries: [] };
 const entries = String(result.stdout || "")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
   const [hash, date, author, subject] = line.split("\u0001");
   return { hash, date, author, subject };
  });
 return { path: String(payload.path), entries };
}

/** Agentic config inventory for the sidebar sections: Skills / Commands /
 *  Agents / Workflows / Memory, split Global (~/.claude) vs Project
 *  (<root>/.claude). Items are shallow: name + kind + file count. */
function listAgenticInventory() {
 const root = workspaceRoot();
 const kinds = ["skills", "commands", "agents", "workflows"];
 const scan = (base) => {
  const groups = {};
  for (const kind of kinds) {
   const directory = join(base, kind);
   const items = [];
   try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
     if (entry.name.startsWith(".")) continue;
     if (entry.isDirectory()) {
      const itemDirectory = join(directory, entry.name);
      // Bounded walk: skip vendored/ignored dirs (a skill carrying a
      // node_modules was reporting 8k+ files) and stop early — the
      // sidebar needs "what's in this skill", not a du(1).
      const files = [];
      let fileCount = 0;
      const walkItem = (dir, prefix, depth) => {
       if (depth > 4 || fileCount > 500) return;
       let children = [];
       try { children = readdirSync(dir, { withFileTypes: true }); } catch { return; }
       for (const child of children) {
        if (child.name.startsWith(".")) continue;
        if (child.isDirectory()) {
         if (WORKSPACE_IGNORED_DIRECTORIES.has(child.name)) continue;
         walkItem(join(dir, child.name), `${prefix}${child.name}/`, depth + 1);
        } else if (child.isFile() && /\.(md|mdx|mjs|js|json|ya?ml|sh)$/i.test(child.name)) {
         fileCount += 1;
         if (files.length < 50) files.push({ name: `${prefix}${child.name}`, path: join(dir, child.name) });
        }
       }
      };
      walkItem(itemDirectory, "", 0);
      items.push({ name: entry.name, path: itemDirectory, fileCount, files });
     } else if (entry.isFile() && /\.(md|mjs|js|json|ya?ml)$/i.test(entry.name)) {
      items.push({ name: entry.name.replace(/\.[^.]+$/, ""), path: join(directory, entry.name), fileCount: 1 });
     }
    }
   } catch { /* group missing */ }
   groups[kind] = items.sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
 };
 const project = scan(join(root, ".claude"));
 const global = scan(join(homedir(), ".claude"));
 const memory = [];
 const slug = root.replaceAll("/", "-");
 const memoryDir = join(homedir(), ".claude", "projects", slug, "memory");
 try {
  for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
   if (entry.isFile() && /\.md$/i.test(entry.name) && entry.name !== "MEMORY.md") {
    memory.push({ name: entry.name.replace(/\.md$/i, ""), path: join(memoryDir, entry.name), fileCount: 1 });
   }
  }
 } catch { /* no memory yet */ }
 return { root, project, global, memory: memory.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Read one agentic-config document by ABSOLUTE path — scoped strictly to
 *  the bases listAgenticInventory scans (project .claude, ~/.claude kinds,
 *  this project's memory store). Read-only companion for sidebar items that
 *  live outside the workspace root. */
function readAgenticDocument(payload) {
 const root = workspaceRoot();
 const slug = root.replaceAll("/", "-");
 const bases = [
  join(root, ".claude"),
  ...["skills", "commands", "agents", "workflows"].map((kind) => join(homedir(), ".claude", kind)),
  join(homedir(), ".claude", "projects", slug, "memory"),
 ];
 // Lexical containment on the resolved request: resolve() collapses any
 // "..", so a path is allowed iff it sits inside a base as written. We do
 // NOT realpath through symlinks — skills are commonly symlinked out of
 // dotfile repos, and following the link would wrongly deny them.
 const requested = resolve(String(payload.path || ""));
 const allowed = bases.some(
  (base) => requested === base || requested.startsWith(`${base}/`),
 );
 if (!allowed) throw new Error("That path is outside the agentic config directories.");
 if (!existsSync(requested) || !statSync(requested).isFile()) throw new Error("Agentic document was not found.");
 const stat = statSync(requested);
 if (stat.size > MAX_MARKDOWN_BYTES) throw new Error("Document is larger than 2 MB.");
 return {
  path: requested,
  content: readFileSync(requested, "utf8"),
  modifiedAt: new Date(stat.mtimeMs).toISOString(),
  readOnly: true,
 };
}

/* ---------------- Paddocks: primed repo states (local or remote) -------- */

function paddocksFile() {
 return join(stateRoot(), "paddocks.json");
}

function loadPaddocks() {
 const stored = jsonFile(paddocksFile(), {});
 return Array.isArray(stored.paddocks) ? stored.paddocks : [];
}

function savePaddocks(paddocks) {
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(paddocksFile(), JSON.stringify({ paddocks }, null, 2));
}

function enrichPaddock(paddock) {
 if (paddock.locator?.kind !== "local") return { ...paddock, exists: null };
 const path = paddock.locator.path;
 const exists = existsSync(path) && statSync(path).isDirectory();
 if (!exists) return { ...paddock, exists: false };
 const branch = spawnSync("git", ["-C", path, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
 const status = spawnSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8" });
 let lastSyncAt = null;
 try {
  const fetchHead = join(path, ".git", "FETCH_HEAD");
  if (existsSync(fetchHead)) lastSyncAt = new Date(statSync(fetchHead).mtimeMs).toISOString();
 } catch { /* not fetched yet */ }
 return {
  ...paddock,
  exists: true,
  branch: branch.status === 0 ? branch.stdout.trim() : null,
  dirty: status.status === 0 ? status.stdout.trim().length > 0 : null,
  lastSyncAt,
 };
}

function listPaddocks() {
 return { paddocks: loadPaddocks().map(enrichPaddock) };
}

function primePaddock(payload) {
 const name = String(payload.name || "").trim();
 const path = String(payload.path || "").trim();
 const host = String(payload.host || "").trim();
 if (!path) throw new Error("A paddock needs a repository path.");
 const kind = host ? "remote" : "local";
 if (kind === "local") {
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error("That folder does not exist.");
  if (!existsSync(join(resolved, ".git"))) throw new Error("A paddock must be a git repository (no .git found).");
 }
 const paddocks = loadPaddocks();
 const id = `${kind}-${(name || basename(path)).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+$/, "");
 if (paddocks.some((item) => item.id === id)) throw new Error(`Paddock '${id}' already exists.`);
 const paddock = {
  id,
  name: name || basename(path),
  locator: kind === "remote" ? { kind, host, path } : { kind, path: resolve(path) },
  primedAt: new Date().toISOString(),
 };
 paddocks.push(paddock);
 savePaddocks(paddocks);
 return enrichPaddock(paddock);
}

function removePaddock(payload) {
 const id = String(payload.id || "");
 const paddocks = loadPaddocks();
 if (!paddocks.some((item) => item.id === id)) throw new Error("Paddock was not found.");
 savePaddocks(paddocks.filter((item) => item.id !== id));
 return { removed: id };
}

/* ---------------- Worktrees: real git worktrees, one per silo ----------
 * A worktree is a real `git worktree` living under $WORK (the dir bind-mounted
 * into every container), based off the bare clone at $WORK/<repo>.git. Both the
 * checkout and its gitdir sit under the mount, so git works inside the silo.
 * The desktop drives the same farm.sh subcommands a terminal user would. */

// Farming-themed two-word names — drawn glyphs of the yard, never emoji.
const WT_ADJECTIVES = ["golden", "misty", "rolling", "dewy", "sunlit", "fallow", "ripe", "verdant", "windy", "early", "amber", "frosted", "loamy", "quiet", "brisk", "hearty", "rustic", "humble", "tilled", "spring"];
const WT_NOUNS = ["paddock", "furrow", "harrow", "silo", "barn", "meadow", "orchard", "haystack", "tractor", "combine", "pasture", "trellis", "granary", "millpond", "windrow", "stubble", "thresher", "corral", "pergola", "acre"];

function worktreesFile() {
 return join(stateRoot(), "worktrees.json");
}

function loadWorktreeRecords() {
 const stored = jsonFile(worktreesFile(), {});
 return Array.isArray(stored.worktrees) ? stored.worktrees : [];
}

function saveWorktreeRecords(worktrees) {
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(worktreesFile(), JSON.stringify({ worktrees }, null, 2));
}

function workDir() {
 return join(stateRoot(), "work");
}

function safeRepoName(value) {
 const name = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
 if (!name) throw new Error("Cannot derive a repository name from that path.");
 return name;
}

/** Synchronously run a farm.sh subcommand (no shell — args are literal). */
function runFarmSync(args, { safe = false, timeout = 60000 } = {}) {
 const cli = farmCli();
 if (!cli) {
  if (safe) return "";
  throw new Error("The farm CLI was not found. Set FARM_CLI to farm.sh or install the app beside it.");
 }
 const result = spawnSync("bash", [cli, ...args], {
  encoding: "utf8",
  timeout,
  env: { ...process.env, FARM_STATE: stateRoot() },
 });
 if (result.status !== 0) {
  if (safe) return "";
  const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" ");
  throw new Error(detail || `farm ${args[0]} failed`);
 }
 return result.stdout || "";
}


/* ------- Host dirs: extra folders shared into every local silo (virtiofs) ------
   Registry is ~/.usage-farm/host-dirs (TSV: host\ttarget\trw|ro). Mutations go
   through farm.sh so path validation and reload messaging stay canonical. */
function hostDirsFile() {
  return join(stateRoot(), "host-dirs");
}

function listHostDirs() {
  const path = hostDirsFile();
  if (!existsSync(path)) return { dirs: [] };
  const dirs = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [host, target, mode] = line.split("\t");
      if (!host) return null;
      return {
        host,
        target: target || host,
        mode: mode === "ro" ? "ro" : "rw",
      };
    })
    .filter(Boolean);
  return { dirs };
}

function addHostDir(payload = {}) {
  const host = String(payload.host || payload.path || "").trim();
  if (!host) throw new Error("A host path is required.");
  const args = ["add-host-dir", host];
  const target = String(payload.target || "").trim();
  if (target) args.push(target);
  if (payload.mode === "ro" || payload.ro === true) args.push("--ro");
  const message = runFarmSync(args).trim();
  return { ...listHostDirs(), message };
}

function removeHostDir(payload = {}) {
  const host = String(payload.host || payload.path || "").trim();
  if (!host) throw new Error("A host path is required.");
  const message = runFarmSync(["rm-host-dir", host]).trim();
  return { ...listHostDirs(), message };
}

function reloadHostDirs(payload = {}) {
  const args = ["reload"];
  if (Array.isArray(payload.accounts)) {
    for (const name of payload.accounts) {
      const safe = String(name || "").trim();
      if (safe) args.push(safe);
    }
  }
  const message = runFarmSync(args, { timeout: 180000 }).trim();
  return { ok: true, message, ...listHostDirs() };
}

/** Providers available on this Mac (host mode) — presence of the user's
 *  native CLI home, same detection the gateway uses for host routes. */
function hostProviders() {
  const homes = {
    claude: join(homedir(), ".claude"),
    codex: join(homedir(), ".codex"),
    grok: join(homedir(), ".grok"),
    gemini: join(homedir(), ".gemini"),
  };
  return Object.entries(homes)
    .filter(([, dir]) => existsSync(dir))
    .map(([name]) => name);
}

/** A memorable, unused farming combo (brisk-otter → golden-furrow). */
function coinWorktreeName(existing) {
 const taken = new Set(existing.map((w) => w.name));
 const span = WT_ADJECTIVES.length * WT_NOUNS.length;
 for (let attempt = 0; attempt < span; attempt += 1) {
  const seed = (Date.now() + attempt * 2654435761) >>> 0;
  const name = `${WT_ADJECTIVES[seed % WT_ADJECTIVES.length]}-${WT_NOUNS[(seed >> 9) % WT_NOUNS.length]}`;
  if (!taken.has(name)) return name;
 }
 return `plot-${Date.now().toString(36)}`;
}

/** Branch picker source: every local branch of the current workspace repo,
 *  including unpushed ones (those become part of the bare clone verbatim). */
function listWorktreeBranches() {
 const root = workspaceRoot();
 const inside = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
 if (inside.status !== 0) throw new Error("The current workspace is not a Git repository.");
 const current = spawnSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
 const refs = spawnSync("git", ["-C", root, "for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\t%(committerdate:iso8601)\t%(upstream:short)", "refs/heads"], { encoding: "utf8" });
 const branches = (refs.status === 0 ? refs.stdout : "").trim().split("\n").filter(Boolean).map((line) => {
  const [name, date, upstream] = line.split("\t");
  return { name, updatedAt: date || null, pushed: Boolean(upstream && upstream.length) };
 });
 return {
  root,
  repo: safeRepoName(basename(root)),
  current: current.status === 0 ? current.stdout.trim() : null,
  branches,
 };
}

/** Fill in git truth (branch, dirty, change count) for one worktree. */
function enrichWorktree(record) {
 const path = join(workDir(), record.dir);
 if (!existsSync(path) || !statSync(path).isDirectory()) return { ...record, exists: false };
 const head = spawnSync("git", ["-C", path, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
 const status = spawnSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8" });
 const dirtyLines = status.status === 0 ? status.stdout.trim().split("\n").filter(Boolean) : [];
 const shortstat = spawnSync("git", ["-C", path, "diff", "HEAD", "--shortstat"], { encoding: "utf8" });
 return {
  ...record,
  exists: true,
  path,
  branch: head.status === 0 ? head.stdout.trim() : record.branch,
  dirty: status.status === 0 ? dirtyLines.length > 0 : null,
  changedFiles: dirtyLines.length,
  additions: Number((shortstat.stdout || "").match(/(\d+) insertion/)?.[1] || 0),
  deletions: Number((shortstat.stdout || "").match(/(\d+) deletion/)?.[1] || 0),
 };
}

/** Git is the source of truth for existence; records add the silo assignment.
 *  Scoped to the ACTIVE workspace: a worktree belongs to the project it was
 *  cloned from (repo name, plus the recorded root when we have one), so a
 *  freshly added project never lists — or merges into itself! — another
 *  project's checkouts. */
function listWorktrees() {
 const rows = runFarmSync(["wt-ls"], { safe: true }).trim().split("\n").filter(Boolean);
 const byDir = new Map(loadWorktreeRecords().map((r) => [r.dir, r]));
 let currentRoot = null;
 try {
  currentRoot = workspaceRoot();
 } catch { /* no workspace resolvable — fall back to listing everything */ }
 // The bare clone's origin URL records which workspace a repo was cloned
 // from — exact truth even when the clone name differs from the folder.
 const originByRepo = new Map();
 const belongsHere = (repo, record) => {
  if (!currentRoot) return true;
  if (record.root) return resolve(record.root) === currentRoot;
  if (!originByRepo.has(repo)) {
   const bare = join(workDir(), `${repo}.git`);
   const url = spawnSync("git", ["-C", bare, "config", "--get", "remote.origin.url"], { encoding: "utf8" });
   originByRepo.set(repo, url.status === 0 && url.stdout.trim() ? resolve(url.stdout.trim()) : null);
  }
  const origin = originByRepo.get(repo);
  if (origin != null) return origin === currentRoot;
  // Legacy bare without an origin — last resort: folder-name match.
  return repo === safeRepoName(basename(currentRoot));
 };
 const worktrees = rows.flatMap((line) => {
  const [repo, dir, branch] = line.split("\t");
  const record = byDir.get(dir) || {};
  if (!belongsHere(repo, record)) return [];
  return [enrichWorktree({
   name: record.name || dir.replace(/^wt-/, ""),
   dir,
   repo,
   branch: record.branch || branch,
   silo: record.silo || null,
   root: record.root || null,
   createdAt: record.createdAt || null,
  })];
 });
 return { worktrees };
}

/** Deep status for one worktree — the detail panel's truth: per-file
 *  changes (+/- from numstat), ahead/behind vs the workspace's current
 *  branch (resolved against the shared bare clone's refs — no network),
 *  recent commits and stash count. */
function worktreeStatus(payload = {}) {
 const worktree = findWorktree(payload.dir);
 if (!worktree.exists || !worktree.path) throw new Error(`Worktree '${worktree.name}' is missing on disk.`);
 const wt = worktree.path;

 const porcelain = runGit(wt, ["status", "--porcelain"], { allowFail: true });
 const numstat = runGit(wt, ["diff", "HEAD", "--numstat"], { allowFail: true });
 const lineCounts = new Map();
 for (const row of (numstat.stdout || "").trim().split("\n").filter(Boolean)) {
  const [add, del, path] = row.split("\t");
  if (!path) continue;
  lineCounts.set(path, {
   additions: add === "-" ? null : Number(add),
   deletions: del === "-" ? null : Number(del),
  });
 }
 const files = (porcelain.stdout || "").split("\n").filter(Boolean).map((row) => {
  const xy = row.slice(0, 2);
  const path = row.slice(3).trim();
  const status = xy.includes("?")
   ? "untracked"
   : /R/.test(xy) ? "renamed" : /A/.test(xy) ? "added" : /D/.test(xy) ? "deleted" : "modified";
  return { path, status, ...(lineCounts.get(path) || { additions: null, deletions: null }) };
 });
 let additions = 0;
 let deletions = 0;
 for (const item of lineCounts.values()) {
  additions += item.additions || 0;
  deletions += item.deletions || 0;
 }

 let target = null;
 let ahead = null;
 let behind = null;
 try {
  target = listWorktreeBranches().current;
  if (target && target !== worktree.branch) {
   const counts = runGit(wt, ["rev-list", "--left-right", "--count", `HEAD...${target}`], { allowFail: true });
   if (counts.status === 0) {
    const [a, b] = counts.stdout.trim().split(/\s+/).map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) {
     ahead = a;
     behind = b;
    }
   }
  }
 } catch { /* workspace not a repo — leave nulls */ }

 const log = runGit(wt, ["log", "-n", "8", "--pretty=%h\t%s\t%cI"], { allowFail: true });
 const commits = (log.stdout || "").trim().split("\n").filter(Boolean).map((row) => {
  const [hash, subject, at] = row.split("\t");
  return { hash, subject: subject || "", at: at || null };
 });
 const stash = runGit(wt, ["stash", "list", "--format=%gd"], { allowFail: true });
 const stashes = (stash.stdout || "").trim().split("\n").filter(Boolean).length;

 return {
  dir: worktree.dir,
  branch: worktree.branch,
  target,
  ahead,
  behind,
  additions,
  deletions,
  files,
  commits,
  stashes,
 };
}

/** Lane data for the branch/worktree graph: the workspace branch plus one
 *  lane per live worktree — first-parent commit times and the merge-base
 *  fork point, all resolved inside each checkout (bare refs, no network). */
function worktreeGraph() {
 const ws = workspaceRoot();
 let target = null;
 try { target = listWorktreeBranches().current; } catch { target = null; }
 const parseLog = (cwd, ref) => {
  const log = runGit(cwd, ["log", "-n", "24", "--first-parent", "--pretty=%h\t%ct\t%s", ref], { allowFail: true });
  if (log.status !== 0) return [];
  return log.stdout.trim().split("\n").filter(Boolean).map((row) => {
   const [hash, t, ...rest] = row.split("\t");
   return { hash, t: Number(t) * 1000, subject: rest.join("\t") };
  });
 };
 const targetCommits = target ? parseLog(ws, target) : [];
 const lanes = listWorktrees().worktrees
  .filter((worktree) => worktree.exists && worktree.path)
  .map((worktree) => {
   const commits = parseLog(worktree.path, "HEAD");
   let base = null;
   if (target) {
    const mergeBase = runGit(worktree.path, ["merge-base", "HEAD", target], { allowFail: true });
    if (mergeBase.status === 0) {
     const hash = mergeBase.stdout.trim();
     const when = runGit(worktree.path, ["show", "-s", "--pretty=%ct", hash], { allowFail: true });
     base = {
      hash: hash.slice(0, 7),
      t: when.status === 0 ? Number(when.stdout.trim()) * 1000 : null,
     };
    }
   }
   return {
    name: worktree.name,
    branch: worktree.branch,
    silo: worktree.silo,
    dirty: Boolean(worktree.dirty),
    base,
    commits,
   };
  });
 return { target: target ? { name: target, commits: targetCommits } : null, lanes };
}

/** Merge risk for every live worktree in one call — the merge preview's
 *  math (bare fetch → ahead/behind, fast-forward test, merge-tree conflict
 *  prediction) without touching the working tree. Rows and the detail rail
 *  read this to show mergeability up front. */
function worktreeMergeability() {
 const ws = workspaceRoot();
 const head = runGit(ws, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true });
 const current = head.status === 0 ? head.stdout.trim() : "";
 if (!current) return { target: null, rows: [] };
 const rows = [];
 for (const worktree of listWorktrees().worktrees) {
  if (!worktree.exists) continue;
  const bare = join(workDir(), `${worktree.repo}.git`);
  if (!existsSync(bare)) continue;
  const fetched = runGit(ws, ["fetch", bare, worktree.branch], { allowFail: true });
  if (fetched.status !== 0) continue;
  const counts = runGit(ws, ["rev-list", "--left-right", "--count", `${current}...FETCH_HEAD`], { allowFail: true })
   .stdout.trim().split(/\s+/);
  const behind = Number(counts[0] || 0);
  const ahead = Number(counts[1] || 0);
  const canFastForward = runGit(ws, ["merge-base", "--is-ancestor", current, "FETCH_HEAD"], { allowFail: true }).status === 0;
  const conflicts = parseMergeTreeConflicts(
   runGit(ws, ["merge-tree", "--write-tree", "--name-only", current, "FETCH_HEAD"], { allowFail: true }),
  );
  rows.push({ dir: worktree.dir, target: current, ahead, behind, canFastForward, conflicts, alreadyMerged: ahead === 0 });
 }
 return { target: current, rows };
}

/** Workspace-wide fetch — updates every remote the workspace knows. */
function worktreeFetch() {
 const ws = workspaceRoot();
 runGit(ws, ["fetch", "--all", "--prune"]);
 return { fetched: true };
}

/** Fast-forward pull — into a worktree checkout when `dir` is given,
 *  otherwise into the workspace's current branch. Never merges. */
function worktreePull(payload = {}) {
 const dir = String(payload.dir || "").trim();
 const cwd = dir ? findWorktree(dir).path : workspaceRoot();
 if (!cwd) throw new Error("No checkout to pull into.");
 const result = runGit(cwd, ["pull", "--ff-only"], { allowFail: true });
 if (result.status !== 0) {
  throw new Error((result.stderr || result.stdout || "Pull failed").trim().slice(0, 300));
 }
 return { pulled: true, output: (result.stdout || "").trim().slice(-400) };
}

/** Create a real worktree: bare-clone the workspace (idempotent, captures
 *  unpushed branches), add the worktree on the chosen branch, assign a silo. */
function createWorktree(payload = {}) {
 const root = workspaceRoot();
 const branch = String(payload.branch || "").trim();
 const silo = String(payload.silo || "").trim();
 if (!branch) throw new Error("Choose a branch to base the worktree on.");
 if (!silo) throw new Error("Choose a silo to assign the worktree to.");
 if (!listAccounts().some((account) => account.name === silo)) throw new Error(`Unknown silo '${silo}'.`);
 const repo = safeRepoName(basename(root));
 const records = loadWorktreeRecords();
 const name = payload.name ? safeRepoName(payload.name) : coinWorktreeName(records);
 const dir = `wt-${name}`;
 if (existsSync(join(workDir(), dir))) throw new Error(`Worktree '${name}' already exists.`);
 runFarmSync(["clone", root, repo]);
 runFarmSync(["wt", repo, silo, branch, dir], { timeout: 120000 });
 const record = { name, dir, repo, branch, silo, root, createdAt: new Date().toISOString() };
 saveWorktreeRecords([...records, record]);
 return enrichWorktree(record);
}

function removeWorktree(payload = {}) {
 const dir = String(payload.dir || (payload.name ? `wt-${safeRepoName(payload.name)}` : "")).trim();
 if (!dir) throw new Error("Which worktree should be removed?");
 runFarmSync(["wt-rm", dir]);
 saveWorktreeRecords(loadWorktreeRecords().filter((record) => record.dir !== dir));
 return { removed: dir };
}

/* ---- Worktree merge-back: bring a silo's commits into the workspace ----
 * The silo's work lives on a branch in the bare repo, whose object store the
 * worktree shares. We fetch that branch straight into the workspace and merge
 * it there — the workspace is where the user wants the result and where their
 * editor/tools resolve conflicts. All git runs against the workspace root. */

function runGit(cwd, args, { allowFail = false } = {}) {
 const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
 if (result.status !== 0 && !allowFail) {
  throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim().slice(0, 400));
 }
 return result;
}

function findWorktree(dir) {
 const target = String(dir || "").trim();
 if (!target) throw new Error("Which worktree?");
 const found = listWorktrees().worktrees.find((worktree) => worktree.dir === target);
 if (!found) throw new Error(`Worktree '${target}' was not found.`);
 return found;
}

/** Conflicted paths from `git merge-tree --write-tree --name-only`. On
 *  conflict (exit 1) the output is: <tree-oid>\n<file>\n<file>… (an optional
 *  trailing informational block is separated by a blank line). */
function parseMergeTreeConflicts(result) {
 if (result.status === 0) return [];
 const lines = (result.stdout || "").split("\n");
 const files = [];
 for (let i = 1; i < lines.length; i += 1) {
  const line = lines[i];
  if (line === "") break; // start of the informational messages block
  if (line.trim()) files.push(line.trim());
 }
 return files;
}

/** Live merge/conflict state of the workspace repo. */
function worktreeMergeStatus() {
 const ws = workspaceRoot();
 if (runGit(ws, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }).status !== 0) {
  return { inProgress: false, conflicts: [], message: null };
 }
 const gitDir = runGit(ws, ["rev-parse", "--absolute-git-dir"]).stdout.trim();
 const inProgress = existsSync(join(gitDir, "MERGE_HEAD"));
 const unmerged = runGit(ws, ["diff", "--name-only", "--diff-filter=U"], { allowFail: true });
 const conflicts = (unmerged.stdout || "").trim().split("\n").filter(Boolean);
 let message = null;
 try { message = readFileSync(join(gitDir, "MERGE_MSG"), "utf8").split("\n")[0]; } catch { /* none */ }
 return { inProgress, conflicts, message };
}

/**
 * One command, several modes so the bridge stays small:
 *  preview  — fetch + report ahead/behind, fast-forwardable, predicted conflicts
 *  apply    — perform the merge (guards: clean tree, no merge in flight)
 *  continue — commit a resolved merge
 *  abort    — `git merge --abort`
 */
function worktreeMerge(payload = {}) {
 const ws = workspaceRoot();
 const mode = String(payload.mode || "preview");

 if (mode === "abort") {
  if (!worktreeMergeStatus().inProgress) throw new Error("No merge is in progress.");
  runGit(ws, ["merge", "--abort"]);
  return { status: "aborted", merge: worktreeMergeStatus() };
 }
 if (mode === "continue") {
  const state = worktreeMergeStatus();
  if (!state.inProgress) throw new Error("No merge is in progress.");
  if (state.conflicts.length) throw new Error(`Resolve ${state.conflicts.length} conflicted file${state.conflicts.length === 1 ? "" : "s"} first.`);
  runGit(ws, ["commit", "--no-edit"]);
  return { status: "merged", merge: worktreeMergeStatus() };
 }

 const worktree = findWorktree(payload.dir);
 const bare = join(workDir(), `${worktree.repo}.git`);
 if (!existsSync(bare)) throw new Error(`Bare repo for '${worktree.repo}' is missing.`);
 const wtBranch = worktree.branch;
 const current = runGit(ws, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
 const target = String(payload.target || current).trim() || current;

 // Pull the silo's commits into the workspace object store (FETCH_HEAD).
 runGit(ws, ["fetch", bare, wtBranch]);
 const counts = runGit(ws, ["rev-list", "--left-right", "--count", `${target}...FETCH_HEAD`], { allowFail: true }).stdout.trim().split(/\s+/);
 const behind = Number(counts[0] || 0);
 const ahead = Number(counts[1] || 0);
 const canFastForward = runGit(ws, ["merge-base", "--is-ancestor", target, "FETCH_HEAD"], { allowFail: true }).status === 0;
 const conflicts = parseMergeTreeConflicts(runGit(ws, ["merge-tree", "--write-tree", "--name-only", target, "FETCH_HEAD"], { allowFail: true }));
 const workspaceDirty = runGit(ws, ["status", "--porcelain"], { allowFail: true }).stdout.trim().length > 0;
 const preview = { target, wtBranch, ahead, behind, canFastForward, conflicts, workspaceDirty, alreadyMerged: ahead === 0 };

 if (mode === "preview") return { status: "preview", preview, merge: worktreeMergeStatus() };
 if (mode !== "apply") throw new Error(`Unknown merge mode '${mode}'.`);

 if (ahead === 0) return { status: "up-to-date", preview, merge: worktreeMergeStatus() };
 if (workspaceDirty) throw new Error("Commit or stash your workspace changes before merging.");
 if (worktreeMergeStatus().inProgress) throw new Error("Finish or abort the in-progress merge first.");
 if (current !== target) throw new Error(`Check out '${target}' in the workspace before merging (currently on '${current}').`);

 const merged = runGit(ws, ["merge", "--no-ff", "FETCH_HEAD", "-m", `Merge worktree ${worktree.name} (${wtBranch})`], { allowFail: true });
 const after = worktreeMergeStatus();
 if (merged.status === 0) return { status: "merged", preview, merge: after };
 if (after.inProgress || after.conflicts.length) return { status: "conflicts", preview, merge: after };
 throw new Error((merged.stderr || merged.stdout || "merge failed").trim().slice(0, 400));
}

/** Quick-resolve one conflicted file by side. "theirs" = the incoming silo
 *  branch, "ours" = the workspace target — the intuitive mapping for a merge. */
function resolveWorktreeConflict(payload = {}) {
 const ws = workspaceRoot();
 const resolution = String(payload.resolution || "");
 if (resolution !== "ours" && resolution !== "theirs") throw new Error("Resolution must be 'ours' or 'theirs'.");
 const state = worktreeMergeStatus();
 if (!state.inProgress) throw new Error("No merge is in progress.");
 const path = String(payload.path || "").trim();
 // Only files git currently reports as unmerged may be resolved — this is the
 // tightest guard against path traversal (no regex needed).
 if (!state.conflicts.includes(path)) throw new Error("That file is not currently conflicted.");
 runGit(ws, ["checkout", `--${resolution}`, "--", path]);
 runGit(ws, ["add", "--", path]);
 return { resolved: path, resolution, merge: worktreeMergeStatus() };
}

/* ------------- Crew assignments: staged jobs for the staffing board ----- */

function crewFile() {
 return join(stateRoot(), "crew.json");
}

function loadCrew() {
 const stored = jsonFile(crewFile(), {});
 return Array.isArray(stored.assignments) ? stored.assignments : [];
}

function listCrewAssignments() {
 return { assignments: loadCrew() };
}

function saveCrewAssignment(payload) {
 const input = payload.assignment || {};
 const title = String(input.title || "").trim();
 const silo = String(input.silo || "").trim();
 if (!title) throw new Error("An assignment needs a title.");
 if (!silo) throw new Error("An assignment needs a silo.");
 const assignments = loadCrew();
 const id = String(input.id || `job-${Date.now().toString(36)}`);
 const existing = assignments.find((item) => item.id === id);
 const next = {
  id,
  title,
  silo,
  kit: String(input.kit || "") || null,
  paddockId: String(input.paddockId || "") || null,
  prompt: String(input.prompt || "") || null,
  status: ["staged", "started", "done"].includes(input.status) ? input.status : existing?.status || "staged",
  createdAt: existing?.createdAt || new Date().toISOString(),
  startedAt: input.status === "started" && !existing?.startedAt ? new Date().toISOString() : existing?.startedAt || null,
 };
 const merged = existing
  ? assignments.map((item) => (item.id === id ? next : item))
  : [...assignments, next];
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(crewFile(), JSON.stringify({ assignments: merged }, null, 2));
 return next;
}

function removeCrewAssignment(payload) {
 const id = String(payload.id || "");
 const assignments = loadCrew();
 if (!assignments.some((item) => item.id === id)) throw new Error("Assignment was not found.");
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(crewFile(), JSON.stringify({ assignments: assignments.filter((item) => item.id !== id) }, null, 2));
 return { removed: id };
}

/* ------- Farm sessions: the durable Jobs store (one file per session) ------
   Chat sessions used to live only in the webview's localStorage; this store
   makes them durable and lets native CLI transcripts be adopted on first use. */

function sessionsDir() {
 return join(stateRoot(), "sessions");
}

function sessionPath(id) {
 const safe = String(id || "").replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "");
 if (!safe) throw new Error("A session needs an id.");
 return join(sessionsDir(), `${safe}.json`);
}

/** Heal adopted sessions whose title was derived from a synthetic record
 *  before the transcript filter existed — re-derive from the first real
 *  user message and rewrite the file once. */
function repairSessionTitle(session, path) {
 if (!session?.title || !syntheticTranscriptText(session.title)) return session;
 const real = (Array.isArray(session.messages) ? session.messages : [])
  .find((message) => message.role === "user" && typeof message.content === "string" && message.content.trim() && !syntheticTranscriptText(message.content));
 const fallback = session.originPath ? basename(String(session.originPath)) : session.id;
 const healed = { ...session, title: (real ? real.content.trim().slice(0, 80) : fallback) };
 try { writeFileSync(path, JSON.stringify(healed, null, 2), { mode: 0o600 }); } catch { /* read-only store — serve healed in-memory */ }
 return healed;
}

function sessionMeta(session) {
 const { id, title, model, createdAt, updatedAt, project, pinned, archived, permissions, effort, catalogModel, source, originPath, importedAt } = session;
 return {
  id, title, model, createdAt, updatedAt,
  project: project ?? null,
  pinned: Boolean(pinned),
  archived: Boolean(archived),
  permissions: permissions || "ask",
  effort, catalogModel, source, originPath, importedAt,
  messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
 };
}

function listFarmSessions(payload = {}) {
 const offset = Math.max(0, Number(payload.offset) || 0);
 const limit = Math.min(200, Math.max(1, Number(payload.limit) || 40));
 const query = String(payload.query || "").trim().toLowerCase();
 let names = [];
 try { names = readdirSync(sessionsDir()).filter((name) => name.endsWith(".json")); } catch { /* no store yet */ }
 // mtime tracks updatedAt (we rewrite the file on every save) — sort on stat
 // so the common no-query path only ever reads one page of files.
 const ordered = names
  .map((name) => {
   const path = join(sessionsDir(), name);
   try { return { path, mtime: statSync(path).mtimeMs }; } catch { return null; }
  })
  .filter(Boolean)
  .sort((a, b) => b.mtime - a.mtime);
 const load = (entry) => {
  const session = jsonFile(entry.path, null);
  return session?.id ? repairSessionTitle(session, entry.path) : null;
 };
 const rows = query
  ? ordered
   .map(load)
   .filter((session) => session && String(session.title || "").toLowerCase().includes(query))
  : ordered.slice(offset, offset + limit).map(load).filter(Boolean);
 const page = query ? rows.slice(offset, offset + limit) : rows;
 return {
  sessions: page.map(sessionMeta),
  total: query ? rows.length : ordered.length,
  offset,
  limit,
 };
}

function getFarmSession(payload) {
 const path = sessionPath(payload.id);
 const session = jsonFile(path, null);
 if (!session) throw new Error("Session was not found.");
 return repairSessionTitle(session, path);
}

function saveFarmSession(payload) {
 const session = payload.session;
 if (!session || typeof session !== "object" || !session.id) throw new Error("A session payload with an id is required.");
 mkdirSync(sessionsDir(), { recursive: true });
 writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), { mode: 0o600 });
 return sessionMeta(session);
}

function removeFarmSession(payload) {
 const path = sessionPath(payload.id);
 if (!existsSync(path)) throw new Error("Session was not found.");
 unlinkSync(path);
 return { removed: String(payload.id) };
}

/* ---- OAuth usage: the authoritative three-bucket report per account ---- */

/** Same endpoint Claude Code's /usage screen reads. Maps the limits[] array
 *  to UsageWindow shapes; "weekly" is renamed "weekly all models" so the
 *  planner's overall-pool matcher picks it as the governing weekly. */
async function fetchClaudeOauthUsage(home) {
 let token = null;
 try {
  const credentials = JSON.parse(readFileSync(join(home, ".credentials.json"), "utf8"));
  token = credentials?.claudeAiOauth?.accessToken || credentials?.accessToken || null;
 } catch { return null; }
 if (!token) return null;
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 8000);
 try {
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
   headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
   signal: controller.signal,
  });
  if (!response.ok) return null;
  const report = await response.json();
  const windows = [];
  for (const limit of Array.isArray(report.limits) ? report.limits : []) {
   // is_active only marks the BINDING limit — every limit is real data.
   if (!limit) continue;
   const kind = String(limit.kind || limit.group || "quota");
   const percent = Number(limit.percent);
   if (!Number.isFinite(percent) && !limit.resets_at) continue;
   const label = kind === "weekly_scoped"
    ? `weekly ${limit.scope?.model?.display_name || "scoped"}`
    : kind === "weekly_all" || kind === "weekly"
     ? "weekly all models"
     : kind.replaceAll("_", " ");
   windows.push({
    window: label,
    usedPercent: Number.isFinite(percent) ? percent : undefined,
    remainingPercent: Number.isFinite(percent) ? Math.max(0, 100 - percent) : undefined,
    resetsAt: isoReset(limit.resets_at),
    status: limit.severity && limit.severity !== "normal" ? String(limit.severity) : undefined,
   });
  }
  // Older shape fallback: top-level five_hour/seven_day objects.
  if (!windows.length) {
   for (const [key, label] of [["five_hour", "session"], ["seven_day", "weekly all models"]]) {
    const pool = report[key];
    if (!pool) continue;
    const used = Number(pool.utilization);
    const usedPercent = Number.isFinite(used) ? (used <= 1 ? used * 100 : used) : undefined;
    windows.push({
     window: label,
     usedPercent,
     remainingPercent: usedPercent != null ? Math.max(0, 100 - usedPercent) : undefined,
     resetsAt: isoReset(pool.resets_at),
    });
   }
  }
  return windows.length ? windows : null;
 } catch {
  return null;
 } finally {
  clearTimeout(timer);
 }
}

function persistOauthWindows(name, windows) {
 const directory = join(stateRoot(), "usage", name);
 const path = join(directory, "claude.json");
 mkdirSync(directory, { recursive: true });
 const previous = jsonFile(path, {});
 writeFileSync(path, JSON.stringify({
  ...previous,
  provider: "claude",
  account: name,
  updatedAt: new Date().toISOString(),
  source: "live-event",
  windows,
 }, null, 2));
}

/* ------ Usage ping: force-fresh stats by touching each silo's CLI ------- */

/** Fire-and-forget: one detached, cheap CLI call per silo/provider so a fresh
 *  transcript (claude) or session record with rate_limits (codex) lands in
 *  the silo home. Returns immediately; the shell re-pulls bootstrap shortly
 *  after and the new evidence shows up as "newest report just now". */
async function pingUsage(payload) {
 const accountsRoot = join(stateRoot(), "accounts");
 const started = [];
 for (const name of listDirectories(accountsRoot)) {
  if (payload.silo && payload.silo !== name) continue;
  const accountPath = join(accountsRoot, name);
  const providers = listDirectories(accountPath).filter((entry) => entry.endsWith("-home")).map((entry) => entry.slice(0, -5));
  for (const provider of providers) {
   if (payload.provider && payload.provider !== provider) continue;
   // claude gets everything from the OAuth pass below; a CLI touch is only
   // worth its cost for codex session records, or when explicitly asked.
   if (!payload.cli && provider === "claude") continue;
   const home = join(accountPath, `${provider}-home`);
   let command = null;
   const env = { ...process.env, PING_PROMPT: "Reply with exactly: pong" };
   if (provider === "claude") {
    env.CLAUDE_CONFIG_DIR = home;
    // Bare-metal ping: no MCP servers, no settings/skills/hooks, one
    // turn — the goal is a fresh transcript stamp, not an agent.
    command = 'command claude --model claude-haiku-4-5 --strict-mcp-config --mcp-config \'{"mcpServers":{}}\' --setting-sources "" --max-turns 1 -p "$PING_PROMPT" >/dev/null 2>&1';
   } else if (provider === "codex") {
    env.CODEX_HOME = home;
    command = 'command codex exec --skip-git-repo-check "$PING_PROMPT" >/dev/null 2>&1';
   } else {
    continue;
   }
   try {
    const child = spawn("zsh", ["-lc", command], { cwd: accountPath, env, detached: true, stdio: "ignore" });
    child.unref();
    started.push({ silo: name, provider });
   } catch { /* CLI missing — silo simply stays on archived data */ }
  }
 }
 // Authoritative pass: the OAuth usage endpoint per claude silo — full
 // session/weekly/per-model windows with reset stamps, ~1s, no CLI boot.
 const oauthResults = await Promise.allSettled(
  listDirectories(accountsRoot)
   .filter((name) => !payload.silo || payload.silo === name)
   .map(async (name) => {
    const home = join(accountsRoot, name, "claude-home");
    if (!existsSync(home)) return null;
    const windows = await fetchClaudeOauthUsage(home);
    if (windows) persistOauthWindows(name, windows);
    return windows ? name : null;
   }),
 );
 const reported = oauthResults
  .map((result) => (result.status === "fulfilled" ? result.value : null))
  .filter(Boolean);
 return { started, reported, startedAt: new Date().toISOString() };
}

/* ----------- Editor assistant: the wiki's floating AI input ------------- */

function editorAssist(payload) {
 const prompt = String(payload.prompt || "").trim();
 if (!prompt) throw new Error("The assistant needs a prompt.");
 const docPath = String(payload.docPath || "").replace(/^\/+/, "");
 const selection = typeof payload.selection === "string" ? payload.selection.slice(0, 4000) : "";
 const model = String(payload.model || "claude-haiku-4-5");
 let docExcerpt = "";
 if (docPath) {
  try {
   const root = workspaceRoot();
   const target = resolve(root, docPath);
   if (target === root || target.startsWith(`${root}/`)) docExcerpt = readFileSync(target, "utf8").slice(0, 12000);
  } catch { /* doc unreadable — assist without it */ }
 }
 const input = [
  "You are the writing assistant inside a markdown wiki editor. Reply with ONLY the markdown to insert or the answer requested — no preamble, no code fence around the whole reply.",
  docExcerpt ? `DOCUMENT (${docPath}):\n${docExcerpt}` : "",
  selection ? `SELECTED TEXT:\n${selection}` : "",
  `REQUEST:\n${prompt}`,
 ].filter(Boolean).join("\n\n");
 // Callers pick their patience (the flow parser wants 45s, not 2min);
 // SIGKILL because a wedged CLI ignores SIGTERM and the whole point of
 // the timeout is ending the wait.
 const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 120000, 10000), 120000);
 const result = spawnSync("zsh", ["-lc", "command claude -p --model \"$ASSIST_MODEL\""], {
  encoding: "utf8",
  input,
  timeout: timeoutMs,
  killSignal: "SIGKILL",
  env: { ...process.env, ASSIST_MODEL: model },
  maxBuffer: 2 * 1024 * 1024,
 });
 if (result.signal) throw new Error(`The assistant timed out after ${Math.round(timeoutMs / 1000)}s — likely another claude instance holds the config lock. Try again.`);
 if (result.status !== 0) throw new Error((result.stderr || "").trim().slice(0, 300) || "The assistant call failed.");
 return { result: result.stdout.trim(), docPath };
}

/* ------------- crewbar: the menu bar extra's state + lifecycle ---------- */

/** Digest the accounts into the crewbar helper's state file. Title is the
 *  summed session hours above weekly reserves (the "safe now" figure) plus
 *  a risk flag; one line per silo. */
function writeCrewbarState(accounts) {
 try {
  let safeHours = 0;
  let risk = 0;
  const lines = [];
  for (const account of accounts) {
   for (const usage of account.usage || []) {
    if (usage.provider !== "claude" || !usage.windows?.length) continue;
    const windowNamed = (pattern) => usage.windows.find((item) => pattern.test(item.window));
    const session = windowNamed(/session|five|hour/i);
    const weekly = windowNamed(/weekly all|week/i);
    const sessionLeft = session?.remainingPercent;
    const weeklyLeft = weekly?.remainingPercent;
    if (sessionLeft != null) safeHours += (Math.min(sessionLeft, weeklyLeft ?? 100) / 100) * 5;
    if (weeklyLeft != null && weeklyLeft < 12) risk += 1;
    lines.push({
     label: `${account.name} — session ${sessionLeft != null ? `${Math.round(100 - sessionLeft)}% used` : "?"} · weekly ${weeklyLeft != null ? `${Math.round(100 - weeklyLeft)}% used` : "?"}`,
    });
   }
  }
  writeFileSync(join(stateRoot(), "crewbar.json"), JSON.stringify({
   title: `${safeHours.toFixed(1)}h${risk ? ` !${risk}` : ""}`,
   lines,
   updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }, null, 2));
 } catch { /* menu bar state is best-effort */ }
}

/** Spawn the compiled helper once (menu-bar accessory, no Dock icon). */
function ensureCrewbar() {
 try {
  const repo = farmRepo();
  if (!repo) return;
  const binary = join(repo, "desktop", "helpers", "crewbar", "crewbar");
  if (!existsSync(binary)) return;
  const running = spawnSync("pgrep", ["-x", "crewbar"], { encoding: "utf8", timeout: 1500 });
  if (running.status === 0) return;
  const child = spawn(binary, [], {
   detached: true,
   stdio: "ignore",
   env: { ...process.env, CREWBAR_CONTROLLER: join(here, "controller.mjs") },
  });
  child.unref();
 } catch { /* helper missing or pgrep unavailable — shell works without it */ }
}

/* -------------------- Desktop notifications (macOS) --------------------- */

function notifyDesktop(payload) {
 const title = String(payload.title || "Agent Farm").slice(0, 80);
 const body = String(payload.body || "").slice(0, 240);
 const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}${payload.silent ? "" : ' sound name "Glass"'}`;
 const result = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 4000 });
 if (result.status !== 0) throw new Error(result.stderr?.trim() || "Notification could not be delivered.");
 return { delivered: true };
}

/* ------ Harvest: heartbeat AI pass that banks reusable capability -------- */
/* Scan is fire-and-forget: the bridge returns immediately so the native UI
 * thread is not blocked for the full LLM call (up to ~3 min). A detached
 * worker process does the real work and writes harvest.json when done. */

const HARVEST_STALE_MS = 4 * 60 * 1000;

function harvestFile() {
 return join(stateRoot(), "harvest.json");
}

function harvestScanningActive(stored) {
 if (!stored?.scanning) return false;
 const pid = Number(stored.scanPid) || 0;
 if (pid && processAlive(pid)) return true;
 const started = Date.parse(stored.scanStartedAt || "") || 0;
 // Brief grace after mark-before-spawn so a just-launched worker is not
 // treated as stale before its pid is written / process is visible.
 if (started && Date.now() - started < 5000) return true;
 return false;
}

/** Same liveness rule as the scan, for the triage worker's own lock. */
function harvestTriagingActive(stored) {
 if (!stored?.triaging) return false;
 const pid = Number(stored.triagePid) || 0;
 if (pid && processAlive(pid)) return true;
 const started = Date.parse(stored.triageStartedAt || "") || 0;
 if (started && Date.now() - started < 5000) return true;
 return false;
}

function loadHarvest() {
 const stored = jsonFile(harvestFile(), {}) || {};
 const suggestions = Array.isArray(stored.suggestions) ? stored.suggestions : [];
 const lastScanAt = stored.lastScanAt || null;
 const lastError = stored.lastError || null;
 const triage = {
  lastTriageAt: stored.lastTriageAt || null,
  lastTriageError: stored.lastTriageError || null,
  lastTriageCounts: stored.lastTriageCounts || null,
 };
 const triagingLive = Boolean(stored.triaging && harvestTriagingActive(stored));
 if (stored.triaging && !triagingLive) {
  // Triage worker died without clearing its flag — heal, same as the scan.
  triage.lastTriageError = triage.lastTriageError || "Harvest triage stopped unexpectedly.";
 }
 if (stored.scanning && !harvestScanningActive(stored)) {
  const healed = {
   suggestions,
   lastScanAt,
   lastError: lastError || "Harvest scan stopped unexpectedly.",
   scanning: false,
   scanPid: null,
   scanStartedAt: null,
   ...triage,
   triaging: triagingLive,
   triagePid: triagingLive ? stored.triagePid : null,
   triageStartedAt: triagingLive ? stored.triageStartedAt : null,
  };
  try { saveHarvest(healed); } catch { /* best-effort heal */ }
  return { suggestions, lastScanAt, lastError: healed.lastError, scanning: false, triaging: triagingLive, ...triage };
 }
 if (stored.triaging && !triagingLive) {
  try {
   saveHarvest({
    suggestions,
    lastScanAt,
    lastError,
    scanning: Boolean(stored.scanning && harvestScanningActive(stored)),
    scanPid: stored.scanPid,
    scanStartedAt: stored.scanStartedAt,
    ...triage,
    triaging: false,
    triagePid: null,
    triageStartedAt: null,
   });
  } catch { /* best-effort heal */ }
 }
 return {
  suggestions,
  lastScanAt,
  lastError,
  scanning: Boolean(stored.scanning && harvestScanningActive(stored)),
  triaging: triagingLive,
  ...triage,
 };
}

function saveHarvest(state) {
 mkdirSync(stateRoot(), { recursive: true });
 const out = {
  suggestions: Array.isArray(state.suggestions) ? state.suggestions : [],
  lastScanAt: state.lastScanAt || null,
  lastError: state.lastError || null,
  scanning: Boolean(state.scanning),
  scanPid: state.scanPid ?? null,
  scanStartedAt: state.scanStartedAt || null,
  triaging: Boolean(state.triaging),
  triagePid: state.triagePid ?? null,
  triageStartedAt: state.triageStartedAt || null,
  lastTriageAt: state.lastTriageAt || null,
  lastTriageError: state.lastTriageError || null,
  lastTriageCounts: state.lastTriageCounts || null,
 };
 writeFileSync(harvestFile(), JSON.stringify(out, null, 2));
}

const HARVEST_KINDS = new Set(["skill", "workflow", "agent-update", "wiki-doc"]);

/** Harvest-any-session (spec B): digest ONE transcript — a Farm session from
 *  the store (sessionId) or a native CLI transcript (sessionPath) — into the
 *  same excerpt shape harvestDigest() produces for workspace docs. */
/** Roots a native transcript may be read from: silo homes plus the host's
 *  own CLI homes (host sessions joined the unified list 2026-07-16). */
function isTranscriptPath(path) {
 return [
  join(stateRoot(), "accounts"),
  join(homedir(), ".claude", "projects"),
  join(homedir(), ".codex", "sessions"),
 ].some((root) => path === root || path.startsWith(`${root}/`));
}

function sessionHarvestDigest(payload) {
 const root = workspaceRoot();
 if (payload.sessionId) {
  const session = jsonFile(sessionPath(payload.sessionId), null);
  if (!session) return { root, fileCount: 0, digest: "" };
  const turns = (Array.isArray(session.messages) ? session.messages : [])
   .map((message) => `${String(message.role || "user").toUpperCase()}: ${transcriptText(message.content).slice(0, 1600)}`)
   .filter((line) => line.length > 6);
  return {
   root,
   fileCount: 1,
   digest: `=== Farm session "${session.title}" (${session.model}) ===\n${turns.join("\n\n").slice(0, 46000)}`,
  };
 }
 const originPath = resolve(String(payload.sessionPath || ""));
 if (!isTranscriptPath(originPath)) return { root, fileCount: 0, digest: "" };
 const turns = [];
 try {
  for (const line of readFileSync(originPath, "utf8").split(/\r?\n/)) {
   if (!line.trim()) continue;
   try {
    const record = JSON.parse(line); const inner = record.payload || record.message || record;
    const role = String(record.role || inner.role || record.type || "").toLowerCase();
    const text = transcriptText(inner.content || inner.message?.content || inner.text || record.content).trim();
    if (text && (role.includes("user") || role.includes("assistant") || role.includes("response") || role.includes("request"))) {
     turns.push(`${role.includes("user") || role.includes("request") ? "USER" : "ASSISTANT"}: ${text.slice(0, 1600)}`);
    }
   } catch { /* incomplete transcript line */ }
  }
 } catch { return { root, fileCount: 0, digest: "" }; }
 return { root, fileCount: 1, digest: `=== Agent transcript ${basename(originPath)} ===\n${turns.join("\n\n").slice(0, 46000)}` };
}

/** Digest of what the crew has been producing: recent workspace docs
 *  (head-only) so the cheap model reads outlines, not whole files. */
function harvestDigest() {
 const { root, files } = listMarkdownWorkspace();
 const recent = [...files]
  .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
  .slice(0, 24);
 const sections = [];
 for (const file of recent) {
  try {
   const text = readFileSync(join(root, file.path), "utf8");
   const head = text.split("\n").slice(0, 40).join("\n").slice(0, 2200);
   sections.push(`=== ${file.path} (modified ${file.modifiedAt}) ===\n${head}`);
  } catch { /* unreadable file — skip */ }
 }
 return { root, fileCount: files.length, digest: sections.join("\n\n").slice(0, 48000) };
}

/** First running claude silo (the same auth jobs use), or null. */
function pickClaudeSilo() {
 const running = containerStates();
 for (const account of listAccounts()) {
  if (!account.providers.includes("claude")) continue;
  if (running.has(`usage-${account.name}`)) return { account: account.name, container: `usage-${account.name}` };
  if (running.has(`claude-${account.name}`)) return { account: account.name, container: `claude-${account.name}` };
 }
 return null;
}

/** Run a cheap completion the way jobs authenticate — NOT via host `claude`
 *  (which is usually not logged in). Prefers the gateway's rota (auto-picks
 *  the healthiest silo); falls back to exec inside a running claude silo. */
async function harvestComplete(prompt, model) {
 const safeModel = /^[a-z0-9._-]+$/i.test(model) ? model : "claude-haiku-4-5";
 const status = gatewayStatus();
 if (status.running) {
  try {
   const config = gatewayConfig();
   const headers = { "content-type": "application/json" };
   if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
   const abort = new AbortController();
   const timer = setTimeout(() => abort.abort(), 180000);
   const response = await fetch(`${status.url}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "rota", messages: [{ role: "user", content: prompt }] }),
    signal: abort.signal,
   });
   clearTimeout(timer);
   if (response.ok) {
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text === "string" && text.trim()) return { text, via: "gateway (rota)" };
   }
  } catch { /* gateway unreachable — fall back to a silo */ }
 }
 const silo = pickClaudeSilo();
 if (silo) {
  const result = spawnSync("container", [
   "exec", "-i", silo.container, "sh", "-lc",
   `cd "${workDir()}" 2>/dev/null; exec claude -p --model "${safeModel}" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources "" 2>/dev/null`,
  ], { encoding: "utf8", input: prompt, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status === 0 && (result.stdout || "").trim()) return { text: result.stdout, via: `silo ${silo.account}` };
  throw new Error((result.stderr || result.stdout || "silo claude failed").trim().slice(0, 300));
 }
 throw new Error("Harvest needs the gateway running or a claude silo up — the host claude CLI is not logged in.");
}

/** Models wrap JSON in prose or fences despite instructions — peel a fenced
 *  block first, then the widest [..] span. Returns null when nothing parses so
 *  the caller can surface the reply head and stay diagnosable, not mute. */
function parseJsonArrayReply(text) {
 const raw = String(text || "").trim();
 const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
 const candidates = [];
 if (fenced) candidates.push(fenced[1].trim());
 const start = raw.indexOf("[");
 const end = raw.lastIndexOf("]");
 if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1));
 for (const candidate of candidates) {
  try {
   const parsed = JSON.parse(candidate);
   if (Array.isArray(parsed)) return parsed;
  } catch { /* next candidate */ }
 }
 return null;
}

/** Actual LLM scan body. Runs only in the detached worker (or when payload.worker). */
async function runHarvestScanWorker(payload) {
 const state = loadHarvest();
 // Keep the scanning flag while we work so list/poll shows progress.
 const scanningMeta = {
  scanning: true,
  scanPid: process.pid,
  scanStartedAt: state.scanStartedAt || new Date().toISOString(),
 };
 const { root, fileCount, digest } = payload.sessionId || payload.sessionPath
  ? sessionHarvestDigest(payload)
  : harvestDigest();
 if (!digest) {
  saveHarvest({
   ...state,
   ...scanningMeta,
   scanning: false,
   scanPid: null,
   scanStartedAt: null,
   lastScanAt: new Date().toISOString(),
   lastError: "Workspace has no readable documents yet.",
  });
  return { ...loadHarvest(), scanned: 0, started: false, worker: true };
 }
 const model = String(payload.model || "claude-haiku-4-5");
 const known = state.suggestions
  .filter((item) => item.status !== "dismissed")
  .map((item) => `- [${item.kind}] ${item.title}`)
  .join("\n");
 const prompt = [
  `${HARVEST_PROMPT_HEAD} for reusable capability.`,
  "Read the document excerpts below and propose AT MOST 4 NEW artifacts worth creating: repeated procedures worth a skill, multi-step processes worth a workflow, conventions worth an agent-file update, or scattered knowledge worth a wiki doc.",
  "Do not repeat anything in the ALREADY-SUGGESTED list. Only suggest something clearly grounded in the excerpts.",
  'Respond with ONLY a JSON array (no prose, no fences): [{"kind":"skill"|"workflow"|"agent-update"|"wiki-doc","title":"...","summary":"one sentence on the value","citations":["relative/doc/path.md"],"draftPath":"suggested/relative/output/path.md","draft":"full markdown body of the artifact"}]',
  "Return [] if nothing is worth banking.",
  known ? `ALREADY-SUGGESTED:\n${known}` : "",
  `WORKSPACE EXCERPTS (${fileCount} docs total, newest first):\n${digest}`,
 ].filter(Boolean).join("\n\n");
 const now = new Date().toISOString();
 let completion;
 try {
  completion = await harvestComplete(prompt, model);
 } catch (error) {
  saveHarvest({
   suggestions: state.suggestions,
   lastScanAt: now,
   lastError: (error instanceof Error ? error.message : String(error)).slice(0, 300),
   scanning: false,
   scanPid: null,
   scanStartedAt: null,
  });
  return { ...loadHarvest(), scanned: 0, started: false, worker: true };
 }
 const proposals = parseJsonArrayReply(completion.text);
 if (!proposals) {
  const head = completion.text.replace(/\s+/g, " ").slice(0, 140);
  saveHarvest({
   suggestions: state.suggestions,
   lastScanAt: now,
   lastError: `Model reply was not valid JSON: "${head}"`,
   scanning: false,
   scanPid: null,
   scanStartedAt: null,
  });
  return { ...loadHarvest(), scanned: 0, started: false, worker: true };
 }
 // Re-read so concurrent approve/dismiss during the scan is not clobbered.
 const latest = loadHarvest();
 const fresh = [];
 for (const item of Array.isArray(proposals) ? proposals : []) {
  const kind = String(item?.kind || "");
  const title = String(item?.title || "").trim();
  if (!HARVEST_KINDS.has(kind) || !title) continue;
  if (latest.suggestions.some((existing) => existing.title.toLowerCase() === title.toLowerCase() && existing.status !== "dismissed")) continue;
  fresh.push({
   id: `harvest-${createHash("sha256").update(`${kind}:${title}`).digest("hex").slice(0, 10)}`,
   root: root || null,
   kind,
   title,
   summary: String(item?.summary || "").slice(0, 300),
   citations: (Array.isArray(item?.citations) ? item.citations : []).map(String).slice(0, 8),
   draftPath: String(item?.draftPath || "").replace(/^\/+/, "") || null,
   draft: typeof item?.draft === "string" ? item.draft.slice(0, 40000) : null,
   status: "proposed",
   createdAt: now,
  });
 }
 saveHarvest({
  suggestions: [...latest.suggestions, ...fresh],
  lastScanAt: now,
  lastError: null,
  scanning: false,
  scanPid: null,
  scanStartedAt: null,
 });
 return { ...loadHarvest(), scanned: fresh.length, root, started: false, worker: true };
}

/** Start (or no-op) a harvest scan. Returns immediately so the native host
 *  bridge does not beach-ball the UI for the full LLM duration. Pass
 *  { worker: true } only from the detached child process. */
async function runHarvestScan(payload = {}) {
 if (payload.worker === true || process.env.HARVEST_WORKER === "1") {
  return runHarvestScanWorker(payload);
 }

 const current = loadHarvest();
 if (current.scanning) {
  return { ...harvestProjection(current), scanned: 0, started: false };
 }

 // Stale lock older than the LLM timeout + buffer — clear before relaunch.
 const stored = jsonFile(harvestFile(), {}) || {};
 const startedAt = Date.parse(stored.scanStartedAt || "") || 0;
 if (stored.scanning && startedAt && Date.now() - startedAt > HARVEST_STALE_MS) {
  saveHarvest({
   suggestions: current.suggestions,
   lastScanAt: current.lastScanAt,
   lastError: current.lastError || "Previous harvest scan timed out.",
   scanning: false,
   scanPid: null,
   scanStartedAt: null,
  });
 }

 const scanStartedAt = new Date().toISOString();
 saveHarvest({
  suggestions: current.suggestions,
  lastScanAt: current.lastScanAt,
  lastError: current.lastError,
  scanning: true,
  scanPid: null,
  scanStartedAt,
 });

 const workerPayload = {
  worker: true,
  model: payload.model || "claude-haiku-4-5",
  ...(payload.sessionId ? { sessionId: String(payload.sessionId) } : {}),
  ...(payload.sessionPath ? { sessionPath: String(payload.sessionPath) } : {}),
 };
 const child = spawn(process.execPath, [
  join(here, "controller.mjs"),
  "farm.harvest.scan",
  JSON.stringify(workerPayload),
 ], {
  detached: true,
  stdio: "ignore",
  env: {
   ...process.env,
   FARM_STATE: stateRoot(),
   HARVEST_WORKER: "1",
  },
 });
 child.unref();

 // Persist pid once known so list can detect a live worker.
 if (child.pid) {
  saveHarvest({
   suggestions: current.suggestions,
   lastScanAt: current.lastScanAt,
   lastError: current.lastError,
   scanning: true,
   scanPid: child.pid,
   scanStartedAt,
  });
 }

 return {
  ...harvestProjection(loadHarvest()),
  scanned: 0,
  started: true,
 };
}

/** Verdicts the triage model may return. Anything else is treated as "human"
 *  — an unparseable opinion must never silently reject someone's work. */
const HARVEST_VERDICTS = new Set(["accept", "refine", "merge", "reject", "human"]);
/** Ratings below this are auto-rejected even on an accept verdict; the model
 *  contradicting itself resolves toward the human queue, not toward a write. */
const HARVEST_MIN_ACCEPT_RATING = 3;

/** Triage body. Runs only in the detached worker (same reason as the scan:
 *  every bridge call blocks the host's main thread for its full duration). */
async function runHarvestTriageWorker(payload) {
 const state = loadHarvest();
 const meta = { triaging: true, triagePid: process.pid, triageStartedAt: state.triageStartedAt || new Date().toISOString() };
 const now = new Date().toISOString();
 const finish = (patch) => {
  const latest = loadHarvest();
  saveHarvest({
   ...latest,
   ...patch,
   triaging: false,
   triagePid: null,
   triageStartedAt: null,
  });
  return { ...harvestProjection(loadHarvest()), worker: true, started: false };
 };

 let root = null;
 try { root = workspaceRoot(); } catch { /* unscoped — triage everything */ }
 const pending = state.suggestions.filter((item) =>
  item.status === "proposed" && (!root || !item.root || resolve(item.root) === root));
 if (!pending.length) return finish({ lastTriageAt: now, lastTriageError: null });

 // Show the model what is already on disk at each draftPath — that is what
 // turns "already exists" from a dead end into a merge it can actually write.
 const cases = pending.map((item, index) => {
  let existing = null;
  if (item.draftPath) {
   try {
    const target = harvestTargetPath(item);
    if (existsSync(target)) existing = readFileSync(target, "utf8").slice(0, 6000);
   } catch { /* escapes the workspace — the writer will refuse it later */ }
  }
  return [
   `--- CANDIDATE ${index + 1} ---`,
   `id: ${item.id}`,
   `kind: ${item.kind}`,
   `title: ${item.title}`,
   `summary: ${item.summary}`,
   `draftPath: ${item.draftPath || "(none)"}`,
   `cites: ${(item.citations || []).join(", ") || "(none)"}`,
   `DRAFT:\n${String(item.draft || "").slice(0, 6000)}`,
   existing === null
    ? "EXISTING FILE AT draftPath: (none — this would be a new file)"
    : `EXISTING FILE AT draftPath (verdict must be "merge" or "reject" — a plain accept would clobber it):\n${existing}`,
  ].join("\n");
 }).join("\n\n");

 const others = pending.map((item) => `${item.id} :: [${item.kind}] ${item.title}`).join("\n");
 const prompt = [
  `${HARVEST_PROMPT_HEAD}.`,
  "You are triaging previously-harvested suggestions so a human only has to look at the genuinely uncertain ones. For EACH candidate return exactly one verdict:",
  '- "accept" — clearly useful and the draft is good as-is. Only when no file exists at draftPath.',
  '- "refine" — useful, but the draft needs editing. Return the corrected full draft (and a better title/summary if needed).',
  '- "merge" — an existing file is shown. Return the FULL merged body of that file with the new material folded in, preserving everything already there. Never drop existing content.',
  '- "reject" — redundant, trivial, speculative, or duplicates another candidate. Say which in the reason.',
  '- "human" — genuinely a judgement call. Use this when unsure; it is the safe default.',
  "Rate 1-5 on usefulness to this team (5 = clearly worth banking). Anything you rate below 3 must not be accepted.",
  "If two candidates overlap, merge the weaker into the stronger (reject the weaker, and say so in its reason).",
  'Respond with ONLY a JSON array (no prose, no fences): [{"id":"...","verdict":"accept|refine|merge|reject|human","rating":1-5,"reason":"one sentence","title":"optional replacement","summary":"optional replacement","draft":"required for refine and merge — the full body"}]',
  `CANDIDATE IDS:\n${others}`,
  `CANDIDATES:\n${cases}`,
 ].join("\n\n");

 let completion;
 try {
  completion = await harvestComplete(prompt, String(payload.model || "claude-haiku-4-5"));
 } catch (error) {
  return finish({ lastTriageAt: now, lastTriageError: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
 }

 const verdicts = parseJsonArrayReply(completion.text);
 if (!verdicts) {
  const head = completion.text.replace(/\s+/g, " ").slice(0, 140);
  return finish({ lastTriageAt: now, lastTriageError: `Triage reply was not valid JSON: "${head}"` });
 }

 // Re-read: the human may have approved or dismissed things while we ran.
 const latest = loadHarvest();
 const byId = new Map(latest.suggestions.map((item) => [item.id, item]));
 const counts = { accepted: 0, merged: 0, refined: 0, rejected: 0, human: 0, failed: 0 };
 for (const entry of verdicts) {
  const suggestion = byId.get(String(entry?.id || ""));
  if (!suggestion || suggestion.status !== "proposed") continue;
  const verdict = HARVEST_VERDICTS.has(String(entry?.verdict)) ? String(entry.verdict) : "human";
  const rating = Math.min(5, Math.max(1, Math.round(Number(entry?.rating) || 0))) || null;
  suggestion.rating = rating;
  suggestion.verdict = verdict;
  suggestion.triageReason = String(entry?.reason || "").slice(0, 300);
  suggestion.triagedAt = now;

  if (verdict === "reject") {
   suggestion.status = "dismissed";
   suggestion.resolvedAt = now;
   counts.rejected += 1;
   continue;
  }
  if (verdict === "human" || !rating || rating < HARVEST_MIN_ACCEPT_RATING) {
   // Contradiction (accept at rating 2, say) resolves toward the human queue.
   if (verdict !== "human") suggestion.verdict = "human";
   counts.human += 1;
   continue;
  }
  if (verdict === "refine" || verdict === "merge") {
   const revised = typeof entry?.draft === "string" ? entry.draft.slice(0, 40000) : "";
   if (!revised.trim()) {
    // A refine/merge with no body is not actionable — hand it to a human
    // rather than writing the unrevised draft over a real file.
    suggestion.verdict = "human";
    suggestion.triageReason = `${suggestion.triageReason} (model returned no revised draft)`.trim();
    counts.human += 1;
    continue;
   }
   suggestion.draft = revised;
   if (entry?.title) suggestion.title = String(entry.title).slice(0, 200);
   if (entry?.summary) suggestion.summary = String(entry.summary).slice(0, 300);
  }
  try {
   const written = writeHarvestDraft(suggestion, { merge: verdict === "merge" });
   suggestion.status = "approved";
   suggestion.writtenTo = written.path;
   suggestion.merged = written.merged;
   suggestion.autoApplied = true;
   suggestion.resolvedAt = now;
   if (written.merged) counts.merged += 1;
   else if (verdict === "refine") counts.refined += 1;
   else counts.accepted += 1;
  } catch (error) {
   // Never lose the suggestion because the write failed — park it for a human.
   suggestion.verdict = "human";
   suggestion.triageReason = `${suggestion.triageReason} (auto-apply failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)})`.trim();
   counts.failed += 1;
  }
 }

 return finish({ suggestions: latest.suggestions, lastTriageAt: now, lastTriageError: null, lastTriageCounts: counts });
}

/** Start (or no-op) a triage pass. Detached for the same reason as the scan. */
async function runHarvestTriage(payload = {}) {
 if (payload.worker === true || process.env.HARVEST_WORKER === "1") {
  return runHarvestTriageWorker(payload);
 }
 const current = loadHarvest();
 const startedAt = Date.parse(current.triageStartedAt || "") || 0;
 const stale = startedAt && Date.now() - startedAt > HARVEST_STALE_MS;
 if (current.triaging && !stale) return { ...harvestProjection(current), started: false };

 const triageStartedAt = new Date().toISOString();
 saveHarvest({ ...current, triaging: true, triagePid: null, triageStartedAt });
 const child = spawn(process.execPath, [
  join(here, "controller.mjs"),
  "farm.harvest.triage",
  JSON.stringify({ worker: true, model: payload.model || "claude-haiku-4-5" }),
 ], {
  detached: true,
  stdio: "ignore",
  env: { ...process.env, FARM_STATE: stateRoot(), HARVEST_WORKER: "1" },
 });
 child.unref();
 if (child.pid) saveHarvest({ ...loadHarvest(), triaging: true, triagePid: child.pid, triageStartedAt });
 return { ...harvestProjection(loadHarvest()), started: true };
}

/** Bridge responses must fit the native host's fixed stdout buffer — draft
 *  bodies are the only unbounded field, so list/scan return metadata plus a
 *  hasDraft flag and the full text is fetched per suggestion via
 *  farm.harvest.draft. Overflow surfaced as StreamTooLong on the harvest page. */
function harvestProjection(state) {
 return {
  ...state,
  suggestions: state.suggestions.map(({ draft, ...rest }) => ({
   ...rest,
   draft: null,
   hasDraft: Boolean(draft),
  })),
 };
}

function readHarvestDraft(payload) {
 const id = String(payload.id || "");
 const suggestion = loadHarvest().suggestions.find((item) => item.id === id);
 if (!suggestion) throw new Error("Suggestion was not found.");
 return { id, draft: suggestion.draft ?? null };
}

function listHarvest() {
 const state = loadHarvest();
 // Migrate legacy suggestions (pre project-scoping) to their historical
 // origin — every early harvest ran against the farm checkout.
 const legacyRoot = farmRepo();
 let migrated = false;
 for (const item of state.suggestions) {
  if (!item.root && legacyRoot) {
   item.root = legacyRoot;
   migrated = true;
  }
 }
 if (migrated) {
  try { saveHarvest({ ...state, ...harvestPersistMeta() }); } catch { /* scoped view still correct */ }
 }
 let current = null;
 try { current = workspaceRoot(); } catch { /* no workspace — show all */ }
 const suggestions = current
  ? state.suggestions.filter((item) => !item.root || resolve(item.root) === current)
  : state.suggestions;
 return harvestProjection({ ...state, suggestions });
}

/** Preserve in-flight scan metadata when mutating suggestions (approve/dismiss
 *  during a scan must not drop scanPid or the worker looks dead). */
function harvestPersistMeta() {
 const stored = jsonFile(harvestFile(), {}) || {};
 return {
  scanning: Boolean(stored.scanning),
  scanPid: stored.scanPid ?? null,
  scanStartedAt: stored.scanStartedAt || null,
  triaging: Boolean(stored.triaging),
  triagePid: stored.triagePid ?? null,
  triageStartedAt: stored.triageStartedAt || null,
  lastTriageAt: stored.lastTriageAt || null,
  lastTriageError: stored.lastTriageError || null,
  lastTriageCounts: stored.lastTriageCounts || null,
 };
}

/** Resolve a suggestion's draftPath inside the workspace. Containment is the
 *  whole point: a resolved path outside the root is refused, never written. */
function harvestTargetPath(suggestion) {
 const root = workspaceRoot();
 const target = resolve(root, suggestion.draftPath);
 if (target !== root && !target.startsWith(`${root}/`)) throw new Error("Draft path escapes the workspace.");
 return target;
}

/** The ONE writer for harvest drafts — approve and auto-accept share it so
 *  containment and the overwrite rule cannot drift apart.
 *
 *  `merge` is what makes the old "already exists — resolve manually" dead end
 *  actionable: triage re-reads the existing file, folds the draft into it, and
 *  passes the merged body back through here. Without an explicit merge the
 *  existing file is still never clobbered. */
function writeHarvestDraft(suggestion, { merge = false } = {}) {
 if (!suggestion.draft || !suggestion.draftPath) throw new Error("This suggestion has no draft to write.");
 const target = harvestTargetPath(suggestion);
 const exists = existsSync(target);
 if (exists && !merge) throw new Error(`${suggestion.draftPath} already exists — approve with merge, or run triage to fold it in.`);
 mkdirSync(dirname(target), { recursive: true });
 writeFileSync(target, suggestion.draft);
 return { path: suggestion.draftPath, merged: exists };
}

/** Approve writes the drafted artifact into the workspace; dismiss just parks
 *  it. `merge: true` permits writing over an existing file — the caller is
 *  asserting the draft already contains that file's content. */
function resolveHarvest(payload) {
 const id = String(payload.id || "");
 const action = String(payload.action || "");
 const state = loadHarvest();
 const meta = harvestPersistMeta();
 const suggestion = state.suggestions.find((item) => item.id === id);
 if (!suggestion) throw new Error("Suggestion was not found.");
 if (action === "dismiss") {
  suggestion.status = "dismissed";
  saveHarvest({ ...state, ...meta });
  return { id, status: "dismissed" };
 }
 if (action !== "approve") throw new Error("Action must be approve or dismiss.");
 const written = writeHarvestDraft(suggestion, { merge: payload.merge === true });
 suggestion.status = "approved";
 suggestion.writtenTo = written.path;
 suggestion.merged = written.merged;
 suggestion.resolvedAt = new Date().toISOString();
 saveHarvest({ ...state, ...meta });
 return { id, status: "approved", path: written.path, merged: written.merged };
}

function readWorkspaceAsset(payload) {
 const root = workspaceRoot();
 const relative = String(payload.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
 const path = workspaceFilePath(root, relative);
 if (!existsSync(path) || !statSync(path).isFile()) throw new Error("Workspace asset was not found.");
 const lower = path.toLowerCase();
 const mime =
  lower.endsWith(".svg") ? "image/svg+xml" :
   lower.endsWith(".png") ? "image/png" :
    lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" :
     lower.endsWith(".gif") ? "image/gif" :
      lower.endsWith(".webp") ? "image/webp" :
       null;
 if (!mime) throw new Error("Only image assets (svg/png/jpg/gif/webp) can be previewed.");
 const stat = statSync(path);
 if (stat.size > 2 * 1024 * 1024) throw new Error("Asset is larger than 2 MB.");
 const buf = readFileSync(path);
 if (mime === "image/svg+xml") {
  return { root, path: relative, mime, encoding: "utf8", content: buf.toString("utf8") };
 }
 return { root, path: relative, mime, encoding: "base64", content: buf.toString("base64") };
}

function readMarkdownWorkspace(payload) {
 const root = workspaceRoot();
 const path = workspacePath(root, payload.path);
 if (!existsSync(path) || !statSync(path).isFile()) throw new Error("Workspace document was not found.");
 const stat = statSync(path);
 if (stat.size > MAX_MARKDOWN_BYTES) throw new Error("Workspace document is larger than 2 MB.");
 return { root, path: String(payload.path), content: readFileSync(path, "utf8"), modifiedAt: new Date(stat.mtimeMs).toISOString() };
}

function writeMarkdownWorkspace(payload) {
 const root = workspaceRoot();
 const path = workspacePath(root, payload.path);
 const content = String(payload.content ?? "");
 if (Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES) throw new Error("Workspace document is larger than 2 MB.");
 // Creating a new page is allowed (workspacePath already constrains the
 // target inside the workspace root and to document extensions); only an
 // existing NON-file at the path (a directory) is refused.
 if (existsSync(path) && !statSync(path).isFile()) throw new Error("That path is a folder, not a document.");
 mkdirSync(dirname(path), { recursive: true });
 writeFileSync(path, content, "utf8");
 const stat = statSync(path);
 return { root, path: String(payload.path), content, modifiedAt: new Date(stat.mtimeMs).toISOString() };
}

function transcriptText(value) {
 if (typeof value === "string") return value;
 if (Array.isArray(value)) return value.map(transcriptText).filter(Boolean).join("\n");
 if (!value || typeof value !== "object") return "";
 return transcriptText(value.text || value.content || value.message || value.value || "");
}

/** Synthetic transcript records — harness/env plumbing, not conversation.
 *  Filtered from summaries, peeks, and adoption so Jobs never show them. */
const SYNTHETIC_PREFIXES = [
 "<environment_context>",
 "<system-reminder>",
 "<command-name>",
 "<command-message>",
 "<local-command-stdout>",
 "<task-notification>",
 "<teammate-message",
 "<bash-input>",
 "<bash-stdout>",
 "<bash-stderr>",
 "<user-memory-input>",
 "<local-command-caveat>",
 "[Request interrupted by user",
 "Caveat: The messages below were generated",
];
// Auth/liveness probes are all "Reply with exactly: <token>" (pong,
// harvest-auth-ok, …) — filter the family, not an enumeration of tokens.
const PROBE_PROMPT_HEAD = "Reply with exactly:";
// Head of the Harvest scan prompt (runHarvestScanWorker builds from this) —
// those headless runs leave real transcripts in the silo homes, and the Jobs
// list must not present the farm's own plumbing as jobs.
const HARVEST_PROMPT_HEAD = "You are Harvest, an analyst that mines a team's working documents";

function syntheticTranscriptText(text) {
 const head = text.trimStart();
 return SYNTHETIC_PREFIXES.some((prefix) => head.startsWith(prefix));
}

function summarizeSessionFile({ provider, account, path, root, anyCwd = false }) {
 let firstPrompt = ""; let latestOutput = ""; let startedAt = null; let updatedAt = null; let cwd = null; let eventCount = 0;
 for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
   const record = JSON.parse(line); const payload = record.payload || record.message || record;
   // Structural subagent marker: sidechain transcripts (Task/workflow
   // agents) carry isSidechain on every record, wherever the file lives.
   if (record.isSidechain === true) return null;
   const timestamp = Date.parse(record.timestamp || payload.timestamp || "") || null;
   if (timestamp && !startedAt) startedAt = timestamp;
   if (timestamp) updatedAt = timestamp;
   cwd = cwd || record.cwd || payload.cwd || payload.workspace || payload.workspacePath || null;
   // payload.role before record.type: codex wraps turns as
   // { type: "response_item", payload: { role: "user", ... } } — reading
   // record.type first filed every codex prompt as output, so codex jobs
   // titled as their rollout-*.jsonl filename instead of the prompt.
   const role = String(record.role || payload.role || record.type || "").toLowerCase();
   const text = transcriptText(payload.content || payload.message?.content || payload.text || record.content).trim();
   if (text && !syntheticTranscriptText(text)) {
    if (!firstPrompt && (role.includes("user") || role.includes("request") || role.includes("input"))) firstPrompt = text;
    if (role.includes("assistant") || role.includes("response") || role.includes("event_msg")) latestOutput = text;
   }
   eventCount += 1;
  } catch { /* incomplete transcript line */ }
 }
 const resolvedCwd = cwd && typeof cwd === "string" ? resolve(cwd) : null;
 if (!anyCwd && resolvedCwd && resolvedCwd !== root && !resolvedCwd.startsWith(`${root}/`) && !root.startsWith(`${resolvedCwd}/`)) return null;
 // Not jobs: transcripts with no visible user ask (synthetic-only content —
 // their only "title" would be the filename), usage-ping heartbeats, and
 // the farm's own Harvest scan runs.
 if (!firstPrompt) return null;
 if (firstPrompt.startsWith(PROBE_PROMPT_HEAD) || firstPrompt.startsWith(HARVEST_PROMPT_HEAD)) return null;
 const mtime = statSync(path).mtimeMs;
 return { id: `${provider}:${account}:${createHash("sha1").update(path).digest("hex").slice(0, 12)}`, provider, account, sourcePath: path, cwd: resolvedCwd, startedAt: new Date(startedAt || mtime).toISOString(), updatedAt: new Date(updatedAt || mtime).toISOString(), prompt: firstPrompt.slice(0, 1200), output: latestOutput.slice(0, 1200), eventCount };
}

/* -- Learned session filters: "See less of these" ---------------------------
   Right-click / row action on a native session stores its first prompt line;
   any transcript whose prompt starts with a stored head stays out of the
   list. Built-ins cover transcripts the farm's own tooling generates. */
const DEFAULT_MUTED_PROMPTS = [
 "You are running as a local agensis workspace agent daemon.",
];
function mutedPromptsPath() { return join(stateRoot(), "jobs-filters.json"); }
function listMutedPrompts() {
 const stored = jsonFile(mutedPromptsPath(), null);
 const muted = Array.isArray(stored?.muted) ? stored.muted.filter((item) => typeof item === "string") : [];
 return { muted, all: [...DEFAULT_MUTED_PROMPTS, ...muted] };
}
function muteSessionPrompt(payload) {
 const head = String(payload.prompt || "").split("\n")[0].trim().slice(0, 160);
 if (head.length < 8) throw new Error("Not enough prompt text to build a filter from.");
 const { muted } = listMutedPrompts();
 const next = payload.remove
  ? muted.filter((item) => item !== head)
  : muted.includes(head) ? muted : [...muted, head];
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(mutedPromptsPath(), JSON.stringify({ muted: next }, null, 2), { mode: 0o600 });
 return { muted: next, head };
}

function listAgentSessions(payload = {}) {
 // anyCwd lifts the workspace-cwd filter so the Jobs list can surface EVERY
 // native transcript (spec B 2026-07-15); default stays workspace-scoped.
 const anyCwd = Boolean(payload.anyCwd);
 const root = workspaceRoot(); const sessions = []; const archives = [];
 for (const account of listAccounts()) {
  const accountRoot = join(stateRoot(), "accounts", account.name);
  for (const provider of account.providers) {
   const archive = provider === "codex" ? join(accountRoot, "codex-home", "sessions") : provider === "claude" ? join(accountRoot, "claude-home", "projects") : null;
   if (archive) archives.push({ provider, account: account.name, archive });
  }
 }
 // Host CLI homes — the user's own sessions on this machine, not silo copies.
 archives.push({ provider: "claude", account: "host", archive: join(homedir(), ".claude", "projects") });
 archives.push({ provider: "codex", account: "host", archive: join(homedir(), ".codex", "sessions") });
 const muted = listMutedPrompts().all;
 const isMuted = (prompt) => {
  const head = prompt.split("\n")[0].trim();
  return muted.some((entry) => head.startsWith(entry));
 };
 for (const { provider, account, archive } of archives) {
  for (const path of recentJsonl(archive, 250)) {
   // Claude session transcripts sit directly in a project dir; anything
   // deeper (subagents/**, workflow journals) is harness plumbing, not a
   // session. Codex keeps full recursion — its sessions nest by date.
   if (provider === "claude" && dirname(dirname(path)) !== archive) continue;
   try { const session = summarizeSessionFile({ provider, account, path, root, anyCwd }); if (session && !isMuted(session.prompt)) sessions.push(session); } catch { /* unreadable archive entry */ }
  }
 }
 return { root, sessions: sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) };
}

/* -- Dropped-file reads: the shell forwards macOS file drops as paths; the
   webview cannot read host files, so this bridge command loads them for the
   attachment path. Size-capped; any user-readable file is a legitimate
   attachment target. */

const FILE_READ_LIMIT = 24 * 1024 * 1024;
const MIME_BY_EXT = {
 png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
 svg: "image/svg+xml", heic: "image/heic", pdf: "application/pdf", txt: "text/plain",
 md: "text/markdown", json: "application/json", csv: "text/csv",
};

function readDroppedFile(payload) {
 const path = resolve(String(payload.path || ""));
 const info = statSync(path);
 if (!info.isFile()) throw new Error("Only files can be attached.");
 if (info.size > FILE_READ_LIMIT) throw new Error(`File is larger than ${Math.round(FILE_READ_LIMIT / 1024 / 1024)}MB.`);
 const extension = path.split(".").pop()?.toLowerCase() || "";
 return {
  name: basename(path),
  mime: MIME_BY_EXT[extension] || "application/octet-stream",
  size: info.size,
  base64: readFileSync(path).toString("base64"),
 };
}

/* -- Adopt-on-use: turn a native CLI transcript into a Farm session --------
   Called by the Jobs list the first time the user SENDS into a native
   session (spec B). Parses the provider .jsonl into ChatMessage turns and
   writes it through the Farm store with provenance. Idempotent per origin
   path (stable id from the transcript path hash). */

function parseNativeTranscript(payload) {
 const originPath = resolve(String(payload.path || ""));
 if (!isTranscriptPath(originPath)) {
  throw new Error("Only transcripts inside silo homes or the host CLI homes can be read.");
 }
 const accountsRoot = join(stateRoot(), "accounts");
 const inSilo = originPath.startsWith(`${accountsRoot}/`);
 const provider = String(payload.provider || (originPath.includes("codex-home") || originPath.startsWith(`${join(homedir(), ".codex")}/`) ? "codex" : "claude"));
 const account = String(payload.account || (inSilo ? originPath.slice(accountsRoot.length + 1).split("/")[0] : "host") || "host");
 const messages = [];
 let title = "";
 for (const line of readFileSync(originPath, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
   const record = JSON.parse(line); const inner = record.payload || record.message || record;
   const role = String(record.role || inner.role || record.type || "").toLowerCase();
   const text = transcriptText(inner.content || inner.message?.content || inner.text || record.content).trim();
   if (!text || syntheticTranscriptText(text)) continue;
   const stamp = record.timestamp || inner.timestamp || new Date().toISOString();
   if (role.includes("user") || role.includes("request") || role.includes("input")) {
    if (!title) title = text.slice(0, 80);
    messages.push({ id: `imp-${messages.length}`, role: "user", content: text, createdAt: stamp });
   } else if (role.includes("assistant") || role.includes("response")) {
    messages.push({ id: `imp-${messages.length}`, role: "assistant", content: text, createdAt: stamp });
   }
  } catch { /* incomplete transcript line */ }
 }
 const now = new Date().toISOString();
 return {
  id: `adopted-${createHash("sha1").update(originPath).digest("hex").slice(0, 12)}`,
  title: title || basename(originPath),
  model: account ? `${provider}/${account}` : provider,
  createdAt: now,
  updatedAt: now,
  permissions: "ask",
  toolsEnabled: true,
  source: provider,
  originPath,
  importedAt: now,
  messages,
  queue: [],
 };
}

/** Read-only preview of a native transcript — NEVER writes to the store.
 *  The Jobs list uses this to render a native session before it is used;
 *  adoption happens only on first send (spec B, adopt-on-use). */
function peekAgentSession(payload) {
 const parsed = parseNativeTranscript(payload);
 const existing = jsonFile(sessionPath(parsed.id), null);
 return existing || parsed;
}

function adoptAgentSession(payload) {
 const parsed = parseNativeTranscript(payload);
 const existing = jsonFile(sessionPath(parsed.id), null);
 if (existing) return sessionMeta(existing);
 return saveFarmSession({ session: parsed });
}

function bootstrap() {
 const repo = farmRepo();
 const state = stateRoot();
 const currentGateway = gatewayStatus();
 const gateway = currentGateway.stale ? startGateway() : currentGateway;
 const distributed = ensureFarmd();
 const accounts = listAccounts();
 writeCrewbarState(accounts);
 ensureCrewbar();
 return {
  app: { version: appVersion(), native: true },
  install: { cli: farmCli(), repo, state, ready: Boolean(farmCli()), nativeCli: spawnSync("native", ["version"], { encoding: "utf8" }).stdout?.trim() || null },
  accounts,
  // Host mode: this Mac's provider CLIs (not a silo). UI surfaces these as
  // a "Host" target; gateway routes are provider/host.
  host: { providers: hostProviders() },
  hostDirs: listHostDirs().dirs,
  profiles: listProfiles(),
  catalog: {
   skills: listNamed(join(homedir(), ".claude", "skills")),
   agents: listNamed(join(homedir(), ".claude", "agents"), true),
   commands: listNamed(join(homedir(), ".claude", "commands"), true),
   mcp: repo ? listNamed(join(repo, "mcp-catalog")).map((name) => name.replace(/\.json$/, "")) : [],
  },
  gateway,
  distributed,
  settings: publicGatewayConfig(),
  // Model-catalog override: same shape as lib/model-catalog.ts BUILTIN_CATALOG,
  // merged client-side. Absent file → null → built-ins only.
  models: jsonFile(join(state, "models.json"), null),
 };
}

function normalizeProfile(input) {
 const name = safeName(input.name);
 const strings = (value) => Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
 return {
  name,
  description: String(input.description || "Custom usage-farm profile"),
  skills_packages: Array.isArray(input.skills_packages) ? input.skills_packages : [],
  skills_from_host: strings(input.skills_from_host),
  agents_from_host: strings(input.agents_from_host),
  commands_from_host: strings(input.commands_from_host),
  mcp: strings(input.mcp),
 };
}

function saveProfile(payload) {
 const profile = normalizeProfile(payload.profile || payload);
 const directory = join(stateRoot(), "profiles");
 mkdirSync(directory, { recursive: true });
 writeFileSync(join(directory, `${profile.name}.json`), `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
 return { profile, profiles: listProfiles() };
}

function duplicateProfile(payload) {
 const source = listProfiles().find((profile) => profile.name === payload.name);
 if (!source) throw new Error(`Profile '${payload.name}' was not found.`);
 const copy = normalizeProfile({ ...source, name: safeName(payload.newName || `${source.name}-copy`), description: `${source.description || source.name} (copy)` });
 return saveProfile({ profile: copy });
}

/** Delete a CUSTOM kit file. Bundled kits refuse (duplicate to customize);
 *  equipped kits refuse so a silo never points at a missing profile. When a
 *  custom kit shadows a bundled one, deleting simply un-shadows it. */
function removeProfile(payload) {
 const name = safeName(String(payload.name || ""));
 if (!name) throw new Error("Which kit should be removed?");
 const customPath = join(stateRoot(), "profiles", `${name}.json`);
 if (!existsSync(customPath)) {
  const bundled = listProfiles().find((profile) => profile.name === name);
  if (bundled) throw new Error(`'${name}' is a bundled kit — it can be duplicated but not deleted.`);
  throw new Error(`Kit '${name}' was not found.`);
 }
 const equipped = listAccounts().filter((account) => account.profile === name).map((account) => account.name);
 if (equipped.length) throw new Error(`'${name}' is equipped on ${equipped.join(", ")} — equip another kit there first.`);
 unlinkSync(customPath);
 return { removed: name, profiles: listProfiles() };
}

function reorderProfiles(payload) {
 const order = Array.isArray(payload.order) ? payload.order.map(safeName) : [];
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(join(stateRoot(), "profile-order.json"), `${JSON.stringify(order, null, 2)}\n`);
 return { profiles: listProfiles() };
}

function gatewayConfig() {
 return jsonFile(join(stateRoot(), "gateway.json"), {
  host: "127.0.0.1",
  port: 4545,
  apiKey: "",
  routes: [],
 });
}

function publicGatewayConfig() {
 const current = gatewayConfig();
 const { apiKey: _legacyGatewayKey, ...publicConfig } = current;
 return {
  ...publicConfig,
  routes: (Array.isArray(current.routes) ? current.routes : []).map((route) => {
   const { apiKey: _inlineKey, apiKeyFile: _legacyKeyFile, ...publicRoute } = route;
   return publicRoute;
  }),
 };
}

function saveGateway(payload) {
 const current = gatewayConfig();
 const sanitizedRoutes = Array.isArray(payload.routes)
  ? payload.routes.map((route) => {
   const { apiKey: _inlineKey, apiKeyFile: _legacyKeyFile, ...safeRoute } = route;
   return safeRoute;
  })
  : current.routes || [];
 const next = {
  ...current,
  ...payload,
  // Never accept or echo secrets through the WebView bridge.
  apiKey: current.apiKey || "",
  host: "127.0.0.1",
  port: Math.min(65535, Math.max(1024, Number(payload.port || current.port || 4545))),
  routes: sanitizedRoutes,
 };
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(join(stateRoot(), "gateway.json"), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
 return publicGatewayConfig();
}

/** PID listening on a TCP port (macOS/Linux lsof). Used to reclaim orphan gateways. */
function gatewayPortListener(port) {
 try {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${Number(port) || 4545}`, "-sTCP:LISTEN", "-t"], {
   encoding: "utf8",
   timeout: 2000,
  });
  if (result.status !== 0) return null;
  const pid = Number(String(result.stdout || "").trim().split(/\s+/)[0]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
 } catch {
  return null;
 }
}

function gatewayHealthy(host = "127.0.0.1", port = 4545) {
 try {
  const result = spawnSync(
   "curl",
   ["-sf", "--max-time", "1", `http://${host || "127.0.0.1"}:${Number(port) || 4545}/health`],
   { encoding: "utf8", timeout: 2500 },
  );
  return result.status === 0 && /"status"\s*:\s*"ok"/.test(result.stdout || "");
 } catch {
  return false;
 }
}

function writeGatewayMarker(pid, startedAt = new Date().toISOString()) {
 const marker = { pid, startedAt, revision: gatewayRevision() };
 mkdirSync(stateRoot(), { recursive: true });
 writeFileSync(join(stateRoot(), "gateway-runtime.json"), `${JSON.stringify(marker, null, 2)}\n`);
 return marker;
}

function killGatewayPid(pid, timeoutMs = 2500) {
 if (!pid || !processAlive(pid)) return;
 try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
 waitForExit(pid, timeoutMs);
 if (processAlive(pid)) {
  try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  waitForExit(pid, 1000);
 }
}

const GATEWAY_TRAFFIC_WINDOWS = [
 { id: "1h", label: "1 hour", durationMs: 60 * 60_000 },
 { id: "4h", label: "4 hours", durationMs: 4 * 60 * 60_000 },
 { id: "8h", label: "8 hours", durationMs: 8 * 60 * 60_000 },
 { id: "24h", label: "Day", durationMs: 24 * 60 * 60_000 },
 { id: "7d", label: "Week", durationMs: 7 * 24 * 60 * 60_000 },
 { id: "30d", label: "Month", durationMs: 30 * 24 * 60 * 60_000 },
];

function rankedTraffic(records, field) {
 const values = new Map();
 for (const record of records) {
  const id = String(record[field] || "unknown");
  const current = values.get(id) || { id, requests: 0, tokens: 0 };
  current.requests += 1;
  current.tokens += Number(record.usage?.total_tokens || 0);
  values.set(id, current);
 }
 return [...values.values()]
  .sort((left, right) => right.requests - left.requests || right.tokens - left.tokens)
  .slice(0, 5);
}

function gatewayActivityStatus() {
 const path = join(stateRoot(), "gateway-activity.jsonl");
 let events = [];
 try {
  events = readFileSync(path, "utf8")
   .split(/\r?\n/)
   .filter(Boolean)
   .slice(-20_000)
   .flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
   });
 } catch { /* no traffic yet */ }
 const byRequest = new Map();
 for (const event of events) {
  if (!event?.requestId) continue;
  const previous = byRequest.get(event.requestId) || {};
  byRequest.set(event.requestId, {
   ...previous,
   ...event,
   state: event.event === "started" ? "active" : event.event,
  });
 }
 const now = Date.now();
 const records = [...byRequest.values()]
  .map((record) => {
   const startedMs = Date.parse(record.startedAt || record.occurredAt || 0);
   const active = record.state === "active" && Number.isFinite(startedMs) && now - startedMs < 2 * 60 * 60_000;
   const dialect = record.usageDialect
    || (record.provider === "claude" || record.transport === "anthropic"
     ? "anthropic-exclusive"
     : record.transport === "openai"
       ? "openai-inclusive"
       : "auto");
   const normalized = normalizeProviderUsage(record.usage, dialect);
   const savings = normalized?.usage_dialect === "anthropic-exclusive"
    ? estimateCacheSavings(normalized, {
     baseInputUsdPerMillion: record.baseInputUsdPerMillion,
     cacheWriteMultiplier: record.cacheWriteMultiplier ?? 1.25,
     requireKnownWriteTtl: record.cacheMode !== "explicit",
    })
    : null;
   const usage = normalized
    ? { ...normalized, ...savings, estimated: Boolean(record.usage?.estimated) }
    : record.usage;
   return { ...record, usage, state: active ? "active" : record.state === "active" ? "aborted" : record.state };
  })
  .sort((left, right) => Date.parse(right.startedAt || 0) - Date.parse(left.startedAt || 0));
 const windows = GATEWAY_TRAFFIC_WINDOWS.map((window) => {
  const inWindow = records.filter((record) => Date.parse(record.startedAt || 0) >= now - window.durationMs);
  return {
   id: window.id,
   label: window.label,
   requests: inWindow.length,
   errors: inWindow.filter((record) => record.state === "failed" || record.state === "aborted").length,
   active: inWindow.filter((record) => record.state === "active").length,
   inputTokens: inWindow.reduce((sum, record) => sum + Number(record.usage?.input_tokens || 0), 0),
   outputTokens: inWindow.reduce((sum, record) => sum + Number(record.usage?.output_tokens || 0), 0),
   totalTokens: inWindow.reduce((sum, record) => sum + Number(record.usage?.total_tokens || 0), 0),
   cacheReadTokens: inWindow.reduce((sum, record) => sum + Number(record.usage?.cached_input_tokens || 0), 0),
   cacheWriteTokens: inWindow.reduce((sum, record) => sum + Number(record.usage?.cache_creation_input_tokens || 0), 0),
   cacheHits: inWindow.filter((record) => Number(record.usage?.cached_input_tokens || 0) > 0).length,
   cacheWrites: inWindow.filter((record) => Number(record.usage?.cache_creation_input_tokens || 0) > 0).length,
   cacheMisses: inWindow.filter((record) => record.usage?.cache_status === "miss").length,
   cacheUnreported: inWindow.filter((record) => record.usage?.cache_status === "unreported").length,
   cacheNetInputTokensSaved: inWindow.reduce(
    (sum, record) => sum + Number(record.usage?.cache_net_input_tokens_saved || 0),
    0,
   ),
   cacheSavingsUsd: inWindow.reduce(
    (sum, record) => sum + Number(record.usage?.cache_savings_usd || 0),
    0,
   ),
   cachePricedRequests: inWindow.filter(
    (record) => record.usage?.cache_savings_usd != null,
   ).length,
   estimatedRequests: inWindow.filter((record) => !record.usage || record.usage.estimated).length,
   topModels: rankedTraffic(inWindow, "model"),
   topEndpoints: rankedTraffic(inWindow, "path"),
   topProviders: rankedTraffic(inWindow, "provider"),
  };
 });
 let runtimeLogs = [];
 try { runtimeLogs = readFileSync(join(stateRoot(), "gateway.log"), "utf8").split(/\r?\n/).filter(Boolean).slice(-50).reverse(); } catch { /* no process log yet */ }
 return {
  activeRequests: records.filter((record) => record.state === "active"),
  recentRequests: records.slice(0, 50),
  recentErrors: records.filter((record) => record.state === "failed" || record.state === "aborted").slice(0, 20),
  lastInferenceAt: records[0]?.startedAt || null,
  trafficWindows: windows,
  runtimeLogs,
 };
}

function gatewayStatus() {
 const config = gatewayConfig();
 const host = config.host || "127.0.0.1";
 const port = config.port || 4545;
 const url = `http://${host}:${port}`;
 const marker = jsonFile(join(stateRoot(), "gateway-runtime.json"), null);
 const revision = gatewayRevision();
 let pid = marker?.pid || null;
 let alive = processAlive(pid);
 let startedAt = alive ? marker?.startedAt || null : null;
 let adopted = false;
 // Orphan reclaim: marker died (or never tracked) but a healthy gateway still
 // holds the port — common after a desktop restart left the child reparented
 // to launchd/init. Adopt it so Start does not EADDRINUSE-loop.
 if (!alive) {
  const holder = gatewayPortListener(port);
  if (holder && gatewayHealthy(host, port)) {
   pid = holder;
   alive = true;
   adopted = true;
   startedAt = marker?.startedAt || new Date().toISOString();
   writeGatewayMarker(pid, startedAt);
  }
 }
 // Stale = tracked live process still on an older gateway.mjs (bootstrap restarts it).
 // Adopted orphans get a fresh marker revision so they are usable immediately.
 const stale = Boolean(alive && !adopted && marker?.revision && marker.revision !== revision);
 const running = alive && !stale;
 const clientLedger = jsonFile(join(stateRoot(), "gateway-clients.json"), null);
 const cutoff = Date.now() - 10 * 60_000;
 const clients = running && Array.isArray(clientLedger?.clients)
  ? clientLedger.clients.filter((item) => Date.parse(item.lastSeenAt || 0) >= cutoff)
  : [];
 const activity = gatewayActivityStatus();
 const rota = jsonFile(join(stateRoot(), "rota.json"), null);
 return {
  running,
  stale,
  revision,
  pid: alive ? pid : null,
  url,
  startedAt: alive ? startedAt : null,
  clients,
  rota: rota ? { ...rota, strategy: rota.strategy || config.rotaStrategy || "smart" } : { strategy: config.rotaStrategy || "smart" },
  ...activity,
 };
}

function startGateway(payload = {}) {
 if (payload && Object.keys(payload).length) saveGateway(payload);
 const config = gatewayConfig();
 const host = config.host || "127.0.0.1";
 const port = config.port || 4545;
 let status = gatewayStatus();
 if (status.running) return status;

 // Free tracked pid and any other listener on the port.
 killGatewayPid(status.pid);
 const holder = gatewayPortListener(port);
 if (holder) {
  if (gatewayHealthy(host, port)) {
   const marker = writeGatewayMarker(holder);
   return { ...gatewayStatus(), running: true, pid: holder, startedAt: marker.startedAt };
  }
  killGatewayPid(holder);
 }

 mkdirSync(stateRoot(), { recursive: true });
 const log = join(stateRoot(), "gateway.log");
 const child = spawn(process.execPath, [join(here, "gateway.mjs")], {
  detached: true,
  stdio: ["ignore", "ignore", "ignore"],
  env: { ...process.env, FARM_STATE: stateRoot(), FARM_CLI: farmCli() || "", USAGE_FARM_GATEWAY_LOG: log },
 });
 child.unref();
 const marker = writeGatewayMarker(child.pid);

 // Confirm listen before claiming success (avoids EADDRINUSE silent death).
 const sleeper = new Int32Array(new SharedArrayBuffer(4));
 for (let attempt = 0; attempt < 40; attempt += 1) {
  if (gatewayHealthy(host, port)) {
   return { ...gatewayStatus(), running: true, pid: child.pid, startedAt: marker.startedAt };
  }
  if (!processAlive(child.pid) && attempt > 2) break;
  Atomics.wait(sleeper, 0, 0, 50);
 }

 // Spawn died or never bound — surface a real error instead of a false "running".
 const tail = (() => {
  try {
   const lines = readFileSync(log, "utf8").trim().split("\n");
   return lines.slice(-3).join(" ");
  } catch { return ""; }
 })();
 throw new Error(tail || `Gateway failed to listen on ${host}:${port}`);
}

function stopGateway() {
 const status = gatewayStatus();
 if (status.pid) {
  try { process.kill(status.pid, "SIGTERM"); } catch { /* already stopped */ }
 }
 return { ...status, running: false, pid: null };
}

function distributedCli() {
 const repo = farmRepo();
 const path = repo ? join(repo, "daemon", "bin", "farm.mjs") : null;
 if (path && existsSync(path)) return { command: process.execPath, args: [path] };
 const installed = farmCli();
 if (installed && basename(installed) !== "farm.sh") return { command: installed, args: [] };
 throw new Error("Install the portable Farm command or run the desktop app beside the Farm checkout.");
}

function isWindowsCommandShim(command) {
 return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(String(command || ""));
}

function runDistributed(args, timeout = 180000) {
 const executable = distributedCli();
 const result = spawnSync(executable.command, [...executable.args, ...args], {
  encoding: "utf8",
  timeout,
  env: { ...process.env, FARM_STATE: stateRoot() },
  maxBuffer: 4 * 1024 * 1024,
  shell: isWindowsCommandShim(executable.command),
  windowsHide: true,
 });
 if (result.status !== 0) throw new Error((result.stderr || result.stdout || "Distributed Farm command failed.").trim());
 try { return JSON.parse(result.stdout); } catch { throw new Error("Distributed Farm returned an invalid response."); }
}

function listDistributedSilos() {
 return runDistributed(["silos"]);
}

function createDistributedSilo(payload) {
 const runtime = String(payload.runtime || "");
 if (!["e2b", "daytona"].includes(runtime)) throw new Error("Runtime must be e2b or daytona.");
 const args = ["silo", "create", runtime, "--name", String(payload.name || `${runtime} silo`)];
 if (payload.workspaceId) args.push("--workspace-id", String(payload.workspaceId));
 if (payload.template) args.push("--template", String(payload.template));
 if (payload.snapshot) args.push("--snapshot", String(payload.snapshot));
 if (payload.image) args.push("--image", String(payload.image));
 if (payload.share) args.push("--share");
 if (payload.sharedModelsFile) args.push("--shared-models-file", String(payload.sharedModelsFile));
 if (payload.codingCmd) args.push("--coding-cmd", String(payload.codingCmd));
 if (payload.model) args.push("--model", String(payload.model));
 if (payload.permissionMode) args.push("--permission-mode", String(payload.permissionMode));
 return runDistributed(args, 300000);
}

function actOnDistributedSilo(payload) {
 const action = String(payload.action || "");
 if (!["start", "pause", "delete"].includes(action)) throw new Error("Unsupported silo action.");
 return runDistributed(["silo", action, String(payload.id || "")], 300000);
}

function farmdConfig() {
 return jsonFile(join(stateRoot(), "farmd.json"), { host: "127.0.0.1", port: 4546, apiKey: "" });
}

function farmdMarkerPath() {
 return join(stateRoot(), "farmd-runtime.json");
}

function farmdProcessMatches(marker) {
 if (!marker?.pid || marker.service !== "farmd" || !marker.command || !processAlive(marker.pid)) return false;
 const commandName = basename(String(marker.command)).toLowerCase();
 if (process.platform === "win32") {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${Number(marker.pid)}\").CommandLine`], { encoding: "utf8", timeout: 1500, windowsHide: true });
  return result.status === 0 && result.stdout.toLowerCase().includes(commandName);
 }
 const result = spawnSync("ps", ["-p", String(marker.pid), "-o", "command="], { encoding: "utf8", timeout: 1500 });
 return result.status === 0 && result.stdout.toLowerCase().includes(commandName);
}

/** Identity-checked port probe — only a body claiming service "farmd"
 *  counts (the gateway/visualTodo ports live next door; a 200 is not enough). */
function farmdPortHealthy(config) {
 const url = `http://${config.host || "127.0.0.1"}:${config.port || 4546}`;
 const probe = spawnSync("curl", ["-fsS", "--max-time", "0.4", `${url}/health`], { encoding: "utf8" });
 if (probe.status !== 0) return false;
 try { return JSON.parse(probe.stdout).service === "farmd"; } catch { return false; }
}

function farmdListeningPid(config) {
 if (process.platform === "win32") return null;
 // -nP skips DNS/port-name lookups; the generous timeout matters — lsof
 // crawls every fd on the box and crawls slowly under load.
 const result = spawnSync("lsof", ["-nP", "-ti", `tcp:${Number(config.port || 4546)}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 6000 });
 const pid = Number((result.stdout || "").trim().split("\n")[0]);
 return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function farmdStatus() {
 const markerPath = farmdMarkerPath();
 const marker = jsonFile(markerPath, null);
 const config = farmdConfig();
 const url = `http://${config.host || "127.0.0.1"}:${config.port || 4546}`;
 let alive = farmdProcessMatches(marker);
 let pid = alive ? marker.pid : null;
 let startedAt = alive ? marker.startedAt || null : null;
 if (!alive && farmdPortHealthy(config)) {
  // The PORT is the truth, the marker is only a cache: a healthy farmd
  // owns the address but the marker lost track of it (an earlier start
  // raced and its corpse overwrote the marker before dying EADDRINUSE).
  // Adopt the live daemon — recover its pid so Stop keeps working, and
  // rewrite the marker so the flap ends here.
  alive = true;
  pid = farmdListeningPid(config);
  startedAt = marker?.startedAt || null;
  if (pid) {
   const adopted = {
    pid,
    host: config.host || "127.0.0.1",
    port: Number(config.port || 4546),
    command: "farmd",
    service: "farmd",
    startedAt: startedAt || new Date().toISOString(),
    adopted: true,
   };
   try { writeFileSync(markerPath, `${JSON.stringify(adopted, null, 2)}\n`, { mode: 0o600 }); } catch { /* status still true */ }
   startedAt = adopted.startedAt;
  }
 } else if (marker && !alive) {
  try { unlinkSync(markerPath); } catch { /* another status check cleaned it */ }
 }
 return { running: alive, pid, url, startedAt };
}

function farmdExecutable() {
 const repo = farmRepo();
 const bundled = repo ? join(repo, "daemon", "bin", "farmd.mjs") : null;
 if (bundled && existsSync(bundled)) return { command: process.execPath, args: [bundled], markerCommand: bundled };
 const explicit = process.env.FARMD_CLI && existsSync(process.env.FARMD_CLI) ? process.env.FARMD_CLI : null;
 const installed = explicit || executableOnPath("farmd");
 if (installed) return { command: installed, args: [], markerCommand: installed };
 throw new Error("Install farmd or run the desktop app beside the Farm checkout.");
}

function startFarmd() {
 const status = farmdStatus();
 if (status.running) return status;
 const executable = farmdExecutable();
 mkdirSync(stateRoot(), { recursive: true });
 const logFd = openSync(join(stateRoot(), "farmd.log"), "a");
 const child = spawn(executable.command, executable.args, {
  detached: true,
  stdio: ["ignore", logFd, logFd],
  env: { ...process.env, FARM_STATE: stateRoot() },
  shell: isWindowsCommandShim(executable.command),
  windowsHide: true,
 });
 child.unref();
 closeSync(logFd);
 const config = farmdConfig();
 const marker = { pid: child.pid, host: config.host || "127.0.0.1", port: Number(config.port || 4546), command: executable.markerCommand, service: "farmd", startedAt: new Date().toISOString() };
 writeFileSync(farmdMarkerPath(), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
 return { running: true, pid: child.pid, url: `http://${marker.host}:${marker.port}`, startedAt: marker.startedAt };
}

function stopFarmd() {
 const status = farmdStatus();
 if (status.pid) {
  try { process.kill(status.pid, "SIGTERM"); } catch { /* already stopped */ }
  waitForExit(status.pid);
 }
 try { unlinkSync(farmdMarkerPath()); } catch { /* already absent */ }
 return { ...status, running: false, pid: null };
}

function ensureFarmd() {
 const status = farmdStatus();
 if (farmdConfig().autoStart === false || status.running) return status;
 try { return startFarmd(); } catch { return farmdStatus(); }
}

function agensisBaseUrl(value) {
 const baseUrl = String(value || "").trim().replace(/\/+$/, "");
 if (!/^https?:\/\//i.test(baseUrl)) throw new Error("Use a complete http or https Agensis URL.");
 return baseUrl;
}

function agensisApiBaseUrl(value) {
 const baseUrl = agensisBaseUrl(value);
 const url = new URL(baseUrl);
 if (url.hostname === "agensis.io" || url.hostname === "www.agensis.io") return "https://agensis-backend.fly.dev";
 if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname) && ["5173", "8888"].includes(url.port)) return "http://127.0.0.1:3142";
 return baseUrl;
}


/** Open an http(s) URL in the user's default browser (macOS `open`, Linux xdg-open).
 *  Desktop WebViews often block window.open; this is the reliable path. */
function openExternalUrl(payload = {}) {
  const raw = String(payload.url || payload.href || "").trim();
  if (!raw) throw new Error("A URL is required.");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("That URL is not valid."); }
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error("Only http(s) URLs can be opened.");
  const url = parsed.toString();
  const opener = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const result = spawnSync(opener, args, {
    encoding: "utf8",
    timeout: 5000,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status != null) {
    throw new Error(`Could not open the browser (exit ${result.status}).`);
  }
  return { ok: true, url };
}

function normalizeAgensisPairing(result, baseUrl) {
  const userCode = String(result.userCode || result.user_code || "").trim();
  const deviceCode = String(result.deviceCode || result.device_code || "").trim();
  let verificationUri = String(result.verificationUri || result.verification_uri || "").trim();
  const root = String(baseUrl || result.baseUrl || "https://agensis.io").replace(/\/+$/, "");
  if (!verificationUri) {
    verificationUri = userCode
      ? `${root}/integrations/farm?code=${encodeURIComponent(userCode)}`
      : `${root}/integrations/farm`;
  } else if (userCode && !/[?&]code=/.test(verificationUri)) {
    verificationUri += (verificationUri.includes("?") ? "&" : "?") + `code=${encodeURIComponent(userCode)}`;
  }
  return {
    ...result,
    baseUrl: root,
    userCode,
    deviceCode,
    verificationUri,
    expiresIn: Number(result.expiresIn || result.expires_in || 600),
    interval: Number(result.interval || 5),
  };
}

async function agensisPairStart(payload) {
 const baseUrl = agensisBaseUrl(payload.baseUrl);
 const response = await fetch(`${agensisApiBaseUrl(baseUrl)}/backend/integrations/farm/device/start`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: String(payload.name || "Agent Farm") }),
 });
 const result = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(result?.error?.message || `Agensis returned HTTP ${response.status}.`);
 const pairing = normalizeAgensisPairing(result, baseUrl);
 // Open the approval page immediately — desktop WebViews block window.open.
 try { openExternalUrl({ url: pairing.verificationUri }); } catch { /* user can click Open Agensis */ }
 return pairing;
}

async function agensisPairExchange(payload) {
 const baseUrl = agensisBaseUrl(payload.baseUrl);
 const response = await fetch(`${agensisApiBaseUrl(baseUrl)}/backend/integrations/farm/device/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ deviceCode: String(payload.deviceCode || "") }),
 });
 const result = await response.json().catch(() => ({}));
 if (!response.ok) {
  const detail = result?.error?.message || result?.error?.code || result?.message || "";
  if (response.status === 428 || /pending|authorization/i.test(String(detail))) {
   throw new Error(detail || "authorization_pending");
  }
  throw new Error(detail || `Agensis returned HTTP ${response.status}.`);
 }
 if (!result.workspaceId) throw new Error("Agensis did not return a workspace id.");
 const directory = join(stateRoot(), "integrations", "agensis");
 mkdirSync(directory, { recursive: true, mode: 0o700 });
 const integration = { ...result, baseUrl };
 writeFileSync(join(directory, `${encodeURIComponent(result.workspaceId)}.json`), `${JSON.stringify(integration, null, 2)}\n`, { mode: 0o600 });
 return { paired: true, workspaceId: result.workspaceId, integrationId: result.integrationId, baseUrl };
}

function runFarm(payload) {
 const cli = farmCli();
 if (!cli) throw new Error("The farm CLI was not found. Set FARM_CLI to farm.sh or install the app beside it.");
 const allowed = new Set(["new", "up", "down", "rm", "equip", "build"]);
 const action = String(payload.action || "");
 if (!allowed.has(action)) throw new Error(`Action '${action}' is not available from the desktop app.`);
 const actionArgs = Array.isArray(payload.args) ? payload.args.map(String) : [];
 if (action === "equip") {
  const profileIndex = actionArgs.indexOf("--profile");
  const requested = profileIndex >= 0 ? actionArgs[profileIndex + 1] : null;
  const profile = requested ? listProfiles().find((item) => item.name === requested) : null;
  if (profile?.path) actionArgs[profileIndex + 1] = profile.path;
 }
 const args = [action, ...actionArgs];
 const logDir = join(stateRoot(), "tasks");
 mkdirSync(logDir, { recursive: true });
 const id = `${Date.now()}-${action}`;
 const log = join(logDir, `${id}.log`);
 writeFileSync(log, `usage-farm task ${id}\ncommand=${cli} ${args.join(" ")}\n`);
 const logFd = openSync(log, "a");
 const child = spawn(cli, args, {
  detached: true,
  stdio: ["ignore", logFd, logFd],
  env: { ...process.env, FARM_STATE: stateRoot() },
 });
 child.unref();
 closeSync(logFd);
 writeFileSync(log, `pid=${child.pid}\n`, { flag: "a" });
 return { id, pid: child.pid, log, action };
}

function visualTodoTaskDirectory() {
 const tasksRoot = join(stateRoot(), "tasks");
 const directory = join(tasksRoot, "visual-todo");
 mkdirSync(tasksRoot, { recursive: true });
 if (!existsSync(directory)) {
  // Migrate the exact private pre-publication queue without retaining its
  // source identity as a searchable public string.
  const previous = join(tasksRoot, ["clu", "so"].join(""));
  if (existsSync(previous) && statSync(previous).isDirectory()) {
   renameSync(previous, directory);
   for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const path = join(directory, name);
    const migrated = readFileSync(path, "utf8").split(previous).join(directory);
    writeFileSync(path, migrated, { mode: 0o600 });
   }
  }
 }
 mkdirSync(directory, { recursive: true });
 return directory;
}

function writeVisualTodoTaskMetadata(path, task) {
 writeFileSync(path, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
}

function withVisualTodoQueueLock(directory, callback) {
 const lock = join(directory, ".queue.lock");
 let fd;
 try {
  fd = openSync(lock, "wx", 0o600);
 } catch {
  return { started: false, reason: "queue-lock-held" };
 }
 try {
  return callback();
 } finally {
  closeSync(fd);
  try { unlinkSync(lock); } catch { /* A stale lock is harmless after the next poll. */ }
 }
}

function visualTodoTaskRecords(directory) {
 const records = [];
 for (const name of readdirSync(directory)) {
  if (!name.endsWith(".json") || name.endsWith(".job.json")) continue;
  const metadataPath = join(directory, name);
  const task = jsonFile(metadataPath, null);
  if (task) records.push({ metadataPath, task });
 }
 return records.sort((left, right) => Date.parse(left.task.createdAt || 0) - Date.parse(right.task.createdAt || 0));
}

function startNextVisualTodoTask() {
 const directory = visualTodoTaskDirectory();
 return withVisualTodoQueueLock(directory, () => {
  const records = visualTodoTaskRecords(directory);
  const activeLockPath = join(directory, ".active-task.lock");
  const activeLock = jsonFile(activeLockPath, null);
  if (activeLock?.id) {
   const activeRecord = records.find((record) => record.task.id === activeLock.id);
   const activeState = activeRecord?.task?.status;
   const launching = activeState === "launching" &&
    Date.now() - Date.parse(activeLock.startedAt || 0) < 15_000;
   if (launching || (activeRecord && processAlive(activeRecord.task.pid))) {
    return { started: false, activeTaskId: activeLock.id };
   }
   try { unlinkSync(activeLockPath); } catch { /* Recovered by the next poll. */ }
  }
  for (const record of records) {
   const active = ["launching", "running", "falling-back"].includes(record.task.status);
   if (!active) continue;
   // A live task without the persistent lock predates the queue. Do not let
   // it block recovery indefinitely; its terminal state is reconciled here.
   if (processAlive(record.task.pid)) {
    record.task = {
     ...record.task,
     status: "failed",
     error: "Superseded by the single-task VisualTodo queue.",
     updatedAt: new Date().toISOString(),
    };
    writeVisualTodoTaskMetadata(record.metadataPath, record.task);
    continue;
   }
   record.task = {
    ...record.task,
    status: "failed",
    error: "Task process exited before reporting completion.",
    updatedAt: new Date().toISOString(),
   };
   writeVisualTodoTaskMetadata(record.metadataPath, record.task);
  }
  const next = records.find((record) => record.task.status === "queued");
  if (!next) return { started: false, reason: "queue-empty" };
  const jobPath = join(directory, `${next.task.id}.job.json`);
  const runner = join(here, "visual-todo-task-runner.mjs");
  if (!existsSync(jobPath) || !existsSync(runner)) {
   next.task = {
    ...next.task,
    status: "failed",
    error: "The VisualTodo task runner is missing from the desktop bundle.",
    updatedAt: new Date().toISOString(),
   };
   writeVisualTodoTaskMetadata(next.metadataPath, next.task);
   return { started: false, reason: "runner-missing" };
  }
  writeFileSync(
   activeLockPath,
   `${JSON.stringify({ id: next.task.id, startedAt: new Date().toISOString() })}\n`,
   { mode: 0o600 },
  );
  const child = spawn(process.execPath, [runner, jobPath], {
   detached: true,
   stdio: ["ignore", "ignore", "ignore"],
   env: { ...process.env, FARM_STATE: stateRoot() },
  });
  child.unref();
  const currentLock = jsonFile(activeLockPath, null);
  if (currentLock?.id === next.task.id) {
   writeFileSync(
    activeLockPath,
    `${JSON.stringify({ ...currentLock, pid: child.pid })}\n`,
    { mode: 0o600 },
   );
  }
  // The detached runner can transition to `running` before this controller
  // gets its next timeslice. Never overwrite a newer runner state.
  const afterSpawn = jsonFile(next.metadataPath, null);
  if (afterSpawn?.id === next.task.id && afterSpawn.status === "queued") {
   next.task = {
    ...afterSpawn,
    status: "launching",
    pid: child.pid,
    updatedAt: new Date().toISOString(),
   };
   writeVisualTodoTaskMetadata(next.metadataPath, next.task);
  }
  return { started: true, id: next.task.id, pid: child.pid };
 });
}

function projectDirectory(value) {
 const root = resolve(String(value || workspaceRoot()));
 if (!existsSync(root) || !statSync(root).isDirectory()) {
  throw new Error("The VisualTodo task project directory does not exist.");
 }
 return root;
}

function terminalSessionName(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 // Include shellAccount so a silo terminal and a host terminal for the same
 // Farm session do not share a tmux pane (and so silo switches get a fresh shell).
 const shell = String(payload.shellAccount || payload.account || "host");
 const key = `${projectRoot}:${String(payload.sessionId || "default")}:${shell}`;
 return `agensis-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

/** Safe shell account name for farm shell <acct> — alnum, dash, underscore. */
function terminalShellAccount(payload = {}) {
 const raw = String(payload.shellAccount || payload.account || "").trim();
 if (!raw || raw === "host") return null;
 if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw)) return null;
 return raw;
}

function runTmux(args, options = {}) {
 const result = spawnSync("tmux", args, { encoding: "utf8", timeout: 3000, ...options });
 if (result.error) throw result.error;
 return result;
}

function terminalSnapshot(payload = {}, create = true) {
 const name = terminalSessionName(payload);
 const exists = runTmux(["has-session", "-t", name]).status === 0;
 if (!exists && create) {
  const root = projectDirectory(payload.projectRoot);
  const shellAcct = terminalShellAccount(payload);
  // Silo sessions land inside the container (`farm shell <acct>`). Host and
  // elevator sessions stay on this Mac in the project root.
  let started;
  if (shellAcct) {
   const cli = farmCli() || "farm";
   // Land inside the silo at the project folder (absolute path, same-path mount).
   // After farm shell exits, drop to a local login shell so the pane stays usable.
   const boot = `${cli} shell ${shellAcct} ${JSON.stringify(root)}; exec ${process.env.SHELL || "/bin/bash"} -l`;
   started = runTmux(["new-session", "-d", "-s", name, "-c", root, "bash", "-lc", boot]);
  } else {
   // Host terminal: tmux -c projectRoot — do not force ~/.claude-farm/work.
   started = runTmux(["new-session", "-d", "-s", name, "-c", root]);
  }
  if (started.status !== 0) throw new Error(started.stderr || "Unable to start terminal session.");
  runTmux(["set-option", "-t", name, "history-limit", "10000"]);
  // Detached zsh does not paint its first prompt until the PTY receives a
  // key. A harmless Enter makes a newly opened terminal visibly ready.
  runTmux(["send-keys", "-t", name, "Enter"]);
 }
 if (!exists && !create) return { session: name, alive: false, output: "", shellAccount: terminalShellAccount(payload) || "host" };
 const captured = runTmux(["capture-pane", "-p", "-e", "-J", "-S", "-1000", "-t", name]);
 return {
  session: name,
  shellAccount: terminalShellAccount(payload) || "host",
  alive: runTmux(["has-session", "-t", name]).status === 0,
  output: captured.status === 0 ? captured.stdout : "",
 };
}

function terminalInput(payload = {}) {
 const name = terminalSessionName(payload);
 terminalSnapshot(payload, true);
 const data = String(payload.data || "");
 const special = new Map([
  ["\r", "Enter"], ["\n", "Enter"], ["\u007f", "BSpace"], ["\b", "BSpace"],
  ["\t", "Tab"], ["\u0003", "C-c"], ["\u0004", "C-d"], ["\u001b", "Escape"],
  ["\u001b[A", "Up"], ["\u001b[B", "Down"], ["\u001b[C", "Right"], ["\u001b[D", "Left"],
 ]);
 if (special.has(data)) {
  runTmux(["send-keys", "-t", name, special.get(data)]);
 } else if (data) {
  runTmux(["send-keys", "-t", name, "-l", data]);
 }
 return terminalSnapshot(payload, false);
}

function terminalResize(payload = {}) {
 const name = terminalSessionName(payload);
 terminalSnapshot(payload, true);
 const cols = Math.max(20, Math.min(500, Number(payload.cols) || 80));
 const rows = Math.max(5, Math.min(200, Number(payload.rows) || 24));
 runTmux(["resize-window", "-t", name, "-x", String(cols), "-y", String(rows)]);
 return { session: name, alive: true, cols, rows };
}

function terminalClose(payload = {}) {
 const name = terminalSessionName(payload);
 runTmux(["kill-session", "-t", name]);
 return { session: name, alive: false };
}

function visualTodoLedgerPath(projectRoot) {
 const directory = join(projectRoot, ".agensis");
 mkdirSync(directory, { recursive: true });
 return join(directory, "visual-todos.jsonl");
}

function visualTodoEvents(projectRoot) {
 const path = visualTodoLedgerPath(projectRoot);
 if (!existsSync(path)) return [];
 return readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
   try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function materializeVisualTodos(projectRoot) {
 const todos = new Map();
 const deleted = new Set();
 for (const event of visualTodoEvents(projectRoot)) {
  const id = String(event.todoId || event.todo?.id || "");
  if (!id) continue;
  if (event.type === "todo.created" && event.todo) {
   if (deleted.has(id)) continue;
   todos.set(id, {
    ...event.todo,
    status: "todo",
    lifecycle: "logged",
    progress: null,
    createdAt: event.at,
    updatedAt: event.at,
   });
   continue;
  }
  if (event.type === "todo.deleted") {
   deleted.add(id);
   continue;
  }
  if (event.type === "todo.restored") {
   deleted.delete(id);
   continue;
  }
  const current = todos.get(id);
  if (!current) continue;
  if (event.type === "todo.status" && ["todo", "in-progress", "done"].includes(event.status)) {
   const lifecycle = event.status === "done" ? "done" : event.status === "in-progress" ? "in-progress" : current.lifecycle || "logged";
   todos.set(id, { ...current, status: event.status, lifecycle, updatedAt: event.at });
  } else if (event.type === "todo.lifecycle" && ["logged", "queued", "in-progress", "done"].includes(event.lifecycle)) {
   const status = event.lifecycle === "done" ? "done" : event.lifecycle === "in-progress" ? "in-progress" : "todo";
   todos.set(id, { ...current, lifecycle: event.lifecycle, status, updatedAt: event.at });
  } else if (event.type === "todo.progress" && typeof event.progress === "string") {
   todos.set(id, { ...current, progress: event.progress, updatedAt: event.at });
  }
 }
 return [...todos.entries()]
  .filter(([id]) => !deleted.has(id))
  .map(([, todo]) => todo)
  .sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0));
}

function deletedVisualTodoIds(projectRoot) {
 const deleted = new Set();
 for (const event of visualTodoEvents(projectRoot)) {
  const id = String(event.todoId || event.todo?.id || "");
  if (!id) continue;
  if (event.type === "todo.deleted") deleted.add(id);
  if (event.type === "todo.restored") deleted.delete(id);
 }
 return deleted;
}

function appendVisualTodoEvent(projectRoot, event) {
 appendFileSync(
  visualTodoLedgerPath(projectRoot),
  `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`,
  { mode: 0o600 },
 );
}

function syncVisualTodos(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 const current = new Set(materializeVisualTodos(projectRoot).map((todo) => String(todo.id)));
 const deleted = deletedVisualTodoIds(projectRoot);
 for (const annotation of Array.isArray(payload.annotations) ? payload.annotations : []) {
  if (!annotation?.id || current.has(String(annotation.id)) || deleted.has(String(annotation.id))) continue;
  appendVisualTodoEvent(projectRoot, { type: "todo.created", todoId: annotation.id, todo: annotation, source: "marker" });
  current.add(String(annotation.id));
 }
 return {
  path: visualTodoLedgerPath(projectRoot),
  todos: materializeVisualTodos(projectRoot),
  deletedIds: [...deletedVisualTodoIds(projectRoot)],
 };
}

function appendVisualTodoMutation(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 const todoId = String(payload.todoId || "");
 const type = String(payload.type || "");
 if (!todoId) throw new Error("A visual TODO id is required.");
 const current = materializeVisualTodos(projectRoot).find((todo) => String(todo.id) === todoId);
 if (type === "todo.restored") {
  if (deletedVisualTodoIds(projectRoot).has(todoId)) {
   appendVisualTodoEvent(projectRoot, { type, todoId, source: payload.source || "user" });
  }
 } else if (type === "todo.deleted") {
  if (current) {
   appendVisualTodoEvent(projectRoot, { type, todoId, source: payload.source || "user" });
   cancelVisualTodoTasks(todoId);
  }
 } else if (type === "todo.status") {
  if (!current) return { skipped: "deleted" };
  if (!["todo", "in-progress", "done"].includes(payload.status)) throw new Error("Invalid visual TODO status.");
  if (current.status !== payload.status) {
   appendVisualTodoEvent(projectRoot, { type, todoId, status: payload.status, source: payload.source || "user" });
  }
 } else if (type === "todo.lifecycle") {
  if (!current) return { skipped: "deleted" };
  if (!["logged", "queued", "in-progress", "done"].includes(payload.lifecycle)) throw new Error("Invalid visual TODO lifecycle.");
  if (current.lifecycle !== payload.lifecycle) {
   appendVisualTodoEvent(projectRoot, { type, todoId, lifecycle: payload.lifecycle, source: payload.source || "agent" });
  }
 } else if (type === "todo.progress") {
  if (!current) return { skipped: "deleted" };
  const progress = String(payload.progress || "").trim();
  if (!progress) throw new Error("Visual TODO progress cannot be empty.");
  const nextProgress = progress.slice(0, 2000);
  if (current.progress !== nextProgress) {
   appendVisualTodoEvent(projectRoot, { type, todoId, progress: nextProgress, source: payload.source || "agent" });
  }
 } else {
  throw new Error("Unsupported visual TODO mutation.");
 }
 return { path: visualTodoLedgerPath(projectRoot), todos: materializeVisualTodos(projectRoot) };
}

function visualTodoTaskProvider(requested) {
 const provider = String(requested || "auto").toLowerCase();
 if (!["auto", "claude", "claude-code", "codex"].includes(provider)) {
  throw new Error("VisualTodo provider must be auto, claude-code, or codex.");
 }
 const candidates = provider === "codex" ? ["codex"] : provider === "claude" || provider === "claude-code" ? ["claude"] : ["claude", "codex"];
 for (const candidate of candidates) {
  const command = executableOnPath(candidate);
  if (command) return { provider: candidate === "claude" ? "claude-code" : "codex", command };
 }
 throw new Error("Neither the Claude Code nor Codex CLI is available on PATH.");
}

function allowedClaudePermissionMode(value) {
 const mode = String(value || "acceptEdits");
 return new Set(["acceptEdits", "auto", "manual", "dontAsk", "plan"]).has(mode) ? mode : "acceptEdits";
}

function visualTodoRecoveryCodexModel(payload) {
 const configured = String(
  payload.recoveryModel || process.env.FARM_VISUAL_TODO_CODEX_RECOVERY_MODEL || "gpt-5.4",
 ).trim();
 // This model is used only after the primary agent fails. It deliberately
 // bypasses a user-level default that an older local Codex binary cannot run.
 return configured && configured.length <= 200 ? configured : "gpt-5.4";
}

/** Identify the worker bound to this port and the project it owns. A generic
 *  HTTP 200 is not enough: reusing another project's worker can edit the wrong
 *  checkout. */
function visualTodoWorkerHealth(url) {
 const health = spawnSync("curl", ["-fsS", "--max-time", "0.3", `${url}/health`], { encoding: "utf8" });
 if (health.status !== 0) return null;
 try {
  const body = JSON.parse(health.stdout);
  return Boolean(body)
   && body.ok === true
   && "warm" in body
   && body.projectRoot
   && Number.isInteger(Number(body.pid))
   ? body
   : null;
 } catch {
  return null;
 }
}

function visualTodoWarmWorker(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 // 4547, NOT 4546 — farmd owns 4546 by default and the two must never share.
 const port = Number(process.env.VISUAL_TODO_WORKER_PORT || 4547);
 const url = `http://127.0.0.1:${port}`;
 const current = visualTodoWorkerHealth(url);
 if (current && resolve(current.projectRoot) === projectRoot) {
  return {
   url,
   ready: true,
   warm: current.warm === true,
   projectRoot,
   pid: Number(current.pid),
   error: current.error || null,
  };
 }
 if (current) {
  if (current.active || Number(current.queued) > 0) {
   return {
    url,
    warm: false,
    projectRoot,
    conflict: resolve(current.projectRoot),
    reason: "worker-busy-on-another-project",
   };
  }
  try { process.kill(Number(current.pid), "SIGTERM"); } catch { /* Already gone. */ }
  for (let attempt = 0; attempt < 20 && visualTodoWorkerHealth(url); attempt += 1) {
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  if (visualTodoWorkerHealth(url)) {
   return {
    url,
    warm: false,
    projectRoot,
    conflict: resolve(current.projectRoot),
    reason: "worker-port-still-owned",
   };
  }
 }
 const configuredScript = String(process.env.VISUAL_TODO_WORKER_SCRIPT || "").trim();
 const script = configuredScript
  ? resolve(configuredScript)
  : join(here, "visual-todo-dev-worker.mjs");
 if (!existsSync(script)) return { url, warm: false, projectRoot, missing: script };
 const logPath = join(stateRoot(), "visual-todo-warm-worker.log");
 const output = openSync(logPath, "a", 0o600);
 const child = spawn(process.execPath, [script], {
  cwd: projectRoot,
  detached: true,
  stdio: ["ignore", output, output],
  env: {
   ...process.env,
   VISUAL_TODO_PROJECT_ROOT: projectRoot,
   VISUAL_TODO_WORKER_PORT: String(port),
   VISUAL_TODO_TASK_LEDGER: join(projectRoot, ".agensis", "agent-tasks.jsonl"),
  },
 });
 child.unref();
 closeSync(output);
 for (let attempt = 0; attempt < 20; attempt += 1) {
  const health = visualTodoWorkerHealth(url);
  if (health && resolve(health.projectRoot) === projectRoot) {
   return {
    url,
    ready: true,
    warm: health.warm === true,
    projectRoot,
    pid: child.pid,
    error: health.error || null,
   };
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
 }
 return { url, warm: false, projectRoot, pid: child.pid, log: logPath };
}

function dispatchWarmVisualTodo(payload, prompt, projectRoot) {
 const worker = visualTodoWarmWorker({ projectRoot });
 if (!worker.warm) return null;
 const id = String(payload.todo?.id || `${Date.now()}`);
 const sent = spawnSync("curl", [
  "-fsS", "--max-time", "1", "-X", "POST",
  "-H", "Content-Type: application/json",
  "--data-binary", JSON.stringify({ id, prompt }),
  `${worker.url}/tasks`,
 ], { encoding: "utf8" });
 if (sent.status !== 0) return null;
 return { id, pid: worker.pid || null, provider: "claude-code", model: null, projectRoot, status: "queued", position: 1, warm: true, events: `${worker.url}/events` };
}

function dispatchVisualTodo(payload) {
 const prompt = String(payload.prompt || payload.todo?.comment || "").trim();
 if (!prompt) throw new Error("A prompt is required for a VisualTodo task.");
 if (prompt.length > 100_000) throw new Error("The VisualTodo task prompt is too large.");

 const projectRoot = projectDirectory(payload.projectRoot);
 const warm = dispatchWarmVisualTodo(payload, prompt, projectRoot);
 if (warm) return warm;
 const todoId = payload.todo?.id ? String(payload.todo.id) : null;
 if (todoId) {
  const existing = visualTodoTaskRecords(visualTodoTaskDirectory())
   .map((record) => record.task)
   .filter((task) => String(task.todo?.id || "") === todoId)
   .find((task) => ["queued", "launching", "running", "falling-back"].includes(task.status));
  if (existing) {
   const queued = visualTodoTaskRecords(visualTodoTaskDirectory())
    .map((record) => record.task)
    .filter((task) => task.status === "queued");
   const index = queued.findIndex((task) => task.id === existing.id);
   return {
    id: existing.id,
    pid: existing.pid || null,
    provider: existing.provider,
    model: existing.model || null,
    projectRoot,
    log: existing.log,
    status: existing.status,
    position: index >= 0 ? index + 1 : 0,
    deduplicated: true,
   };
  }
 }
 const selected = visualTodoTaskProvider(payload.provider);
 const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : null;
 const args = selected.provider === "claude-code"
  ? [
   "-p", prompt,
   "--input-format", "text",
   "--output-format", "stream-json",
   "--verbose",
   "--safe-mode",
   "--strict-mcp-config",
   "--mcp-config", '{"mcpServers":{}}',
   "--effort", "low",
   "--tools", "Read,Edit,Bash,Glob,Grep",
   "--disable-slash-commands",
   "--no-session-persistence",
   "--prompt-suggestions", "false",
   "--permission-mode", allowedClaudePermissionMode(payload.permissionMode),
   ...(model ? ["--model", model] : []),
  ]
  : [
   "exec", "--json", "--ephemeral", "--ignore-user-config",
   "-c", 'model_reasoning_effort="low"',
   "-c", "mcp_servers={}",
   "-s", "workspace-write", "-C", projectRoot,
   ...(model ? ["-m", model] : []), prompt,
  ];
 const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
 const directory = visualTodoTaskDirectory();
 const jobPath = join(directory, `${id}.job.json`);
 const metadataPath = join(directory, `${id}.json`);
 const logPath = join(directory, `${id}.log`);
 const now = new Date().toISOString();
 const metadata = {
  id,
  status: "queued",
  provider: selected.provider,
  model,
  command: selected.command,
  projectRoot,
  prompt,
  todo: payload.todo || null,
  createdAt: now,
  updatedAt: now,
  log: logPath,
 };
 // An automatic route is allowed to move to Codex if Claude's allowance is
 // exhausted. Keep explicit provider choices deterministic.
 const fallbackCommand =
  String(payload.provider || "auto").toLowerCase() === "auto" &&
   selected.provider === "claude-code"
   ? executableOnPath("codex")
   : null;
 const fallbackModel = fallbackCommand ? visualTodoRecoveryCodexModel(payload) : null;
 const fallback = fallbackCommand
  ? {
   provider: "codex",
   command: fallbackCommand,
   model: fallbackModel,
   args: [
    "exec", "--json", "--ephemeral", "--ignore-user-config",
    "-c", 'model_reasoning_effort="low"',
    "-c", "mcp_servers={}",
    "-s", "workspace-write", "-C", projectRoot,
    "-m", fallbackModel, prompt,
   ],
  }
  : null;
 const job = {
  ...metadata,
  metadataPath,
  logPath,
  controllerPath: join(here, "controller.mjs"),
  activeLockPath: join(directory, ".active-task.lock"),
  args,
  fallback,
  env: { FARM_STATE: stateRoot() },
 };
 writeVisualTodoTaskMetadata(metadataPath, metadata);
 writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
 const launch = startNextVisualTodoTask();
 return {
  id,
  pid: launch.id === id ? launch.pid : null,
  provider: selected.provider,
  model,
  projectRoot,
  log: logPath,
  status: launch.id === id ? "started" : "queued",
  position: launch.id === id
   ? 0
   : visualTodoTaskRecords(directory).filter((record) => record.task.status === "queued").findIndex((record) => record.task.id === id) + 1,
 };
}

function cancelVisualTodoTasks(todoId) {
 const directory = visualTodoTaskDirectory();
 const activeLockPath = join(directory, ".active-task.lock");
 const activeLock = jsonFile(activeLockPath, null);
 for (const record of visualTodoTaskRecords(directory)) {
  if (String(record.task.todo?.id || "") !== String(todoId)) continue;
  if (!["queued", "launching", "running", "falling-back"].includes(record.task.status)) continue;
  if (processAlive(record.task.pid)) {
   try { process.kill(record.task.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
  if (activeLock?.id === record.task.id && processAlive(activeLock.pid)) {
   try { process.kill(activeLock.pid, "SIGTERM"); } catch { /* Already stopped. */ }
   try { unlinkSync(activeLockPath); } catch { /* Reconciled below. */ }
  }
  const cancelled = {
   ...record.task,
   status: "cancelled",
   error: "Cancelled because the visual TODO was deleted.",
   updatedAt: new Date().toISOString(),
  };
  writeVisualTodoTaskMetadata(record.metadataPath, cancelled);
  try { unlinkSync(join(directory, `${record.task.id}.job.json`)); } catch { /* May already be running. */ }
 }
 startNextVisualTodoTask();
}

function visualTodoTaskStatus(payload = {}) {
 const requested = new Set(
  (Array.isArray(payload.todoIds) ? payload.todoIds : [])
   .map((id) => String(id))
   .filter(Boolean),
 );
 const directory = visualTodoTaskDirectory();
 const tasks = [];
 const queue = visualTodoTaskRecords(directory).filter((record) => record.task.status === "queued");
 for (const name of readdirSync(directory)) {
  if (!name.endsWith(".json") || name.endsWith(".job.json")) continue;
  try {
   const metadataPath = join(directory, name);
   let task = jsonFile(metadataPath, null);
   const todoId = task?.todo?.id ? String(task.todo.id) : null;
   if (!task || !todoId || (requested.size && !requested.has(todoId))) continue;
   const isActive = task.status === "running" || task.status === "falling-back";
   const pid = Number(task.pid);
   if (isActive && Number.isInteger(pid) && pid > 0) {
    let alive = true;
    try {
     process.kill(pid, 0);
    } catch {
     alive = false;
    }
    if (!alive) {
     task = {
      ...task,
      status: "failed",
      error: "Task process exited before reporting completion.",
      updatedAt: new Date().toISOString(),
     };
     writeFileSync(metadataPath, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
    }
   }
   tasks.push({
    id: task.id,
    todoId,
    status: task.status || "unknown",
    provider: task.provider || null,
    model: task.model || null,
    fallbackProvider: task.fallbackProvider || null,
    fallbackModel: task.fallbackModel || null,
    progress: task.progress || null,
    error: task.error || task.primaryError || null,
    exitCode: task.exitCode ?? null,
    updatedAt: task.updatedAt || null,
    queuePosition: task.status === "queued"
     ? queue.findIndex((record) => record.task.id === task.id) + 1
     : 0,
   });
  } catch {
   // A runner can be rewriting metadata while this snapshot is read.
  }
 }
 tasks.sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
 return { tasks };
}

/* ---------------- Chores: the task planner (spec 2026-07-20) ------------
 * Event-sourced ledger per project under $FARM_STATE/tasks/<slug>/ — the
 * same replay pattern as the visual TODO ledger, extended with
 * subtasks, dependencies, assignment, scheduling, attachments and runs.
 * Status/lifecycle enums intentionally match visual TODOs so model-instance
 * todo lists remain compatible by construction. */

const CHORE_STATUSES = ["todo", "in-progress", "done"];
const CHORE_LIFECYCLES = ["logged", "queued", "in-progress", "done"];
const CHORE_ATTACHMENT_LIMIT = 10 * 1024 * 1024;

function choresDirectory(projectRoot) {
 const directory = join(stateRoot(), "tasks", projectRoot.replaceAll("/", "-"));
 mkdirSync(directory, { recursive: true });
 return directory;
}

function choresLedgerPath(projectRoot) {
 return join(choresDirectory(projectRoot), "ledger.jsonl");
}

function choreEvents(projectRoot) {
 const path = choresLedgerPath(projectRoot);
 if (!existsSync(path)) return [];
 return readFileSync(path, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .flatMap((line) => {
   try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function appendChoreEvent(projectRoot, event) {
 appendFileSync(
  choresLedgerPath(projectRoot),
  `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`,
  { mode: 0o600 },
 );
}

function choreStatusForLifecycle(lifecycle) {
 return lifecycle === "done" ? "done" : lifecycle === "in-progress" ? "in-progress" : "todo";
}

/** Status drives lifecycle like visual TODOs do — except a task reset to
 *  "todo" from an active lifecycle drops back to "logged" instead of
 *  staying visibly active. */
function choreLifecycleForStatus(status, current) {
 if (status === "done") return "done";
 if (status === "in-progress") return "in-progress";
 return current === "done" || current === "in-progress" ? "logged" : current || "logged";
}

function materializeChores(projectRoot) {
 const chores = new Map();
 const deleted = new Set();
 for (const event of choreEvents(projectRoot)) {
  const id = String(event.taskId || event.task?.id || "");
  if (!id) continue;
  if (event.type === "task.created" && event.task) {
   if (deleted.has(id) || chores.has(id)) continue;
   const task = event.task;
   chores.set(id, {
    id,
    title: String(task.title || "Untitled"),
    notes: String(task.notes || ""),
    parentId: task.parentId ? String(task.parentId) : null,
    tags: Array.isArray(task.tags) ? task.tags.map(String) : [],
    status: "todo",
    lifecycle: "logged",
    assignee: {
     silo: task.assignee?.silo ? String(task.assignee.silo) : null,
     provider: task.assignee?.provider ? String(task.assignee.provider) : null,
     model: task.assignee?.model ? String(task.assignee.model) : null,
    },
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
    start: task.start || null,
    due: task.due || null,
    estimateHours: task.estimateHours == null ? null : Number(task.estimateHours) || null,
    attachments: [],
    data: task.data && typeof task.data === "object"
     ? Object.fromEntries(Object.entries(task.data).map(([key, value]) => [String(key), String(value)]))
     : {},
    runs: [],
    order: Number(task.order) || 0,
    createdAt: event.at,
    updatedAt: event.at,
   });
   continue;
  }
  if (event.type === "task.deleted") { deleted.add(id); continue; }
  if (event.type === "task.restored") { deleted.delete(id); continue; }
  const current = chores.get(id);
  if (!current) continue;
  const stamp = { updatedAt: event.at };
  if (event.type === "task.updated" && event.patch && typeof event.patch === "object") {
   const patch = {};
   if (typeof event.patch.title === "string" && event.patch.title.trim()) patch.title = event.patch.title.trim();
   if (typeof event.patch.notes === "string") patch.notes = event.patch.notes;
   if (Array.isArray(event.patch.tags)) patch.tags = event.patch.tags.map(String);
   if ("start" in event.patch) patch.start = event.patch.start || null;
   if ("due" in event.patch) patch.due = event.patch.due || null;
   if ("estimateHours" in event.patch) {
    patch.estimateHours = event.patch.estimateHours == null ? null : Number(event.patch.estimateHours) || null;
   }
   if (event.patch.data && typeof event.patch.data === "object") {
    patch.data = Object.fromEntries(Object.entries(event.patch.data).map(([key, value]) => [String(key), String(value)]));
   }
   chores.set(id, { ...current, ...patch, ...stamp });
  } else if (event.type === "task.status" && CHORE_STATUSES.includes(event.status)) {
   chores.set(id, {
    ...current,
    status: event.status,
    lifecycle: choreLifecycleForStatus(event.status, current.lifecycle),
    ...stamp,
   });
  } else if (event.type === "task.lifecycle" && CHORE_LIFECYCLES.includes(event.lifecycle)) {
   chores.set(id, {
    ...current,
    lifecycle: event.lifecycle,
    status: choreStatusForLifecycle(event.lifecycle),
    ...stamp,
   });
  } else if (event.type === "task.moved") {
   chores.set(id, {
    ...current,
    parentId: event.parentId ? String(event.parentId) : null,
    order: Number(event.order) || 0,
    ...stamp,
   });
  } else if (event.type === "task.assigned") {
   chores.set(id, {
    ...current,
    assignee: {
     silo: event.silo ? String(event.silo) : null,
     provider: event.provider ? String(event.provider) : null,
     model: event.model ? String(event.model) : null,
    },
    ...stamp,
   });
  } else if (event.type === "task.dependency.added" && event.dependsOn) {
   const dep = String(event.dependsOn);
   if (!current.dependsOn.includes(dep)) {
    chores.set(id, { ...current, dependsOn: [...current.dependsOn, dep], ...stamp });
   }
  } else if (event.type === "task.dependency.removed" && event.dependsOn) {
   const dep = String(event.dependsOn);
   chores.set(id, { ...current, dependsOn: current.dependsOn.filter((item) => item !== dep), ...stamp });
  } else if (event.type === "task.attachment.added" && event.attachment?.id) {
   chores.set(id, {
    ...current,
    attachments: [...current.attachments, {
     id: String(event.attachment.id),
     name: String(event.attachment.name || "file"),
     kind: event.attachment.kind === "image" ? "image" : "file",
     addedAt: event.at,
    }],
    ...stamp,
   });
  } else if (event.type === "task.attachment.removed" && event.attachmentId) {
   chores.set(id, {
    ...current,
    attachments: current.attachments.filter((item) => item.id !== String(event.attachmentId)),
    ...stamp,
   });
  } else if (event.type === "task.run.started" && event.jobId) {
   chores.set(id, {
    ...current,
    runs: [...current.runs, {
     jobId: String(event.jobId),
     silo: event.silo ? String(event.silo) : null,
     provider: event.provider ? String(event.provider) : null,
     model: event.model ? String(event.model) : null,
     startedAt: event.at,
     finishedAt: null,
     outcome: null,
    }],
    ...stamp,
   });
  } else if (event.type === "task.run.finished" && event.jobId) {
   chores.set(id, {
    ...current,
    runs: current.runs.map((run) => run.jobId === String(event.jobId)
     ? { ...run, finishedAt: event.at, outcome: event.outcome === "done" ? "done" : "failed" }
     : run),
    ...stamp,
   });
  }
 }
 const tasks = [...chores.entries()].filter(([id]) => !deleted.has(id)).map(([, task]) => task);
 // Deleted tasks disappear; edges into the void must not block anyone.
 const ids = new Set(tasks.map((task) => task.id));
 for (const task of tasks) {
  task.dependsOn = task.dependsOn.filter((dep) => ids.has(dep));
  if (task.parentId && !ids.has(task.parentId)) task.parentId = null;
 }
 tasks.sort((left, right) => (left.order - right.order) || (Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0)));
 return tasks;
}

function choreBlockedIds(tasks) {
 const byId = new Map(tasks.map((task) => [task.id, task]));
 const blocked = new Set();
 for (const task of tasks) {
  if (task.dependsOn.some((dep) => byId.has(dep) && byId.get(dep).status !== "done")) blocked.add(task.id);
 }
 return blocked;
}

/** Adding taskId→dependsOn is illegal iff dependsOn already reaches taskId
 *  through dependency edges (finish-to-start graph must stay a DAG). */
function choreCreatesCycle(tasks, taskId, dependsOn) {
 const byId = new Map(tasks.map((task) => [task.id, task]));
 const seen = new Set();
 const stack = [dependsOn];
 while (stack.length) {
  const current = stack.pop();
  if (current === taskId) return true;
  if (seen.has(current)) continue;
  seen.add(current);
  for (const next of byId.get(current)?.dependsOn || []) stack.push(next);
 }
 return false;
}

function choreSettingsPath(projectRoot) {
 return join(choresDirectory(projectRoot), "board.json");
}

function choreSettings(projectRoot) {
 const stored = jsonFile(choreSettingsPath(projectRoot), {});
 return {
  autoRun: stored.autoRun === true,
  concurrency: Math.max(1, Math.min(4, Number(stored.concurrency) || 1)),
 };
}

function saveChoreSettings(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 const settings = {
  autoRun: payload.autoRun === true,
  concurrency: Math.max(1, Math.min(4, Number(payload.concurrency) || 1)),
 };
 writeFileSync(choreSettingsPath(projectRoot), `${JSON.stringify(settings, null, 2)}\n`);
 return { settings };
}

function listChores(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 // Every read folds finished runner jobs back into the ledger first, so
 // polling the list is enough to keep run state honest.
 reconcileChoreRuns(projectRoot);
 const tasks = materializeChores(projectRoot);
 return {
  root: projectRoot,
  tasks,
  settings: choreSettings(projectRoot),
  blocked: [...choreBlockedIds(tasks)],
 };
}

function mutateChore(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 const type = String(payload.type || "");
 const tasks = materializeChores(projectRoot);
 const byId = new Map(tasks.map((task) => [task.id, task]));
 if (type === "task.created") {
  const title = String(payload.task?.title || "").trim();
  if (!title) throw new Error("A chore needs a title.");
  const id = payload.task?.id ? String(payload.task.id) : `chore-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  if (byId.has(id)) throw new Error(`Chore '${id}' already exists.`);
  const parentId = payload.task?.parentId ? String(payload.task.parentId) : null;
  if (parentId && !byId.has(parentId)) throw new Error("The parent chore was not found.");
  const siblings = tasks.filter((task) => task.parentId === parentId);
  const order = payload.task?.order == null
   ? (siblings.length ? Math.max(...siblings.map((task) => task.order)) + 1 : 0)
   : Number(payload.task.order) || 0;
  appendChoreEvent(projectRoot, {
   type,
   taskId: id,
   task: { ...payload.task, id, title, parentId, order },
   source: payload.source || "user",
  });
  return { id, ...listChores({ projectRoot }) };
 }
 const taskId = String(payload.taskId || "");
 if (!taskId) throw new Error("Which chore?");
 if (type === "task.restored") {
  appendChoreEvent(projectRoot, { type, taskId, source: payload.source || "user" });
  return listChores({ projectRoot });
 }
 const current = byId.get(taskId);
 if (!current) throw new Error("Chore was not found.");
 if (type === "task.updated") {
  if (!payload.patch || typeof payload.patch !== "object") throw new Error("A patch is required.");
  appendChoreEvent(projectRoot, { type, taskId, patch: payload.patch, source: payload.source || "user" });
 } else if (type === "task.status") {
  if (!CHORE_STATUSES.includes(payload.status)) throw new Error("Invalid chore status.");
  appendChoreEvent(projectRoot, { type, taskId, status: payload.status, source: payload.source || "user" });
 } else if (type === "task.lifecycle") {
  if (!CHORE_LIFECYCLES.includes(payload.lifecycle)) throw new Error("Invalid chore lifecycle.");
  appendChoreEvent(projectRoot, { type, taskId, lifecycle: payload.lifecycle, source: payload.source || "user" });
 } else if (type === "task.moved") {
  const parentId = payload.parentId ? String(payload.parentId) : null;
  if (parentId) {
   if (!byId.has(parentId)) throw new Error("The parent chore was not found.");
   let cursor = parentId;
   while (cursor) {
    if (cursor === taskId) throw new Error("A chore cannot be nested under itself.");
    cursor = byId.get(cursor)?.parentId || null;
   }
  }
  appendChoreEvent(projectRoot, {
   type,
   taskId,
   parentId,
   order: Number(payload.order) || 0,
   source: payload.source || "user",
  });
 } else if (type === "task.assigned") {
  appendChoreEvent(projectRoot, {
   type,
   taskId,
   silo: payload.silo || null,
   provider: payload.provider || null,
   model: payload.model || null,
   source: payload.source || "user",
  });
 } else if (type === "task.dependency.added") {
  const dep = String(payload.dependsOn || "");
  if (!dep || !byId.has(dep)) throw new Error("The dependency chore was not found.");
  if (dep === taskId) throw new Error("A chore cannot depend on itself.");
  if (!current.dependsOn.includes(dep)) {
   if (choreCreatesCycle(tasks, taskId, dep)) throw new Error("That dependency would create a cycle.");
   appendChoreEvent(projectRoot, { type, taskId, dependsOn: dep, source: payload.source || "user" });
  }
 } else if (type === "task.dependency.removed") {
  appendChoreEvent(projectRoot, { type, taskId, dependsOn: String(payload.dependsOn || ""), source: payload.source || "user" });
 } else if (type === "task.attachment.removed") {
  const attachmentId = String(payload.attachmentId || "");
  if (current.attachments.some((item) => item.id === attachmentId)) {
   appendChoreEvent(projectRoot, { type, taskId, attachmentId, source: payload.source || "user" });
   try {
    const directory = join(choresDirectory(projectRoot), "attachments", taskId);
    for (const name of readdirSync(directory)) {
     if (name.startsWith(`${attachmentId}-`)) unlinkSync(join(directory, name));
    }
   } catch { /* attachment file already gone */ }
  }
 } else if (type === "task.deleted") {
  appendChoreEvent(projectRoot, { type, taskId, source: payload.source || "user" });
 } else {
  throw new Error("Unsupported chore mutation.");
 }
 return listChores({ projectRoot });
}

const CHORE_IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|heic|svg|bmp)$/i;

function choreAttachmentDirectory(projectRoot, taskId) {
 const directory = join(choresDirectory(projectRoot), "attachments", taskId);
 mkdirSync(directory, { recursive: true });
 return directory;
}

/** Persist a pasted/dropped file for a chore. Content arrives either as
 *  base64 (`content`) or a source path to copy (`sourcePath`). */
function addChoreAttachment(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 const taskId = String(payload.taskId || "");
 if (!taskId) throw new Error("Which chore?");
 const tasks = materializeChores(projectRoot);
 if (!tasks.some((task) => task.id === taskId)) throw new Error("Chore was not found.");
 const name = String(payload.name || "attachment").replace(/[/\\]/g, "-").slice(0, 120) || "attachment";
 let bytes;
 if (typeof payload.content === "string" && payload.content) {
  bytes = Buffer.from(payload.content, "base64");
 } else if (typeof payload.sourcePath === "string" && payload.sourcePath) {
  const source = resolve(payload.sourcePath);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error("The dropped file was not found.");
  if (statSync(source).size > CHORE_ATTACHMENT_LIMIT) throw new Error("Attachments are limited to 10 MB.");
  bytes = readFileSync(source);
 } else {
  throw new Error("Attachment content is required.");
 }
 if (bytes.length > CHORE_ATTACHMENT_LIMIT) throw new Error("Attachments are limited to 10 MB.");
 if (!bytes.length) throw new Error("The attachment is empty.");
 const id = `att-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
 writeFileSync(join(choreAttachmentDirectory(projectRoot, taskId), `${id}-${name}`), bytes, { mode: 0o600 });
 appendChoreEvent(projectRoot, {
  type: "task.attachment.added",
  taskId,
  attachment: { id, name, kind: CHORE_IMAGE_EXTENSIONS.test(name) ? "image" : "file" },
  source: payload.source || "user",
 });
 return { id, ...listChores({ projectRoot }) };
}

function readChoreAttachment(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 const taskId = String(payload.taskId || "");
 const attachmentId = String(payload.attachmentId || "");
 if (!taskId || !attachmentId) throw new Error("Which attachment?");
 const task = materializeChores(projectRoot).find((item) => item.id === taskId);
 const attachment = task?.attachments.find((item) => item.id === attachmentId);
 if (!attachment) throw new Error("Attachment was not found.");
 const directory = join(choresDirectory(projectRoot), "attachments", taskId);
 const file = existsSync(directory)
  ? readdirSync(directory).find((name) => name.startsWith(`${attachmentId}-`))
  : null;
 if (!file) throw new Error("The attachment file is missing on disk.");
 return {
  id: attachmentId,
  name: attachment.name,
  kind: attachment.kind,
  content: readFileSync(join(directory, file)).toString("base64"),
 };
}

const CHORE_RUN_TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** Fold finished visual TODO jobs back into the ledger: every open run whose job
 *  metadata reached a terminal state gets task.run.finished, and the chore's
 *  lifecycle follows (done on success — unless subtasks remain — failed runs
 *  drop the chore back to queued for another go or a human look). */
function reconcileChoreRuns(projectRoot) {
 const tasks = materializeChores(projectRoot);
 const directory = visualTodoTaskDirectory();
 let changed = false;
 for (const task of tasks) {
  for (const run of task.runs) {
   if (run.finishedAt) continue;
   const metadata = jsonFile(join(directory, `${run.jobId}.json`), null);
   if (!metadata) continue;
   if (CHORE_RUN_TERMINAL.has(metadata.status)) {
    const outcome = metadata.status === "completed" ? "done" : "failed";
    appendChoreEvent(projectRoot, { type: "task.run.finished", jobId: run.jobId, taskId: task.id, outcome, source: "runner" });
    const openSubtasks = tasks.filter((item) => item.parentId === task.id && item.status !== "done");
    if (outcome === "done" && !openSubtasks.length) {
     appendChoreEvent(projectRoot, { type: "task.status", taskId: task.id, status: "done", source: "runner" });
    } else if (outcome === "failed") {
     appendChoreEvent(projectRoot, { type: "task.lifecycle", taskId: task.id, lifecycle: "queued", source: "runner" });
    }
    changed = true;
   } else if (["running", "falling-back"].includes(metadata.status) && task.lifecycle === "queued") {
    appendChoreEvent(projectRoot, { type: "task.lifecycle", taskId: task.id, lifecycle: "in-progress", source: "runner" });
    changed = true;
   }
  }
 }
 return changed;
}

function choreOpenRuns(task) {
 return task.runs.filter((run) => !run.finishedAt);
}

function chorePrompt(task, tasks) {
 const byId = new Map(tasks.map((item) => [item.id, item]));
 const subtasks = tasks.filter((item) => item.parentId === task.id);
 const lines = [`Task: ${task.title}`];
 if (task.notes.trim()) lines.push("", task.notes.trim());
 if (task.tags.length) lines.push("", `Tags: ${task.tags.join(", ")}`);
 if (subtasks.length) {
  lines.push("", "Checklist:");
  for (const subtask of subtasks) {
   lines.push(`- [${subtask.status === "done" ? "x" : " "}] ${subtask.title}`);
  }
 }
 const finished = task.dependsOn.map((dep) => byId.get(dep)).filter((dep) => dep && dep.status === "done");
 if (finished.length) {
  lines.push("", "Already completed prerequisite tasks:");
  for (const dep of finished) lines.push(`- ${dep.title}`);
 }
 if (Object.keys(task.data).length) {
  lines.push("", "Additional data:");
  for (const [key, value] of Object.entries(task.data)) lines.push(`- ${key}: ${value}`);
 }
 lines.push("", "Work in this repository. When finished, summarise what changed.");
 return lines.join("\n");
}

/** Run ONE chore now on its assignment through the visual TODO job machinery.
 *  The job carries todo.id "chore:<id>" so farm.visual-todo.status polling and
 *  queue dedup keep working unchanged. */
function dispatchChore(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 reconcileChoreRuns(projectRoot);
 const tasks = materializeChores(projectRoot);
 const task = tasks.find((item) => item.id === String(payload.taskId || ""));
 if (!task) throw new Error("Chore was not found.");
 if (choreBlockedIds(tasks).has(task.id)) throw new Error("This chore is blocked by unfinished dependencies.");
 if (choreOpenRuns(task).length) throw new Error("This chore already has a run in flight.");
 if (!task.assignee.silo && !task.assignee.provider && !task.assignee.model) {
  throw new Error("Assign the chore to a silo or model first.");
 }
 const result = dispatchVisualTodo({
  projectRoot,
  prompt: chorePrompt(task, tasks),
  provider: task.assignee.provider || "auto",
  model: task.assignee.model,
  permissionMode: payload.permissionMode,
  todo: { id: `chore:${task.id}`, comment: task.title },
 });
 appendChoreEvent(projectRoot, {
  type: "task.run.started",
  taskId: task.id,
  jobId: result.id,
  silo: task.assignee.silo,
  provider: result.provider || task.assignee.provider || null,
  model: result.model || task.assignee.model || null,
  source: payload.source || "user",
 });
 if (task.lifecycle === "logged") {
  appendChoreEvent(projectRoot, { type: "task.lifecycle", taskId: task.id, lifecycle: "queued", source: "runner" });
 }
 return { run: result, ...listChores({ projectRoot }) };
}

/** Auto-runner heartbeat: with the board toggle on, start queued, unblocked,
 *  assigned chores until the concurrency cap is reached. Also reconciles
 *  finished runs, so polling this keeps run state honest. */
function choresAutorunTick(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 reconcileChoreRuns(projectRoot);
 const settings = choreSettings(projectRoot);
 if (!settings.autoRun) return { dispatched: [], active: 0, ...listChores({ projectRoot }) };
 let tasks = materializeChores(projectRoot);
 const dispatched = [];
 let active = tasks.reduce((total, task) => total + choreOpenRuns(task).length, 0);
 for (const task of tasks) {
  if (active >= settings.concurrency) break;
  if (task.lifecycle !== "queued") continue;
  if (choreOpenRuns(task).length) continue;
  if (!task.assignee.silo && !task.assignee.provider && !task.assignee.model) continue;
  if (choreBlockedIds(tasks).has(task.id)) continue;
  try {
   dispatchChore({ projectRoot, taskId: task.id, source: "autorun" });
   dispatched.push(task.id);
   active += 1;
   tasks = materializeChores(projectRoot);
  } catch {
   // A single unrunnable chore must not stall the rest of the queue.
  }
 }
 return { dispatched, active, ...listChores({ projectRoot }) };
}

/** Two-way bridge with the visual TODO ledger: import unlinked todos
 *  as chores (tagged, linked via data.visualTodoId), then reflect chore
 *  status back onto the todos so the widget stays truthful. */
function syncChoresWithVisualTodo(payload = {}) {
 const projectRoot = projectDirectory(payload.projectRoot);
 const todos = materializeVisualTodos(projectRoot);
 const chores = materializeChores(projectRoot);
 const linked = new Map();
 const prepublicationKey = ["clu", "so", "TodoId"].join("");
 for (const task of chores) {
  const current = task.data.visualTodoId;
  const previous = current || task.data?.[prepublicationKey];
  if (!previous) continue;
  const todoId = String(previous);
  if (!current) {
   // Upgrade the private pre-publication foreign key without retaining its
   // source-specific field name in the public implementation.
   appendChoreEvent(projectRoot, {
    type: "task.updated",
    taskId: task.id,
    patch: { data: { ...task.data, visualTodoId: todoId } },
    source: "visual-todo-migration",
   });
   task.data = { ...task.data, visualTodoId: todoId };
  }
  linked.set(todoId, task);
 }
 let imported = 0;
 for (const todo of todos) {
  const todoId = String(todo.id);
  if (linked.has(todoId)) continue;
  const title = String(todo.comment || todo.title || `Visual TODO ${todoId}`).slice(0, 200);
  mutateChore({
   projectRoot,
   type: "task.created",
   source: "visual-todo",
   task: { title, tags: ["from-visual-todo"], data: { visualTodoId: todoId } },
  });
  const fresh = materializeChores(projectRoot).find((task) => task.data.visualTodoId === todoId);
  if (fresh && todo.status && todo.status !== "todo") {
   appendChoreEvent(projectRoot, { type: "task.status", taskId: fresh.id, status: todo.status, source: "visual-todo" });
  }
  imported += 1;
 }
 let reflected = 0;
 const todosById = new Map(todos.map((todo) => [String(todo.id), todo]));
 for (const [todoId, task] of linked) {
  const todo = todosById.get(todoId);
  if (todo && todo.status !== task.status) {
   appendVisualTodoMutation({ projectRoot, todoId, type: "todo.status", status: task.status, source: "chores" });
   reflected += 1;
  }
 }
 return { imported, reflected, ...listChores({ projectRoot }) };
}

const handlers = {
 "farm.bootstrap": bootstrap,
 "farm.profile.save": saveProfile,
 "farm.profile.duplicate": duplicateProfile,
 "farm.profile.remove": removeProfile,
 "farm.profile.reorder": reorderProfiles,
 "farm.gateway.save": saveGateway,
 "farm.gateway.start": startGateway,
 "farm.gateway.stop": stopGateway,
 "farm.gateway.status": gatewayStatus,
 "farm.farmd.start": startFarmd,
 "farm.farmd.stop": stopFarmd,
 "farm.farmd.status": farmdStatus,
 "farm.distributed.list": listDistributedSilos,
 "farm.distributed.create": createDistributedSilo,
 "farm.distributed.action": actOnDistributedSilo,
 "farm.agensis.pair.start": agensisPairStart,
 "farm.agensis.pair.exchange": agensisPairExchange,
 "farm.open.url": openExternalUrl,
 "farm.action": runFarm,
 "farm.visual-todo.dispatch": dispatchVisualTodo,
 "farm.visual-todo.worker.start": visualTodoWarmWorker,
 "farm.visual-todo.next": startNextVisualTodoTask,
 "farm.visual-todo.status": visualTodoTaskStatus,
 "farm.visual-todo.todo.sync": syncVisualTodos,
 "farm.visual-todo.todo.append": appendVisualTodoMutation,
 "farm.chores.list": listChores,
 "farm.chores.mutate": mutateChore,
 "farm.chores.settings.save": saveChoreSettings,
 "farm.chores.attachment.add": addChoreAttachment,
 "farm.chores.attachment.read": readChoreAttachment,
 "farm.chores.dispatch": dispatchChore,
 "farm.chores.autorun.tick": choresAutorunTick,
 "farm.chores.sync.visual-todo": syncChoresWithVisualTodo,
 "farm.terminal.open": (payload) => terminalSnapshot(payload, true),
 "farm.terminal.input": terminalInput,
 "farm.terminal.resize": terminalResize,
 "farm.terminal.close": terminalClose,
 "farm.hostDirs.list": listHostDirs,
 "farm.hostDirs.add": addHostDir,
 "farm.hostDirs.remove": removeHostDir,
 "farm.hostDirs.reload": reloadHostDirs,
 "farm.workspace.list": listMarkdownWorkspace,
 "farm.workspace.setRoot": setWorkspaceRoot,
 "farm.workspace.links": workspaceLinkGraph,
 "farm.workspace.fileHistory": workspaceFileHistory,
 "farm.agentic.list": listAgenticInventory,
 "farm.agentic.read": readAgenticDocument,
 "farm.paddock.list": listPaddocks,
 "farm.paddock.prime": primePaddock,
 "farm.paddock.remove": removePaddock,
 "farm.worktree.branches": listWorktreeBranches,
 "farm.worktree.list": listWorktrees,
 "farm.worktree.create": createWorktree,
 "farm.worktree.remove": removeWorktree,
 "farm.worktree.merge": worktreeMerge,
 "farm.worktree.mergeStatus": worktreeMergeStatus,
 "farm.worktree.status": worktreeStatus,
 "farm.worktree.graph": worktreeGraph,
 "farm.worktree.fetch": worktreeFetch,
 "farm.worktree.pull": worktreePull,
 "farm.worktree.mergeability": worktreeMergeability,
 "farm.worktree.resolveConflict": resolveWorktreeConflict,
 "farm.crew.list": listCrewAssignments,
 "farm.crew.save": saveCrewAssignment,
 "farm.crew.remove": removeCrewAssignment,
 "farm.session.list": listFarmSessions,
 "farm.session.get": getFarmSession,
 "farm.session.save": saveFarmSession,
 "farm.session.remove": removeFarmSession,
 "farm.session.adopt": adoptAgentSession,
 "farm.session.peek": peekAgentSession,
 "farm.file.read": readDroppedFile,
 "farm.notify": notifyDesktop,
 "farm.usage.ping": pingUsage,
 "farm.editor.assist": editorAssist,
 "farm.harvest.scan": runHarvestScan,
 "farm.harvest.triage": runHarvestTriage,
 "farm.harvest.list": listHarvest,
 "farm.harvest.draft": readHarvestDraft,
 "farm.harvest.resolve": resolveHarvest,
 "farm.workspace.read": readMarkdownWorkspace,
 "farm.workspace.asset": readWorkspaceAsset,
 "farm.workspace.write": writeMarkdownWorkspace,
 "farm.workspace.diff": workspaceDiff,
 "farm.history.list": listAgentSessions,
 "farm.history.mute": muteSessionPrompt,
};

async function dispatch(command, payload) {
 if (!handlers[command]) throw new Error(`Unknown bridge command: ${command}`);
 return Promise.resolve(handlers[command](payload));
}

// Long-lived mode is used by the native host to avoid spawning Node for every
// bridge call. Each request and response is one JSON line, preserving the
// existing command/payload contract while allowing the process to be reused.
if (process.argv[2] === "--server") {
 const readline = await import("node:readline");
 const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
 for await (const line of input) {
  if (!line.trim()) continue;
  try {
   const request = JSON.parse(line);
   const result = await dispatch(request.command, request.payload || {});
   process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
   process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  }
 }
} else {
 const command = process.argv[2];
 const payload = process.argv[3] ? JSON.parse(process.argv[3]) : {};
 try {
  process.stdout.write(JSON.stringify(await dispatch(command, payload)));
 } catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
 }
}
