import { useEffect, useState } from "react";
import { ActivityIcon, ChevronDownIcon, CircleDashedIcon, Clock3Icon, CpuIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GroupedTools } from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";
import type { ChatMemberTrace, ChatUsage } from "@/types/farm";

const count = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function formatTokens(usage?: ChatUsage) {
  if (!usage) return "tokens pending";
  return `${usage.estimated ? "about " : ""}${count.format(usage.totalTokens)} tokens`;
}

function duration(member: ChatMemberTrace) {
  if (member.durationMs != null) return `${(member.durationMs / 1000).toFixed(member.durationMs < 10_000 ? 1 : 0)}s`;
  if (!member.startedAt) return null;
  const end = member.completedAt ? Date.parse(member.completedAt) : Date.now();
  return `${Math.max(0, (end - Date.parse(member.startedAt)) / 1000).toFixed(1)}s`;
}

function UsageDetails({ usage }: { usage?: ChatUsage }) {
  if (!usage) return <span>Waiting for token usage</span>;
  return <>
    <span>{count.format(usage.inputTokens)} input</span>
    <span>{count.format(usage.outputTokens)} output</span>
    {usage.cachedInputTokens > 0 && <span>{count.format(usage.cachedInputTokens)} cache read</span>}
    {usage.cacheCreationInputTokens > 0 && <span>{count.format(usage.cacheCreationInputTokens)} cache write</span>}
    {usage.cacheStatus === "miss" && <span>cache miss</span>}
    {!usage.estimated && usage.cacheStatus === "unreported" && <span>cache not reported</span>}
  </>;
}

function MemberTrace({ member }: { member: ChatMemberTrace }) {
  const [open, setOpen] = useState(member.status === "running");
  useEffect(() => { if (member.status === "running") setOpen(true); }, [member.status]);
  const running = member.status === "running";
  return <Collapsible open={open} onOpenChange={setOpen} className="border-l pl-3">
    <CollapsibleTrigger className="group flex w-full items-center gap-2 py-1.5 text-left">
      {running ? <CircleDashedIcon className="size-3.5 animate-spin text-primary" /> : <CpuIcon className="size-3.5 text-muted-foreground" />}
      <span className="text-xs font-medium">{member.route}</span>
      {member.role === "synthesizer" && <span className="text-xs text-muted-foreground">synthesis</span>}
      {member.run > 1 && <span className="text-xs text-muted-foreground">run {member.run}</span>}
      <span className="ml-auto text-xs text-muted-foreground">{member.eventCount} events · {formatTokens(member.usage)}{duration(member) ? ` · ${duration(member)}` : ""}</span>
      <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent className="pb-3 pl-5">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><UsageDetails usage={member.usage} />{member.ttftMs != null && <span>{(member.ttftMs / 1000).toFixed(1)}s first token</span>}{member.permissionMode && <span>{member.permissionMode} permissions</span>}{member.costUsd != null && <span>${member.costUsd.toFixed(4)}</span>}</div>
      {member.rateLimit && <p className="mt-2 text-xs text-muted-foreground">{member.rateLimit.window?.replaceAll("_", " ")} quota: {member.rateLimit.status || (member.rateLimit.remainingPercent != null ? `${member.rateLimit.remainingPercent}% left` : "reported")}{member.rateLimit.resetsAt ? ` · resets ${new Date(member.rateLimit.resetsAt).toLocaleString()}` : ""}</p>}
      {member.models?.length ? <div className="mt-2 flex flex-col gap-1">{member.models.map((model) => <div key={model.model} className="flex items-center gap-2 text-xs text-muted-foreground"><span className="rounded-md border border-input bg-muted px-1.5 py-0.5 font-mono text-foreground">{model.model}</span><span>{formatTokens(model.usage)}</span>{model.contextWindow ? <span>{count.format(model.contextWindow)} context</span> : null}{model.costUsd != null && <span className="ml-auto">${model.costUsd.toFixed(4)}</span>}</div>)}</div> : null}
      <div className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {member.reasoning ? <div className="whitespace-pre-wrap border-l pl-3">{member.reasoning}</div> : <p>{running ? "Waiting for reasoning or activity from this provider." : "This provider emitted no reasoning text."}</p>}
      </div>
      {member.tools.length > 0 && <GroupedTools className="mt-3" tools={member.tools} />}
      {member.error && <p className="mt-2 text-xs text-destructive">{member.error}</p>}
      {member.output && member.role !== "synthesizer" && <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Member output</summary><div className="mt-2 whitespace-pre-wrap border-l pl-3 text-muted-foreground">{member.output}</div></details>}
    </CollapsibleContent>
  </Collapsible>;
}

export function ModelTrace({ members, usage, streaming }: { members: ChatMemberTrace[]; usage?: ChatUsage; streaming?: boolean }) {
  const [open, setOpen] = useState(Boolean(streaming));
  useEffect(() => { if (streaming) setOpen(true); }, [streaming]);
  if (!members.length) return null;
  const running = members.filter((member) => member.status === "running").length;
  const events = members.reduce((sum, member) => sum + member.eventCount, 0);
  const elapsedMs = Math.max(0, ...members.map((member) => member.durationMs || 0));
  const elapsed = elapsedMs > 0
    ? elapsedMs >= 60_000
      ? `${Math.floor(elapsedMs / 60_000)}m ${Math.round((elapsedMs % 60_000) / 1000)}s`
      : `${(elapsedMs / 1000).toFixed(elapsedMs < 10_000 ? 1 : 0)}s`
    : null;
  return <Collapsible open={open} onOpenChange={setOpen} className="not-prose w-full">
    <CollapsibleTrigger className="group flex w-full items-center gap-2 border-b py-2 text-left text-xs text-muted-foreground hover:text-foreground">
      <ActivityIcon className={cn("size-3.5", streaming && "animate-pulse text-primary")} />
      <span>{streaming ? "Working" : elapsed ? `Worked for ${elapsed}` : "Work details"}</span>
      <span className="ml-auto">{members.length} run{members.length === 1 ? "" : "s"} · {events} events · {formatTokens(usage)}</span>
      <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent className="mt-2 flex flex-col gap-1">{members.map((member) => <MemberTrace key={member.id} member={member} />)}</CollapsibleContent>
  </Collapsible>;
}
