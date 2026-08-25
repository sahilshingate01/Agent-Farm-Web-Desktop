import { useEffect, useMemo, useState } from "react";
import {
  ChartGanttIcon,
  ImportIcon,
  KanbanSquareIcon,
  ListIcon,
  PlusIcon,
  ZapIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChoreList } from "@/components/chores/chore-list";
import { ChoreBoard } from "@/components/chores/chore-board";
import { ChoreTimeline } from "@/components/chores/chore-timeline";
import { ChoreDetail } from "@/components/chores/chore-detail";
import { invokeNative } from "@/lib/native";
import { useChores } from "@/lib/chores/store";
import { criticalPath } from "@/lib/chores/critical-path";
import { cn } from "@/lib/utils";
import { vocab } from "@/lib/vocabulary";
import type { ChoreTask, FarmAccount } from "@/types/farm";

type ChoresTab = "list" | "board" | "timeline";

const TABS: Array<{ id: ChoresTab; label: string; icon: typeof ListIcon }> = [
  { id: "list", label: "List", icon: ListIcon },
  { id: "board", label: "Board", icon: KanbanSquareIcon },
  { id: "timeline", label: "Timeline", icon: ChartGanttIcon },
];

/** Chores — the task planner (spec 2026-07-20): plan the workload as a
 *  list, a kanban board, or a dependency-aware timeline, then run chores
 *  on their assigned silo/model. */
export function ChoresWorkspace({
  accounts,
  models,
  notify,
}: {
  accounts: FarmAccount[];
  models?: unknown;
  notify: (message: string) => void;
}) {
  const store = useChores();
  const [tab, setTab] = useState<ChoresTab>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const critical = useMemo(
    () => criticalPath(store.snapshot?.tasks ?? []).taskIds,
    [store.snapshot],
  );
  const selected = selectedId ? store.byId.get(selectedId) ?? null : null;
  const settings = store.snapshot?.settings ?? { autoRun: false, concurrency: 1 };

  const saveSettings = async (next: { autoRun: boolean; concurrency: number }) => {
    try {
      await invokeNative("farm.chores.settings.save", next);
      await store.refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Auto-run heartbeat — the controller enforces gates and the cap; this
  // only has to keep asking while the board toggle is on.
  useEffect(() => {
    if (!settings.autoRun) return;
    const tick = () =>
      void invokeNative("farm.chores.autorun.tick")
        .then(() => store.refresh())
        .catch(() => {});
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, [settings.autoRun]);

  const syncVisualTodo = async () => {
    try {
      const result = await invokeNative<{ imported: number; reflected: number }>("farm.chores.sync.visual-todo");
      await store.refresh();
      notify(`Imported ${result.imported} visual TODO${result.imported === 1 ? "" : "s"}, reflected ${result.reflected}.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const createChore = async (title: string, parentId: string | null = null) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const result = await store.mutate({ type: "task.created", task: { title: trimmed, parentId } });
      if (result.id) setSelectedId(result.id);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runChore = async (task: ChoreTask) => {
    try {
      await invokeNative("farm.chores.dispatch", { taskId: task.id });
      await store.refresh();
      notify(`${vocab.chore} '${task.title}' dispatched.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-end justify-between gap-8 border-b bg-background/90 px-8 pb-6 pt-10">
        <div className="flex flex-col gap-1">
          <h1 className="type-title leading-none">{vocab.chores}</h1>
          <p className="mt-1 max-w-2xl type-caption">
            Plan the workload: {vocab.chores.toLowerCase()} with subtasks, tags, dependencies and{" "}
            {vocab.silo.toLowerCase()} assignments — as a list, a board, or a timeline.
          </p>
        </div>
        <div className="flex gap-0.5 rounded-lg border bg-muted/40 p-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 font-secondary text-[0.8rem] font-medium uppercase transition-colors",
                tab === id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <form
            className="flex items-center gap-2 border-b px-6 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createChore(draft);
              setDraft("");
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`New ${vocab.chore.toLowerCase()}…`}
              aria-label={`New ${vocab.chore.toLowerCase()}`}
              className="max-w-md"
            />
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              <PlusIcon /> Add
            </Button>
            {store.error && <span className="type-caption text-destructive">{store.error}</span>}
            <span className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="sm" title="Import visual TODOs as chores" onClick={() => void syncVisualTodo()}>
                <ImportIcon /> Import TODOs
              </Button>
              {settings.autoRun && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" aria-label="Auto-run concurrency">
                      ×{settings.concurrency}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {[1, 2, 3, 4].map((cap) => (
                      <DropdownMenuItem
                        key={cap}
                        onSelect={() => void saveSettings({ autoRun: true, concurrency: cap })}
                      >
                        {cap} at a time
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                variant={settings.autoRun ? "default" : "outline"}
                size="sm"
                aria-pressed={settings.autoRun}
                title="When on, queued unblocked chores with an assignment run automatically"
                onClick={() => void saveSettings({ autoRun: !settings.autoRun, concurrency: settings.concurrency })}
              >
                <ZapIcon /> Auto-run
              </Button>
            </span>
          </form>
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {tab === "list" && (
              <ChoreList
                store={store}
                critical={critical}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddSub={(parentId) => {
                  const title = window.prompt(`New sub-${vocab.chore.toLowerCase()} of '${store.byId.get(parentId)?.title ?? parentId}'`);
                  if (title) void createChore(title, parentId);
                }}
              />
            )}
            {tab === "board" && (
              <ChoreBoard
                store={store}
                critical={critical}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
            {tab === "timeline" && (
              <ChoreTimeline
                store={store}
                selectedId={selectedId}
                onSelect={setSelectedId}
                notify={notify}
              />
            )}
            {store.snapshot && store.snapshot.tasks.length === 0 && (
              <p className="type-caption px-2 py-8 text-center">
                No {vocab.chores.toLowerCase()} yet — add the first one above.
              </p>
            )}
          </div>
        </div>
        {selected && (
          <ChoreDetail
            task={selected}
            store={store}
            accounts={accounts}
            models={models}
            onClose={() => setSelectedId(null)}
            onRun={(task) => void runChore(task)}
            notify={notify}
          />
        )}
      </div>
    </div>
  );
}
