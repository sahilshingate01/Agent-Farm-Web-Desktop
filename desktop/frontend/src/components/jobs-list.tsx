import { useEffect, useMemo, useRef, useState } from "react";
import {
  EyeOffIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  WheatIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import { cn } from "@/lib/utils";
import { vocab } from "@/lib/vocabulary";
import type {
  AgentSessionIndex,
  AgentSessionSummary,
  FarmSessionMeta,
} from "@/types/farm";

/** Unified Jobs list (spec B): Farm-store sessions and native CLI transcripts
 *  in one lazily-loaded list. Farm rows page through the bridge (the parent
 *  owns that state); native rows come from farm.history.list with the
 *  workspace-cwd filter lifted and are sliced client-side. */

const NATIVE_SLICE = 30;

const FILTERS = [
  { value: "all", label: "All" },
  { value: "farm", label: "Farm" },
  { value: "claude", label: "claude" },
  { value: "codex", label: "codex" },
] as const;

type JobsFilter = (typeof FILTERS)[number]["value"];

type JobRow =
  | { key: string; kind: "farm"; meta: FarmSessionMeta }
  | { key: string; kind: "native"; session: AgentSessionSummary };

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

/** Provider segment of a Farm row: adopted sessions carry their source; born
 *  Farm sessions derive it from the "provider/silo" route string. Elevator and
 *  command routes have no provider segment. */
function farmProvider(meta: FarmSessionMeta) {
  if (meta.source && meta.source !== "farm") return meta.source;
  return meta.model.includes("/") ? meta.model.split("/")[0] : "";
}

/** Display title of a native row — the exact string the UI renders. The
 *  test-handover filter matches on this, so the filename fallback (e.g. codex
 *  "rollout-….jsonl" transcripts with no prompt) is covered too. */
function nativeTitle(session: AgentSessionSummary) {
  return (
    session.prompt.split("\n")[0].slice(0, 80) ||
    session.sourcePath.split("/").pop() ||
    session.id
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  if (!provider)
    return (
      <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
    );
  const initial = provider === "codex" ? "X" : provider[0].toUpperCase();
  return (
    <span className="grid size-4 shrink-0 place-items-center rounded-sm bg-muted font-mono text-[0.6rem] font-medium text-muted-foreground">
      {initial}
    </span>
  );
}

function JobRowItem({
  title,
  caption,
  provider,
  tag,
  active,
  pending,
  onOpen,
  onAdoptNow,
  onMute,
  onHarvest,
}: {
  title: string;
  caption: string;
  provider: string;
  tag?: string;
  active?: boolean;
  /** Open as a transient peek — italic until adopted or switched away. */
  pending?: boolean;
  onOpen: () => void;
  /** Double-click: skip the pending stage and adopt immediately. */
  onAdoptNow?: () => void;
  /** "See less of these" — learn a mute filter from this row (also on
   *  right-click). */
  onMute?: () => void;
  onHarvest: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md pr-1",
            active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
          )}
        >
          <button
            type="button"
            onClick={onOpen}
            onDoubleClick={onAdoptNow}
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
          >
            <ProviderBadge provider={provider} />
            <span className="min-w-0 flex-1">
              <span
                className={cn("block truncate type-list", pending && "italic")}
              >
                {title}
              </span>
              <span className="block truncate type-caption">{caption}</span>
            </span>
            {tag && <span className="shrink-0 type-label">{tag}</span>}
          </button>
          {/* Visible "…" kebab (matches the sidebar SessionMenu) — the
              discoverable home for "See less of these" and Harvest. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground"
                aria-label={`${vocab.job} actions`}
                title="Actions"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {onMute && (
                <DropdownMenuItem onClick={onMute}>
                  <EyeOffIcon /> See less of these
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onHarvest}>
                <WheatIcon /> {vocab.harvest}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      {/* Same actions on native right-click. */}
      <ContextMenuContent className="w-56">
        {onMute && (
          <ContextMenuItem onClick={onMute}>
            <EyeOffIcon /> See less of these
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={onHarvest}>
          <WheatIcon /> {vocab.harvest}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function JobsList({
  rows,
  activeId,
  activeOriginPath,
  hasMore,
  onLoadMore,
  onOpen,
  onOpenNative,
  onAdoptNative,
  notify,
}: {
  /** Farm session metas, already deduped by the parent (source of truth). */
  rows: FarmSessionMeta[];
  activeId?: string;
  /** Origin path of the active session when it is a native peek — highlights
   *  the native row that is being previewed. */
  activeOriginPath?: string;
  /** Whether the bridge store has more Farm pages beyond `rows`. */
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  onOpenNative: (session: AgentSessionSummary) => void;
  /** Double-click on a native row: adopt into the Farm immediately. */
  onAdoptNative: (session: AgentSessionSummary) => void;
  notify: (message: string) => void;
}) {
  const [filter, setFilter] = useState<JobsFilter>("all");
  const [natives, setNatives] = useState<AgentSessionSummary[] | null>(null);
  const [nativeLimit, setNativeLimit] = useState(NATIVE_SLICE);
  const [clock, setClock] = useState(Date.now());
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchNatives = () => {
    if (!hasNativeBridge()) {
      setNatives([]);
      return;
    }
    invokeNative<AgentSessionIndex>("farm.history.list", { anyCwd: true })
      .then((index) => setNatives(index.sessions || []))
      .catch(() => setNatives([]));
  };
  useEffect(fetchNatives, []);

  /** "See less of these": learn a mute filter from this row's prompt head —
   *  the backend hides every native session that starts the same way. */
  const muteNative = (session: AgentSessionSummary) => {
    const head = session.prompt.split("\n")[0].trim();
    if (head.length < 8) {
      notify("Not enough prompt text to build a filter from.");
      return;
    }
    invokeNative<{ head?: string }>("farm.history.mute", { prompt: head })
      .then((result) => {
        notify(
          `Hiding ${vocab.jobs.toLowerCase()} starting “${(result?.head || head).slice(0, 48)}…” (undo in jobs-filters.json)`,
        );
        fetchNatives();
      })
      .catch((error) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  };

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Adopted transcripts already appear as Farm rows — hide their native twin.
  const adoptedPaths = useMemo(
    () => new Set(rows.map((meta) => meta.originPath).filter(Boolean)),
    [rows],
  );
  // Hide test-handover rows: anything whose displayed title starts with
  // "rollout-" (CI/agent smoke-test handovers). Match on the same string the
  // UI renders so an empty title with a prefixed prompt/output still hides.
  const isTestHandover = (value: string) =>
    value.trimStart().toLowerCase().startsWith("rollout-");
  const farmVisible = (
    filter === "all" || filter === "farm"
      ? rows
      : rows.filter((meta) => farmProvider(meta) === filter)
  ).filter((meta) => !isTestHandover(meta.title));
  const nativesVisible = (
    filter === "farm"
      ? []
      : (natives || []).filter(
          (session) => filter === "all" || session.provider === filter,
        )
  )
    .filter((session) => !adoptedPaths.has(session.sourcePath))
    .filter((session) => !isTestHandover(nativeTitle(session)));
  const nativeSlice = nativesVisible.slice(0, nativeLimit);
  const nativeHasMore = nativesVisible.length > nativeLimit;

  const merged = useMemo<JobRow[]>(() => {
    const items: JobRow[] = [
      ...farmVisible.map((meta) => ({
        key: `farm:${meta.id}`,
        kind: "farm" as const,
        meta,
      })),
      ...nativeSlice.map((session) => ({
        key: `native:${session.id}`,
        kind: "native" as const,
        session,
      })),
    ];
    const stamp = (row: JobRow) =>
      row.kind === "farm" ? row.meta.updatedAt : row.session.updatedAt;
    return items.sort((a, b) => stamp(b).localeCompare(stamp(a)));
  }, [farmVisible, nativeSlice]);

  // Lazy loading: one sentinel grows both sources. State guards keep an
  // always-visible sentinel from looping once a source is exhausted.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (hasMore) onLoadMore();
      if (nativeHasMore) setNativeLimit((limit) => limit + NATIVE_SLICE);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, nativeHasMore, onLoadMore]);

  const harvest = (payload: { sessionId: string } | { sessionPath: string }) => {
    invokeNative<{ started?: boolean }>("farm.harvest.scan", payload)
      .then((result) =>
        notify(
          result?.started
            ? `${vocab.harvest} started.`
            : `${vocab.harvest} is already running.`,
        ),
      )
      .catch((error) =>
        notify(error instanceof Error ? error.message : String(error)),
      );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-3">
        <span className="type-label">{vocab.jobs}</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-md px-2 py-1 type-list transition-colors",
              filter === value
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {merged.map((row) =>
            row.kind === "farm" ? (
              <JobRowItem
                key={row.key}
                title={row.meta.title || `New ${vocab.job.toLowerCase()}`}
                caption={[
                  farmProvider(row.meta) || row.meta.model || vocab.job,
                  row.meta.model.includes("/")
                    ? row.meta.model.split("/")[1]
                    : "",
                  relativeTime(row.meta.updatedAt, clock),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                provider={farmProvider(row.meta)}
                tag={
                  row.meta.source && row.meta.source !== "farm"
                    ? row.meta.source
                    : undefined
                }
                active={row.meta.id === activeId}
                onOpen={() => onOpen(row.meta.id)}
                onHarvest={() => harvest({ sessionId: row.meta.id })}
              />
            ) : (
              <JobRowItem
                key={row.key}
                title={nativeTitle(row.session)}
                caption={[
                  row.session.provider,
                  row.session.account,
                  relativeTime(row.session.updatedAt, clock),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                provider={row.session.provider}
                // activeOriginPath is only set while the open session is a
                // transient peek — that row reads as pending, not native.
                tag={
                  row.session.sourcePath === activeOriginPath
                    ? "pending"
                    : "native"
                }
                active={row.session.sourcePath === activeOriginPath}
                pending={row.session.sourcePath === activeOriginPath}
                onOpen={() => onOpenNative(row.session)}
                onAdoptNow={() => onAdoptNative(row.session)}
                onMute={() => muteNative(row.session)}
                onHarvest={() => harvest({ sessionPath: row.session.sourcePath })}
              />
            ),
          )}
          {!merged.length && (
            <p className="px-2 py-2 type-caption">
              {natives === null
                ? `Loading ${vocab.jobs.toLowerCase()}…`
                : `No ${vocab.jobs.toLowerCase()} yet.`}
            </p>
          )}
          {(hasMore || nativeHasMore) && (
            <div ref={sentinelRef} aria-hidden className="h-6 shrink-0" />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
