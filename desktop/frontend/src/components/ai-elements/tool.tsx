import type { HTMLAttributes, ReactNode } from "react";
import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  FileTextIcon,
  SearchIcon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { cn } from "@/lib/utils";
import type { ChatToolEvent } from "@/types/farm";

type FileChange = { path: string; additions: number; deletions: number };
type GrepHit = { path: string; line?: string; text: string };

/** Turn wire-format tool payloads into something a human can read. Claude CLI
 *  often hands us plain strings (grep dumps) or JSON-as-string; JSON.stringify
 *  of those produces the quoted wall of `\n` the screenshot shows. */
function coerceValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  // JSON document (object/array) or a JSON-encoded string.
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return coerceValue(JSON.parse(trimmed));
    } catch {
      /* keep original */
    }
  }

  // Double-escaped dumps: one physical line with literal \n sequences.
  if (!value.includes("\n") && /\\n|\\t|\\"/.test(value)) {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return value;
}

function contentBlocksText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.text === "string") parts.push(entry.text);
    else if (typeof entry.content === "string") parts.push(entry.content);
    else if (typeof entry.output === "string") parts.push(entry.output);
  }
  return parts.length ? parts.join("\n") : null;
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const fromBlocks = contentBlocksText(value);
  if (fromBlocks != null) return fromBlocks;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join("\n");
  }
  return null;
}

function fileChanges(output: unknown): FileChange[] | null {
  if (!output || typeof output !== "object") return null;
  const value = output as { files?: unknown; changes?: unknown };
  const list = Array.isArray(value.files)
    ? value.files
    : Array.isArray(value.changes)
      ? value.changes
      : null;
  if (!list) return null;
  const parsed = list
    .map((item) => {
      if (typeof item === "string")
        return { path: item, additions: 0, deletions: 0 };
      if (!item || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      return {
        path: String(entry.path || entry.file || entry.name || "Changed file"),
        additions: Number(entry.additions || entry.added || 0),
        deletions: Number(entry.deletions || entry.removed || 0),
      };
    })
    .filter(Boolean) as FileChange[];
  return parsed.length ? parsed : null;
}

/** ripgrep / Claude Grep style: `path:line: snippet` one hit per line. */
function grepHits(text: string): GrepHit[] | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return null;
  const hits: GrepHit[] = [];
  let matched = 0;
  for (const line of lines) {
    const withLine = line.match(/^([^:\n]+):(\d+):(.*)$/);
    if (withLine) {
      hits.push({
        path: withLine[1],
        line: withLine[2],
        text: withLine[3].replace(/^\s/, ""),
      });
      matched += 1;
      continue;
    }
    // Keep non-matching lines as free text so we don't drop headers.
    hits.push({ path: "", text: line });
  }
  if (matched < Math.max(2, Math.ceil(lines.length * 0.5))) return null;
  return hits;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isGenericToolLabel(name: string): boolean {
  return /^(tool|tool result|tool_result|tool_use)$/i.test(name.trim());
}

/** Recover Claude Code tool names when the stream only delivered a result. */
function inferToolName(event: ChatToolEvent): string | null {
  const input = coerceValue(event.input);
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (typeof record.name === "string" && !isGenericToolLabel(record.name))
      return record.name.trim();
    if (typeof record.tool === "string" && !isGenericToolLabel(record.tool))
      return record.tool.trim();
    if (typeof record.command === "string") return "Bash";
    if (typeof record.pattern === "string" || typeof record.regex === "string")
      return "Grep";
    if (typeof record.glob === "string" || typeof record.glob_pattern === "string")
      return "Glob";
    if (typeof record.old_string === "string" || typeof record.new_string === "string")
      return "Edit";
    if (typeof record.file_path === "string" || typeof record.path === "string") {
      if (typeof record.content === "string") return "Write";
      return "Read";
    }
    if (typeof record.skill === "string") return "Skill";
    if (typeof record.query === "string") return "Search";
  }
  const text = asText(coerceValue(event.output)) || "";
  if (!text) return null;
  if (/^Launching skill:/i.test(text)) return "Skill";
  if (/^Exit code\b/m.test(text)) return "Bash";
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const grepHits = lines.filter((line) => /^[^:\n]+:\d+:/.test(line)).length;
  if (lines.length && grepHits >= Math.max(1, Math.ceil(lines.length * 0.4)))
    return "Grep";
  if (
    lines.length >= 2 &&
    lines.every((line) => /^[./~]/.test(line.trim()) && !line.includes(": "))
  )
    return "Glob";
  if (
    lines.length === 1 &&
    /^[./~]/.test(lines[0].trim()) &&
    !lines[0].includes(" ")
  )
    return "Bash";
  if (/\n\s*\d+[\t|]/.test(text) || /^\s*\d+→/.test(text) || /^\s*\d+\t/.test(text))
    return "Read";
  return null;
}

function toolTitle(event: ChatToolEvent): string {
  const name = String(event.name || "").trim();
  if (name && !isGenericToolLabel(name)) return name;
  return inferToolName(event) || "Tool";
}

/** One-line context for a chip (command, path, pattern…). */
function toolDetail(event: ChatToolEvent): string | null {
  const input = coerceValue(event.input);
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of [
      "command",
      "file_path",
      "path",
      "pattern",
      "glob",
      "glob_pattern",
      "query",
      "skill",
    ] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        const text = value.trim().replace(/\s+/g, " ");
        return text.length > 72 ? `${text.slice(0, 71)}…` : text;
      }
    }
  }
  const out = asText(coerceValue(event.output));
  if (!out) return null;
  const first = out.split(/\r?\n/).find((line) => line.trim())?.trim();
  if (!first) return null;
  if (/^Launching skill:\s*(.+)/i.test(first)) {
    return first.replace(/^Launching skill:\s*/i, "");
  }
  return first.length > 72 ? `${first.slice(0, 71)}…` : first;
}

function ToolPayload({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-1.5">
      <p className="type-label">{label}</p>
      {children}
    </section>
  );
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={cn(
        "type-code max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-muted-foreground",
        className,
      )}
    >
      {children}
    </pre>
  );
}

function GrepHitsView({ hits }: { hits: GrepHit[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <SearchIcon className="size-3.5 text-muted-foreground" />
        <span className="type-caption">
          {hits.filter((hit) => hit.path).length} match
          {hits.filter((hit) => hit.path).length === 1 ? "" : "es"}
        </span>
      </div>
      <ul className="divide-y">
        {hits.map((hit, index) =>
          hit.path ? (
            <li key={`${hit.path}:${hit.line}:${index}`} className="px-3 py-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="type-code min-w-0 flex-1 truncate text-foreground">
                  {hit.path}
                </span>
                {hit.line ? (
                  <span className="type-code shrink-0 text-muted-foreground">
                    :{hit.line}
                  </span>
                ) : null}
              </div>
              {hit.text ? (
                <p className="type-code mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                  {hit.text}
                </p>
              ) : null}
            </li>
          ) : (
            <li
              key={`meta-${index}`}
              className="type-code px-3 py-1.5 text-muted-foreground"
            >
              {hit.text}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function FileChangesView({ changes }: { changes: FileChange[] }) {
  const additions = changes.reduce((sum, file) => sum + file.additions, 0);
  const deletions = changes.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <FileTextIcon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <strong className="block type-list">
            Edited {changes.length} {changes.length === 1 ? "file" : "files"}
          </strong>
          <span className="type-code">
            <span className="text-success">+{additions}</span>
            <span className="ml-2 text-destructive">-{deletions}</span>
          </span>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-7">
          Review
        </Button>
      </div>
      <div className="divide-y">
        {changes.slice(0, 8).map((file) => (
          <div key={file.path} className="flex items-center gap-2 px-3 py-2">
            <span className="type-code min-w-0 flex-1 truncate">{file.path}</span>
            <span className="type-code shrink-0">
              <span className="text-success">+{file.additions}</span>
              <span className="ml-1.5 text-destructive">-{file.deletions}</span>
            </span>
          </div>
        ))}
        {changes.length > 8 && (
          <div className="type-caption px-3 py-2">
            Show {changes.length - 8} more files
          </div>
        )}
      </div>
    </div>
  );
}

function renderValue(value: unknown): ReactNode {
  const coerced = coerceValue(value);
  if (coerced == null || coerced === "") {
    return <p className="type-caption">No payload.</p>;
  }

  const changes = fileChanges(coerced);
  if (changes) return <FileChangesView changes={changes} />;

  const text = asText(coerced);
  if (text != null) {
    const hits = grepHits(text);
    if (hits) return <GrepHitsView hits={hits} />;
    return <CodeBlock>{text}</CodeBlock>;
  }

  return <CodeBlock>{prettyJson(coerced)}</CodeBlock>;
}

function ToolStatusIcon({
  status,
}: {
  status: ChatToolEvent["status"] | "mixed";
}) {
  // size-3 matches the dense claude/host trace row chrome.
  if (status === "completed")
    return <CheckCircle2Icon className="size-3 text-success" />;
  if (status === "error" || status === "denied")
    return <XCircleIcon className="size-3 text-destructive" />;
  if (status === "mixed")
    return <CheckCircle2Icon className="size-3 text-muted-foreground" />;
  return (
    <CircleDashedIcon className="size-3 animate-spin text-muted-foreground" />
  );
}

function aggregateStatus(
  tools: ChatToolEvent[],
): ChatToolEvent["status"] | "mixed" {
  if (tools.some((tool) => tool.status === "running" || tool.status === "pending"))
    return "running";
  const failed = tools.some(
    (tool) => tool.status === "error" || tool.status === "denied",
  );
  const ok = tools.some((tool) => tool.status === "completed");
  if (failed && ok) return "mixed";
  if (failed) return "error";
  return "completed";
}

function groupToolsByName(
  tools: ChatToolEvent[],
): Array<{ name: string; tools: ChatToolEvent[] }> {
  const order: string[] = [];
  const map = new Map<string, ChatToolEvent[]>();
  for (const tool of tools) {
    const name = toolTitle(tool);
    if (!map.has(name)) {
      map.set(name, []);
      order.push(name);
    }
    map.get(name)!.push(tool);
  }
  return order.map((name) => ({ name, tools: map.get(name)! }));
}

function ToolChipTrigger({
  label,
  count,
  status,
  detail,
}: {
  label: string;
  count: number;
  status: ChatToolEvent["status"] | "mixed";
  detail?: string | null;
}) {
  return (
    <CollapsibleTrigger className="group flex h-7 w-full items-center gap-1.5 rounded-md border bg-card/55 px-2 text-left text-xs">
      <WrenchIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">
        <span className="tabular-nums text-muted-foreground">{count}</span>
        <span className="text-muted-foreground"> × </span>
        {label}
        {detail ? (
          <span className="font-normal text-muted-foreground">
            {" · "}
            {detail}
          </span>
        ) : null}
      </span>
      <span className="ml-auto shrink-0" title={status} aria-label={status}>
        <ToolStatusIcon status={status} />
      </span>
      <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
}

/** Name-level group: "3 × Bash" → individual Tool rows. */
function ToolNameGroup({
  name,
  tools,
}: {
  name: string;
  tools: ChatToolEvent[];
}) {
  if (tools.length === 1) return <Tool event={tools[0]} />;
  const status = aggregateStatus(tools);
  // When every call shares a detail prefix (same command/path), surface it.
  const details = tools.map(toolDetail).filter(Boolean) as string[];
  const detail =
    details.length === tools.length && details.every((item) => item === details[0])
      ? details[0]
      : null;
  return (
    <Collapsible className="not-prose">
      <ToolChipTrigger
        label={name}
        count={tools.length}
        status={status}
        detail={detail}
      />
      <CollapsibleContent className="mt-1 flex flex-col gap-1 border-l border-border/60 pl-2">
        {tools.map((tool) => (
          <Tool key={tool.id} event={tool} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Stack of tools with two collapse levels:
 *  1. Run chip — "8 × tools" (grows as calls stream in)
 *  2. Per-name chips — "3 × Bash", "2 × Grep"
 *  3. Individual Tool cards (input/output)
 */
export function GroupedTools({
  tools,
  className,
}: {
  tools: ChatToolEvent[];
  className?: string;
}) {
  if (!tools.length) return null;
  if (tools.length === 1) {
    return (
      <div className={cn("not-prose", className)}>
        <Tool event={tools[0]} />
      </div>
    );
  }

  const byName = groupToolsByName(tools);
  const status = aggregateStatus(tools);
  // Prefer real names in the top chip: "8 × tools" only when mixed.
  const named = byName.filter((group) => !isGenericToolLabel(group.name));
  const topLabel =
    byName.length === 1
      ? byName[0].name
      : named.length === 1 && named[0].tools.length === tools.length
        ? named[0].name
        : "tools";

  return (
    <Collapsible className={cn("not-prose", className)}>
      <ToolChipTrigger label={topLabel} count={tools.length} status={status} />
      <CollapsibleContent className="mt-1 flex flex-col gap-1 border-l border-border/60 pl-2">
        {byName.map((group) => (
          <ToolNameGroup
            key={group.name}
            name={group.name}
            tools={group.tools}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Map farm tool status → AI Elements Confirmation state. */
function toolConfirmationState(
  status: ChatToolEvent["status"],
): "approval-requested" | "approval-responded" | "output-available" | "output-denied" | "input-available" {
  if (status === "pending") return "approval-requested";
  if (status === "denied") return "output-denied";
  if (status === "error") return "output-denied";
  if (status === "completed") return "output-available";
  return "input-available";
}

export function Tool({
  event,
  className,
  onApprove,
  onReject,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  event: ChatToolEvent;
  /** Optional HITL handlers — used when permission mode is "ask" / pending tools. */
  onApprove?: (tool: ChatToolEvent) => void;
  onReject?: (tool: ChatToolEvent) => void;
}) {
  const done = event.status === "completed";
  const failed = event.status === "error" || event.status === "denied";
  const awaiting = event.status === "pending";
  const title = toolTitle(event);
  const hasOutput = event.output != null && event.output !== "";
  const hasInput = event.input != null && event.input !== "";

  const detail = toolDetail(event);
  const confirmationState = toolConfirmationState(event.status);
  const showConfirmation =
    awaiting ||
    event.status === "denied" ||
    (failed && onReject != null) ||
    onApprove != null && awaiting;

  return (
    <div className={cn("not-prose grid gap-1.5", className)}>
      <Collapsible
        className="overflow-hidden rounded-md border bg-card/55"
        {...props}
      >
        <CollapsibleTrigger className="group flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs">
          <WrenchIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {title}
            {detail ? (
              <span className="font-normal text-muted-foreground">
                {" · "}
                {detail}
              </span>
            ) : null}
          </span>
          <span className="ml-auto shrink-0" title={event.status} aria-label={event.status}>
            <ToolStatusIcon status={event.status} />
          </span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-2 border-t p-2">
          {hasOutput ? (
            <ToolPayload label="Output">{renderValue(event.output)}</ToolPayload>
          ) : null}
          {hasInput ? (
            <ToolPayload label="Input">{renderValue(event.input)}</ToolPayload>
          ) : null}
          {!hasOutput && !hasInput ? (
            <p className="type-caption">No tool payload.</p>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      {showConfirmation || awaiting || event.status === "denied" ? (
        <Confirmation
          approval={
            awaiting
              ? { id: event.id }
              : event.status === "denied"
                ? { id: event.id, approved: false }
                : done
                  ? { id: event.id, approved: true }
                  : { id: event.id }
          }
          state={confirmationState}
          className="py-2"
        >
          <ConfirmationRequest>
            <ConfirmationTitle className="text-xs">
              Allow <span className="font-medium text-foreground">{title}</span>
              {detail ? (
                <span className="text-muted-foreground"> · {detail}</span>
              ) : null}
              {" "}to run?
            </ConfirmationTitle>
            <ConfirmationActions className="mt-2">
              <ConfirmationAction
                variant="outline"
                size="sm"
                onClick={() => onReject?.(event)}
              >
                <XIcon className="size-3.5" />
                Reject
              </ConfirmationAction>
              <ConfirmationAction
                size="sm"
                onClick={() => onApprove?.(event)}
              >
                <CheckIcon className="size-3.5" />
                Approve
              </ConfirmationAction>
            </ConfirmationActions>
          </ConfirmationRequest>
          <ConfirmationAccepted>
            <ConfirmationTitle className="inline-flex items-center gap-1.5 text-xs">
              <CheckIcon className="size-3.5 text-success" />
              Approved {title}
            </ConfirmationTitle>
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <ConfirmationTitle className="inline-flex items-center gap-1.5 text-xs">
              <XIcon className="size-3.5 text-destructive" />
              Rejected {title}
            </ConfirmationTitle>
          </ConfirmationRejected>
        </Confirmation>
      ) : null}
    </div>
  );
}
