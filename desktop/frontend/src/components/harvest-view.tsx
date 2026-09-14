import { useEffect, useState } from "react";
import { ChevronRightIcon, ChevronDownIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";

export type HarvestKind = "skill" | "workflow" | "agent-update" | "wiki-doc";
export type HarvestStatus = "proposed" | "approved" | "dismissed";

export interface HarvestSuggestion {
  id: string;
  kind: HarvestKind;
  title: string;
  summary: string;
  citations: string[];
  draftPath: string | null;
  /** List responses carry only this flag — the body arrives via farm.harvest.draft. */
  hasDraft?: boolean;
  draft: string | null;
  status: HarvestStatus;
  createdAt: string;
  writtenTo?: string;
  resolvedAt?: string;
  /** Written over an existing file (triage merged rather than replaced). */
  merged?: boolean;
  /** ---- Triage pass (farm.harvest.triage) ---- */
  /** 1-5 usefulness. Absent = not triaged yet. */
  rating?: number;
  /** What triage decided. "human" is what is left for you to judge. */
  verdict?: "accept" | "refine" | "merge" | "reject" | "human";
  triageReason?: string;
  triagedAt?: string;
  /** True when triage wrote this itself rather than a human approving it. */
  autoApplied?: boolean;
}

export interface HarvestTriageCounts {
  accepted: number;
  merged: number;
  refined: number;
  rejected: number;
  human: number;
  failed: number;
}

export interface HarvestState {
  suggestions: HarvestSuggestion[];
  lastScanAt: string | null;
  lastError: string | null;
  /** True while a detached worker is running the LLM pass. */
  scanning?: boolean;
  /** True while the triage worker is rating/applying suggestions. */
  triaging?: boolean;
  lastTriageAt?: string | null;
  lastTriageError?: string | null;
  lastTriageCounts?: HarvestTriageCounts | null;
}

const SECTIONS: { kind: HarvestKind; label: string }[] = [
  { kind: "skill", label: "Skills" },
  { kind: "workflow", label: "Workflows" },
  { kind: "agent-update", label: "Expert file updates" },
  { kind: "wiki-doc", label: "Wiki docs" },
];

function relativeAge(iso: string | null): string {
  if (!iso) return "No harvest yet";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "No harvest yet";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "Last harvest just now";
  if (minutes < 60) return `Last harvest ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `Last harvest ${hours}h ago`;
}

function SuggestionCard({
  suggestion,
  expanded,
  draftText,
  onToggleDraft,
  onApprove,
  onDismiss,
}: {
  suggestion: HarvestSuggestion;
  expanded: boolean;
  draftText: string | null;
  onToggleDraft: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const hasDraft = suggestion.hasDraft ?? Boolean(suggestion.draft);
  return (
    <article className="rounded-lg border bg-background p-3.5">
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 text-sm font-medium">{suggestion.title}</h4>
        {suggestion.rating ? (
          <span
            className="shrink-0 type-label"
            title={suggestion.triageReason || "Triage rating"}
          >
            {"●".repeat(suggestion.rating)}
            <span className="text-muted-foreground/40">
              {"●".repeat(Math.max(0, 5 - suggestion.rating))}
            </span>
          </span>
        ) : null}
      </div>
      <p className="mt-1 type-caption">{suggestion.summary}</p>
      {/* Why triage left this for a human — the whole point of the pass is
          that the remaining cards say what the model was unsure about. */}
      {suggestion.triageReason && suggestion.status === "proposed" && (
        <p className="mt-1 type-caption text-(--signal)">{suggestion.triageReason}</p>
      )}
      {suggestion.autoApplied && (
        <p className="mt-1 type-caption">
          Banked automatically by triage{suggestion.merged ? " (merged into the existing file)" : ""}.
        </p>
      )}
      {suggestion.citations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestion.citations.map((citation) => (
            <span
              key={citation}
              className="inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 font-secondary text-[0.8rem] font-medium border-border bg-muted/60 text-muted-foreground"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("agensis:open-wiki-doc", { detail: citation }),
                )
              }
            >
              {citation}
            </span>
          ))}
        </div>
      )}
      {hasDraft && (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 type-caption"
            onClick={onToggleDraft}
          >
            {expanded ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )}
            View draft
          </button>
          {expanded && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {draftText ?? "Loading draft…"}
            </pre>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        {suggestion.status === "proposed" && (
          <>
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-45"
              disabled={!hasDraft}
              title={hasDraft ? undefined : "No draft to approve"}
              onClick={onApprove}
            >
              Approve
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </>
        )}
        {suggestion.status === "approved" && (
          <span className="inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 font-secondary text-[0.8rem] font-medium border-success/25 bg-success/10 text-success">
            {`Banked → ${suggestion.writtenTo}`}
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * Harvest floor: an AI pass that mines the team's working documents and
 * banks reusable capability — skills, workflows, expert-file updates, wiki
 * docs — as approvable suggestions with citations back to their source.
 */
function applyHarvestState(
  result: HarvestState,
  setters: {
    setSuggestions: (s: HarvestSuggestion[]) => void;
    setLastScanAt: (v: string | null) => void;
    setLastError: (v: string | null) => void;
    setScanning: (v: boolean) => void;
    setTriaging: (v: boolean) => void;
    setTriageCounts: (v: HarvestTriageCounts | null) => void;
  },
) {
  setters.setSuggestions(result.suggestions);
  setters.setLastScanAt(result.lastScanAt);
  setters.setLastError(result.lastError ?? result.lastTriageError ?? null);
  if (typeof result.scanning === "boolean") setters.setScanning(result.scanning);
  if (typeof result.triaging === "boolean") setters.setTriaging(result.triaging);
  setters.setTriageCounts(result.lastTriageCounts ?? null);
}

/** Poll list until the detached worker finishes (or timeout). Bridge list
 *  calls are cheap; the heavy LLM work is off the UI thread. */
async function waitForHarvestIdle(
  onTick: (state: HarvestState) => void,
  { intervalMs = 1200, timeoutMs = 4 * 60 * 1000 } = {},
): Promise<HarvestState> {
  const deadline = Date.now() + timeoutMs;
  let last = await invokeNative<HarvestState>("farm.harvest.list");
  onTick(last);
  while ((last.scanning || last.triaging) && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    last = await invokeNative<HarvestState>("farm.harvest.list");
    onTick(last);
  }
  return last;
}

export function HarvestView({ onNotify }: { onNotify: (message: string) => void }) {
  const [suggestions, setSuggestions] = useState<HarvestSuggestion[]>([]);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [triageCounts, setTriageCounts] = useState<HarvestTriageCounts | null>(null);
  const [expandedDrafts, setExpandedDrafts] = useState<Set<string>>(new Set());
  const [draftCache, setDraftCache] = useState<Record<string, string>>({});

  const apply = (result: HarvestState) =>
    applyHarvestState(result, {
      setSuggestions,
      setLastScanAt,
      setLastError,
      setScanning,
      setTriaging,
      setTriageCounts,
    });

  const load = async () => {
    try {
      const result = await invokeNative<HarvestState>("farm.harvest.list");
      apply(result);
      // Resume spinner if a scan was already in flight (e.g. heartbeat).
      if (result.scanning || result.triaging) {
        void waitForHarvestIdle(apply).catch((error) =>
          onNotify(error instanceof Error ? error.message : String(error)),
        );
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const scan = async () => {
    setScanning(true);
    try {
      // Starts a detached worker and returns immediately — must not block
      // the native bridge for the full LLM duration (beach-ball fix).
      const started = await invokeNative<HarvestState & { scanned: number; started?: boolean }>(
        "farm.harvest.scan",
        {},
      );
      apply(started);
      if (started.scanning) {
        await waitForHarvestIdle(apply);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
      setScanning(false);
    }
  };

  /** Auto-triage: a small model rates every proposed suggestion, writes the
   *  clearly-good ones (merging into an existing file rather than dead-ending
   *  on "already exists"), rejects the dead ones, and leaves the judgement
   *  calls for a human. Detached like the scan — never blocks the bridge. */
  const triage = async () => {
    setTriaging(true);
    try {
      const started = await invokeNative<HarvestState & { started?: boolean }>(
        "farm.harvest.triage",
        {},
      );
      apply(started);
      if (started.triaging) {
        const done = await waitForHarvestIdle(apply);
        const counts = done.lastTriageCounts;
        if (done.lastTriageError) onNotify(done.lastTriageError);
        else if (counts)
          onNotify(
            `Triage: ${counts.accepted} accepted, ${counts.refined} refined, ${counts.merged} merged, ${counts.rejected} rejected, ${counts.human} left for you.`,
          );
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
      setTriaging(false);
    }
  };

  const resolve = async (id: string, action: "approve" | "dismiss", merge = false) => {
    try {
      await invokeNative("farm.harvest.resolve", { id, action, ...(merge ? { merge: true } : {}) });
      await load();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleDraft = (id: string) => {
    const opening = !expandedDrafts.has(id);
    setExpandedDrafts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (opening && !(id in draftCache)) {
      void invokeNative<{ id: string; draft: string | null }>("farm.harvest.draft", { id })
        .then((result) => setDraftCache((prev) => ({ ...prev, [id]: result.draft ?? "" })))
        .catch((error) => onNotify(error instanceof Error ? error.message : String(error)));
    }
  };

  const [floorFilter, setFloorFilter] = useState<"proposed" | "banked" | "all">(
    () => (["banked", "all"].includes(localStorage.getItem("usage-farm-harvest-filter") || "")
      ? (localStorage.getItem("usage-farm-harvest-filter") as "banked" | "all")
      : "proposed"),
  );
  const pickFilter = (filter: "proposed" | "banked" | "all") => {
    setFloorFilter(filter);
    localStorage.setItem("usage-farm-harvest-filter", filter);
  };
  const live = suggestions.filter((suggestion) =>
    floorFilter === "all"
      ? suggestion.status !== "dismissed"
      : floorFilter === "banked"
        ? suggestion.status === "approved"
        : suggestion.status === "proposed");
  const proposedCount = suggestions.filter((suggestion) => suggestion.status === "proposed").length;
  const bankedCount = suggestions.filter((suggestion) => suggestion.status === "approved").length;
  const documentsCited = new Set(suggestions.filter((item) => item.status !== "dismissed").flatMap((item) => item.citations)).size;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="panel-depth rounded-lg border bg-card p-4">
          <p className="type-label">Proposed</p>
          <p className="text-[1.857rem] font-semibold leading-none tracking-[-0.04em]">
            {proposedCount}
          </p>
          <p className="type-caption">Awaiting review</p>
        </div>
        <div className="panel-depth rounded-lg border bg-card p-4">
          <p className="type-label">Banked</p>
          <p className="text-[1.857rem] font-semibold leading-none tracking-[-0.04em]">
            {bankedCount}
          </p>
          <p className="type-caption">Approved and written</p>
        </div>
        <div className="panel-depth rounded-lg border bg-card p-4">
          <p className="type-label">Documents cited</p>
          <p className="text-[1.857rem] font-semibold leading-none tracking-[-0.04em]">
            {documentsCited}
          </p>
          <p className="type-caption">Unique sources</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="type-heading">Harvest floor</h2>
          <p className="type-caption">{relativeAge(lastScanAt)}</p>
          {lastError && <p className="type-caption text-(--signal)">{lastError}</p>}
        </div>
        <div className="flex gap-0.5 rounded-lg border bg-muted/40 p-0.5">
          {([
            ["proposed", "Proposed"],
            ["banked", "Banked"],
            ["all", "All"],
          ] as const).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              aria-pressed={floorFilter === filter}
              onClick={() => pickFilter(filter)}
              className={cn(
                "rounded-md px-2 py-1 font-secondary text-[0.75rem] font-medium uppercase transition-colors",
                floorFilter === filter
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 border bg-background rounded-md px-3 py-1.5 font-mono text-xs font-medium uppercase hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
            disabled={scanning || triaging || !proposedCount}
            onClick={() => void triage()}
            title="A small model rates every proposal, banks the clearly-good ones, rejects the dead ones, and leaves the judgement calls for you."
          >
            <SparklesIcon className={cn("size-3.5", triaging && "animate-pulse")} />
            {triaging ? "Triaging…" : "Auto-triage"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 border bg-background rounded-md px-3 py-1.5 font-mono text-xs font-medium uppercase hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
            disabled={scanning || triaging}
            onClick={() => void scan()}
          >
            <RefreshCwIcon className={cn("size-3.5", scanning && "animate-spin")} />
            Scan now
          </button>
        </div>
      </div>

      {triageCounts && (
        <p className="type-caption">
          Last triage — {triageCounts.accepted} accepted, {triageCounts.refined} refined,{" "}
          {triageCounts.merged} merged, {triageCounts.rejected} rejected,{" "}
          {triageCounts.human} left for review
          {triageCounts.failed ? `, ${triageCounts.failed} could not be written` : ""}.
        </p>
      )}

      {live.length === 0 ? (
        <div className="grid min-h-[8rem] place-items-center panel-depth rounded-lg border bg-card">
          <p className="type-caption">
            {floorFilter === "proposed"
              ? "Nothing awaiting review — new suggestions land here on the next heartbeat, or scan now."
              : floorFilter === "banked"
                ? "Nothing banked yet — approve a suggestion and it lands here."
                : "Nothing harvested yet — the heartbeat scans your workspace on a cadence, or run a scan now."}
          </p>
        </div>
      ) : (
        SECTIONS.map(({ kind, label }) => {
          const items = live.filter((suggestion) => suggestion.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="panel-depth rounded-lg border bg-card">
              <div className="flex items-center gap-2 border-b px-5 py-4">
                <h3 className="type-heading">{label}</h3>
                <Badge>{items.length}</Badge>
              </div>
              <div className="grid gap-2.5 p-4">
                {items.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    draftText={draftCache[suggestion.id] ?? suggestion.draft}
                    expanded={expandedDrafts.has(suggestion.id)}
                    onToggleDraft={() => toggleDraft(suggestion.id)}
                    onApprove={() => void resolve(suggestion.id, "approve")}
                    onDismiss={() => void resolve(suggestion.id, "dismiss")}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
