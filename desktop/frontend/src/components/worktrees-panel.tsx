import { useEffect, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  GitMergeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ServerIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import type { FarmAccount } from "@/types/farm";

/** Wire shapes of farm.worktree.* (public/backend/controller.mjs). */
export interface Worktree {
  name: string;
  dir: string;
  repo: string;
  branch: string;
  silo: string | null;
  root: string | null;
  createdAt: string | null;
  exists: boolean;
  path?: string;
  dirty?: boolean | null;
  changedFiles?: number;
  additions?: number;
  deletions?: number;
}

interface BranchInfo {
  name: string;
  updatedAt: string | null;
  pushed: boolean;
}

interface BranchList {
  root: string;
  repo: string;
  current: string | null;
  branches: BranchInfo[];
}

interface MergePreview {
  target: string;
  wtBranch: string;
  ahead: number;
  behind: number;
  canFastForward: boolean;
  conflicts: string[];
  workspaceDirty: boolean;
  alreadyMerged: boolean;
}
interface MergeState {
  inProgress: boolean;
  conflicts: string[];
  message: string | null;
}
interface MergeResult {
  status: string;
  preview?: MergePreview;
  merge: MergeState;
}

/**
 * Real git worktrees, one per silo — the card CONTENT for the Crew page's
 * Worktrees panel. Picks a branch of the current workspace repo (unpushed
 * branches included), assigns a silo, and creates a farming-named worktree
 * that lands under $WORK, git-functional inside that silo's container.
 */
export function WorktreesPanel({
  accounts,
  onNotify,
  refreshKey = 0,
  onChanged,
}: {
  accounts: FarmAccount[];
  onNotify: (message: string) => void;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [branchList, setBranchList] = useState<BranchList | null>(null);
  const [branch, setBranch] = useState<string>("");
  const [silo, setSilo] = useState<string>("");
  const [creating, setCreating] = useState(false);
  // Two-step remove (assignment-zone pattern): arm, then confirm. No dialog.
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const disarmTimer = useRef<number | null>(null);
  const [mergeFor, setMergeFor] = useState<Worktree | null>(null);

  const load = async () => {
    try {
      const result = await invokeNative<{ worktrees: Worktree[] }>(
        "farm.worktree.list",
      );
      setWorktrees(result.worktrees);
    } catch {
      setWorktrees([]);
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

  const openCreate = async () => {
    setCreateOpen(true);
    setBranchList(null);
    try {
      const result = await invokeNative<BranchList>("farm.worktree.branches");
      setBranchList(result);
      setBranch(result.current || result.branches[0]?.name || "");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
      setCreateOpen(false);
    }
    // Default the silo to the first idle account, else the first account.
    if (!silo) setSilo(accounts[0]?.name || "");
  };

  const create = async () => {
    if (!branch || !silo) return;
    setCreating(true);
    try {
      await invokeNative("farm.worktree.create", { branch, silo });
      setCreateOpen(false);
      await load();
      window.dispatchEvent(new Event("agensis:worktrees-changed"));
      onChanged?.();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const armRemove = (dir: string) => {
    setArmedRemove(dir);
    if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setArmedRemove(null), 4000);
  };
  const remove = async (dir: string) => {
    setArmedRemove(null);
    try {
      await invokeNative("farm.worktree.remove", { dir });
      await load();
      window.dispatchEvent(new Event("agensis:worktrees-changed"));
      onChanged?.();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };

  const empty = worktrees && !worktrees.length;

  return (
    <>
      {empty ? (
        <div className="grid min-h-[6rem] place-items-center gap-3 p-4">
          <p className="type-caption text-center">
            No worktrees yet. Create one to give a silo an isolated checkout of a
            branch — work stays out of your main tree.
          </p>
          <Button variant="outline" size="sm" onClick={() => void openCreate()}>
            <PlusIcon className="size-3.5" />
            New worktree
          </Button>
        </div>
      ) : (
        <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {(worktrees || []).map((worktree) => {
            const armed = armedRemove === worktree.dir;
            const changed = worktree.changedFiles ?? 0;
            return (
              <article
                key={worktree.dir}
                className={cn(
                  "group rounded-lg border bg-background p-3",
                  armed && "border-destructive/60",
                )}
                title={worktree.path || worktree.dir}
              >
                <header className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate type-list font-medium">
                    {worktree.name}
                  </h3>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        aria-label={`Actions for ${worktree.name}`}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setMergeFor(worktree)}>
                        <GitMergeIcon className="size-3.5" />
                        Merge back…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => armRemove(worktree.dir)}
                      >
                        Remove…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </header>
                <p className="mt-1 truncate type-caption">
                  {changed > 0
                    ? `${changed} uncommitted ${changed === 1 ? "change" : "changes"}`
                    : "clean — no uncommitted changes"}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono type-caption">
                    <GitBranchIcon className="size-3" />
                    {worktree.branch}
                  </span>
                  {worktree.silo && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 type-caption">
                      <ServerIcon className="size-3" />
                      {worktree.silo}
                    </span>
                  )}
                  {armed && (
                    <Button
                      variant="destructive"
                      size="xs"
                      className="ml-auto"
                      onClick={() => void remove(worktree.dir)}
                    >
                      Click again to remove
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
          <button
            type="button"
            onClick={() => void openCreate()}
            className="grid min-h-[5.5rem] place-items-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
          >
            <span className="flex items-center gap-1.5 type-list">
              <PlusIcon className="size-3.5" />
              New worktree
            </span>
          </button>
        </div>
      )}

      <MergeDialog
        worktree={mergeFor}
        onClose={() => setMergeFor(null)}
        onNotify={onNotify}
        onDone={() => {
          void load();
          window.dispatchEvent(new Event("agensis:worktrees-changed"));
          onChanged?.();
        }}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New worktree</DialogTitle>
            <DialogDescription>
              {branchList
                ? `Branch off ${branchList.repo} into an isolated checkout for one silo. A farming name is assigned automatically.`
                : "Reading branches…"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="type-label">Branch</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="justify-between font-mono"
                    disabled={!branchList}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <GitBranchIcon className="size-3.5" />
                      {branch || "choose a branch"}
                    </span>
                    <ChevronDownIcon className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
                  <DropdownMenuLabel>Branches</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(branchList?.branches || []).map((item) => (
                    <DropdownMenuItem
                      key={item.name}
                      onSelect={() => setBranch(item.name)}
                    >
                      <span className="font-mono">{item.name}</span>
                      {!item.pushed && (
                        <span className="ml-auto type-caption text-muted-foreground">
                          unpushed
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="type-label">Silo</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-between">
                    <span className="inline-flex items-center gap-1.5">
                      <ServerIcon className="size-3.5" />
                      {silo || "choose a silo"}
                    </span>
                    <ChevronDownIcon className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {accounts.map((account) => (
                    <DropdownMenuItem
                      key={account.name}
                      onSelect={() => setSilo(account.name)}
                    >
                      {account.name}
                      {account.running && (
                        <span className="ml-auto type-caption text-(--success)">
                          running
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!branch || !silo || creating}
              onClick={() => void create()}
            >
              {creating ? "Creating…" : "Create worktree"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Merge a worktree's branch back into the workspace. Opens on a preview
 * (ahead/behind, fast-forward, predicted conflicts) and, when a merge leaves
 * conflicts, becomes a per-file resolver (take silo / take workspace) with
 * Complete / Abort. All git happens in the workspace repo, backend-side.
 */
export function MergeDialog({
  worktree,
  onClose,
  onNotify,
  onDone,
}: {
  worktree: Worktree | null;
  onClose: () => void;
  onNotify: (message: string) => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [merge, setMerge] = useState<MergeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!worktree) {
      setPreview(null);
      setMerge(null);
      setDone(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    invokeNative<MergeResult>("farm.worktree.merge", {
      dir: worktree.dir,
      mode: "preview",
    })
      .then((result) => {
        if (cancelled) return;
        setPreview(result.preview || null);
        setMerge(result.merge);
      })
      .catch((error) => {
        if (cancelled) return;
        onNotify(error instanceof Error ? error.message : String(error));
        onClose();
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [worktree, onClose, onNotify]);

  const inConflict = Boolean(merge?.inProgress);

  const run = async (
    payload: Record<string, unknown>,
    { closeOnDone = false } = {},
  ) => {
    setBusy(true);
    try {
      const result = await invokeNative<MergeResult>(
        "farm.worktree.merge",
        payload,
      );
      setMerge(result.merge);
      if (result.preview) setPreview(result.preview);
      if (result.status === "merged" || result.status === "up-to-date") {
        setDone(true);
        onDone();
        if (closeOnDone) onClose();
      }
      if (result.status === "aborted") onClose();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (path: string, resolution: "ours" | "theirs") => {
    setBusy(true);
    try {
      const result = await invokeNative<{ merge: MergeState }>(
        "farm.worktree.resolveConflict",
        { path, resolution },
      );
      setMerge(result.merge);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(worktree)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <GitMergeIcon className="size-4" />
            Merge {worktree?.name}
          </DialogTitle>
          <DialogDescription>
            {inConflict
              ? "Resolve each file, then complete the merge."
              : preview
                ? `Merge ${preview.wtBranch} into ${preview.target} in your workspace.`
                : "Reading merge preview…"}
          </DialogDescription>
        </DialogHeader>

        {!inConflict && preview && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono type-caption">
                <GitBranchIcon className="size-3" />
                {preview.wtBranch} → {preview.target}
              </span>
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5 type-caption tabular-nums">
                {preview.ahead} ahead · {preview.behind} behind
              </span>
              {preview.canFastForward && (
                <span className="rounded-md bg-muted/60 px-1.5 py-0.5 type-caption">
                  fast-forward
                </span>
              )}
            </div>
            {preview.alreadyMerged ? (
              <p className="type-caption inline-flex items-center gap-1.5">
                <CheckIcon className="size-3.5 text-(--success)" />
                Already up to date — nothing to merge.
              </p>
            ) : preview.workspaceDirty ? (
              <p className="type-caption inline-flex items-center gap-1.5 text-(--signal)">
                <AlertTriangleIcon className="size-3.5" />
                Your workspace has uncommitted changes — commit or stash first.
              </p>
            ) : preview.conflicts.length ? (
              <div className="flex flex-col gap-1.5">
                <p className="type-caption inline-flex items-center gap-1.5 text-(--signal)">
                  <AlertTriangleIcon className="size-3.5" />
                  {preview.conflicts.length} file
                  {preview.conflicts.length === 1 ? "" : "s"} will conflict —
                  you'll resolve them after merging.
                </p>
                <ul className="max-h-32 overflow-auto rounded-md border bg-muted/30 p-2">
                  {preview.conflicts.map((file) => (
                    <li key={file} className="truncate font-mono type-caption">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="type-caption inline-flex items-center gap-1.5">
                <CheckIcon className="size-3.5 text-(--success)" />
                Clean merge — no conflicts predicted.
              </p>
            )}
          </div>
        )}

        {inConflict && merge && (
          <div className="flex flex-col gap-1.5">
            {merge.conflicts.length ? (
              merge.conflicts.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-2 rounded-md border bg-background p-2"
                >
                  <span className="min-w-0 flex-1 truncate font-mono type-caption">
                    {file}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() => void resolve(file, "theirs")}
                  >
                    Take silo
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() => void resolve(file, "ours")}
                  >
                    Take workspace
                  </Button>
                </div>
              ))
            ) : (
              <p className="type-caption inline-flex items-center gap-1.5">
                <CheckIcon className="size-3.5 text-(--success)" />
                All conflicts resolved — complete the merge.
              </p>
            )}
            <p className="type-caption text-muted-foreground">
              For a hand-merge, edit the file in your workspace, then complete.
            </p>
          </div>
        )}

        <DialogFooter>
          {inConflict ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run({ mode: "abort" })}
              >
                Abort
              </Button>
              <Button
                disabled={busy || (merge?.conflicts.length ?? 0) > 0}
                onClick={() => void run({ mode: "continue" }, { closeOnDone: true })}
              >
                Complete merge
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                {done ? "Close" : "Cancel"}
              </Button>
              <Button
                disabled={
                  busy ||
                  done ||
                  !preview ||
                  preview.alreadyMerged ||
                  preview.workspaceDirty
                }
                onClick={() =>
                  worktree &&
                  void run(
                    { dir: worktree.dir, mode: "apply" },
                    { closeOnDone: preview?.conflicts.length === 0 },
                  )
                }
              >
                {busy
                  ? "Merging…"
                  : preview?.conflicts.length
                    ? "Merge & resolve"
                    : "Merge"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
