import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlusIcon, LockIcon } from "lucide-react";
import {
  GanttFeatureItem,
  GanttFeatureList,
  GanttFeatureListGroup,
  GanttHeader,
  GanttProvider,
  GanttSidebar,
  GanttSidebarGroup,
  GanttSidebarItem,
  GanttTimeline,
  GanttToday,
  type GanttFeature,
} from "@/components/ui/kibo-ui/gantt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { criticalPath } from "@/lib/chores/critical-path";
import { cn } from "@/lib/utils";
import { vocab } from "@/lib/vocabulary";
import type { ChoreTask } from "@/types/farm";
import type { ChoresStore } from "@/lib/chores/store";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Finish-to-start arrows drawn over the vendored gantt. Renders an
 *  absolute inset overlay inside GanttTimeline; bars are located by the
 *  FARM: `data-feature-bar-id` attribute and geometry is re-measured on
 *  scroll, resize, and layout mutations. Critical edges paint --primary. */
function DependencyArrows({
  edges,
  criticalEdges,
}: {
  edges: Array<{ from: string; to: string }>;
  criticalEdges: Set<string>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [paths, setPaths] = useState<Array<{ key: string; d: string; critical: boolean }>>([]);

  const measure = useCallback(() => {
    const container = hostRef.current?.parentElement;
    const host = hostRef.current?.getBoundingClientRect();
    if (!container || !host) return;
    const next: Array<{ key: string; d: string; critical: boolean }> = [];
    for (const edge of edges) {
      const from = container.querySelector(`[data-feature-bar-id="${CSS.escape(edge.from)}"]`);
      const to = container.querySelector(`[data-feature-bar-id="${CSS.escape(edge.to)}"]`);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.right - host.left;
      const y1 = a.top + a.height / 2 - host.top;
      const x2 = b.left - host.left;
      const y2 = b.top + b.height / 2 - host.top;
      const bend = Math.max(16, Math.min(48, Math.abs(x2 - x1) / 2));
      next.push({
        key: `${edge.from}->${edge.to}`,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 4} ${y2}`,
        critical: criticalEdges.has(`${edge.from}->${edge.to}`),
      });
    }
    setPaths(next);
  }, [edges, criticalEdges]);

  useEffect(() => {
    const container = hostRef.current?.parentElement;
    if (!container) return;
    measure();
    // The provider's `.gantt` div is the scroll surface.
    const scroller = container.closest(".gantt");
    const observer = new MutationObserver(() => measure());
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-10">
      {paths.length > 0 && (
        <svg className="h-full w-full overflow-visible">
          <defs>
            <marker id="chore-dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--muted-foreground)" />
            </marker>
            <marker id="chore-dep-arrow-critical" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--primary)" />
            </marker>
          </defs>
          {paths.map((path) => (
            <path
              key={path.key}
              d={path.d}
              fill="none"
              stroke={path.critical ? "var(--primary)" : "var(--muted-foreground)"}
              strokeWidth={path.critical ? 2 : 1.25}
              strokeOpacity={path.critical ? 0.9 : 0.5}
              markerEnd={`url(#${path.critical ? "chore-dep-arrow-critical" : "chore-dep-arrow"})`}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

export function ChoreTimeline({
  store,
  selectedId,
  onSelect,
  notify,
}: {
  store: ChoresStore;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  notify: (message: string) => void;
}) {
  const tasks = store.snapshot?.tasks ?? [];
  const scheduled = tasks.filter((task) => task.start && task.due);
  const unscheduled = tasks.filter((task) => !task.start || !task.due);
  const path = useMemo(() => criticalPath(tasks), [tasks]);

  const features: GanttFeature[] = scheduled.map((task) => ({
    id: task.id,
    name: task.title,
    startAt: new Date(`${task.start}T00:00:00`),
    endAt: new Date(`${task.due}T23:59:59`),
    status: {
      id: task.status,
      name: task.status,
      color: path.taskIds.has(task.id)
        ? "var(--primary)"
        : store.blocked.has(task.id)
          ? "var(--muted-foreground)"
          : task.status === "done"
            ? "var(--success)"
            : "var(--foreground)",
    },
  }));

  const edges = useMemo(() => {
    const scheduledIds = new Set(scheduled.map((task) => task.id));
    const list: Array<{ from: string; to: string }> = [];
    for (const task of scheduled) {
      for (const dep of task.dependsOn) {
        if (scheduledIds.has(dep)) list.push({ from: dep, to: task.id });
      }
    }
    return list;
  }, [scheduled]);

  const moveChore = (id: string, startAt: Date, endAt: Date | null) => {
    void store
      .mutate({
        type: "task.updated",
        taskId: id,
        patch: { start: isoDate(startAt), due: isoDate(endAt ?? startAt) },
      })
      .catch((cause) => notify(cause instanceof Error ? cause.message : String(cause)));
  };

  const scheduleChore = (task: ChoreTask) => {
    const today = new Date();
    const due = new Date(today.getTime() + Math.max(0, (task.estimateHours ?? 24) / 24 - 1) * 86_400_000);
    moveChore(task.id, today, due);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {unscheduled.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="type-label">Unscheduled</span>
          {unscheduled.map((task) => (
            <Button
              key={task.id}
              variant="outline"
              size="sm"
              className="gap-1.5"
              title={`Schedule '${task.title}' starting today`}
              onClick={() => scheduleChore(task)}
            >
              <CalendarPlusIcon />
              <span className="max-w-40 truncate">{task.title}</span>
              {store.blocked.has(task.id) && <LockIcon className="size-3 text-muted-foreground" />}
            </Button>
          ))}
        </section>
      )}
      {scheduled.length === 0 ? (
        <p className="type-caption px-2 py-8 text-center">
          Nothing scheduled — give a {vocab.chore.toLowerCase()} start and due dates, or click an
          unscheduled one above to drop it onto the timeline.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
          <GanttProvider range="daily" zoom={100} className="h-full">
            <GanttSidebar headerLabel={vocab.chores}>
              <GanttSidebarGroup name={vocab.chores}>
                {features.map((feature) => (
                  <GanttSidebarItem
                    key={feature.id}
                    feature={feature}
                    onSelectItem={(id) => onSelect(selectedId === id ? null : id)}
                  />
                ))}
              </GanttSidebarGroup>
            </GanttSidebar>
            <GanttTimeline>
              <GanttHeader />
              <GanttFeatureList>
                <GanttFeatureListGroup>
                  {features.map((feature) => {
                    const task = store.byId.get(feature.id);
                    return (
                      <GanttFeatureItem key={feature.id} {...feature} onMove={moveChore}>
                        <button
                          type="button"
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-1.5 text-left",
                            selectedId === feature.id && "text-primary",
                          )}
                          onClick={() => onSelect(selectedId === feature.id ? null : feature.id)}
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: feature.status.color }}
                          />
                          <span className="truncate text-xs">{feature.name}</span>
                          {task && store.blocked.has(task.id) && (
                            <LockIcon className="size-3 shrink-0 text-muted-foreground" />
                          )}
                          {path.taskIds.has(feature.id) && (
                            <Badge variant="default" className="shrink-0">critical</Badge>
                          )}
                        </button>
                      </GanttFeatureItem>
                    );
                  })}
                </GanttFeatureListGroup>
              </GanttFeatureList>
              <GanttToday />
              <DependencyArrows edges={edges} criticalEdges={path.edges} />
            </GanttTimeline>
          </GanttProvider>
        </div>
      )}
    </div>
  );
}
