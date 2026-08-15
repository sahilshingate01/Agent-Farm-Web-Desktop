import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, PlayIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import { vocab } from "@/lib/vocabulary";

/** Wire shape of farm.crew.* (public/backend/controller.mjs). */
export interface CrewAssignment {
  id: string;
  title: string;
  silo: string;
  kit?: string | null;
  paddockId?: string | null;
  prompt?: string | null;
  status: "staged" | "started" | "done";
  createdAt: string;
  startedAt?: string | null;
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StatusTag({ status }: { status: CrewAssignment["status"] }) {
  if (status === "started") return <Badge>Started</Badge>;
  if (status === "done") {
    return (
      <Badge
        variant="outline"
        className="border-(--success)/40 text-(--success)"
      >
        Done
      </Badge>
    );
  }
  return <Badge variant="secondary">Staged</Badge>;
}

/** Muted-pill select (OK select anatomy, dropdown-menu backed) for the
 *  staging form — keeps the board free of a select dependency. */
function FieldSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
  allowNone,
}: {
  label: string;
  value: string;
  placeholder: string;
  /** Options with the same `group` render under a type-label eyebrow header
   *  (groups must arrive contiguous — no sorting happens here). */
  options: { value: string; label: string; group?: string }[];
  onChange: (value: string) => void;
  allowNone?: boolean;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="type-label">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="justify-between font-normal normal-case"
          >
            <span className={cn("truncate", !current && "text-muted-foreground")}>
              {current?.label || placeholder}
            </span>
            <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          {allowNone && (
            <DropdownMenuItem onSelect={() => onChange("")}>
              <span className="text-muted-foreground">None</span>
            </DropdownMenuItem>
          )}
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {option.group && option.group !== options[index - 1]?.group && (
                <DropdownMenuLabel className="type-label">
                  {option.group}
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem onSelect={() => onChange(option.value)}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && <CheckIcon className="size-3.5" />}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </label>
  );
}

/**
 * Crew staffing board — card CONTENT for the Crew page: assignment rows
 * (title, silo · kit · paddock meta, status tag, Start / Mark done /
 * Remove) plus an inline staging form. Deliberately dumb: silo, kit and
 * paddock choices come in as props; only the farm.crew.* calls are owned
 * here. Starting a job dispatches `agensis:start-job` for the app shell.
 */
export function CrewBoard({
  accounts,
  elevators = [],
  profiles,
  paddocks,
  onNotify,
  refreshKey = 0,
}: {
  accounts: { name: string }[];
  /** Hybrid gateway routes — offered first in the silo picker; picking one
   *  stores the route id (the gateway resolves it to member silos). */
  elevators?: { id: string; label?: string }[];
  profiles: { name: string }[];
  paddocks: { id: string; name: string }[];
  onNotify: (message: string) => void;
  refreshKey?: number;
}) {
  const [assignments, setAssignments] = useState<CrewAssignment[] | null>(null);
  const [title, setTitle] = useState("");
  const [silo, setSilo] = useState("");
  const [kit, setKit] = useState("");
  const [paddockId, setPaddockId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [armedRemoveId, setArmedRemoveId] = useState<string | null>(null);
  const disarmTimer = useRef<number | null>(null);

  const load = async () => {
    try {
      const result = await invokeNative<{ assignments: CrewAssignment[] }>(
        "farm.crew.list",
      );
      setAssignments(result.assignments);
    } catch {
      setAssignments([]);
    }
  };
  useEffect(() => {
    void load();
  }, [refreshKey]);
  useEffect(
    () => () => {
      if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    },
    [],
  );

  const paddockName = (id?: string | null) =>
    paddocks.find((paddock) => paddock.id === id)?.name || null;

  const save = async (assignment: Partial<CrewAssignment>) => {
    const result = await invokeNative<CrewAssignment>("farm.crew.save", {
      assignment,
    });
    await load();
    return result;
  };
  const stage = async () => {
    if (!title.trim() || !silo) return;
    try {
      await save({
        title: title.trim(),
        silo,
        ...(kit ? { kit } : {}),
        ...(paddockId ? { paddockId } : {}),
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        status: "staged",
      });
      setTitle("");
      setPrompt("");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };
  const start = async (assignment: CrewAssignment) => {
    try {
      await save({ ...assignment, status: "started" });
      window.dispatchEvent(
        new CustomEvent("agensis:start-job", {
          detail: {
            silo: assignment.silo,
            kit: assignment.kit || null,
            prompt: assignment.prompt || null,
            title: assignment.title,
          },
        }),
      );
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };
  const markDone = async (assignment: CrewAssignment) => {
    try {
      await save({ ...assignment, status: "done" });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };
  const armRemove = (id: string) => {
    setArmedRemoveId(id);
    if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setArmedRemoveId(null), 4000);
  };
  const remove = async (id: string) => {
    setArmedRemoveId(null);
    try {
      await invokeNative("farm.crew.remove", { id });
      await load();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };

  const rowMeta = (assignment: CrewAssignment): ReactNode =>
    [
      assignment.silo,
      assignment.kit || null,
      paddockName(assignment.paddockId),
      relativeTime(assignment.createdAt),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="flex flex-col">
      {assignments && !assignments.length && (
        <p className="px-4 py-6 text-center type-caption">
          No {vocab.jobs.toLowerCase()} staged yet — stage one below to hand a
          scoped brief to a {vocab.silo.toLowerCase()}.
        </p>
      )}
      {(assignments || []).map((assignment) => {
        const armed = armedRemoveId === assignment.id;
        return (
          <article
            key={assignment.id}
            className="group flex items-center gap-3 border-b px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate type-list font-medium">
                {assignment.title}
              </p>
              <p className="truncate type-caption">{rowMeta(assignment)}</p>
            </div>
            <StatusTag status={assignment.status} />
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {assignment.status === "staged" && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void start(assignment)}
                >
                  <PlayIcon className="size-3" />
                  Start
                </Button>
              )}
              {assignment.status === "started" && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void markDone(assignment)}
                >
                  <CheckIcon className="size-3" />
                  Mark done
                </Button>
              )}
              {armed ? (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => void remove(assignment.id)}
                >
                  Click again to remove
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => armRemove(assignment.id)}
                >
                  Remove
                </Button>
              )}
            </div>
          </article>
        );
      })}
      <form
        className="flex flex-col gap-3 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void stage();
        }}
      >
        <p className="type-label">New assignment</p>
        <label className="flex flex-col gap-1.5">
          <span className="type-label">Title</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ship the settings audit"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <FieldSelect
            label={vocab.silo}
            value={silo}
            placeholder={`Pick a ${vocab.silo.toLowerCase()}`}
            options={[
              ...elevators.map((elevator) => ({
                value: elevator.id,
                label: elevator.label || elevator.id,
                group: vocab.siloGroups,
              })),
              ...accounts.map((account) => ({
                value: account.name,
                label: account.name,
                ...(elevators.length ? { group: vocab.silos } : {}),
              })),
            ]}
            onChange={setSilo}
          />
          <FieldSelect
            label={`${vocab.equipment} ${vocab.kit}`}
            value={kit}
            placeholder="Optional"
            options={profiles.map((profile) => ({
              value: profile.name,
              label: profile.name,
            }))}
            onChange={setKit}
            allowNone
          />
          <FieldSelect
            label={vocab.paddock}
            value={paddockId}
            placeholder="Optional"
            options={paddocks.map((paddock) => ({
              value: paddock.id,
              label: paddock.name,
            }))}
            onChange={setPaddockId}
            allowNone
          />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="type-label">Prompt (optional)</span>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Scoped brief handed to the agent when the job starts"
            rows={2}
          />
        </label>
        <div>
          <Button type="submit" size="sm" disabled={!title.trim() || !silo}>
            <PlusIcon className="size-3.5" />
            Stage assignment
          </Button>
        </div>
      </form>
    </div>
  );
}
