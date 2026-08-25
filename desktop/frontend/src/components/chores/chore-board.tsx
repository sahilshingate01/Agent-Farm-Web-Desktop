import { useEffect, useState } from "react";
import { LockIcon } from "lucide-react";
import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/ui/kibo-ui/kanban";
import { Badge } from "@/components/ui/badge";
import { SiloAvatar } from "@/components/silo-avatar";
import { invokeNative } from "@/lib/native";
import { cn } from "@/lib/utils";
import type { ChoreLifecycle, ChoreTask } from "@/types/farm";
import type { ChoresStore } from "@/lib/chores/store";

const COLUMNS: Array<{ id: ChoreLifecycle; name: string }> = [
  { id: "logged", name: "Logged" },
  { id: "queued", name: "Queued" },
  { id: "in-progress", name: "In progress" },
  { id: "done", name: "Done" },
];

type BoardItem = {
  id: string;
  name: string;
  column: string;
};

function CardThumb({ task }: { task: ChoreTask }) {
  const image = task.attachments.find((attachment) => attachment.kind === "image");
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (!image) return;
    void invokeNative<{ content: string }>("farm.chores.attachment.read", {
      taskId: task.id,
      attachmentId: image.id,
    })
      .then((result) => {
        if (alive) setSrc(`data:image/*;base64,${result.content}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [task.id, image?.id]);
  if (!image || !src) return null;
  return <img src={src} alt={image.name} className="max-h-24 w-full rounded-md border object-cover" />;
}

export function ChoreBoard({
  store,
  critical,
  selectedId,
  onSelect,
}: {
  store: ChoresStore;
  critical: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const tasks = store.snapshot?.tasks ?? [];
  // Local mirror keeps the drag interaction smooth; the ledger snapshot
  // re-seeds it whenever the poll or a mutation lands.
  const [items, setItems] = useState<BoardItem[]>([]);
  useEffect(() => {
    setItems(tasks.map((task) => ({ id: task.id, name: task.title, column: task.lifecycle })));
  }, [store.snapshot]);

  const handleDataChange = (next: BoardItem[]) => {
    setItems(next);
    for (const item of next) {
      const task = store.byId.get(item.id);
      if (task && task.lifecycle !== item.column) {
        void store.mutate({
          type: "task.lifecycle",
          taskId: task.id,
          lifecycle: item.column as ChoreLifecycle,
        });
      }
    }
  };

  return (
    <KanbanProvider
      columns={COLUMNS}
      data={items}
      onDataChange={handleDataChange}
      className="grid h-full grid-cols-4 gap-3"
    >
      {(column) => (
        <KanbanBoard id={column.id} key={column.id}>
          <KanbanHeader className="type-label flex items-center justify-between">
            {column.name}
            <span className="text-muted-foreground">
              {items.filter((item) => item.column === column.id).length}
            </span>
          </KanbanHeader>
          <KanbanCards id={column.id}>
            {(item: BoardItem) => {
              const task = store.byId.get(item.id);
              if (!task) return null;
              const children = store.childrenOf(task.id);
              const doneChildren = children.filter((child) => child.status === "done").length;
              const parent = task.parentId ? store.byId.get(task.parentId) : null;
              return (
                <KanbanCard
                  key={item.id}
                  {...item}
                  className={cn(selectedId === task.id && "ring-2 ring-primary")}
                >
                  {/* KanbanCard forwards no DOM handlers — selection rides the content. */}
                  <div
                    className="flex flex-col gap-2"
                    onClick={() => onSelect(selectedId === task.id ? null : task.id)}
                  >
                    {parent && (
                      <p className="type-caption m-0 truncate">{parent.title} ›</p>
                    )}
                    <p className={cn("type-list m-0", task.status === "done" && "text-muted-foreground line-through")}>
                      {task.title}
                    </p>
                    <CardThumb task={task} />
                    {(task.tags.length > 0 || children.length > 0 || store.blocked.has(task.id) || critical.has(task.id)) && (
                      <div className="flex flex-wrap items-center gap-1">
                        {task.tags.map((tag) => (
                          <Badge key={tag} variant="outline">{tag}</Badge>
                        ))}
                        {children.length > 0 && (
                          <Badge variant="secondary">{doneChildren}/{children.length}</Badge>
                        )}
                        {store.blocked.has(task.id) && (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <LockIcon className="size-3" /> blocked
                          </Badge>
                        )}
                        {critical.has(task.id) && <Badge variant="default">critical</Badge>}
                      </div>
                    )}
                    {task.assignee.silo && (
                      <div className="flex items-center gap-1.5">
                        <SiloAvatar name={task.assignee.silo} size="sm" />
                        <span className="type-caption">{task.assignee.silo}</span>
                      </div>
                    )}
                  </div>
                </KanbanCard>
              );
            }}
          </KanbanCards>
        </KanbanBoard>
      )}
    </KanbanProvider>
  );
}
