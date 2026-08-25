import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleIcon,
  GripVerticalIcon,
  LockIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SiloAvatar } from "@/components/silo-avatar";
import { cn } from "@/lib/utils";
import { vocab } from "@/lib/vocabulary";
import type { ChoreStatus, ChoreTask } from "@/types/farm";
import type { ChoresStore } from "@/lib/chores/store";

const NEXT_STATUS: Record<ChoreStatus, ChoreStatus> = {
  todo: "in-progress",
  "in-progress": "done",
  done: "todo",
};

function StatusIcon({ status }: { status: ChoreStatus }) {
  if (status === "done") return <CheckCircle2Icon className="size-4 text-success" />;
  if (status === "in-progress") return <CircleDashedIcon className="size-4 text-primary" />;
  return <CircleIcon className="size-4 text-muted-foreground" />;
}

function ChoreRow({
  task,
  depth,
  hasChildren,
  expanded,
  blocked,
  critical,
  selected,
  onToggleExpand,
  onSelect,
  onCycleStatus,
  onAddSub,
}: {
  task: ChoreTask;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  blocked: boolean;
  critical: boolean;
  selected: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onCycleStatus: () => void;
  onAddSub: () => void;
}) {
  const sortable = useSortable({ id: task.id });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5",
        selected ? "border-border bg-accent text-accent-foreground" : "hover:bg-accent/50",
        sortable.isDragging && "opacity-60",
      )}
      onClick={onSelect}
    >
      <span style={{ width: `${depth * 1.25}rem` }} className="shrink-0" />
      <button
        type="button"
        className="cursor-grab opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Reorder"
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVerticalIcon className="size-3.5 text-muted-foreground" />
      </button>
      <button
        type="button"
        aria-label={`Status: ${task.status}`}
        onClick={(event) => {
          event.stopPropagation();
          onCycleStatus();
        }}
      >
        <StatusIcon status={task.status} />
      </button>
      <span className={cn("type-list min-w-0 truncate", task.status === "done" && "text-muted-foreground line-through")}>
        {task.title}
      </span>
      {task.tags.map((tag) => (
        <Badge key={tag} variant="outline">{tag}</Badge>
      ))}
      {blocked && (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <LockIcon className="size-3" /> blocked
        </Badge>
      )}
      {critical && <Badge variant="default">critical</Badge>}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {task.due && <span className="type-caption">{task.due}</span>}
        {task.assignee.silo && <SiloAvatar name={task.assignee.silo} size="sm" />}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Add sub-${vocab.chore.toLowerCase()}`}
          className="opacity-0 group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onAddSub();
          }}
        >
          <PlusIcon />
        </Button>
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand();
            }}
          >
            <ChevronRightIcon className={cn("transition-transform", expanded && "rotate-90")} />
          </Button>
        ) : (
          <span className="size-6" />
        )}
      </span>
    </div>
  );
}

export function ChoreList({
  store,
  critical,
  selectedId,
  onSelect,
  onAddSub,
}: {
  store: ChoresStore;
  critical: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddSub: (parentId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleDragEnd = (event: DragEndEvent) => {
    const activeTask = store.byId.get(String(event.active.id));
    const overTask = event.over ? store.byId.get(String(event.over.id)) : null;
    if (!activeTask || !overTask || activeTask.id === overTask.id) return;
    // Reordering stays within one sibling group; reparenting lives in the rail.
    if (activeTask.parentId !== overTask.parentId) return;
    const siblings = store.childrenOf(activeTask.parentId).filter((task) => task.id !== activeTask.id);
    const overIndex = siblings.findIndex((task) => task.id === overTask.id);
    const before = siblings[overIndex - 1];
    const movingDown = store.childrenOf(activeTask.parentId).indexOf(activeTask)
      < store.childrenOf(activeTask.parentId).indexOf(overTask);
    // Land after `over` when dragging down, before it when dragging up.
    const lower = movingDown ? overTask : before;
    const upper = movingDown ? siblings[overIndex + 1] : overTask;
    const order = lower && upper
      ? (lower.order + upper.order) / 2
      : lower
        ? lower.order + 1
        : upper.order - 1;
    void store.mutate({ type: "task.moved", taskId: activeTask.id, parentId: activeTask.parentId, order });
  };

  const renderGroup = (parentId: string | null, depth: number): React.ReactNode => {
    const group = store.childrenOf(parentId);
    if (!group.length) return null;
    return (
      <SortableContext items={group.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        {group.map((task) => {
          const children = store.childrenOf(task.id);
          const expanded = !collapsed.has(task.id);
          return (
            <div key={task.id}>
              <ChoreRow
                task={task}
                depth={depth}
                hasChildren={children.length > 0}
                expanded={expanded}
                blocked={store.blocked.has(task.id)}
                critical={critical.has(task.id)}
                selected={selectedId === task.id}
                onToggleExpand={() => toggle(task.id)}
                onSelect={() => onSelect(selectedId === task.id ? null : task.id)}
                onCycleStatus={() =>
                  void store.mutate({ type: "task.status", taskId: task.id, status: NEXT_STATUS[task.status] })
                }
                onAddSub={() => onAddSub(task.id)}
              />
              {expanded && renderGroup(task.id, depth + 1)}
            </div>
          );
        })}
      </SortableContext>
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-0.5">{renderGroup(null, 0)}</div>
    </DndContext>
  );
}
