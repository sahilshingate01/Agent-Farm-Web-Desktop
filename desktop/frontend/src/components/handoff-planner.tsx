import { formatClock } from "@/lib/timezone";
import { useMemo, useState } from "react";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  minuteToClock,
  planHandoff,
  scheduleLines,
  type HandoffPlan,
  type LaneBlock,
} from "@/lib/handoff-plan";
import type { FarmAccount } from "@/types/farm";

const LANE_HEIGHT = 44;
const LANE_GAP = 8;

function blockClasses(kind: LaneBlock["kind"]): string {
  switch (kind) {
    case "available":
      return "border-success/40 bg-success/15";
    case "partial":
      return "border-primary/40 bg-primary/15";
    case "exhausted":
      return "border-border bg-muted";
    case "weekly-capped":
      return "border-destructive/30 bg-destructive/10";
    default:
      return "border-dashed border-border bg-muted/40";
  }
}

function blockTitle(plan: HandoffPlan, block: LaneBlock): string {
  const range = `${minuteToClock(plan.from, block.start)}–${minuteToClock(plan.from, block.end)}`;
  switch (block.kind) {
    case "available":
      return `${range} · fresh session window`;
    case "partial":
      return `${range} · ${Math.round(block.headroom * 100)}% of session left${block.resetAt ? ` · resets ${formatClock(block.resetAt)}` : ""}`;
    case "exhausted":
      return `${range} · session exhausted${block.resetAt ? ` · resets ${formatClock(block.resetAt)}` : ""}`;
    case "weekly-capped":
      return `${range} · weekly limit reached`;
    default:
      return `${range} · usage not reported`;
  }
}

/** The magical bit of the Overview: every silo's usage windows as 24h lanes,
 *  the computed optimal handoff route drawn across them, and the precise
 *  schedule extracted beside it. Slide the start to explore other routes. */
export function HandoffPlanner({ accounts }: { accounts: FarmAccount[] }) {
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const plan = useMemo(() => {
    const from = new Date(Date.now() + offsetMinutes * 60_000);
    return planHandoff(accounts, from);
  }, [accounts, offsetMinutes]);

  const lines = scheduleLines(plan);
  const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  const copyPlan = () => {
    void navigator.clipboard?.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (!plan.lanes.length) {
    return <p className="type-caption py-6 text-center">No silo usage reported yet — start a silo to plan handoffs.</p>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <p className="type-label">Next 24 hours · from {minuteToClock(plan.from, 0)}</p>
          <input
            type="range"
            min={0}
            max={720}
            step={15}
            value={offsetMinutes}
            onChange={(event) => {
              setOffsetMinutes(Number(event.target.value));
              setSelectedSegment(null);
            }}
            aria-label="Slide plan start time"
            className="ml-auto h-1 w-40 accent-[var(--primary)]"
          />
          <span className="type-label">+{Math.round(offsetMinutes / 60)}h</span>
        </div>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3">
          <div />
          <div className="relative mb-1 h-4">
            {hours.map((hour) => (
              <span
                key={hour}
                className="type-label absolute -translate-x-1/2"
                style={{ left: `${(hour / 24) * 100}%` }}
              >
                {hour === 0 ? "now" : `+${hour}h`}
              </span>
            ))}
          </div>
          {plan.lanes.map((lane) => {
            const laneRoute = plan.route
              .map((segment, index) => ({ segment, index }))
              .filter(({ segment }) => segment.silo === lane.silo);
            return (
              <div key={lane.silo} className="contents">
                <div className="flex flex-col justify-center py-1" style={{ height: LANE_HEIGHT + LANE_GAP }}>
                  <span className="truncate text-sm font-medium">{lane.silo}</span>
                  <span className="type-label truncate">
                    {lane.weeklyRemaining != null ? `week ${Math.round(lane.weeklyRemaining * 100)}%` : lane.provider}
                  </span>
                </div>
                <div className="relative py-1" style={{ height: LANE_HEIGHT + LANE_GAP }}>
                  {hours.slice(1, -1).map((hour) => (
                    <span
                      key={hour}
                      aria-hidden
                      className="absolute inset-y-0 border-l border-border/50"
                      style={{ left: `${(hour / 24) * 100}%` }}
                    />
                  ))}
                  {lane.blocks.map((block, blockIndex) => (
                    <span
                      key={blockIndex}
                      title={`${lane.provider}/${lane.silo} · ${blockTitle(plan, block)}`}
                      className={cn("absolute inset-y-1 rounded-md border", blockClasses(block.kind))}
                      style={{
                        left: `${(block.start / plan.horizonMinutes) * 100}%`,
                        width: `${Math.max(((block.end - block.start) / plan.horizonMinutes) * 100 - 0.3, 0.4)}%`,
                      }}
                    />
                  ))}
                  {laneRoute.map(({ segment, index }) => (
                    <button
                      key={index}
                      type="button"
                      title={`${index + 1}. ${minuteToClock(plan.from, segment.start)} → ${minuteToClock(plan.from, segment.end)} · ${segment.reason}`}
                      aria-label={`Handoff segment ${index + 1} on ${lane.silo}`}
                      onClick={() => setSelectedSegment(index === selectedSegment ? null : index)}
                      className={cn(
                        "absolute bottom-1.5 h-2 rounded-full bg-primary transition-opacity",
                        selectedSegment != null && selectedSegment !== index && "opacity-30",
                      )}
                      style={{
                        left: `${(segment.start / plan.horizonMinutes) * 100}%`,
                        width: `${Math.max(((segment.end - segment.start) / plan.horizonMinutes) * 100 - 0.2, 0.5)}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {plan.uncovered > 0 && (
          <p className="type-caption mt-2">
            {Math.round(plan.uncovered)} min of the horizon has no silo available — expect a gap.
          </p>
        )}
      </div>
      <aside className="panel-depth rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center">
          <p className="type-label">Handoff plan</p>
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Copy handoff plan" onClick={copyPlan}>
            <CopyIcon />
          </Button>
          {copied && <span className="type-label text-primary">copied</span>}
        </div>
        {lines.length === 0 ? (
          <p className="type-caption">No route available — every silo is capped.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {lines.map((line, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => setSelectedSegment(index === selectedSegment ? null : index)}
                  className={cn(
                    "w-full rounded-md px-2 py-1 text-left font-mono text-xs leading-relaxed hover:bg-muted",
                    selectedSegment === index && "bg-primary/10 text-primary",
                  )}
                >
                  {line}
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
