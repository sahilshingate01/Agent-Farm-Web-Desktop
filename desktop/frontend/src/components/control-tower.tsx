import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangleIcon, CalendarDaysIcon, ChevronRightIcon, ClockIcon, RefreshCwIcon, SatelliteDishIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  minuteToClock,
  planHandoff,
  type HandoffPlan,
  type LaneBlock,
  type SiloLane,
} from "@/lib/handoff-plan";
import { invokeNative } from "@/lib/native";
import { formatClock } from "@/lib/timezone";
import { WorktreesPanel, type Worktree } from "@/components/worktrees-panel";
import { BentoGrid, type BentoPanelSpec } from "@/components/bento-grid";
import { FarmEstate, type EstateAction } from "@/components/farm-estate";
import { CrewBoard } from "@/components/crew-board";
import { SiloAvatarPicker } from "@/components/silo-avatar";
import type { FarmAccount, FarmProfile } from "@/types/farm";

/** The Overview "Silo Control Tower" (from Sahil Shingate's visual.html mockup):
 *  metric strip, the operational-route timeline (availability windows,
 *  reset markers, capacity tracks, the handoff route), the numbered plan,
 *  silo topology cards with per-pool mini bars, and profile loadouts with
 *  a REAL assignment zone (stages profile→silo, applies via `farm equip`).
 *  Everything binds live data; panels without a backend were cut, not faked. */

const WEEKLY_RESERVE = 0.12;

function minutesUntilFrom(at: Date): number {
  return (at.getTime() - Date.now()) / 60_000;
}

function hoursLabel(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

function sessionRemaining(lane: SiloLane): number {
  const first = lane.blocks[0];
  if (!first) return 0;
  if (first.kind === "exhausted" || first.kind === "weekly-capped") return 0;
  return first.headroom;
}

/** Fuel-gauge tone for a 0..1 remaining fraction — the chip color answers
 *  "how healthy" so 100% and 40% never read the same. */
function quotaToneClasses(fraction: number | null): string {
  if (fraction == null) return "border-border bg-muted/50 text-muted-foreground";
  if (fraction >= 0.8) return "border-success/30 bg-success/10 text-success";
  if (fraction >= 0.3) return "border-border bg-muted/50 text-muted-foreground";
  if (fraction >= 0.1) return "border-signal/35 bg-signal/10 text-signal";
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

/** Temperature ladder: HOT = container up AND a crew job started on it;
 *  WARM = container up, context held, idle; COOL = capacity but cold start;
 *  ICE = weekly headroom below reserve — frozen out until the reset. */
type LaneTone = "hot" | "busy" | "ready" | "risk" | "reserve" | "ice";
function laneState(lane: SiloLane, running: boolean, working: boolean): { label: string; tone: LaneTone } {
  if (lane.weeklyRemaining != null && lane.weeklyRemaining < WEEKLY_RESERVE) return { label: "ICE", tone: "ice" };
  if (running && working) return { label: "HOT", tone: "hot" };
  if (running) return { label: "WARM", tone: "busy" };
  return { label: "COOL", tone: "reserve" };
}

/** Successive 5h windows alternate tint so one cycle reads against the
 *  next; without it a full day of "available" is one undifferentiated bar. */
/** Human line for what a lane is doing at a given plan minute. */
function laneReadoutAt(lane: SiloLane, minute: number): string {
  const block = lane.blocks.find((candidate) => minute >= candidate.start && minute < candidate.end);
  if (!block) return "no data";
  switch (block.kind) {
    case "available":
      return block.headroom >= 1 ? "fresh session" : `${Math.round((1 - block.headroom) * 100)}% used`;
    case "partial":
      return `${Math.round((1 - block.headroom) * 100)}% used`;
    case "exhausted":
      return block.resetAt ? `exhausted · resets ${formatClock(block.resetAt)}` : "exhausted";
    case "weekly-capped":
      return block.resetAt ? `weekly capped until ${formatClock(block.resetAt)}` : "weekly capped";
    default:
      return "unreported";
  }
}

function windowClasses(kind: LaneBlock["kind"], alternate: boolean): string {
  switch (kind) {
    case "available":
      return alternate ? "bg-success/25 border-success/55" : "bg-success/8 border-success/35";
    case "partial":
      return alternate ? "bg-primary/20 border-primary/50" : "bg-primary/8 border-primary/30";
    case "exhausted":
      return "bg-muted border-border";
    case "weekly-capped":
      return "bg-destructive/10 border-destructive/25";
    default:
      return "bg-muted/40 border-dashed border-border";
  }
}

const STATE_EXPLANATION: Record<string, string> = {
  HOT: "HOT — container running AND a crew job started on it",
  WARM: "WARM — container running, context held, idle and ready",
  COOL: "COOL — has capacity but the container needs a cold start",
  ICE: "ICE — weekly headroom below reserve; frozen until the weekly reset",
  OFFLINE: "OFFLINE — no usage lane for this silo",
};

function StatePill({ label, tone }: { label: string; tone: LaneTone }) {
  return (
    <span
      title={STATE_EXPLANATION[label] || label}
      className={cn(
        "inline-flex h-6 w-full items-center justify-center rounded-md border px-2 type-label",
        tone === "hot" && "border-signal/45 bg-signal/15 text-signal",
        tone === "ready" && "border-success/30 bg-success/10 text-success",
        tone === "busy" && "border-primary/30 bg-primary/10 text-primary",
        tone === "risk" && "border-signal/40 bg-signal/10 text-signal",
        tone === "reserve" && "border-border bg-muted text-muted-foreground",
        tone === "ice" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {label}
    </span>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 font-secondary text-[0.8rem] font-medium",
        !tone && "border-border bg-muted/60 text-muted-foreground",
        tone === "blue" && "border-primary/25 bg-primary/10 text-primary",
        tone === "green" && "border-success/25 bg-success/10 text-success",
        tone === "amber" && "border-signal/30 bg-signal/10 text-signal",
      )}
    >
      {children}
    </span>
  );
}

/** Takes REMAINING (planner unit) but displays USED — matching Claude's own
 *  /usage convention so the two never look like they disagree. */
function MiniRow({ label, percent, unknown }: { label: string; percent: number | null; unknown?: boolean }) {
  const used = percent == null ? null : 1 - percent;
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.25rem] items-center gap-2">
      <span className="type-label">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full",
            (percent ?? 0) < 0.2 ? "bg-signal" : "bg-primary",
          )}
          style={{ width: `${Math.round((unknown ? 0 : (used ?? 0)) * 100)}%` }}
        />
      </span>
      <em className="text-right font-mono text-xs not-italic text-muted-foreground">
        {unknown ? "?" : used == null ? "—" : `${Math.round(used * 100)}% used`}
      </em>
    </div>
  );
}

/** One actionable availability notice for the attention strip. */
interface AttentionNotice {
  tone: "signal" | "info";
  icon: React.ReactNode;
  text: string;
}

export function ControlTower({
  accounts,
  profiles,
  elevators = [],
  catalog,
  gatewayRunning,
  routeCount,
  onEquip,
  onNavigate,
  onNotify,
  refreshedAt,
  onRefreshUsage,
  pinging = false,
}: {
  accounts: FarmAccount[];
  profiles: FarmProfile[];
  /** Hybrid gateway routes — listed first in every silo picker. */
  elevators?: { id: string; label?: string }[];
  /** Host command/agent names for the estate's farmhouse + experts cottage. */
  catalog?: { commands: string[]; agents: string[] };
  gatewayRunning: boolean;
  routeCount: number;
  onEquip: (silo: string, profile: string) => void;
  onNavigate: (view: "silos" | "profiles" | "gateway") => void;
  onNotify: (message: string) => void;
  refreshedAt: number | null;
  onRefreshUsage: () => void;
  pinging?: boolean;
}) {
  const [selectedSilo, setSelectedSilo] = useState<string | null>(null);
  const autoOpenedRef = useRef(false);
  const [expandedKit, setExpandedKit] = useState<string | null>(null);
  // Topology ranking lens: which pool "available" means right now.
  const [rankLens, setRankLens] = useState<"now" | "daily" | "weekly" | "special">(
    () => (["daily", "weekly", "special"].includes(localStorage.getItem("usage-farm-silo-rank") || "")
      ? (localStorage.getItem("usage-farm-silo-rank") as "daily" | "weekly" | "special")
      : "now"),
  );
  const pickLens = (lens: "now" | "daily" | "weekly" | "special") => {
    setRankLens(lens);
    localStorage.setItem("usage-farm-silo-rank", lens);
  };
  const [armedAssign, setArmedAssign] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  // Quota chips on the silo cards: % left, or hours on click (session hours
  // are real 5h-window arithmetic; weekly flips to hours-until-reset, the
  // only honest hour figure for a fraction of an unknown weekly budget).
  const [quotaUnit, setQuotaUnit] = useState<"pct" | "hours">(
    () => (localStorage.getItem("usage-farm-quota-unit") === "hours" ? "hours" : "pct"),
  );
  const toggleQuotaUnit = () => {
    setQuotaUnit((unit) => {
      const next = unit === "pct" ? "hours" : "pct";
      localStorage.setItem("usage-farm-quota-unit", next);
      return next;
    });
  };
  const [panelEpoch, setPanelEpoch] = useState(0);

  useEffect(() => {
    invokeNative<{ worktrees: Worktree[] }>("farm.worktree.list")
      .then((result) => setWorktrees(result.worktrees))
      .catch(() => setWorktrees([]));
  }, [panelEpoch]);
  // Silos with a STARTED crew job — the only honest "actively working"
  // signal we hold (usage freshness is polluted by our own pings).
  const [workingSilos, setWorkingSilos] = useState<Set<string>>(new Set());
  useEffect(() => {
    invokeNative<{ assignments: Array<{ silo: string; status: string }> }>("farm.crew.list")
      .then((result) =>
        setWorkingSilos(new Set(result.assignments.filter((item) => item.status === "started").map((item) => item.silo))))
      .catch(() => setWorkingSilos(new Set()));
  }, [panelEpoch]);

  // 30s clock tick: the rota, reset countdowns, and age chips are all
  // functions of "now" — without this they freeze between data refreshes
  // and the page reads as dead.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 30000);
    return () => window.clearInterval(interval);
  }, []);

  // Timeline hover: crosshair + a live readout of every lane at the cursor
  // minute (replaces the native title tooltips on the blocks).
  const [hover, setHover] = useState<{ frac: number; y: number } | null>(null);

  const plan: HandoffPlan = useMemo(
    () => planHandoff(accounts, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, tick],
  );

  // Order silos actually get USED, from the handoff route — distinct from
  // the availability ranking, and shown on every card so nobody has to
  // guess whether list position means "next up".
  const rotaOrder = useMemo(() => {
    const order = new Map<string, number>();
    for (const segment of plan.route) {
      if (!order.has(segment.silo)) order.set(segment.silo, order.size + 1);
    }
    return order;
  }, [plan]);

  const lensScore = useMemo(() => {
    return (lane: SiloLane | undefined): number => {
      if (!lane) return -1;
      switch (rankLens) {
        case "daily":
          return sessionRemaining(lane);
        case "weekly":
          return lane.weeklyRemaining ?? -1;
        case "special":
          return Math.max(...lane.models.map((pool) => pool.remaining ?? -1), -1);
        default:
          return lane.usableNow;
      }
    };
  }, [rankLens]);
  // ONE order everywhere: the route chart and the topology cards sort by the
  // same lens, so the page never shows two competing sequences.
  const orderedLanes = useMemo(
    () => [...plan.lanes].sort((a, b) => lensScore(b) - lensScore(a)),
    [plan, lensScore],
  );
  const rankedAccounts = useMemo(() => {
    const laneOf = (name: string) => plan.lanes.find((item) => item.silo === name);
    return [...accounts].sort((a, b) => lensScore(laneOf(b.name)) - lensScore(laneOf(a.name)));
  }, [accounts, plan, lensScore]);
  useEffect(() => {
    if (autoOpenedRef.current || !rankedAccounts.length) return;
    autoOpenedRef.current = true;
    setSelectedSilo(rankedAccounts[0].name);
  }, [rankedAccounts]);

  // Metric strip — every value computed from the live rota.
  // Doctrine usableNow per lane: min(session, weekly headroom above reserve).
  const safeNowMinutes = plan.lanes.reduce((total, lane) => total + lane.usableNow * 300, 0);
  const coverageMinutes = plan.horizonMinutes - plan.uncovered;
  const riskCount = plan.lanes.filter(
    (lane) => lane.weeklyRemaining != null && lane.weeklyRemaining < WEEKLY_RESERVE,
  ).length;
  const nextReset = plan.lanes
    .flatMap((lane) =>
      lane.blocks
        .filter((block) => block.resetAt)
        .map((block) => ({ lane, at: block.resetAt as Date })),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const modelNotes = plan.lanes.flatMap((lane) => lane.weeklyModelNotes);

  // Honesty layer: how fresh is the usage the whole rota is computed from?
  const newestReport = accounts
    .flatMap((account) => account.usage || [])
    .map((usage) => Date.parse(usage.updatedAt || ""))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => b - a)[0];
  const usageAgeMinutes = newestReport ? Math.round((Date.now() - newestReport) / 60000) : null;
  const unreportedLanes = plan.lanes.filter((lane) => !lane.reported);
  const usageStale = usageAgeMinutes != null && usageAgeMinutes > 30;

  // Attention strip — only what changes a decision in the next hour.
  const attention: AttentionNotice[] = [];
  if (!gatewayRunning)
    attention.push({ tone: "signal", icon: <SatelliteDishIcon className="size-3.5" />, text: "Gateway is stopped — silos cannot take routed work." });
  if (nextReset) {
    const minutesUntil = Math.round((nextReset.at.getTime() - Date.now()) / 60000);
    if (minutesUntil >= 0 && minutesUntil <= 45)
      attention.push({
        tone: "info",
        icon: <ClockIcon className="size-3.5" />,
        text: `${nextReset.lane.silo} session refreshes in ${minutesUntil}m (${formatClock(nextReset.at)}) — capacity returns.`,
      });
  }
  for (const lane of plan.lanes)
    if (lane.weeklyRemaining != null && lane.weeklyRemaining < WEEKLY_RESERVE)
      attention.push({
        tone: "signal",
        icon: <AlertTriangleIcon className="size-3.5" />,
        text: `${lane.silo} weekly headroom is ${Math.round(lane.weeklyRemaining * 100)}% — below the ${Math.round(WEEKLY_RESERVE * 100)}% reserve.`,
      });
  if (unreportedLanes.length)
    attention.push({
      tone: "info",
      icon: <RefreshCwIcon className="size-3.5" />,
      text: `${unreportedLanes.map((lane) => lane.silo).join(", ")} ${unreportedLanes.length === 1 ? "has" : "have"} no reported usage — planner is running on the conservative ${Math.round(0.2 * 100)}% reserve.`,
    });
  if (usageAgeMinutes != null && usageAgeMinutes > 30)
    attention.push({
      tone: "signal",
      icon: <RefreshCwIcon className="size-3.5" />,
      text: `Usage data is ${usageAgeMinutes >= 120 ? `${Math.round(usageAgeMinutes / 60)}h` : `${usageAgeMinutes}m`} old — the rota may be stale. Refresh usage.`,
    });
  if (plan.uncovered > 30)
    attention.push({
      tone: "signal",
      icon: <AlertTriangleIcon className="size-3.5" />,
      text: `${hoursLabel(plan.uncovered)} of the next 24h has no silo available.`,
    });
  const nextResetSoon = nextReset ? (nextReset.at.getTime() - Date.now()) / 60000 <= 30 : false;

  // Today's reset schedule — every boundary inside the horizon, so "when do
  // I get capacity back" never needs hover-hunting on the timeline.
  const resetsToday = [
    ...plan.lanes.flatMap((lane) => {
      const first = lane.blocks.find((block) => block.resetAt)?.resetAt;
      return first ? [{ silo: lane.silo, kind: "session" as const, at: first }] : [];
    }),
    ...plan.lanes.flatMap((lane) =>
      lane.weekly.resetsAt && minutesUntilFrom(lane.weekly.resetsAt) <= 24 * 60
        ? [{ silo: lane.silo, kind: "weekly" as const, at: lane.weekly.resetsAt }]
        : [],
    ),
  ]
    .filter((entry, index, all) =>
      all.findIndex((other) => other.silo === entry.silo && other.kind === entry.kind) === index)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  // Session AND weekly landing the same day collapse to one "full" chip on
  // the weekly boundary — after that moment the silo is completely reset.
  const resetChips = plan.lanes
    .map((lane) => lane.silo)
    .filter((silo, index, all) => all.indexOf(silo) === index)
    .flatMap((silo): Array<{ silo: string; kind: "session" | "weekly" | "both"; at: Date }> => {
      const mine = resetsToday.filter((entry) => entry.silo === silo);
      const weekly = mine.find((entry) => entry.kind === "weekly");
      if (weekly && mine.some((entry) => entry.kind === "session"))
        return [{ silo, kind: "both", at: weekly.at }];
      return mine;
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // Always-visible pulse: when the app last pulled, and how old the newest
  // provider report is — so "nothing changed" is distinguishable from
  // "nothing is refreshing".
  const checkedSeconds = refreshedAt ? Math.max(0, Math.round((Date.now() - refreshedAt) / 1000)) : null;
  const pingAge =
    checkedSeconds == null ? "\u2014" : checkedSeconds < 120 ? `${checkedSeconds}s` : `${Math.round(checkedSeconds / 60)}m`;
  const statsAge =
    usageAgeMinutes == null ? "none" : usageAgeMinutes >= 120 ? `${Math.round(usageAgeMinutes / 60)}h` : `${usageAgeMinutes}m`;
  const freshness = (
    <span className="inline-flex items-center gap-1.5 font-secondary text-[0.8rem] font-medium uppercase text-muted-foreground">
      age
      <span className="rounded-md border bg-muted/50 px-1.5 py-px">
        ping {pingAge} · stats {statsAge}
      </span>
    </span>
  );

  const metrics: Array<{ label: string; value: string; sub: string; signal?: boolean }> = [
    {
      label: "Safe now",
      value: hoursLabel(safeNowMinutes),
      sub: `Across ${plan.lanes.length} silo lanes, above ${Math.round(WEEKLY_RESERVE * 100)}% reserves`,
    },
    {
      label: "Next 24 hours",
      value: hoursLabel(coverageMinutes),
      sub: "Relay coverage incl. session refreshes",
    },
    {
      label: "Fable safe",
      value: plan.lanes.some((lane) => lane.models.length)
        ? hoursLabel(
            plan.lanes.reduce((total, lane) => {
              const pool = lane.models.find((item) => item.remaining != null);
              if (!pool || pool.remaining == null) return total;
              return total + (Math.max(pool.remaining - lane.reserve, 0) / (1 - lane.reserve)) * 300;
            }, 0),
          )
        : "—",
      sub: plan.lanes.some((lane) => lane.models.length)
        ? "Above protected reserves"
        : "No per-model weeklies reported",
    },
    {
      label: "Worktrees",
      value: String(worktrees.length),
      sub: worktrees.length
        ? `${worktrees.filter((worktree) => worktree.dirty).length} with uncommitted work`
        : "No worktrees yet",
    },
    {
      label: "Weekly risk",
      value: String(riskCount),
      sub: riskCount === 1 ? "Silo below preferred reserve" : "Silos below preferred reserve",
      signal: riskCount > 0,
    },
    {
      label: "Next event",
      value: nextReset
        ? formatClock(nextReset.at)
        : "—",
      sub: nextReset ? `${nextReset.lane.silo} session refresh` : "No reset reported",
      signal: nextResetSoon,
    },
  ];

  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const profileUse = (name: string) => accounts.filter((account) => account.profile === name).length;

  // Estate mirror — the 3D farm panel runs on the same plan-derived numbers
  // as the cards (USED fractions; the estate renders % used gauges).
  const rotaNow = plan.route[0]?.silo || null;
  const rotaLane = rotaNow ? plan.lanes.find((lane) => lane.silo === rotaNow) : undefined;
  const estateSilos = accounts.map((account) => {
    const lane = plan.lanes.find((item) => item.silo === account.name);
    const fablePool = lane?.models.find((pool) => pool.remaining != null);
    return {
      name: account.name,
      session: lane ? 1 - sessionRemaining(lane) : 0,
      weekly: lane?.weeklyRemaining != null ? 1 - lane.weeklyRemaining : 0,
      fable: fablePool?.remaining != null ? 1 - fablePool.remaining : 0,
    };
  });
  const estateWorktrees = worktrees.map((worktree) => ({
    name: worktree.name,
    branches: 1,
    uncommitted: worktree.changedFiles ?? (worktree.dirty ? 1 : 0),
    active: worktree.silo != null && worktree.silo === rotaNow,
  }));
  const estateKits = profiles.map((profile) => {
    const used = profileUse(profile.name);
    return {
      name: profile.name,
      skills:
        profile.skills_from_host.length +
        profile.skills_packages.reduce((n, pack) => n + pack.skills.length, 0),
      mcp: profile.mcp.length,
      agents: profile.agents_from_host.length,
      // "unassigned" is the estate's exact spare-kit marker — kit.assign
      // picks the first kit carrying it.
      assigned: used ? `${used} silo${used > 1 ? "s" : ""}` : "unassigned",
    };
  });
  // Estate button contract: play the visual locally, emit the action here.
  // Real mappings where the app already owns the operation; the rest lands
  // on the window bus (agensis:estate-action) for farmd wiring plus a toast.
  const onEstateAction = (action: EstateAction) => {
    window.dispatchEvent(new CustomEvent("agensis:estate-action", { detail: action }));
    switch (action.type) {
      case "kit.assign":
        if (action.kit && action.silo) {
          onEquip(action.silo, action.kit);
          onNotify(`Equipping ${action.silo} with ${action.kit} (farm equip)…`);
        }
        break;
      case "message.send":
        if (action.arg)
          window.dispatchEvent(
            new CustomEvent("agensis:start-job", {
              detail: { silo: action.arg, kit: null, prompt: null, title: `Estate message to ${action.arg}` },
            }),
          );
        break;
      case "rota.set":
      case "rota.next":
        onNotify(
          `Estate rota → ${action.silo || action.arg || "next"} — visual only; the live rota stays quota-derived.`,
        );
        break;
      case "worktree.create":
        onNotify("The estate can't pick a branch yet — plant worktrees from the Worktrees panel.");
        break;
      default:
        onNotify(`Estate: ${action.type}${action.arg ? ` · ${action.arg}` : ""}`);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Attention strip — availability facts that change a decision now.
          Rendered only when there is something to act on; freshness chip
          rides along so the age of the underlying data is never hidden. */}
      {attention.length === 0 && resetChips.length === 0 && (
        <p className="text-right">{freshness}</p>
      )}
      {attention.length > 0 && (
        <section className="flex flex-col gap-1.5 rounded-lg border border-signal/25 bg-signal/[0.04] p-3">
          <header className="flex items-center justify-between gap-3">
            <p className="type-label text-signal">Needs attention</p>
            <span>{freshness}</span>
          </header>
          {attention.map((notice, index) => (
            <p
              key={index}
              className={cn(
                "flex items-center gap-2 text-sm",
                notice.tone === "signal" ? "text-signal" : "text-muted-foreground",
              )}
            >
              {notice.icon}
              {notice.text}
            </p>
          ))}
        </section>
      )}

      {resetChips.length > 0 && (
        <section className="flex flex-wrap items-center gap-1.5 panel-depth rounded-lg border bg-card px-3 py-2">
          <span className="mr-1 type-label">Resets today</span>
          {resetChips.map((entry) => (
            <span
              key={`${entry.silo}-${entry.kind}`}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 font-secondary text-[0.8rem] font-semibold",
                entry.kind === "session" ? "bg-foreground text-background" : "bg-signal text-white",
              )}
              title={
                entry.kind === "both"
                  ? "Session and weekly both reset today — fully restocked from this time"
                  : entry.kind === "weekly"
                    ? "Weekly allowance resets"
                    : "Session window refreshes"
              }
            >
              {entry.kind === "session" ? <ClockIcon className="size-3" /> : <CalendarDaysIcon className="size-3" />}
              {entry.silo} {formatClock(entry.at)}
            </span>
          ))}
          {attention.length === 0 && (
            <span className="ml-auto">{freshness}</span>
          )}
        </section>
      )}

      {/* Customisable bento grid — every panel drags (header grip; whole
          tile for the metric cells) and resizes (corner handle), persisted
          per user. Defaults mirror the old fixed layout: metric strip,
          route + rotation, topology + kits, crew board + worktrees, plus a
          reserved slot for the next panel. */}
      <BentoGrid
        storageKey="usage-farm-crew-bento-v1"
        panels={[
          ...metrics.map(
            (metric): BentoPanelSpec => ({
              id: `metric-${metric.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
              chromeless: true,
              w: 2,
              h: 2,
              content: (
                <article
                  className={cn(
                    "flex h-full flex-col justify-between gap-3 panel-depth rounded-lg border bg-card p-4",
                    metric.signal && "border-signal/35 bg-signal/[0.05]",
                  )}
                >
                  <p className={cn("type-label", metric.signal && "text-signal")}>{metric.label}</p>
                  <div>
                    <p
                      className={cn(
                        "text-[1.857rem] font-semibold leading-none tracking-[-0.04em]",
                        metric.signal && "text-signal",
                      )}
                    >
                      {metric.value}
                    </p>
                    <p className="mt-2 type-caption">{metric.sub}</p>
                  </div>
                </article>
              ),
            }),
          ),
          {
            id: "route",
            title: "Operational route",
            caption:
              "Availability, capacity and the recommended handoff path across the next 24 hours.",
            w: 8,
            h: 6,
            minW: 5,
            minH: 4,
            content: (
              <div className="relative px-5 pb-5 pt-4">
                {usageStale && (
                  <div className="absolute inset-0 z-10 grid place-items-center">
                    <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-signal/30 bg-background/95 p-5 text-center shadow-lg">
                      <AlertTriangleIcon className="size-5 text-signal" />
                      <p className="text-sm font-medium">
                        This rota is built on usage from{" "}
                        {usageAgeMinutes >= 120 ? `${Math.round(usageAgeMinutes / 60)} hours` : `${usageAgeMinutes} minutes`} ago.
                      </p>
                      <p className="type-caption">
                        Every window below may have moved. Ping the silos for fresh stats before trusting it.
                      </p>
                      <button
                        type="button"
                        disabled={pinging}
                        onClick={onRefreshUsage}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-xs font-medium uppercase text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
                      >
                        <RefreshCwIcon className={cn("size-3.5", pinging && "animate-spin")} />
                        {pinging ? "Pinging crew…" : "Refresh"}
                      </button>
                    </div>
                  </div>
                )}
                <div
                  aria-hidden={usageStale || undefined}
                  className={cn(
                    "relative grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3",
                    usageStale && "pointer-events-none select-none opacity-60 blur-[3px]",
                  )}
                >
                  <div
                    className="absolute inset-y-0 left-[8.25rem] right-0 z-[5] cursor-crosshair"
                    onMouseMove={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setHover({
                        frac: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
                        y: event.clientY - rect.top,
                      });
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    {hover && (() => {
                      const minute = hover.frac * plan.horizonMinutes;
                      const at = new Date(plan.from.getTime() + minute * 60_000);
                      const holder = plan.route.find((segment) => minute >= segment.start && minute < segment.end);
                      const flip = hover.frac > 0.72;
                      return (
                        <>
                          <span
                            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40"
                            style={{ left: `${hover.frac * 100}%` }}
                          />
                          <div
                            className="pointer-events-none absolute z-10 w-56 rounded-lg border bg-popover p-3 shadow-lg"
                            style={{
                              left: `calc(${hover.frac * 100}% + ${flip ? "-15rem" : "0.75rem"})`,
                              top: Math.max(0, Math.min(hover.y - 40, 999)),
                            }}
                          >
                            <p className="font-secondary text-[0.8rem] font-semibold">
                              {formatClock(at)}
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                +{(minute / 60).toFixed(1)}h
                              </span>
                            </p>
                            <div className="mt-2 grid gap-1">
                              {plan.lanes.map((lane) => (
                                <p key={`${lane.silo}/${lane.provider}`} className="flex justify-between gap-3 type-caption">
                                  <span className={cn(holder?.silo === lane.silo && "font-medium text-primary")}>
                                    {lane.silo}
                                  </span>
                                  <span>{laneReadoutAt(lane, minute)}</span>
                                </p>
                              ))}
                            </div>
                            {holder && (
                              <p className="mt-2 border-t pt-1.5 type-caption">
                                Route: <span className="font-medium text-primary">{holder.silo}</span> holds this window
                              </p>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div />
                  <div className="relative mb-2 h-4">
                    {hours.map((hour) => (
                      <span
                        key={hour}
                        className="type-label absolute"
                        style={{
                          left: `${(hour / 24) * 100}%`,
                          transform: hour === 0 ? "none" : hour === 24 ? "translateX(-100%)" : "translateX(-50%)",
                        }}
                      >
                        {hour === 0 ? formatClock(plan.from) : `+${hour}H`}
                      </span>
                    ))}
                  </div>
                  {orderedLanes.map((lane) => {
                    const account = accounts.find((item) => item.name === lane.silo);
                    const laneRoute = plan.route.filter((segment) => segment.silo === lane.silo && segment.provider === lane.provider);
                    const capacity = sessionRemaining(lane);
                    const weeklyTone =
                      lane.weeklyRemaining != null && lane.weeklyRemaining < WEEKLY_RESERVE
                        ? "bg-signal"
                        : capacity > 0.6
                          ? "bg-success"
                          : capacity > 0.25
                            ? "bg-primary"
                            : "bg-signal";
                    return (
                      <div key={`${lane.silo}/${lane.provider}`} className="contents">
                        <div className="border-t py-3 pr-3">
                          <strong className="block text-sm font-medium">{lane.silo}</strong>
                          <small className="type-label mt-1 block">
                            {lane.provider}
                            {account?.running ? " · warm" : ""}
                          </small>
                        </div>
                        <div className="relative min-h-[5.5rem] border-t">
                          {[6, 12, 18].map((hour) => (
                            <span
                              key={hour}
                              aria-hidden
                              className="absolute inset-y-0 border-l border-border/40"
                              style={{ left: `${(hour / 24) * 100}%` }}
                            />
                          ))}
                          {lane.blocks.map((block, blockIndex) => (
                            <span
                              key={blockIndex}
                              title={`${minuteToClock(plan.from, block.start)}–${minuteToClock(plan.from, block.end)} · ${block.kind}${block.kind === "partial" ? ` (${Math.round((1 - block.headroom) * 100)}% used)` : ""}`}
                              className={cn("absolute top-3 h-9 rounded-md border", windowClasses(block.kind, blockIndex % 2 === 1))}
                              style={{
                                left: `${(block.start / plan.horizonMinutes) * 100}%`,
                                width: `${Math.max(((block.end - block.start) / plan.horizonMinutes) * 100 - 0.4, 0.5)}%`,
                              }}
                            />
                          ))}
                          {lane.blocks
                            .filter((block) => block.resetAt && block.end < plan.horizonMinutes)
                            .map((block, index) => {
                              const frac = block.end / plan.horizonMinutes;
                              return (
                                <span key={`reset-${index}`} className="contents">
                                  <span
                                    title={`Session refreshes ${block.resetAt ? formatClock(block.resetAt) : ""}`}
                                    className="absolute bottom-3 top-2 w-[2px] rounded-full bg-[repeating-linear-gradient(to_bottom,var(--foreground),var(--foreground)_6px,transparent_6px,transparent_10px)] opacity-50"
                                    style={{ left: `${frac * 100}%` }}
                                  />
                                  {block.resetAt && (
                                    <span
                                      className={cn(
                                        "pointer-events-none absolute bottom-0 z-[2] inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-foreground px-1.5 py-px font-secondary text-[0.7rem] font-semibold text-background",
                                        frac > 0.85 ? "-translate-x-full" : "translate-x-1",
                                      )}
                                      style={{ left: `${frac * 100}%` }}
                                    >
                                      <ClockIcon className="size-3" />
                                      {formatClock(block.resetAt)}
                                    </span>
                                  )}
                                </span>
                              );
                            })}
                          {lane.weekly.resetsAt && (() => {
                            const minute = (lane.weekly.resetsAt.getTime() - plan.from.getTime()) / 60_000;
                            if (minute <= 0 || minute >= plan.horizonMinutes) return null;
                            const frac = minute / plan.horizonMinutes;
                            return (
                              <>
                                <span
                                  title={`Weekly allowance resets ${formatClock(lane.weekly.resetsAt)}`}
                                  className="pointer-events-auto absolute inset-y-1 z-[1] w-[3px] rounded-full bg-signal shadow-[0_0_0_2px_color-mix(in_oklab,var(--signal)_25%,transparent)]"
                                  style={{ left: `${frac * 100}%` }}
                                />
                                {/* Same solid-amber treatment as the "Resets today"
                                    chips — the bar and the chip are the same event. */}
                                <span
                                  className={cn(
                                    "pointer-events-none absolute top-0 z-[2] inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-signal px-1.5 py-px font-secondary text-[0.7rem] font-semibold text-white",
                                    frac > 0.85 ? "-translate-x-full" : "translate-x-1",
                                  )}
                                  style={{ left: `${frac * 100}%` }}
                                >
                                  <CalendarDaysIcon className="size-3" />
                                  {formatClock(lane.weekly.resetsAt)}
                                </span>
                              </>
                            );
                          })()}
                          {laneRoute.map((segment, index) => (
                            <span
                              key={`route-${index}`}
                              title={`${minuteToClock(plan.from, segment.start)} → ${minuteToClock(plan.from, segment.end)} · ${segment.reason}`}
                              className="absolute top-[3.4rem] h-[3px] rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_10%,transparent)] after:absolute after:-top-[3px] after:right-[-4px] after:size-2 after:rounded-full after:border-2 after:border-background after:bg-primary"
                              style={{
                                left: `${(segment.start / plan.horizonMinutes) * 100}%`,
                                width: `${Math.max(((segment.end - segment.start) / plan.horizonMinutes) * 100 - 0.3, 0.5)}%`,
                              }}
                            />
                          ))}
                          <span
                            title={`${Math.round((1 - capacity) * 100)}% of session used`}
                            className="absolute inset-x-0 bottom-2 h-1.5 overflow-hidden rounded-full bg-muted"
                          >
                            <span
                              className={cn("block h-full rounded-full", weeklyTone)}
                              style={{ width: `${Math.round((1 - capacity) * 100)}%` }}
                            />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {plan.uncovered > 0 && (
                  <p className="mt-3 type-caption">
                    {Math.round(plan.uncovered)} min of the horizon has no silo available.
                  </p>
                )}
              </div>
            ),
          },
          {
            id: "rotation",
            title: "Rotation",
            caption: "Optimised for quota expiry and warm context.",
            w: 4,
            h: 6,
            minW: 3,
            minH: 3,
            content: (
              <ol className="p-4">
                {plan.route.map((segment, index) => {
                  const lane = plan.lanes.find(
                    (item) => item.silo === segment.silo && item.provider === segment.provider,
                  );
                  return (
                    <li
                      key={index}
                      className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 pb-4 last:pb-0 [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:bottom-0 [&:not(:last-child)]:after:left-[0.85rem] [&:not(:last-child)]:after:top-7 [&:not(:last-child)]:after:w-px [&:not(:last-child)]:after:bg-border"
                    >
                      <span className="z-[1] grid size-7 place-items-center rounded-lg bg-foreground font-mono text-xs font-semibold text-background">
                        {index + 1}
                      </span>
                      <div>
                        <h3 className="text-sm font-medium">
                          {segment.silo}
                          {" · "}
                          {segment.end - segment.start >= plan.horizonMinutes ? (
                            <>covers the whole day from {minuteToClock(plan.from, segment.start)}</>
                          ) : (
                            <>
                              {minuteToClock(plan.from, segment.start)} → {minuteToClock(plan.from, segment.end)}
                            </>
                          )}
                          <span className="ml-1.5 type-caption">
                            ({((segment.end - segment.start) / 60).toFixed(1)}h)
                          </span>
                        </h3>
                        <p className="mt-0.5 type-caption">{segment.reason}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Tag tone="blue">{segment.provider}</Tag>
                          {lane?.weeklyRemaining != null && lane.weeklyRemaining < 0.25 && (
                            <Tag tone="amber">Weekly limited</Tag>
                          )}
                          {index === 0 && <Tag tone="green">Warm context</Tag>}
                          {!lane?.reported && <Tag>Low confidence</Tag>}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {plan.route.length === 0 && (
                  <p className="type-caption p-2">No route available — every lane is capped.</p>
                )}
                {(() => {
                  const routed = new Set(plan.route.map((segment) => segment.silo));
                  const standby = plan.lanes.filter((lane) => !routed.has(lane.silo)).map((lane) => lane.silo);
                  const unique = [...new Set(standby)];
                  if (!unique.length || !plan.route.length) return null;
                  return (
                    <li className="list-none border-t pt-3 type-caption">
                      In reserve: {unique.join(", ")} — capacity on standby; the rota only
                      hands off when the active silo runs low.
                    </li>
                  );
                })()}
              </ol>
            ),
          },
          {
            id: "topology",
            title: "Silo topology",
            caption:
              "Sorted by availability (lens above) — the rota tag on each card is the order they actually get used.",
            w: 7,
            h: 6,
            minW: 5,
            minH: 3,
            actions: (
              <div className="flex gap-0.5 rounded-lg border bg-muted/40 p-0.5">
                {([
                  ["now", "Now"],
                  ["daily", "Daily"],
                  ["weekly", "Weekly"],
                  ["special", "Special"],
                ] as const).map(([lens, label]) => (
                  <button
                    key={lens}
                    type="button"
                    aria-pressed={rankLens === lens}
                    onClick={() => pickLens(lens)}
                    className={cn(
                      "rounded-md px-2 py-1 font-secondary text-[0.75rem] font-medium uppercase transition-colors",
                      rankLens === lens
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ),
            content: (
              <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto p-4">
                {/* Ranked by usableNow — the rota's own ordering: the top card is
                    "who do I reach for next", spent silos sink. */}
                {rankedAccounts.map((account) => {
                  const lane = plan.lanes.find((item) => item.silo === account.name);
                  const state = lane
                    ? laneState(lane, account.running, workingSilos.has(account.name))
                    : { label: "OFFLINE", tone: "reserve" as const };
                  const selected = selectedSilo === account.name;
                  const modelNote = lane?.weeklyModelNotes.find((note) => !/all|overall/i.test(note));
                  return (
                    <article
                      key={account.name}
                      onClick={() => setSelectedSilo(selected ? null : account.name)}
                      className={cn(
                        "cursor-pointer overflow-hidden rounded-lg border bg-background transition-shadow",
                        selected && "border-primary/40 shadow-md shadow-primary/10",
                      )}
                    >
                      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_1rem] items-center gap-3 p-3.5">
                        <SiloAvatarPicker name={account.name} />
                        <div className="min-w-0">
                          <h3 className="flex items-center gap-1.5 truncate text-sm font-medium">
                            {account.name}
                            {rotaOrder.get(account.name) === 1 ? (
                              <Tag tone="green">rota now</Tag>
                            ) : rotaOrder.has(account.name) ? (
                              <Tag>rota #{rotaOrder.get(account.name)}</Tag>
                            ) : (
                              <Tag tone="amber">not in rota</Tag>
                            )}
                          </h3>
                          <p className="mt-0.5 truncate type-caption">
                            {[account.profile || "no profile", account.providers.join(" · ")]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <span className="grid grid-cols-[4.25rem_4.25rem_4.5rem] items-center gap-1.5">
                          {!lane && <span />}
                          {lane && (
                            <button
                              type="button"
                              title={quotaUnit === "pct" ? "Session USED (matches Claude’s /usage) — click for hours left" : "Session hours LEFT — click for % used"}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleQuotaUnit();
                              }}
                              className={cn(
                                "inline-flex h-6 w-full items-center justify-center gap-1 rounded-md border px-1.5 font-secondary text-[0.75rem] font-medium tabular-nums",
                                quotaToneClasses(sessionRemaining(lane)),
                              )}
                            >
                              <ClockIcon className="size-3" />
                              {quotaUnit === "pct"
                                ? `${Math.round((1 - sessionRemaining(lane)) * 100)}%`
                                : `${(sessionRemaining(lane) * 5).toFixed(1)}h`}
                            </button>
                          )}
                          {(!lane || lane.weeklyRemaining == null) && <span />}
                          {lane && lane.weeklyRemaining != null && (
                            <button
                              type="button"
                              title={quotaUnit === "pct" ? "Weekly left — click for hours to reset" : "Hours until weekly reset — click for %"}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleQuotaUnit();
                              }}
                              className={cn(
                                "inline-flex h-6 w-full items-center justify-center gap-1 rounded-md border px-1.5 font-secondary text-[0.75rem] font-medium tabular-nums",
                                quotaToneClasses(lane.weeklyRemaining),
                              )}
                            >
                              <CalendarDaysIcon className="size-3" />
                              {quotaUnit === "pct"
                                ? `${Math.round((1 - lane.weeklyRemaining) * 100)}%`
                                : lane.weekly.resetsAt
                                  ? `→${Math.max(0, (lane.weekly.resetsAt.getTime() - Date.now()) / 3600000).toFixed(0)}h`
                                  : "—"}
                            </button>
                          )}
                          <StatePill label={state.label} tone={state.tone} />
                        </span>
                        <ChevronRightIcon
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            selected && "rotate-90",
                          )}
                        />
                      </div>
                      {selected && lane && (
                        <div className="grid gap-2 px-3.5 pb-3.5 pl-[4.4rem]">
                          <MiniRow label="Session" percent={sessionRemaining(lane)} />
                          <MiniRow label="Weekly" percent={lane.weeklyRemaining} unknown={lane.weeklyRemaining == null} />
                          {modelNote ? (
                            <MiniRow
                              label={modelNote.split(":")[0].slice(0, 9)}
                              percent={Number(modelNote.match(/(\d+)% left/)?.[1] ?? 0) / 100}
                            />
                          ) : (
                            <MiniRow label="Confidence" percent={lane.reported ? 1 : 0.18} />
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {accounts.length === 0 && (
                  <p className="type-caption p-2">No silos yet — create the first one from the Silos view.</p>
                )}
              </div>
            ),
          },
          {
            id: "kits",
            title: "Equipment kits",
            caption: "Select a kit, then a silo, then apply.",
            w: 5,
            h: 6,
            minW: 4,
            minH: 3,
            actions: (
              <button
                type="button"
                onClick={() => onNavigate("profiles")}
                className="rounded-md border bg-background px-3 py-1.5 font-mono text-xs font-medium uppercase hover:bg-muted"
              >
                Equipment
              </button>
            ),
            content: (
              <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto p-4">
                {profiles.map((profile) => {
                  const expanded = expandedKit === profile.name;
                  const used = profileUse(profile.name);
                  return (
                    <article
                      key={profile.name}
                      className={cn(
                        "rounded-lg border bg-background transition-shadow",
                        expanded && "border-primary/40 shadow-md shadow-primary/10",
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-2 p-3.5 text-left"
                        aria-expanded={expanded}
                        onClick={() => {
                          setExpandedKit(expanded ? null : profile.name);
                          setArmedAssign(null);
                        }}
                      >
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-medium">{profile.name}</h3>
                          <p className="mt-1 line-clamp-2 type-caption">{profile.description}</p>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <Tag>{profile.skills_from_host.length + profile.skills_packages.reduce((n, pack) => n + pack.skills.length, 0)} skills</Tag>
                            <Tag>{profile.mcp.length} MCP</Tag>
                            {profile.agents_from_host.length > 0 && <Tag>{profile.agents_from_host.length} agents</Tag>}
                          </div>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {used > 0 ? <Tag tone="blue">{used} silo{used > 1 ? "s" : ""}</Tag> : <Tag>Unassigned</Tag>}
                          <ChevronRightIcon className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                        </span>
                      </button>
                      {expanded && (
                        <div className="border-t px-3.5 py-2.5">
                          <p className="type-caption">Apply to a silo — click twice to confirm (runs farm equip).</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {accounts.map((account) => {
                              const armed = armedAssign === `${profile.name}:${account.name}`;
                              const equipped = account.profile === profile.name;
                              return (
                                <button
                                  key={account.name}
                                  type="button"
                                  disabled={equipped}
                                  onClick={() => {
                                    if (equipped) return;
                                    if (!armed) {
                                      setArmedAssign(`${profile.name}:${account.name}`);
                                      return;
                                    }
                                    setArmedAssign(null);
                                    onEquip(account.name, profile.name);
                                  }}
                                  className={cn(
                                    "inline-flex h-6 items-center gap-1 rounded-md border px-2 font-secondary text-[0.75rem] font-medium",
                                    equipped
                                      ? "cursor-default border-success/30 bg-success/10 text-success"
                                      : armed
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "bg-muted/50 text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  {equipped ? `${account.name} ✓` : armed ? `${account.name} — sure?` : account.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ),
          },
          {
            id: "crew-board",
            title: "Crew board",
            caption: "Staged jobs — who does what, with which kit, in which worktree.",
            w: 7,
            h: 6,
            minW: 4,
            minH: 3,
            content: (
              <CrewBoard
                accounts={accounts}
                elevators={elevators}
                profiles={profiles}
                paddocks={worktrees.map((worktree) => ({
                  id: worktree.dir,
                  name: worktree.silo
                    ? `${worktree.name} · ${worktree.branch} · ${worktree.silo}`
                    : `${worktree.name} · ${worktree.branch}`,
                }))}
                onNotify={onNotify}
                refreshKey={panelEpoch}
              />
            ),
          },
          {
            id: "worktrees",
            title: "Worktrees",
            caption:
              "Isolated branch checkouts, one per silo — created under the shared work mount so git runs inside the silo's container. Unpushed branches welcome.",
            w: 5,
            h: 6,
            minW: 4,
            minH: 3,
            content: (
              <WorktreesPanel
                accounts={accounts}
                onNotify={onNotify}
                refreshKey={panelEpoch}
                onChanged={() => setPanelEpoch((epoch) => epoch + 1)}
              />
            ),
          },
          {
            // Headerless CRT panel: the card is the monitor shell, the inset
            // rounded view is the glass, the grip floats on the picture.
            id: "estate",
            w: 4,
            h: 6,
            minW: 3,
            minH: 3,
            content: (
              <div className="flex min-h-72 flex-1 flex-col">
                <FarmEstate
                  silos={estateSilos}
                  rota={rotaNow}
                  sessionProgress={rotaLane ? 1 - sessionRemaining(rotaLane) : 0.2}
                  worktrees={estateWorktrees}
                  kits={estateKits}
                  commands={(catalog?.commands || []).map((name) =>
                    name.startsWith("/") ? name : `/${name}`,
                  )}
                  experts={(catalog?.agents || []).map((name): [string, string] => [name, "host agent"])}
                  onAction={onEstateAction}
                  onOpenArticle={(article) => onNotify(`${article.title} isn't linked to the wiki yet.`)}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
