import { useEffect, useMemo, useState } from "react";
import {
  BotIcon,
  ChevronRightIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  PaperclipIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import type {
  ChatMessage,
  ChatSession,
  ChatToolEvent,
} from "@/types/farm";

/** Same tool-name idiom as chat-workspace's messageHasFileEdits, but
 *  camelCase-aware: "NotebookEdit"/"WebFetch" split into words first, so the
 *  boundary match sees "notebook edit" / "web fetch". */
const EDIT_TOOL_RE =
  /(?:^|[\s_.:/-])(edit|write|patch|apply|replace|create|delete)(?:$|[\s_.:/-])/i;
const SOURCE_TOOL_RE =
  /(?:^|[\s_.:/-])(read|fetch|search|grep|glob|web|list|view|cat)(?:$|[\s_.:/-])/i;

function toolWords(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
const isEditTool = (name: string) => EDIT_TOOL_RE.test(toolWords(name));
const isSourceTool = (name: string) => SOURCE_TOOL_RE.test(toolWords(name));

const PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "filename",
  "file",
  "target",
  "notebook_path",
];
const URL_KEYS = ["url", "uri", "href"];
const PATH_LIKE_RE = /^(?:~\/|\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)+\.\w+$/;

/** Cheap path/URL extraction from a tool's input payload: known keys first,
 *  then a shallow scan of string values that look like file paths or URLs. */
function extractLocators(input: unknown): { paths: string[]; urls: string[] } {
  const paths: string[] = [];
  const urls: string[] = [];
  if (!input || typeof input !== "object") return { paths, urls };
  const record = input as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value) paths.push(value);
  }
  for (const key of URL_KEYS) {
    const value = record[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value))
      urls.push(value);
  }
  if (!paths.length && !urls.length) {
    for (const value of Object.values(record)) {
      if (typeof value !== "string") continue;
      if (/^https?:\/\//i.test(value)) urls.push(value);
      else if (PATH_LIKE_RE.test(value) && value.startsWith("/"))
        paths.push(value);
    }
  }
  return { paths, urls };
}

interface OutputEntry {
  path: string;
  tool: string;
  status: ChatToolEvent["status"];
}
interface SubagentEntry {
  route: string;
  status: string;
  toolCount: number;
  runs: number;
}
interface SourceEntry {
  kind: "file" | "url" | "attachment";
  label: string;
  detail: string;
}

export interface JobStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  silos: string[];
  topModel: string | null;
  topTool: string | null;
  toolNames: string[];
  mcpTools: number;
  skillsUsed: string[];
}

function collectStats(messages: ChatMessage[]): JobStats {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const silos = new Set<string>();
  const modelCounts = new Map<string, number>();
  const toolCounts = new Map<string, number>();
  const skills = new Set<string>();
  const addUsage = (usage?: { inputTokens: number; outputTokens: number }) => {
    if (!usage) return;
    inputTokens += usage.inputTokens || 0;
    outputTokens += usage.outputTokens || 0;
  };
  const addTools = (tools?: ChatToolEvent[]) => {
    for (const tool of tools || []) {
      toolCounts.set(tool.name, (toolCounts.get(tool.name) || 0) + 1);
      if (/^skill$/i.test(tool.name)) {
        const args = tool.input as { skill?: string } | undefined;
        if (args?.skill) skills.add(String(args.skill));
      }
    }
  };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    addUsage(message.usage);
    addTools(message.tools);
    if (message.model) {
      modelCounts.set(message.model, (modelCounts.get(message.model) || 0) + 1);
      const silo = message.model.split("/")[1] || message.model.split("/")[0];
      if (silo) silos.add(silo);
    }
    for (const member of message.members || []) {
      addUsage(member.usage);
      addTools(member.tools);
      costUsd += member.costUsd || 0;
      const silo = member.route.split("/")[1] || member.route;
      if (silo) silos.add(silo);
      for (const model of member.models || []) {
        modelCounts.set(model.model, (modelCounts.get(model.model) || 0) + 1);
        costUsd += model.costUsd || 0;
      }
    }
  }
  const top = (counts: Map<string, number>) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    inputTokens,
    outputTokens,
    costUsd,
    silos: [...silos],
    topModel: top(modelCounts),
    topTool: top(toolCounts),
    toolNames: [...toolCounts.keys()],
    mcpTools: [...toolCounts.keys()].filter((name) => /^mcp[_-]/i.test(name)).length,
    skillsUsed: [...skills],
  };
}

export function summarizeJob(messages: ChatMessage[]) {
  const outputs = new Map<string, OutputEntry>();
  let pathlessEdits = 0;
  const subagents = new Map<string, SubagentEntry>();
  const sources = new Map<string, SourceEntry>();

  const scanTool = (tool: ChatToolEvent) => {
    const { paths, urls } = extractLocators(tool.input);
    if (isEditTool(tool.name)) {
      if (paths.length) {
        for (const path of paths)
          outputs.set(path, { path, tool: tool.name, status: tool.status });
      } else {
        pathlessEdits += 1;
      }
      return;
    }
    if (isSourceTool(tool.name)) {
      for (const path of paths)
        sources.set(`file:${path}`, { kind: "file", label: path, detail: tool.name });
      for (const url of urls)
        sources.set(`url:${url}`, { kind: "url", label: url, detail: tool.name });
    }
  };

  for (const message of messages) {
    for (const tool of message.tools || []) scanTool(tool);
    for (const member of message.members || []) {
      const existing = subagents.get(member.route);
      subagents.set(member.route, {
        route: member.route,
        status: member.status,
        toolCount: (existing?.toolCount || 0) + (member.tools?.length || 0),
        runs: (existing?.runs || 0) + 1,
      });
      for (const tool of member.tools || []) scanTool(tool);
    }
    if (message.role === "user") {
      for (const attachment of message.attachments || []) {
        sources.set(`attachment:${attachment.name}`, {
          kind: "attachment",
          label: attachment.name,
          detail: attachment.mediaType,
        });
      }
    }
  }

  return {
    outputs: [...outputs.values()],
    pathlessEdits,
    subagents: [...subagents.values()],
    sources: [...sources.values()],
  };
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-center gap-2">
        <p className="type-label">{label}</p>
        <Badge variant="outline">{count}</Badge>
      </header>
      <div className="mt-2 flex flex-col gap-1">{children}</div>
    </section>
  );
}

function basename(path: string) {
  return path.split("/").at(-1) || path;
}

const subagentDot: Record<string, string> = {
  running: "bg-primary",
  queued: "bg-muted-foreground/50",
  completed: "bg-(--success)",
  error: "bg-destructive",
  stopped: "bg-muted-foreground",
};

/**
 * Codex-style job summary for the inspector sidebar: what the job produced
 * (Outputs), who worked on it (Subagents), and what it consulted (Sources).
 * All derived client-side from the session's message/tool traces.
 */
interface RepoChangeFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export function JobSummaryPanel({ session }: { session: ChatSession }) {
  const summary = useMemo(
    () => summarizeJob(session.messages),
    [session.messages],
  );
  const stats = useMemo(() => collectStats(session.messages), [session.messages]);
  const compact = (value: number) =>
    value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
  // Repo changes: authoritative git status of the workspace — what actually
  // changed on disk, regardless of which tool (or human) touched it.
  const [repoFiles, setRepoFiles] = useState<RepoChangeFile[]>([]);
  const [repoOpen, setRepoOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    invokeNative<{ files: RepoChangeFile[] }>("farm.workspace.diff")
      .then((result) => {
        if (!cancelled) setRepoFiles(result.files);
      })
      .catch(() => { /* not a git workspace or no bridge */ });
    return () => {
      cancelled = true;
    };
  }, [session.messages.length]);
  const additions = repoFiles.reduce((total, file) => total + file.additions, 0);
  const deletions = repoFiles.reduce((total, file) => total + file.deletions, 0);
  const empty =
    !summary.outputs.length &&
    !summary.pathlessEdits &&
    !summary.subagents.length &&
    !summary.sources.length &&
    !repoFiles.length;

  if (empty) {
    return (
      <p className="px-1 py-6 text-center type-caption">
        No activity yet — outputs, subagents and sources appear as the job
        runs.
      </p>
    );
  }

  const statRows: Array<[string, string]> = [
    ["Tokens in / out", `${compact(stats.inputTokens)} / ${compact(stats.outputTokens)}`],
    ...(stats.costUsd > 0 ? [["Cost", `$${stats.costUsd.toFixed(stats.costUsd < 1 ? 3 : 2)}`] as [string, string]] : []),
    ...(stats.silos.length ? [["Silos", stats.silos.join(", ")] as [string, string]] : []),
    ...(stats.topModel ? [["Top model", stats.topModel] as [string, string]] : []),
    ...(stats.topTool ? [["Top tool", stats.topTool] as [string, string]] : []),
    ...(stats.toolNames.length
      ? [["Tools used", `${stats.toolNames.length}${stats.mcpTools ? ` (${stats.mcpTools} MCP)` : ""}`] as [string, string]]
      : []),
    ...(stats.skillsUsed.length ? [["Skills", stats.skillsUsed.join(", ")] as [string, string]] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      {(stats.inputTokens > 0 || stats.outputTokens > 0 || stats.toolNames.length > 0) && (
        <section>
          <header className="flex items-center gap-2">
            <p className="type-label">Stats</p>
          </header>
          <dl className="mt-2 overflow-hidden rounded-md border bg-background">
            {statRows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border/60 px-2.5 py-1.5 last:border-b-0">
                <dt className="shrink-0 type-caption">{label}</dt>
                <dd className="min-w-0 truncate text-right font-mono text-xs text-foreground" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {repoFiles.length > 0 && (
        <section>
          <button
            type="button"
            className="flex w-full items-center gap-2"
            aria-expanded={repoOpen}
            onClick={() => setRepoOpen((open) => !open)}
          >
            <p className="type-label">Repo changes</p>
            <span className="font-mono text-xs font-medium text-(--success)">+{additions}</span>
            <span className="font-mono text-xs font-medium text-destructive">−{deletions}</span>
            <ChevronRightIcon
              className={cn("ml-auto size-3.5 text-muted-foreground transition-transform", repoOpen && "rotate-90")}
            />
          </button>
          {repoOpen && (
            <div className="mt-2 flex flex-col gap-1">
              {repoFiles.map((file) => (
                <article
                  key={file.path}
                  className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5"
                  title={`${file.path} · ${file.status}`}
                >
                  <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono type-caption text-foreground">
                    {file.path}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-(--success)">+{file.additions}</span>
                  <span className="shrink-0 font-mono text-xs text-destructive">−{file.deletions}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      <Section label="Outputs" count={summary.outputs.length}>
        {summary.outputs.length ? (
          summary.outputs.map((output) => (
            <article
              key={output.path}
              className="rounded-md border bg-background px-2.5 py-1.5"
              title={output.path}
            >
              <p className="truncate type-list font-medium">
                {basename(output.path)}
              </p>
              <p className="truncate font-mono type-caption">{output.path}</p>
            </article>
          ))
        ) : summary.pathlessEdits ? (
          <p className="type-caption">
            {summary.pathlessEdits} edit
            {summary.pathlessEdits === 1 ? "" : "s"} without reported file
            paths.
          </p>
        ) : (
          <p className="type-caption">Nothing written yet.</p>
        )}
        {summary.outputs.length > 0 && summary.pathlessEdits > 0 && (
          <p className="type-caption">
            +{summary.pathlessEdits} edit
            {summary.pathlessEdits === 1 ? "" : "s"} without reported paths.
          </p>
        )}
      </Section>
      <Section label="Subagents" count={summary.subagents.length}>
        {summary.subagents.length ? (
          summary.subagents.map((member) => (
            <div key={member.route} className="flex items-center gap-2 px-0.5">
              <BotIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate type-list font-medium">
                {member.route}
              </span>
              <span className="shrink-0 type-caption">
                {member.status} · {member.toolCount} tool
                {member.toolCount === 1 ? "" : "s"}
              </span>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  subagentDot[member.status] || "bg-muted-foreground/50",
                )}
              />
            </div>
          ))
        ) : (
          <p className="type-caption">No subagents were dispatched.</p>
        )}
      </Section>
      <Section label="Sources" count={summary.sources.length}>
        {summary.sources.length ? (
          <div className="flex flex-wrap gap-1">
            {summary.sources.map((source) => (
              <span
                key={`${source.kind}:${source.label}`}
                title={`${source.label} (${source.detail})`}
                className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 type-caption [font-family:var(--font-secondary,inherit)]"
              >
                {source.kind === "url" ? (
                  <GlobeIcon className="size-3 shrink-0" />
                ) : source.kind === "attachment" ? (
                  <PaperclipIcon className="size-3 shrink-0" />
                ) : (
                  <FileTextIcon className="size-3 shrink-0" />
                )}
                <span className="truncate">
                  {source.kind === "file" ? basename(source.label) : source.label}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p className="type-caption">Nothing consulted yet.</p>
        )}
      </Section>
    </div>
  );
}
