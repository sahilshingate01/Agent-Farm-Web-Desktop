import { ArrowDownIcon, ArrowUpIcon, CheckIcon } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  ExecutionWorkflow,
  ExecutionWorkflowKind,
  GatewayRoute,
} from "@/types/farm";

const WORKFLOWS: Array<{
  kind: ExecutionWorkflowKind;
  label: string;
  description: string;
}> = [
  {
    kind: "single",
    label: "Single",
    description:
      "Run one selected member while keeping the rest available as group context.",
  },
  {
    kind: "parallel",
    label: "Parallel",
    description: "Run every member and return a labeled panel.",
  },
  {
    kind: "race",
    label: "Race",
    description: "Return the first successful member.",
  },
  {
    kind: "synthesize",
    label: "Synthesize",
    description: "Run members, then ask one member to combine their answers.",
  },
  {
    kind: "chain",
    label: "Chain",
    description: "Pass each member's output into the next member in order.",
  },
  {
    kind: "cascade",
    label: "Cascade",
    description: "Try members in order, falling back when one fails.",
  },
  {
    kind: "anchor",
    label: "Anchor",
    description:
      "One member holds the whole conversation and hands scoped tasks to the rest. Workers get only the brief it writes — never the transcript.",
  },
];

/** Convert old route fields into the extensible workflow representation. */
export function workflowFromRoute(
  route: Pick<
    GatewayRoute,
    "strategy" | "members" | "repeats" | "synthesizer" | "workflow"
  >,
): ExecutionWorkflow {
  if (route.workflow) {
    return {
      ...route.workflow,
      members: [
        ...(route.workflow.members?.length
          ? route.workflow.members
          : route.members || []),
      ],
      repeats: route.workflow.repeats || route.repeats || 1,
      synthesizer: route.workflow.synthesizer || route.synthesizer,
    };
  }
  return {
    kind: route.strategy || "parallel",
    members: [...(route.members || [])],
    repeats: route.repeats || 1,
    synthesizer: route.synthesizer,
  };
}

/** Keep legacy fields in sync while callers migrate to `workflow`. */
export function applyWorkflowToRoute<T extends GatewayRoute>(
  route: T,
  workflow: ExecutionWorkflow,
): T {
  return {
    ...route,
    workflow,
    members: workflow.members,
    repeats: workflow.repeats,
    synthesizer: workflow.synthesizer,
    strategy:
      workflow.kind === "parallel" ||
      workflow.kind === "race" ||
      workflow.kind === "synthesize"
        ? workflow.kind
        : undefined,
  };
}

export interface WorkflowEditorProps {
  value: ExecutionWorkflow;
  members: string[];
  onChange: (workflow: ExecutionWorkflow) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Shared execution editor for group and route screens. It deliberately owns
 * no persistence, so it can be embedded in Profiles, Containers, or API
 * Server without duplicating workflow semantics.
 */
export function WorkflowEditor({
  value,
  members,
  onChange,
  className,
  disabled,
}: WorkflowEditorProps) {
  const selected = useMemo(
    () => value.members || members,
    [members, value.members],
  );
  // Two-stage grouping: members are `model/silo` ids, so group them by the
  // Silo (the segment after the first slash) and expose the model per chip.
  const silos = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const member of members) {
      const silo = member.includes("/")
        ? member.slice(member.indexOf("/") + 1)
        : member;
      const list = groups.get(silo);
      if (list) list.push(member);
      else groups.set(silo, [member]);
    }
    return [...groups.entries()];
  }, [members]);
  const set = (patch: Partial<ExecutionWorkflow>) =>
    onChange({ ...value, ...patch });
  const toggle = (member: string) => {
    const next = selected.includes(member)
      ? selected.filter((item) => item !== member)
      : [...selected, member];
    set({
      members: next,
      activeMember:
        value.activeMember === member && !next.includes(member)
          ? next[0]
          : value.activeMember,
      // Same rule for the anchor: dropping the member that was the anchor must
      // not leave the workflow pointing at a route it no longer includes.
      anchor:
        value.anchor === member && !next.includes(member)
          ? next[0]
          : value.anchor,
    });
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    set({ members: next });
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Field>
        <FieldLabel>Execution workflow</FieldLabel>
        <select
          className="h-9 rounded-md border bg-background px-3 type-body"
          value={value.kind}
          disabled={disabled}
          onChange={(event) =>
            set({ kind: event.target.value as ExecutionWorkflowKind })
          }
        >
          {WORKFLOWS.map((workflow) => (
            <option key={workflow.kind} value={workflow.kind}>
              {workflow.label}
            </option>
          ))}
        </select>
        <FieldDescription>
          {
            WORKFLOWS.find((workflow) => workflow.kind === value.kind)
              ?.description
          }
        </FieldDescription>
      </Field>

      {value.kind === "single" && (
        <Field>
          <FieldLabel>Member to execute</FieldLabel>
          <FieldDescription>
            The other enabled members remain available to the group but do not
            run.
          </FieldDescription>
          <select
            className="h-9 rounded-md border bg-background px-3 type-body"
            value={value.activeMember || selected[0] || ""}
            disabled={disabled}
            onChange={(event) => set({ activeMember: event.target.value })}
          >
            {selected.map((member) => (
              <option key={member}>{member}</option>
            ))}
          </select>
        </Field>
      )}

      {value.kind === "anchor" && (
        <>
          <Field>
            <FieldLabel>Anchor member</FieldLabel>
            <FieldDescription>
              Holds the whole conversation and decides what to hand out. Wants a
              large context window. Every other enabled member is a worker and
              receives only the brief the anchor writes — never the transcript.
            </FieldDescription>
            <select
              className="h-9 rounded-md border bg-background px-3 type-body"
              value={value.anchor || selected[0] || ""}
              disabled={disabled}
              onChange={(event) => set({ anchor: event.target.value })}
            >
              {selected.map((member) => (
                <option key={member}>{member}</option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel>Delegations per turn</FieldLabel>
            <FieldDescription>
              Each delegation is anchor → worker → anchor, so every one adds a
              full round trip. Keep this at 1 unless you have measured that a
              second hop pays for itself.
            </FieldDescription>
            <select
              className="h-9 rounded-md border bg-background px-3 type-body"
              value={String(value.maxDelegations ?? 1)}
              disabled={disabled}
              onChange={(event) => set({ maxDelegations: Number(event.target.value) })}
            >
              {[0, 1, 2, 3].map((count) => (
                <option key={count} value={count}>
                  {count === 0 ? "0 — never delegate" : count}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field>
        <FieldLabel>Members and order</FieldLabel>
        <FieldDescription>
          Enable members for this workflow. Chain and Cascade use the displayed
          order. For Anchor, every member except the anchor is a worker.
        </FieldDescription>
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/35 p-2">
          {silos.map(([silo, siloMembers]) => (
            <div key={silo} className="flex flex-col gap-1.5">
              <span className="px-0.5 type-label">
                {silo}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {siloMembers.map((member) => (
                  <button
                    type="button"
                    key={member}
                    disabled={disabled}
                    onClick={() => toggle(member)}
                    className={cn(
                      "rounded-md border px-2 py-1 type-list leading-tight transition-colors",
                      selected.includes(member)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted",
                    )}
                  >
                    {selected.includes(member) && (
                      <CheckIcon className="mr-1 inline size-3" />
                    )}
                    {member.includes("/")
                      ? member.slice(0, member.indexOf("/"))
                      : member}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {selected.length > 0 &&
          (value.kind === "chain" || value.kind === "cascade") && (
            <div className="mt-2 flex flex-col gap-1 rounded-lg border p-2">
              {selected.map((member, index) => (
                <div key={member} className="flex items-center gap-2 type-list">
                  <span className="w-5 font-mono type-caption">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{member}</span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move ${member} up`}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled || index === selected.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move ${member} down`}
                  >
                    <ArrowDownIcon />
                  </Button>
                </div>
              ))}
            </div>
          )}
      </Field>

      {(value.kind === "parallel" ||
        value.kind === "race" ||
        value.kind === "synthesize") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>Runs per member</FieldLabel>
            <Input
              type="number"
              min={1}
              max={8}
              value={value.repeats || 1}
              disabled={disabled}
              onChange={(event) =>
                set({
                  repeats: Math.min(
                    8,
                    Math.max(1, Number(event.target.value) || 1),
                  ),
                })
              }
            />
          </Field>
          {value.kind === "synthesize" && (
            <Field>
              <FieldLabel>Synthesizer</FieldLabel>
              <select
                className="h-9 rounded-md border bg-background px-3 type-body"
                value={value.synthesizer || ""}
                disabled={disabled}
                onChange={(event) =>
                  set({ synthesizer: event.target.value || undefined })
                }
              >
                <option value="">First member</option>
                {selected.map((member) => (
                  <option key={member}>{member}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
