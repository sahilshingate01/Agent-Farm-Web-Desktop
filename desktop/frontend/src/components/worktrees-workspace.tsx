import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudDownloadIcon,
  CodeIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  GitMergeIcon,
  ListRestartIcon,
  MoreHorizontalIcon,
  PaintbrushIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import { BentoGrid, type BentoPanelSpec } from "@/components/bento-grid";
import { MergeDialog, type Worktree } from "@/components/worktrees-panel";
import { TerminalPane } from "@/components/terminal-pane";
import { vocab } from "@/lib/vocabulary";
import type { FarmAccount } from "@/types/farm";

/** Wire shapes of farm.worktree.status / .branches (controller.mjs). */
interface WorktreeFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | string;
  additions: number | null;
  deletions: number | null;
}
interface WorktreeStatus {
  dir: string;
  branch: string;
  target: string | null;
  ahead: number | null;
  behind: number | null;
  additions: number;
  deletions: number;
  files: WorktreeFileChange[];
  commits: { hash: string; subject: string; at: string | null }[];
  stashes: number;
}
interface BranchList {
  root: string;
  repo: string;
  current: string | null;
  branches: { name: string; updatedAt: string | null; pushed: boolean }[];
}
interface GraphCommit {
  hash: string;
  t: number;
  subject: string;
}
interface GraphLane {
  name: string;
  branch: string;
  silo: string | null;
  dirty: boolean;
  base: { hash: string; t: number | null } | null;
  commits: GraphCommit[];
}
interface GraphData {
  target: { name: string; commits: GraphCommit[] } | null;
  lanes: GraphLane[];
}
/** farm.crew.* assignment — rows link to worktrees via paddockId. */
interface CrewLink {
  id: string;
  title: string;
  status: string;
  paddockId?: string | null;
}
/** farm.worktree.mergeability row — merge risk vs the workspace branch. */
interface MergeRisk {
  dir: string;
  target: string;
  ahead: number;
  behind: number;
  canFastForward: boolean;
  conflicts: string[];
  alreadyMerged: boolean;
}

function relativeTime(iso: string | null | undefined) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const FILE_STATUS: Record<string, { letter: string; tone: string }> = {
  modified: { letter: "M", tone: "text-primary" },
  added: { letter: "A", tone: "text-(--success)" },
  untracked: { letter: "U", tone: "text-(--success)" },
  deleted: { letter: "D", tone: "text-destructive" },
  renamed: { letter: "R", tone: "text-muted-foreground" },
};

function Stat({
  label,
  value,
  sub,
  mono,
  signal,
}: {
  label: string;
  value: ReactNode;
  sub: string;
  mono?: boolean;
  signal?: boolean;
}) {
  return (
    <article className={cn("min-w-0 p-4", signal && "bg-signal/[0.05]")}>
      <p className={cn("type-label", signal && "text-signal")}>{label}</p>
      <p
        className={cn(
          "mt-2 truncate text-[1.286rem] font-semibold leading-tight tracking-[-0.02em]",
          mono && "font-mono",
          signal && "text-signal",
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate type-caption">{sub}</p>
    </article>
  );
}

/** Branch/worktree graph — first-parent lanes on a shared time axis
 *  (percent x-coords keep the SVG responsive without measurement). The
 *  workspace branch rides the top lane; each worktree forks off its
 *  merge-base, runs solid through its commits, then dashes to "now" with a
 *  hollow marker when uncommitted work is sitting in the checkout. */
const LANE_COLORS = ["var(--signal)", "var(--success)", "var(--muted-foreground)", "var(--destructive)"];
const LANE_H = 44;

interface GraphHover {
  rowKey: string;
  color: string;
  branch: string;
  commit: GraphCommit;
  x: number;
  y: number;
  width: number;
}

function WorktreeGraph({
  graph,
  riskByName,
  selectedName,
  focusLane,
  focusHash,
  onPeek,
  onSelectName,
}: {
  graph: GraphData;
  riskByName: Record<string, MergeRisk | undefined>;
  selectedName: string | null;
  /** Cross-panel focus: a worktree name (lane) and/or commit hash hovered
   *  elsewhere on the page — the matching lane stays lit, the rest dim. */
  focusLane: string | null;
  focusHash: string | null;
  onPeek?: (peek: { laneName: string | null; hash: string } | null) => void;
  onSelectName: (name: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<GraphHover | null>(null);
  // A lane's first-parent log walks past its fork into target history —
  // show only the commits that are NOT on the target's first-parent line
  // (a merged lane's own commits stay visible; inherited ones drop).
  const targetHashes = new Set((graph.target?.commits || []).map((commit) => commit.hash));
  const ownCommits = (lane: GraphLane) => {
    const own = lane.commits.filter((commit) => !targetHashes.has(commit.hash));
    return own.length ? own : lane.commits.slice(0, 1);
  };
  // Most recent fork sits nearest the workspace lane — forks and the
  // merged-back join then travel the fewest rows.
  const lanes = graph.lanes
    .filter((lane) => lane.commits.length)
    .sort((a, b) => (b.base?.t ?? 0) - (a.base?.t ?? 0));
  const rows = [
    ...(graph.target
      ? [{ key: "__target", label: graph.target.name, color: "var(--primary)", lane: null as GraphLane | null }]
      : []),
    ...lanes.map((lane, index) => ({
      key: lane.name,
      label: lane.branch,
      color: LANE_COLORS[index % LANE_COLORS.length],
      lane,
    })),
  ];
  const times = [
    ...(graph.target?.commits || []).map((commit) => commit.t),
    ...lanes.flatMap((lane) => [
      ...ownCommits(lane).map((commit) => commit.t),
      ...(lane.base?.t ? [lane.base.t] : []),
    ]),
  ].filter((t) => Number.isFinite(t) && t > 0);
  if (!rows.length || !times.length) return null;
  const min = Math.min(...times);
  const max = Date.now();
  const x = (t: number) => `${max <= min ? 50 : 5 + ((t - min) / (max - min)) * 89}%`;
  const rowY = (index: number) => index * LANE_H + LANE_H / 2;
  const targetY = rowY(0);
  const rowCommits = (row: (typeof rows)[number]) =>
    row.lane ? ownCommits(row.lane) : graph.target?.commits || [];
  const externalKey = focusHash
    ? rows.find((row) => rowCommits(row).some((commit) => commit.hash === focusHash))?.key ?? null
    : focusLane
      ? rows.find((row) => (row.lane ? row.lane.name : null) === focusLane)?.key ?? null
      : null;
  const activeKey = hover?.rowKey ?? externalKey;
  const litHash = hover?.commit.hash ?? focusHash;

  const hoverCommit = (rowKey: string, color: string, branch: string, commit: GraphCommit) =>
    (event: ReactMouseEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHover({
        rowKey,
        color,
        branch,
        commit,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
      });
    };

  return (
    <div
      ref={wrapRef}
      className="relative flex min-w-[36rem]"
      onMouseLeave={() => {
        setHover(null);
        onPeek?.(null);
      }}
    >
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-60 rounded-lg border bg-popover p-2.5 shadow-lg"
          style={{
            left: Math.min(Math.max(hover.x + 14, 8), hover.width - 252),
            top: Math.max(hover.y - 86, 4),
          }}
        >
          <p className="truncate type-caption text-foreground">{hover.commit.subject}</p>
          <p className="mt-1 flex items-center gap-2 type-caption">
            <span className="font-mono">{hover.commit.hash}</span>
            <span>{relativeTime(new Date(hover.commit.t).toISOString()) || ""}</span>
          </p>
          <p className="mt-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono type-caption"
              style={{ color: hover.color, borderColor: `color-mix(in oklab, ${hover.color} 40%, transparent)` }}
            >
              <GitBranchIcon className="size-3" />
              {hover.branch}
            </span>
          </p>
        </div>
      )}
      <div className="flex w-56 shrink-0 flex-col border-r">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            disabled={!row.lane}
            onClick={() => row.lane && onSelectName(row.lane.name)}
            className="flex items-center gap-2 px-3 text-left"
            style={{ height: LANE_H }}
          >
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-1.5 truncate rounded-md border px-1.5 py-0.5 font-mono type-caption",
                row.lane && selectedName === row.lane.name && "ring-1 ring-primary/40",
                activeKey === row.key && "ring-1 ring-current",
              )}
              style={{
                color: row.color,
                borderColor: `color-mix(in oklab, ${row.color} 40%, transparent)`,
              }}
            >
              <GitBranchIcon className="size-3 shrink-0" />
              <span className="truncate">{row.label}</span>
            </span>
            {row.lane ? (
              <span className="type-label shrink-0">WT</span>
            ) : (
              <span className="shrink-0 type-caption">workspace</span>
            )}
          </button>
        ))}
      </div>
      <svg className="min-w-0 flex-1" style={{ height: rows.length * LANE_H }} role="img" aria-label="Branch and worktree commit graph">
        {rows.map((row, index) => {
          const y = rowY(index);
          const commits = row.lane ? ownCommits(row.lane) : graph.target?.commits || [];
          if (!commits.length) return null;
          const newest = Math.max(...commits.map((commit) => commit.t));
          const oldest = Math.min(...commits.map((commit) => commit.t));
          return (
            <g
              key={row.key}
              opacity={activeKey && activeKey !== row.key ? 0.3 : 1}
              className="transition-opacity"
            >
              {row.lane?.base?.t != null && (
                <line
                  x1={x(row.lane.base.t)}
                  y1={targetY}
                  x2={x(oldest)}
                  y2={y}
                  stroke={row.color}
                  strokeOpacity="0.45"
                  strokeWidth="1.5"
                />
              )}
              {(() => {
                const risk = row.lane ? riskByName[row.lane.name] : undefined;
                const merged = Boolean(row.lane && risk?.alreadyMerged);
                const joinT = Math.min(newest + (max - min) * 0.04, max);
                return (
                  <>
                    <line x1={x(oldest)} y1={y} x2={x(newest)} y2={y} stroke={row.color} strokeOpacity="0.7" strokeWidth="2" />
                    {merged ? (
                      /* Every commit is in the target — draw the lane joining
                         back into the workspace branch, like a landed merge. */
                      <line x1={x(newest)} y1={y} x2={x(joinT)} y2={targetY} stroke={row.color} strokeOpacity="0.55" strokeWidth="1.5" />
                    ) : (
                      <line
                        x1={x(newest)}
                        y1={y}
                        x2="96%"
                        y2={y}
                        stroke={row.color}
                        strokeOpacity="0.3"
                        strokeWidth="1.5"
                        strokeDasharray="4 5"
                      />
                    )}
                    {!merged && row.lane?.dirty && !risk?.conflicts.length && (
                      <circle cx="96%" cy={y} r="4.5" fill="none" stroke={row.color} strokeWidth="1.5" strokeOpacity="0.8">
                        <title>uncommitted changes in the checkout</title>
                      </circle>
                    )}
                    {!merged && (risk?.conflicts.length ?? 0) > 0 && (
                      <g>
                        <circle cx="96%" cy={y} r="6" fill="var(--destructive)">
                          <title>{`would conflict merging into ${risk?.target}:\n${risk?.conflicts.join("\n")}`}</title>
                        </circle>
                        <text
                          x="96%"
                          y={y + 3}
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight="700"
                          fill="var(--background)"
                        >
                          !
                        </text>
                      </g>
                    )}
                  </>
                );
              })()}
              {commits.map((commit) => {
                const isHovered = litHash === commit.hash;
                return (
                  <g key={commit.hash}>
                    {isHovered && (
                      <circle cx={x(commit.t)} cy={y} r="10" fill="none" stroke={row.color} strokeOpacity="0.45" strokeWidth="2" />
                    )}
                    <circle
                      cx={x(commit.t)}
                      cy={y}
                      r={isHovered ? 6.5 : 4.5}
                      fill={isHovered ? row.color : "var(--card)"}
                      stroke={row.color}
                      strokeWidth="2"
                    />
                    {/* Fat invisible hit target — the visible dot is too
                        small to hover reliably. */}
                    <circle
                      cx={x(commit.t)}
                      cy={y}
                      r="11"
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={(event) => {
                        hoverCommit(row.key, row.color, row.label, commit)(event);
                        onPeek?.({ laneName: row.lane ? row.lane.name : null, hash: commit.hash });
                      }}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="type-label leading-6">{label}</dt>
      <dd className="min-w-0 truncate type-caption leading-6 text-foreground">{children}</dd>
    </>
  );
}

/**
 * The Worktrees workspace — full-page WT interface (from Sahil Shingate's reference
 * mock): stat strip, worktree rows with inline actions, per-worktree
 * terminal, and a detail rail (overview, live changes, recent commits,
 * local notes). Everything binds farm.worktree.* — panels whose data has
 * no backend yet (PRs, graph) were cut, not faked.
 */
export function WorktreesWorkspace({
  accounts,
  onNotify,
}: {
  accounts: FarmAccount[];
  onNotify: (message: string) => void;
}) {
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [mergeFor, setMergeFor] = useState<Worktree | null>(null);
  const [terminalDir, setTerminalDir] = useState<string | null>(null);
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const disarmTimer = useRef<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [silo, setSilo] = useState("");
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [crew, setCrew] = useState<CrewLink[]>([]);
  const [risks, setRisks] = useState<Map<string, MergeRisk>>(new Map());
  const [syncing, setSyncing] = useState<"fetch" | "pull" | null>(null);
  /** Cross-panel hover focus — rows, activity, rail commits and graph dots
   *  all set this, and everything that can relate to it lights up. */
  const [peek, setPeek] = useState<{ dir?: string | null; name?: string | null; hash?: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await invokeNative<{ worktrees: Worktree[] }>("farm.worktree.list");
      setWorktrees(result.worktrees);
      setSelectedDir((current) =>
        current && result.worktrees.some((worktree) => worktree.dir === current)
          ? current
          : result.worktrees[0]?.dir || null,
      );
    } catch {
      setWorktrees([]);
    }
    try {
      setBranches(await invokeNative<BranchList>("farm.worktree.branches"));
    } catch {
      setBranches(null);
    }
    try {
      setGraph(await invokeNative<GraphData>("farm.worktree.graph"));
    } catch {
      setGraph(null);
    }
    try {
      const result = await invokeNative<{ assignments: CrewLink[] }>("farm.crew.list");
      setCrew(result.assignments);
    } catch {
      setCrew([]);
    }
    try {
      const result = await invokeNative<{ target: string | null; rows: MergeRisk[] }>(
        "farm.worktree.mergeability",
      );
      setRisks(new Map(result.rows.map((row) => [row.dir, row])));
    } catch {
      setRisks(new Map());
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, epoch]);
  useEffect(
    () => () => {
      if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    },
    [],
  );

  const selected = worktrees?.find((worktree) => worktree.dir === selectedDir) || null;
  const terminalWorktree = worktrees?.find((worktree) => worktree.dir === terminalDir) || null;

  useEffect(() => {
    setStatus(null);
    setStatusError(null);
    if (!selectedDir) return;
    let cancelled = false;
    invokeNative<WorktreeStatus>("farm.worktree.status", { dir: selectedDir })
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch((error) => {
        if (!cancelled) setStatusError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDir, worktrees]);

  useEffect(() => {
    setNote(selectedDir ? localStorage.getItem(`usage-farm-wt-note:${selectedDir}`) || "" : "");
  }, [selectedDir]);
  const saveNote = () => {
    if (!selectedDir) return;
    localStorage.setItem(`usage-farm-wt-note:${selectedDir}`, note);
    onNotify("Note saved.");
  };

  const changed = () => {
    setEpoch((value) => value + 1);
    window.dispatchEvent(new Event("agensis:worktrees-changed"));
  };

  const openCreate = () => {
    setCreateOpen(true);
    setBranch(branches?.current || branches?.branches[0]?.name || "");
    if (!silo) setSilo(accounts[0]?.name || "");
  };
  const create = async () => {
    if (!branch || !silo) return;
    setCreating(true);
    try {
      await invokeNative("farm.worktree.create", { branch, silo });
      setCreateOpen(false);
      changed();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };
  const armRemove = (dir: string) => {
    setArmedRemove(dir);
    if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setArmedRemove(null), 4000);
  };
  const remove = async (dir: string) => {
    setArmedRemove(null);
    try {
      await invokeNative("farm.worktree.remove", { dir });
      if (terminalDir === dir) setTerminalDir(null);
      changed();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };

  const existing = (worktrees || []).filter((worktree) => worktree.exists);
  const totalDirty = existing.reduce((sum, worktree) => sum + (worktree.changedFiles || 0), 0);
  const crewFor = (dir: string) => crew.find((item) => item.paddockId === dir && item.status !== "done");
  const peekDir =
    peek?.dir ?? (peek?.name ? (worktrees || []).find((worktree) => worktree.name === peek.name)?.dir ?? null : null);

  const fetchAll = async () => {
    setSyncing("fetch");
    try {
      await invokeNative("farm.worktree.fetch");
      onNotify("Fetched all remotes.");
      setEpoch((value) => value + 1);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(null);
    }
  };
  const pullWorkspace = async () => {
    setSyncing("pull");
    try {
      await invokeNative("farm.worktree.pull", {});
      onNotify(`Pulled ${branches?.current || "the workspace"} fast-forward.`);
      setEpoch((value) => value + 1);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(null);
    }
  };

  // Activity feed — real events only: worktree creations + the workspace
  // branch's recent commits (from the graph payload).
  const activity = useMemo(() => {
    const events: { t: number; text: string; created?: boolean; dir?: string; name?: string; hash?: string }[] = [];
    for (const worktree of worktrees || []) {
      const t = worktree.createdAt ? Date.parse(worktree.createdAt) : NaN;
      if (Number.isFinite(t))
        events.push({
          t,
          text: `Created worktree ${worktree.name} (${worktree.branch})`,
          created: true,
          dir: worktree.dir,
          name: worktree.name,
        });
    }
    for (const commit of graph?.target?.commits.slice(0, 8) || []) {
      events.push({ t: commit.t, text: `${commit.hash} ${commit.subject} — ${graph?.target?.name}`, hash: commit.hash });
    }
    return events.sort((a, b) => b.t - a.t).slice(0, 12);
  }, [worktrees, graph]);

  // Honest automation hints, derived from the selected worktree's status
  // and its live merge risk.
  const suggestions = useMemo(() => {
    if (!status) return [];
    const risk = selectedDir ? risks.get(selectedDir) : undefined;
    const items: { Icon: typeof GitMergeIcon; tone?: string; text: string }[] = [];
    if (risk?.conflicts.length)
      items.push({
        Icon: AlertTriangleIcon,
        tone: "text-destructive",
        text: `${risk.conflicts.length} file${risk.conflicts.length === 1 ? "" : "s"} would conflict merging into ${risk.target}: ${risk.conflicts.slice(0, 3).join(", ")}${risk.conflicts.length > 3 ? "…" : ""}`,
      });
    if (risk && !risk.conflicts.length && !risk.alreadyMerged && risk.canFastForward)
      items.push({
        Icon: CheckIcon,
        tone: "text-(--success)",
        text: `Fast-forwards cleanly onto ${risk.target} — a merge is a no-risk move.`,
      });
    if ((status.ahead ?? 0) > 0 && !status.files.length)
      items.push({
        Icon: GitMergeIcon,
        text: `${status.ahead} commit${status.ahead === 1 ? "" : "s"} ahead of ${status.target} with a clean tree — ready to merge back.`,
      });
    if (status.files.length)
      items.push({
        Icon: AlertTriangleIcon,
        tone: "text-signal",
        text: "Uncommitted changes — have the silo commit before merging back.",
      });
    if ((status.behind ?? 0) > 3)
      items.push({
        Icon: RefreshCwIcon,
        text: `${status.behind} commits behind ${status.target} — consider a fresh worktree off ${status.target}.`,
      });
    if (status.stashes > 0)
      items.push({
        Icon: ArchiveIcon,
        text: `${status.stashes} stash${status.stashes === 1 ? "" : "es"} parked in this checkout.`,
      });
    return items;
  }, [status, risks, selectedDir]);

  return (
    <>
      {/* Same header anatomy as PageHeader (App.tsx) — title + caption, blue for actions. */}
      <header className="flex items-end justify-between gap-8 border-b bg-background/90 px-8 pb-6 pt-10">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate type-title leading-none">{branches?.repo || vocab.paddocks}</h1>
          <p className="mt-1 max-w-2xl truncate font-mono type-caption">
            {branches?.root || "Isolated branch checkouts, one per silo."}
          </p>
        </div>
        <div className="no-drag flex shrink-0 items-center gap-2">
          {branches?.current && (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 font-mono type-caption">
              <GitBranchIcon className="size-3.5" />
              {branches.current}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <PlusIcon data-icon="inline-start" />
            Add worktree
          </Button>
        </div>
      </header>

      {/* The mock's app toolbar lives inside the working area — the left
          sidebar and top bar stay claude-farm chrome. Buttons without a
          backend are disabled, not faked. */}
      <div className="no-drag flex items-center gap-1 overflow-x-auto border-b bg-background/90 px-6 py-2 scrollbar-none">
        <Button variant="ghost" size="sm" onClick={openCreate}>
          <PlusIcon data-icon="inline-start" />
          Create worktree
        </Button>
        <Button variant="ghost" size="sm" disabled title="Branch creation backend coming">
          <GitBranchPlusIcon data-icon="inline-start" />
          New branch
        </Button>
        <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="sm" disabled={syncing !== null} onClick={() => void fetchAll()}>
          <CloudDownloadIcon data-icon="inline-start" className={cn(syncing === "fetch" && "animate-pulse")} />
          Fetch
        </Button>
        <Button variant="ghost" size="sm" disabled={syncing !== null} onClick={() => void pullWorkspace()}>
          <ArrowDownToLineIcon data-icon="inline-start" className={cn(syncing === "pull" && "animate-pulse")} />
          Pull
        </Button>
        <Button variant="ghost" size="sm" disabled title="Rebase backend coming">
          <ListRestartIcon data-icon="inline-start" />
          Rebase
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!selected}
          onClick={() => selected && setMergeFor(selected)}
        >
          <GitMergeIcon data-icon="inline-start" />
          Merge
        </Button>
        <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="sm" disabled title="IDE hook coming">
          <CodeIcon data-icon="inline-start" />
          Open in IDE
        </Button>
        <Button variant="ghost" size="sm" disabled title="Cleanup backend coming">
          <PaintbrushIcon data-icon="inline-start" />
          Clean up
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-none min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-[86rem] flex-col gap-4">
            <BentoGrid
              storageKey="usage-farm-wt-bento-v1"
              panels={[
                {
                  // Headerless card — the segmented stat bar brings its own grid.
                  id: "stats",
                  w: 12,
                  h: 2,
                  minW: 6,
                  minH: 2,
                  content: (
              <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
              <Stat
                label="Current branch"
                value={branches?.current || "—"}
                sub="workspace checkout"
                mono
              />
              <Stat
                label="Dirty files"
                value={String(totalDirty)}
                sub={`across ${existing.length} ${existing.length === 1 ? "worktree" : "worktrees"}`}
                signal={totalDirty > 0}
              />
              <Stat
                label="Ahead / behind"
                value={
                  status && status.ahead != null ? (
                    <>
                      <span className="text-(--success)">↑{status.ahead}</span>{" "}
                      <span className={cn((status.behind || 0) > 0 && "text-signal")}>
                        ↓{status.behind}
                      </span>
                    </>
                  ) : (
                    "—"
                  )
                }
                sub={
                  status?.target && selected
                    ? `${selected.name} vs ${status.target}`
                    : "select a worktree"
                }
              />
              <Stat
                label="Active worktrees"
                value={`${existing.length}/${(worktrees || []).length}`}
                sub="checkouts on disk"
              />
              <Stat
                label="Stashes"
                value={status ? String(status.stashes) : "—"}
                sub={selected ? selected.name : "select a worktree"}
              />
              </div>
                  ),
                },
                {
                  id: "worktrees",
                  title: vocab.paddocks,
                  caption: "Isolated branch checkouts, one per silo — click a row for detail.",
                  w: 12,
                  h: 4,
                  minW: 6,
                  minH: 3,
                  content: (
              <div className="flex flex-col gap-2 p-4">
                {worktrees && !worktrees.length && (
                  <div className="grid min-h-[8rem] place-items-center gap-3 p-6">
                    <p className="text-center type-caption">
                      No worktrees yet. Create one to give a silo an isolated checkout
                      of a branch — work stays out of your main tree.
                    </p>
                    <Button variant="outline" size="sm" onClick={openCreate}>
                      <PlusIcon className="size-3.5" />
                      New worktree
                    </Button>
                  </div>
                )}
                {(worktrees || []).map((worktree) => {
                  const isSelected = selectedDir === worktree.dir;
                  const armed = armedRemove === worktree.dir;
                  const dirty = worktree.changedFiles || 0;
                  const age = relativeTime(worktree.createdAt);
                  const job = crewFor(worktree.dir);
                  const risk = risks.get(worktree.dir);
                  return (
                    <article
                      key={worktree.dir}
                      onClick={() => setSelectedDir(worktree.dir)}
                      onMouseEnter={() => setPeek({ dir: worktree.dir, name: worktree.name })}
                      onMouseLeave={() => setPeek(null)}
                      className={cn(
                        "group grid cursor-pointer grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-background px-4 py-3 transition-colors hover:bg-muted/40",
                        isSelected && "border-primary/50 ring-1 ring-primary/25 hover:bg-background",
                        !isSelected && peekDir === worktree.dir && "border-primary/30 bg-muted/40",
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 justify-self-center rounded-full",
                          !worktree.exists
                            ? "bg-muted-foreground/40"
                            : dirty > 0
                              ? "bg-signal"
                              : "bg-success",
                        )}
                        title={!worktree.exists ? "missing on disk" : dirty > 0 ? "uncommitted changes" : "clean"}
                      />
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-2">
                          <span className="truncate type-list font-medium">{worktree.name}</span>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono type-caption">
                            <GitBranchIcon className="size-3" />
                            {worktree.branch}
                          </span>
                          {worktree.silo && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 type-caption">
                              <ServerIcon className="size-3" />
                              {worktree.silo}
                            </span>
                          )}
                          {job && (
                            <span
                              className="inline-flex min-w-0 shrink items-center gap-1 truncate rounded-md bg-primary/10 px-1.5 py-0.5 type-caption text-primary"
                              title={`Crew: ${job.title} (${job.status})`}
                            >
                              {job.title}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate font-mono type-caption">
                          {worktree.path || worktree.dir}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {risk &&
                          (risk.conflicts.length ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 type-caption text-destructive"
                              title={`Would conflict with ${risk.target}:\n${risk.conflicts.join("\n")}`}
                            >
                              <AlertTriangleIcon className="size-3" />
                              {risk.conflicts.length} conflict{risk.conflicts.length === 1 ? "" : "s"}
                            </span>
                          ) : risk.alreadyMerged ? (
                            <span className="rounded-md bg-muted/60 px-1.5 py-0.5 type-caption" title={`No commits beyond ${risk.target}`}>
                              merged
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 type-caption text-(--success)"
                              title={`${risk.ahead} ahead · ${risk.behind} behind ${risk.target}`}
                            >
                              <CheckIcon className="size-3" />
                              {risk.canFastForward ? "fast-forward" : "clean merge"}
                            </span>
                          ))}
                        <span className="font-mono type-caption tabular-nums">
                          {worktree.exists ? (
                            dirty > 0 ? (
                              <>
                                <span className="text-signal">{dirty}</span>{" "}
                                <span className="text-(--success)">+{worktree.additions ?? 0}</span>{" "}
                                <span className="text-destructive">−{worktree.deletions ?? 0}</span>
                              </>
                            ) : (
                              <span className="text-(--success)">clean</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">missing</span>
                          )}
                        </span>
                        {age && <span className="type-caption">{age}</span>}
                        <span className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              setTerminalDir(worktree.dir);
                            }}
                          >
                            <TerminalIcon className="size-3" />
                            Terminal
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMergeFor(worktree);
                            }}
                          >
                            <GitMergeIcon className="size-3" />
                            Merge
                          </Button>
                          {armed ? (
                            <Button
                              variant="destructive"
                              size="xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                void remove(worktree.dir);
                              }}
                            >
                              Click again to remove
                            </Button>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`Actions for ${worktree.name}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <MoreHorizontalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => armRemove(worktree.dir)}
                                >
                                  Remove…
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
                  ),
                },
                {
                  id: "graph",
                  title: "Branch / worktree graph",
                  caption: `First-parent history per lane — each worktree forks from its merge-base with ${graph?.target?.name || "the workspace branch"}; hollow marker = uncommitted work.`,
                  w: 12,
                  h: 4,
                  minW: 6,
                  minH: 3,
                  content:
                    graph && (graph.target?.commits.length || graph.lanes.some((lane) => lane.commits.length)) ? (
                <div className="overflow-x-auto py-3 pr-2">
                  <WorktreeGraph
                    graph={graph}
                    riskByName={Object.fromEntries(
                      (worktrees || []).map((worktree) => [worktree.name, risks.get(worktree.dir)]),
                    )}
                    focusLane={peek?.name ?? null}
                    focusHash={peek?.hash ?? null}
                    onPeek={(value) => setPeek(value ? { name: value.laneName, hash: value.hash } : null)}
                    selectedName={selected?.name || null}
                    onSelectName={(name) => {
                      const match = (worktrees || []).find((worktree) => worktree.name === name);
                      if (match) setSelectedDir(match.dir);
                    }}
                  />
                </div>
                    ) : (
                      <p className="px-5 py-6 type-caption">No commit history to draw yet.</p>
                    ),
                },
                {
                  id: "terminal",
                  title: terminalWorktree ? `Terminal — ${terminalWorktree.name}` : "Terminal",
                  actions: terminalWorktree ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Close terminal"
                      onClick={() => setTerminalDir(null)}
                    >
                      <XIcon />
                    </Button>
                  ) : undefined,
                  w: 6,
                  h: 5,
                  minW: 4,
                  minH: 3,
                  content: (
                    <div className="flex min-h-0 flex-1 flex-col">
                  {terminalWorktree ? (
                    <div className="min-h-64 flex-1 p-2">
                      <TerminalPane
                        projectRoot={terminalWorktree.path || undefined}
                        sessionId={`wt:${terminalWorktree.dir}`}
                        initialCommand={
                          terminalWorktree.path
                            ? `cd '${terminalWorktree.path.replace(/'/g, `'\\''`)}'`
                            : undefined
                        }
                      />
                    </div>
                  ) : (
                    <p className="px-5 py-6 type-caption">
                      Open a terminal from a worktree row — it lands in that checkout.
                    </p>
                  )}
                    </div>
                  ),
                },
                {
                  id: "activity",
                  title: "Activity",
                  caption: "Worktree creations and the workspace branch's recent commits.",
                  w: 6,
                  h: 5,
                  minW: 4,
                  minH: 3,
                  content: (
                  <div className="flex-1 overflow-y-auto">
                    {activity.length ? (
                      activity.map((event, index) => (
                        <div
                          key={index}
                          onMouseEnter={() => setPeek({ dir: event.dir, name: event.name, hash: event.hash })}
                          onMouseLeave={() => setPeek(null)}
                          onClick={() => event.dir && setSelectedDir(event.dir)}
                          className={cn(
                            "flex items-center gap-2.5 border-b px-5 py-2 transition-colors last:border-b-0",
                            event.dir && "cursor-pointer",
                            Boolean((event.dir && peekDir === event.dir) || (event.hash && peek?.hash === event.hash)) &&
                              "bg-muted/50",
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              event.created ? "bg-success" : "bg-primary/60",
                            )}
                          />
                          <span className="w-16 shrink-0 type-caption">
                            {relativeTime(new Date(event.t).toISOString()) || ""}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono type-caption text-foreground">
                            {event.text}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="px-5 py-6 type-caption">No activity yet.</p>
                    )}
                  </div>
                  ),
                },
              ]}
            />
          </div>
        </div>

        <aside className="hidden w-[24rem] shrink-0 overflow-y-auto border-l xl:block">
            {!selected && (
              <div className="grid min-h-[10rem] place-items-center p-6">
                <p className="text-center type-caption">
                  Select a worktree to see its changes, commits and notes.
                </p>
              </div>
            )}
            {selected && (
              <>
                <section className="border-b">
                  <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
                    <div className="min-w-0">
                      <h2 className="truncate type-heading">{selected.name}</h2>
                      <p className="mt-1 truncate font-mono type-caption">{selected.branch}</p>
                    </div>
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        !selected.exists
                          ? "bg-muted-foreground/40"
                          : (selected.changedFiles || 0) > 0
                            ? "bg-signal"
                            : "bg-success",
                      )}
                    />
                  </header>
                  <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-5 py-4">
                    <DetailRow label="Path">
                      <span title={selected.path || selected.dir} className="font-mono">
                        {selected.path || selected.dir}
                      </span>
                    </DetailRow>
                    <DetailRow label="Branch">
                      <span className="font-mono">{selected.branch}</span>
                    </DetailRow>
                    <DetailRow label="Silo">{selected.silo || "unassigned"}</DetailRow>
                    <DetailRow label="Repo">{selected.repo}</DetailRow>
                    <DetailRow label="Created">
                      {relativeTime(selected.createdAt) || "unknown"}
                    </DetailRow>
                    {status && status.ahead != null && status.target && (
                      <DetailRow label="Position">
                        {status.ahead} ahead · {status.behind} behind {status.target}
                      </DetailRow>
                    )}
                    {status?.commits[0] && (
                      <DetailRow label="HEAD">
                        <span className="font-mono">{status.commits[0].hash}</span>{" "}
                        {status.commits[0].subject}
                      </DetailRow>
                    )}
                    {crewFor(selected.dir) && (
                      <DetailRow label="Crew">
                        {crewFor(selected.dir)?.title} ({crewFor(selected.dir)?.status})
                      </DetailRow>
                    )}
                    {(() => {
                      const risk = risks.get(selected.dir);
                      if (!risk) return null;
                      return (
                        <DetailRow label="Merge">
                          <span
                            className={cn(risk.conflicts.length ? "text-destructive" : "text-(--success)")}
                            title={risk.conflicts.join("\n") || undefined}
                          >
                            {risk.conflicts.length
                              ? `${risk.conflicts.length} conflict${risk.conflicts.length === 1 ? "" : "s"} predicted vs ${risk.target}`
                              : risk.alreadyMerged
                                ? `already merged into ${risk.target}`
                                : risk.canFastForward
                                  ? `fast-forwards onto ${risk.target}`
                                  : `clean merge into ${risk.target}`}
                          </span>
                        </DetailRow>
                      );
                    })()}
                  </dl>
                </section>

                <section className="border-b">
                  <header className="flex items-center justify-between gap-3 border-b px-5 py-4">
                    <h2 className="type-heading">Changes</h2>
                    {status && (
                      <span className="font-mono type-caption tabular-nums">
                        <span className="text-(--success)">+{status.additions}</span>{" "}
                        <span className="text-destructive">−{status.deletions}</span>
                      </span>
                    )}
                  </header>
                  <div className="max-h-72 overflow-y-auto">
                    {statusError && (
                      <p className="px-5 py-4 type-caption">
                        Detailed status unavailable — the shell needs a rebuild to allow
                        farm.worktree.status.
                      </p>
                    )}
                    {status && !status.files.length && (
                      <p className="px-5 py-4 type-caption">
                        Clean — no uncommitted changes.
                      </p>
                    )}
                    {status?.files.map((file) => {
                      const meta = FILE_STATUS[file.status] || FILE_STATUS.modified;
                      return (
                        <div
                          key={file.path}
                          className="flex items-center gap-2 border-b px-5 py-1.5 last:border-b-0"
                        >
                          <span
                            className={cn("w-3 shrink-0 text-center font-mono text-xs font-medium", meta.tone)}
                          >
                            {meta.letter}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono type-caption" title={file.path}>
                            {file.path}
                          </span>
                          <span className="shrink-0 font-mono type-caption tabular-nums">
                            {file.additions != null && (
                              <span className="text-(--success)">+{file.additions}</span>
                            )}{" "}
                            {file.deletions != null && file.deletions > 0 && (
                              <span className="text-destructive">−{file.deletions}</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="border-b">
                  <header className="border-b px-5 py-4">
                    <h2 className="type-heading">Recent commits</h2>
                  </header>
                  <div className="max-h-64 overflow-y-auto">
                    {statusError && (
                      <p className="px-5 py-4 type-caption">—</p>
                    )}
                    {status && !status.commits.length && (
                      <p className="px-5 py-4 type-caption">No commits yet.</p>
                    )}
                    {status?.commits.map((commit) => (
                      <div
                        key={commit.hash}
                        onMouseEnter={() => setPeek({ hash: commit.hash, name: selected.name })}
                        onMouseLeave={() => setPeek(null)}
                        className={cn(
                          "flex items-center gap-2.5 border-b px-5 py-2 transition-colors last:border-b-0",
                          peek?.hash === commit.hash && "bg-muted/50",
                        )}
                      >
                        <span className="shrink-0 font-mono type-caption">{commit.hash}</span>
                        <span className="min-w-0 flex-1 truncate type-caption text-foreground">
                          {commit.subject}
                        </span>
                        <span className="shrink-0 type-caption">
                          {relativeTime(commit.at) || ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {status && suggestions.length > 0 && (
                  <section className="border-b">
                    <header className="border-b px-5 py-4">
                      <h2 className="type-heading">Suggestions</h2>
                    </header>
                    <ul className="flex flex-col gap-2.5 p-4">
                      {suggestions.map(({ Icon, tone, text }, index) => (
                        <li key={index} className="flex items-start gap-2 type-caption">
                          <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone || "text-muted-foreground")} />
                          <span className="min-w-0">{text}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <header className="border-b px-5 py-4">
                    <h2 className="type-heading">Notes</h2>
                  </header>
                  <div className="flex flex-col gap-2 p-4">
                    <Textarea
                      rows={4}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Working notes for this worktree — stays on this machine."
                    />
                    <div className="flex justify-end">
                      <Button size="xs" variant="outline" onClick={saveNote}>
                        Save
                      </Button>
                    </div>
                  </div>
                </section>
              </>
            )}
        </aside>
      </div>

      <MergeDialog
        worktree={mergeFor}
        onClose={() => setMergeFor(null)}
        onNotify={onNotify}
        onDone={changed}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New worktree</DialogTitle>
            <DialogDescription>
              {branches
                ? `Branch off ${branches.repo} into an isolated checkout for one silo. A farming name is assigned automatically.`
                : "Reading branches…"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="type-label">Branch</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-between font-mono" disabled={!branches}>
                    <span className="inline-flex items-center gap-1.5">
                      <GitBranchIcon className="size-3.5" />
                      {branch || "choose a branch"}
                    </span>
                    <ChevronDownIcon className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
                  <DropdownMenuLabel>Branches</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(branches?.branches || []).map((item) => (
                    <DropdownMenuItem key={item.name} onSelect={() => setBranch(item.name)}>
                      <span className="font-mono">{item.name}</span>
                      {!item.pushed && (
                        <span className="ml-auto type-caption text-muted-foreground">unpushed</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="type-label">Silo</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-between">
                    <span className="inline-flex items-center gap-1.5">
                      <ServerIcon className="size-3.5" />
                      {silo || "choose a silo"}
                    </span>
                    <ChevronDownIcon className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {accounts.map((account) => (
                    <DropdownMenuItem key={account.name} onSelect={() => setSilo(account.name)}>
                      {account.name}
                      {account.running && (
                        <span className="ml-auto type-caption text-(--success)">running</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!branch || !silo || creating} onClick={() => void create()}>
              {creating ? "Creating…" : "Create worktree"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
