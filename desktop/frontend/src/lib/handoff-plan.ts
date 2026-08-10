import type { FarmAccount, UsageWindow } from "@/types/farm";
import { formatClock } from "./timezone";

/** Handoff planning across silo usage windows — v2, the three-bucket model
 *  from docs/availability-scheduling.md:
 *
 *    usableNow = min(session, weeklyOverall - reserve, modelPool - reserve)
 *
 *  Each silo×CLI lane carries three pool kinds (session / weekly-overall /
 *  per-model weeklies), a confidence-scaled safety reserve, and an expiry
 *  pressure (headroom expiring soon is spent FIRST). The route sweeps the
 *  horizon and at each availability boundary scores every lane with the
 *  doctrine weights — burn expiring capacity, protect scarce model pools,
 *  keep the freshest account as the continuity reserve.
 *
 *  Percentages are the capacity unit (the doctrine's "hours" normalized to
 *  the 5h session window); absolute weekly budgets aren't reported by the
 *  CLIs yet, so weekly pools act as fractions of an unknown budget — correct
 *  for ordering and reserves, approximate for wall-clock arithmetic.
 *
 *  Pure and deterministic: everything derives from `accounts` + `from`.
 */

export const SESSION_WINDOW_MINUTES = 300;

/** Safety reserves by confidence (doctrine: 8–12% normal, 20% unproven). */
const RESERVE_REPORTED = 0.1;
const RESERVE_UNPROVEN = 0.2;

export interface AllowancePool {
  /** 0..1 of the pool remaining, null when unreported */
  remaining: number | null;
  resetsAt: Date | null;
}

export interface ModelPool extends AllowancePool {
  name: string;
}

export interface LaneBlock {
  /** minutes from plan start */
  start: number;
  end: number;
  kind: "available" | "partial" | "exhausted" | "weekly-capped" | "unknown";
  /** 0..1 of session budget usable inside this block (for partial) */
  headroom: number;
  resetAt?: Date;
}

export interface SiloLane {
  silo: string;
  provider: string;
  /* pools */
  session: AllowancePool;
  weekly: AllowancePool;
  models: ModelPool[];
  reserve: number;
  /** min(session, weekly-reserve) right now — the doctrine's usableNow */
  usableNow: number;
  /** weeklyHeadroom / hoursUntilWeeklyReset — capacity at risk of expiring */
  expiryPressure: number;
  /* kept for UI compatibility */
  weeklyRemaining: number | null;
  weeklyModelNotes: string[];
  blocks: LaneBlock[];
  reported: boolean;
}

export interface HandoffSegment {
  silo: string;
  provider: string;
  start: number;
  end: number;
  reason: string;
  score: number;
}

export interface HandoffPlan {
  from: Date;
  horizonMinutes: number;
  lanes: SiloLane[];
  route: HandoffSegment[];
  /** minutes in the horizon with no silo available */
  uncovered: number;
}

const SESSION_RE = /five|5\s*h|session|hour(?!.*week)/i;
const WEEKLY_RE = /week|seven|7\s*d|day(?!.*hour)/i;
const OVERALL_RE = /all|overall|total/i;

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

function isBlockedStatus(status?: string): boolean {
  return !!status && /block|limit|denied|exhaust|reject/i.test(status);
}

function remainingFraction(window: UsageWindow): number | null {
  if (window.remainingPercent != null) return Math.max(0, Math.min(1, window.remainingPercent / 100));
  if (window.usedPercent != null) return Math.max(0, Math.min(1, 1 - window.usedPercent / 100));
  return null;
}

function poolOf(window: UsageWindow | undefined): AllowancePool {
  if (!window) return { remaining: null, resetsAt: null };
  return {
    remaining: remainingFraction(window),
    resetsAt: window.resetsAt ? new Date(window.resetsAt) : null,
  };
}

/** A reset stamp in the past means the reported window already rolled over:
 *  the old percentage belongs to the ELAPSED window, so the allowance is
 *  fresh (unknown, treated as full) and the next boundary is the stamp
 *  advanced in window-length steps past `from`. Weekly pools get no new
 *  stamp (the next weekly reset is beyond the horizon anyway). Without this
 *  a silo that reset at 05:10 keeps showing "hard stop 05:10" all morning
 *  when no fresh usage event has landed. */
function rollForward(pool: AllowancePool, from: Date, windowMinutes: number | null): AllowancePool {
  if (!pool.resetsAt || pool.resetsAt.getTime() > from.getTime()) return pool;
  if (windowMinutes == null) return { remaining: null, resetsAt: null };
  const resetsAt = new Date(pool.resetsAt.getTime());
  while (resetsAt.getTime() <= from.getTime()) {
    resetsAt.setTime(resetsAt.getTime() + windowMinutes * 60_000);
  }
  return { remaining: null, resetsAt };
}

/** "fable seven day" → "fable"; falls back to the cleaned window name. */
function modelNameOf(window: UsageWindow): string {
  const cleaned = window.window.replaceAll("_", " ").trim();
  const stripped = cleaned.replace(/\b(seven|7\s*d(ay)?s?|week(ly)?|day|limit|window)\b/gi, "").trim();
  return stripped || cleaned;
}

function buildLane(
  siloName: string,
  provider: string,
  allWindows: UsageWindow[],
  from: Date,
  horizonMinutes: number,
): SiloLane {
  const weeklyWindows = allWindows.filter((w) => WEEKLY_RE.test(w.window));
  const sessionWindow = allWindows.find((w) => SESSION_RE.test(w.window) && !WEEKLY_RE.test(w.window));

  // Weekly-overall = the "all models" window when labelled, else the
  // TIGHTEST weekly (conservative: the binding constraint governs the lane).
  const overallWindow =
    weeklyWindows.find((w) => OVERALL_RE.test(w.window)) ||
    [...weeklyWindows].sort(
      (a, b) => (remainingFraction(a) ?? 1) - (remainingFraction(b) ?? 1),
    )[0];
  const modelWindows = weeklyWindows.filter((w) => w !== overallWindow && !OVERALL_RE.test(w.window));

  const sessionRaw = poolOf(sessionWindow);
  const sessionStale = !!sessionRaw.resetsAt && sessionRaw.resetsAt.getTime() <= from.getTime();
  const session = rollForward(sessionRaw, from, SESSION_WINDOW_MINUTES);
  const weekly = rollForward(poolOf(overallWindow), from, null);
  const models: ModelPool[] = modelWindows.map((w) => ({
    ...rollForward(poolOf(w), from, null),
    name: modelNameOf(w),
  }));

  const reported = !!sessionWindow || weeklyWindows.length > 0;
  const reserve = reported ? RESERVE_REPORTED : RESERVE_UNPROVEN;

  const weeklyHeadroom =
    weekly.remaining == null ? null : Math.max(weekly.remaining - reserve, 0) / (1 - reserve);
  const sessionNow = sessionWindow
    ? !sessionStale && isBlockedStatus(sessionWindow.status)
      ? 0
      : (session.remaining ?? 1)
    : 0.5; // unreported: assume half a window, low confidence
  const usableNow = Math.min(sessionNow, weeklyHeadroom ?? 1);

  const hoursToWeeklyReset =
    weekly.resetsAt != null ? Math.max(minutesBetween(from, weekly.resetsAt) / 60, 1) : null;
  const expiryPressure =
    weeklyHeadroom != null && hoursToWeeklyReset != null ? weeklyHeadroom / hoursToWeeklyReset : 0;

  const weeklyModelNotes = [
    ...(weekly.remaining != null && overallWindow
      ? [`${overallWindow.window.replaceAll("_", " ")}: ${Math.round(weekly.remaining * 100)}% left`]
      : []),
    ...models
      .filter((pool) => pool.remaining != null)
      .map((pool) => `${pool.name}: ${Math.round((pool.remaining ?? 0) * 100)}% left`),
  ];

  /* -------- availability blocks across the horizon -------- */
  const blocks: LaneBlock[] = [];
  if (weeklyHeadroom != null && weeklyHeadroom <= 0) {
    // Dead until the weekly reset; fresh capacity after it (if inside horizon).
    const resetMinute = weekly.resetsAt
      ? Math.min(Math.max(minutesBetween(from, weekly.resetsAt), 0), horizonMinutes)
      : horizonMinutes;
    blocks.push({ start: 0, end: resetMinute, kind: "weekly-capped", headroom: 0, resetAt: weekly.resetsAt || undefined });
    let cursor = resetMinute;
    while (cursor < horizonMinutes) {
      const end = Math.min(cursor + SESSION_WINDOW_MINUTES, horizonMinutes);
      blocks.push({ start: cursor, end, kind: "available", headroom: 1 });
      cursor = end;
    }
  } else if (!sessionWindow) {
    blocks.push({ start: 0, end: horizonMinutes, kind: "unknown", headroom: 0.5 });
  } else {
    // A blocked status from before an elapsed reset no longer applies.
    const blocked = !sessionStale && isBlockedStatus(sessionWindow.status);
    const remaining = session.remaining;
    let firstBoundary = session.resetsAt ? minutesBetween(from, session.resetsAt) : SESSION_WINDOW_MINUTES;
    if (!Number.isFinite(firstBoundary) || firstBoundary <= 0) firstBoundary = SESSION_WINDOW_MINUTES;
    firstBoundary = Math.min(firstBoundary, horizonMinutes);
    if (blocked || remaining === 0) {
      blocks.push({ start: 0, end: firstBoundary, kind: "exhausted", headroom: 0, resetAt: session.resetsAt || undefined });
    } else if (remaining != null && remaining < 1) {
      blocks.push({ start: 0, end: firstBoundary, kind: "partial", headroom: remaining, resetAt: session.resetsAt || undefined });
    } else {
      blocks.push({ start: 0, end: firstBoundary, kind: "available", headroom: remaining ?? 1, resetAt: session.resetsAt || undefined });
    }
    let cursor = firstBoundary;
    while (cursor < horizonMinutes) {
      const end = Math.min(cursor + SESSION_WINDOW_MINUTES, horizonMinutes);
      blocks.push({ start: cursor, end, kind: "available", headroom: 1 });
      cursor = end;
    }
  }

  return {
    silo: siloName,
    provider,
    session,
    weekly,
    models,
    reserve,
    usableNow,
    expiryPressure,
    weeklyRemaining: weekly.remaining,
    weeklyModelNotes,
    blocks,
    reported,
  };
}

function laneBlockAt(lane: SiloLane, minute: number): LaneBlock | undefined {
  return lane.blocks.find((block) => minute >= block.start && minute < block.end);
}

/** Doctrine score for running work on `lane` starting at `minute`.
 *  accountScore = expiryPressure*.40 + immediateHeadroom*.25 +
 *  modelSuitability*.20 + continuity*.10 − scarcityPenalty*.05 */
export function laneScoreAt(
  lane: SiloLane,
  minute: number,
  options: { preferredModel?: string; sticky?: boolean } = {},
): number {
  const block = laneBlockAt(lane, minute);
  if (!block || block.kind === "exhausted" || block.kind === "weekly-capped") return 0;

  const weeklyHeadroom =
    lane.weekly.remaining == null
      ? 0.6 // unknown weekly: neither pristine nor risky
      : Math.max(lane.weekly.remaining - lane.reserve, 0) / (1 - lane.reserve);
  if (lane.weekly.remaining != null && weeklyHeadroom <= 0) return 0;

  const immediateHeadroom = Math.min(
    block.kind === "unknown" ? 0.25 : block.headroom,
    weeklyHeadroom || 1,
  );

  // Normalize expiry pressure into 0..1 (1 ≈ a full week's headroom expiring
  // within 12h). Expiring capacity is the doctrine's top routing priority.
  const expiry = Math.min(lane.expiryPressure * 12, 1);

  let modelSuitability = 0.5; // neutral when no preference
  let scarcity = 0;
  if (options.preferredModel) {
    const pool = lane.models.find((item) =>
      item.name.toLowerCase().includes(options.preferredModel!.toLowerCase()),
    );
    if (pool?.remaining != null) {
      const headroom = Math.max(pool.remaining - lane.reserve, 0) / (1 - lane.reserve);
      modelSuitability = headroom;
      scarcity = pool.remaining < 0.25 ? 1 - pool.remaining : 0;
      if (headroom <= 0) return 0; // model pool at its floor — protect it
    }
  } else {
    // Generic work: penalize burning a lane whose model pools are scarce.
    const scarcest = Math.min(
      ...lane.models.map((pool) => pool.remaining ?? 1),
      1,
    );
    scarcity = scarcest < 0.25 ? 1 - scarcest : 0;
  }

  const continuity =
    block.end - minute >= 120 ? 1 : (block.end - minute) / 120; // can it run 2h uninterrupted?

  const sticky = options.sticky ? 0.08 : 0;

  return (
    expiry * 0.4 +
    immediateHeadroom * 0.25 +
    modelSuitability * 0.2 +
    continuity * 0.1 -
    scarcity * 0.05 +
    sticky
  );
}

function reasonFor(lane: SiloLane, block: LaneBlock | undefined, from: Date): string {
  const parts: string[] = [];
  if (block?.kind === "partial") parts.push(`${Math.round((1 - block.headroom) * 100)}% of its session used`);
  else if (block?.kind === "available") parts.push("full session available");
  else parts.push("best remaining option");
  if (lane.expiryPressure * 12 >= 0.5 && lane.weekly.resetsAt) {
    parts.push(
      `its weekly allowance resets ${formatClock(lane.weekly.resetsAt)}, so spend it before it expires`,
    );
  } else if (lane.weekly.remaining != null && lane.weekly.remaining - lane.reserve < 0.1) {
    parts.push("close to its protected reserve");
  }
  return parts.join(" · ");
}

/** Rank lanes for placing a piece of work right now (Crew staffing). */
export function rankLanesFor(plan: HandoffPlan, preferredModel?: string): Array<{ lane: SiloLane; score: number }> {
  return plan.lanes
    .map((lane) => ({ lane, score: laneScoreAt(lane, 0, { preferredModel }) }))
    .sort((a, b) => b.score - a.score);
}

/** Compute the optimal handoff route: doctrine-scored sweep over the
 *  availability boundaries, sticky to the current lane. */
export function planHandoff(accounts: FarmAccount[], from: Date, horizonMinutes = 1440): HandoffPlan {
  const lanes = accounts.flatMap((account) => {
    const entries = (account.usage || []).filter((entry) => (entry.windows || []).length);
    if (entries.length) {
      return entries.map((entry) =>
        buildLane(account.name, entry.provider, entry.windows || [], from, horizonMinutes),
      );
    }
    if (!account.running) return [];
    const provider = account.providers?.[0] || "claude";
    return [buildLane(account.name, provider, [], from, horizonMinutes)];
  });

  const boundaries = Array.from(
    new Set(
      lanes
        .flatMap((lane) => lane.blocks.flatMap((block) => [block.start, block.end]))
        .concat([0, horizonMinutes])
        .map((minute) => Math.max(0, Math.min(horizonMinutes, Math.round(minute)))),
    ),
  ).sort((a, b) => a - b);

  const route: HandoffSegment[] = [];
  let uncovered = 0;

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end - start < 1) continue;
    const current = route[route.length - 1];
    let best: { lane: SiloLane; score: number } | null = null;
    for (const lane of lanes) {
      const sticky = !!current && current.silo === lane.silo && current.provider === lane.provider && current.end === start;
      const score = laneScoreAt(lane, start, { sticky });
      if (score > (best?.score ?? 0)) best = { lane, score };
    }
    if (!best || best.score <= 0) {
      uncovered += end - start;
      continue;
    }
    const block = laneBlockAt(best.lane, start);
    if (current && current.silo === best.lane.silo && current.provider === best.lane.provider && current.end === start) {
      current.end = end;
    } else {
      route.push({
        silo: best.lane.silo,
        provider: best.lane.provider,
        start,
        end,
        reason: reasonFor(best.lane, block, from),
        score: best.score,
      });
    }
  }

  return { from, horizonMinutes, lanes, route, uncovered };
}

export function minuteToClock(from: Date, minute: number): string {
  const at = new Date(from.getTime() + minute * 60_000);
  return formatClock(at);
}

/** The precise, copyable schedule: `1. claude/sahil 10:00 → 12:00 · 40% session left` */
export function scheduleLines(plan: HandoffPlan): string[] {
  return plan.route.map(
    (segment, index) =>
      `${index + 1}. ${segment.provider}/${segment.silo} ${minuteToClock(plan.from, segment.start)} → ${minuteToClock(plan.from, segment.end)} · ${segment.reason}`,
  );
}
