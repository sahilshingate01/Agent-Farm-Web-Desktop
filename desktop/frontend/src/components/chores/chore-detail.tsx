import { useEffect, useRef, useState } from "react";
import {
  EyeIcon,
  ImageIcon,
  LinkIcon,
  PaperclipIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TokenChip } from "@/components/ui/token-chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarkdownPreview } from "@/components/markdown-preview";
import { SiloAvatar } from "@/components/silo-avatar";
import { invokeNative } from "@/lib/native";
import { mergeCatalog } from "@/lib/model-catalog";
import { choreWouldCycle, type ChoresStore } from "@/lib/chores/store";
import { cn } from "@/lib/utils";
import { vocab } from "@/lib/vocabulary";
import type { ChoreTask, FarmAccount } from "@/types/farm";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="type-label">{label}</h3>
      {children}
    </section>
  );
}

function AttachmentThumb({
  task,
  attachmentId,
  name,
  kind,
  onRemove,
}: {
  task: ChoreTask;
  attachmentId: string;
  name: string;
  kind: "image" | "file";
  onRemove: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (kind !== "image") return;
    void invokeNative<{ content: string; name: string }>("farm.chores.attachment.read", {
      taskId: task.id,
      attachmentId,
    })
      .then((result) => {
        if (alive) setSrc(`data:image/*;base64,${result.content}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [task.id, attachmentId, kind]);
  return (
    <figure className="group/attachment relative flex w-24 flex-col gap-1">
      <div className="grid h-16 w-24 place-items-center overflow-hidden rounded-md border bg-muted/40">
        {src ? (
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : kind === "image" ? (
          <ImageIcon className="size-4 text-muted-foreground" />
        ) : (
          <PaperclipIcon className="size-4 text-muted-foreground" />
        )}
      </div>
      <figcaption className="type-caption truncate" title={name}>{name}</figcaption>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${name}`}
        className="absolute right-0.5 top-0.5 bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover/attachment:opacity-100"
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </figure>
  );
}

export function ChoreDetail({
  task,
  store,
  accounts,
  models,
  onClose,
  onRun,
  notify,
}: {
  task: ChoreTask;
  store: ChoresStore;
  accounts: FarmAccount[];
  models: unknown;
  onClose: () => void;
  onRun: (task: ChoreTask) => void;
  notify: (message: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [previewNotes, setPreviewNotes] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [dataDraft, setDataDraft] = useState<{ key: string; value: string }>({ key: "", value: "" });
  const fileInput = useRef<HTMLInputElement>(null);
  const catalog = mergeCatalog(models);
  const blocked = store.blocked.has(task.id);

  // Adopt upstream edits when another surface (or the poll) moves the task.
  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes);
  }, [task.id, task.updatedAt, task.title, task.notes]);

  const patch = (
    fields: Partial<Pick<ChoreTask, "title" | "notes" | "tags" | "start" | "due" | "estimateHours" | "data">>,
  ) =>
    void store.mutate({ type: "task.updated", taskId: task.id, patch: fields }).catch((cause) =>
      notify(cause instanceof Error ? cause.message : String(cause)),
    );

  const addAttachment = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      notify("Attachments are limited to 10 MB.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      await invokeNative("farm.chores.attachment.add", {
        taskId: task.id,
        name: file.name || "pasted-image.png",
        content: btoa(binary),
      });
      await store.refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const dependencyOptions = (store.snapshot?.tasks ?? []).filter(
    (candidate) =>
      candidate.id !== task.id &&
      !task.dependsOn.includes(candidate.id) &&
      candidate.parentId !== task.id,
  );

  const openRuns = task.runs.filter((run) => !run.finishedAt);

  return (
    <aside
      className="flex w-[22rem] shrink-0 flex-col gap-5 overflow-y-auto border-l bg-sidebar p-4"
      onPaste={(event) => {
        const file = [...event.clipboardData.files][0];
        if (file) void addAttachment(file);
      }}
    >
      <div className="flex items-start gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title.trim() && title !== task.title) patch({ title });
          }}
          aria-label={`${vocab.chore} title`}
          className="type-heading border-transparent px-1 shadow-none focus-visible:border-input"
        />
        <Button variant="ghost" size="icon-sm" aria-label="Close detail" onClick={onClose}>
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={task.status === "done" ? "default" : "outline"}>{task.status}</Badge>
        <Badge variant="outline">{task.lifecycle}</Badge>
        {blocked && <Badge variant="outline" className="text-muted-foreground">blocked</Badge>}
        <Button
          size="sm"
          disabled={blocked || openRuns.length > 0}
          title={blocked ? "Blocked by unfinished dependencies" : undefined}
          onClick={() => onRun(task)}
        >
          <PlayIcon /> {openRuns.length ? "Running…" : "Run"}
        </Button>
      </div>

      <Section label="Notes">
        <div className="flex items-center gap-1">
          <Button
            variant={previewNotes ? "ghost" : "secondary"}
            size="icon-xs"
            aria-label="Edit notes"
            onClick={() => setPreviewNotes(false)}
          >
            <PencilIcon />
          </Button>
          <Button
            variant={previewNotes ? "secondary" : "ghost"}
            size="icon-xs"
            aria-label="Preview notes"
            onClick={() => setPreviewNotes(true)}
          >
            <EyeIcon />
          </Button>
        </div>
        {previewNotes ? (
          <div className="rounded-md border bg-background p-3">
            <MarkdownPreview content={notes || "*No notes yet.*"} />
          </div>
        ) : (
          <Textarea
            value={notes}
            rows={6}
            placeholder="Markdown notes…"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => {
              if (notes !== task.notes) patch({ notes });
            }}
          />
        )}
      </Section>

      <Section label="Tags">
        <div className="flex flex-wrap gap-1.5">
          {task.tags.map((tag) => (
            <TokenChip
              key={tag}
              selected
              aria-label={`Remove tag ${tag}`}
              onClick={() => patch({ tags: task.tags.filter((item) => item !== tag) })}
            >
              {tag} ×
            </TokenChip>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const tag = tagDraft.trim();
              if (tag && !task.tags.includes(tag)) patch({ tags: [...task.tags, tag] });
              setTagDraft("");
            }}
          >
            <Input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="+ tag"
              aria-label="Add tag"
              className="h-7 w-24"
            />
          </form>
        </div>
      </Section>

      <Section label="Assignment">
        <div className="flex flex-col gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="justify-start gap-2">
                {task.assignee.silo ? (
                  <>
                    <SiloAvatar name={task.assignee.silo} size="sm" /> {task.assignee.silo}
                  </>
                ) : (
                  `Assign ${vocab.silo.toLowerCase()}…`
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() =>
                  void store.mutate({
                    type: "task.assigned",
                    taskId: task.id,
                    silo: null,
                    provider: task.assignee.provider,
                    model: task.assignee.model,
                  })
                }
              >
                Unassigned
              </DropdownMenuItem>
              {accounts.map((account) => (
                <DropdownMenuItem
                  key={account.name}
                  onSelect={() =>
                    void store.mutate({
                      type: "task.assigned",
                      taskId: task.id,
                      silo: account.name,
                      provider: task.assignee.provider,
                      model: task.assignee.model,
                    })
                  }
                >
                  <SiloAvatar name={account.name} size="sm" /> {account.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="justify-start">
                {task.assignee.model
                  ? `${task.assignee.provider ?? ""} · ${task.assignee.model}`
                  : "Assign model…"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() =>
                  void store.mutate({
                    type: "task.assigned",
                    taskId: task.id,
                    silo: task.assignee.silo,
                    provider: null,
                    model: null,
                  })
                }
              >
                Any model
              </DropdownMenuItem>
              {catalog.flatMap((provider) =>
                provider.models.map((model) => (
                  <DropdownMenuItem
                    key={`${provider.id}-${model.id}`}
                    onSelect={() =>
                      void store.mutate({
                        type: "task.assigned",
                        taskId: task.id,
                        silo: task.assignee.silo,
                        provider: provider.id,
                        model: model.id,
                      })
                    }
                  >
                    {provider.label} · {model.label}
                  </DropdownMenuItem>
                )),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Section>

      <Section label="Schedule">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="type-caption">Start</span>
            <Input
              type="date"
              value={task.start ?? ""}
              onChange={(event) => patch({ start: event.target.value || null })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="type-caption">Due</span>
            <Input
              type="date"
              value={task.due ?? ""}
              onChange={(event) => patch({ due: event.target.value || null })}
            />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <span className="type-caption w-16">Estimate</span>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={task.estimateHours ?? ""}
            placeholder="hours"
            onChange={(event) =>
              patch({ estimateHours: event.target.value === "" ? null : Number(event.target.value) })
            }
          />
        </label>
      </Section>

      <Section label="Dependencies">
        <div className="flex flex-col gap-1">
          {task.dependsOn.map((dep) => {
            const target = store.byId.get(dep);
            return (
              <div key={dep} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <LinkIcon className="size-3 text-muted-foreground" />
                <span className="type-caption min-w-0 flex-1 truncate">{target?.title ?? dep}</span>
                {target && target.status !== "done" && (
                  <Badge variant="outline" className="text-muted-foreground">waiting</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove dependency"
                  onClick={() =>
                    void store.mutate({ type: "task.dependency.removed", taskId: task.id, dependsOn: dep })
                  }
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
          {dependencyOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="justify-start text-muted-foreground">
                  <PlusIcon /> Add dependency
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                {dependencyOptions.map((candidate) => {
                  const cycles = choreWouldCycle(store.snapshot?.tasks ?? [], task.id, candidate.id);
                  return (
                    <DropdownMenuItem
                      key={candidate.id}
                      disabled={cycles}
                      title={cycles ? "Would create a dependency cycle" : undefined}
                      onSelect={() =>
                        void store
                          .mutate({ type: "task.dependency.added", taskId: task.id, dependsOn: candidate.id })
                          .catch((cause) => notify(cause instanceof Error ? cause.message : String(cause)))
                      }
                    >
                      {candidate.title}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </Section>

      <Section label="Attachments">
        <div className="flex flex-wrap gap-2">
          {task.attachments.map((attachment) => (
            <AttachmentThumb
              key={attachment.id}
              task={task}
              attachmentId={attachment.id}
              name={attachment.name}
              kind={attachment.kind}
              onRemove={() =>
                void store.mutate({
                  type: "task.attachment.removed",
                  taskId: task.id,
                  attachmentId: attachment.id,
                })
              }
            />
          ))}
        </div>
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void addAttachment(file);
            event.target.value = "";
          }}
        />
        <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => fileInput.current?.click()}>
          <PaperclipIcon /> Add file — or paste a screenshot here
        </Button>
      </Section>

      <Section label="Data">
        <div className="flex flex-col gap-1">
          {Object.entries(task.data).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="type-caption w-24 truncate font-mono" title={key}>{key}</span>
              <span className="type-caption min-w-0 flex-1 truncate" title={value}>{value}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${key}`}
                onClick={() => {
                  const next = { ...task.data };
                  delete next[key];
                  patch({ data: next });
                }}
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              const key = dataDraft.key.trim();
              if (key) patch({ data: { ...task.data, [key]: dataDraft.value } });
              setDataDraft({ key: "", value: "" });
            }}
          >
            <Input
              value={dataDraft.key}
              onChange={(event) => setDataDraft((draft) => ({ ...draft, key: event.target.value }))}
              placeholder="key"
              aria-label="Data key"
              className="h-7 w-24 font-mono"
            />
            <Input
              value={dataDraft.value}
              onChange={(event) => setDataDraft((draft) => ({ ...draft, value: event.target.value }))}
              placeholder="value"
              aria-label="Data value"
              className="h-7 flex-1"
            />
            <Button variant="ghost" size="icon-xs" type="submit" aria-label="Add data entry">
              <PlusIcon />
            </Button>
          </form>
        </div>
      </Section>

      {task.runs.length > 0 && (
        <Section label="Runs">
          <div className="flex flex-col gap-1">
            {[...task.runs].reverse().map((run) => (
              <div key={run.jobId} className="flex items-center gap-2 rounded-md border px-2 py-1">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    run.outcome === "done" && "bg-success",
                    run.outcome === "failed" && "bg-destructive",
                    !run.outcome && "bg-primary",
                  )}
                />
                <span className="type-caption min-w-0 flex-1 truncate">
                  {run.provider ?? "auto"}{run.model ? ` · ${run.model}` : ""}
                </span>
                <span className="type-caption">
                  {run.outcome ?? "running"} · {new Date(run.startedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="mt-auto border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-destructive"
          onClick={() => {
            void store.mutate({ type: "task.deleted", taskId: task.id });
            onClose();
          }}
        >
          <Trash2Icon /> Delete {vocab.chore.toLowerCase()}
        </Button>
      </div>
    </aside>
  );
}
