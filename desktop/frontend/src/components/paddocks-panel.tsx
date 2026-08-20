import { useEffect, useRef, useState } from "react";
import {
  GitBranchIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PlusIcon,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { invokeNative } from "@/lib/native";
import { vocab } from "@/lib/vocabulary";

/** Wire shapes of farm.paddock.* (public/backend/controller.mjs). */
export interface PaddockLocator {
  kind: "local" | "remote";
  path: string;
  host?: string;
}
export interface Paddock {
  id: string;
  name: string;
  locator: PaddockLocator;
  primedAt: string;
  /** null for remote paddocks (unverifiable from here). */
  exists: boolean | null;
  branch?: string | null;
  dirty?: boolean | null;
  lastSyncAt?: string | null;
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

function paddockFacts(paddock: Paddock) {
  if (paddock.locator.kind === "remote") {
    return `remote · ${paddock.locator.host || paddock.locator.path}`;
  }
  if (paddock.exists === false) return null; // rendered as the missing state
  const facts = [
    paddock.dirty === null || paddock.dirty === undefined
      ? null
      : paddock.dirty
        ? "dirty"
        : "clean",
    paddock.lastSyncAt ? `last sync ${relativeTime(paddock.lastSyncAt)}` : null,
  ].filter(Boolean);
  return facts.length ? facts.join(" · ") : paddock.locator.path;
}

/**
 * Paddock (primed worktree) registry grid — card CONTENT for the Crew
 * page's Paddocks panel (visual.html "worktrees" anatomy: name, muted facts
 * line, mono branch chip). Owns its own farm.paddock.list fetch; the host
 * passes notify for errors and may bump refreshKey to force a refetch.
 */
export function PaddocksPanel({
  onNotify,
  refreshKey = 0,
  onChanged,
}: {
  onNotify: (message: string) => void;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [paddocks, setPaddocks] = useState<Paddock[] | null>(null);
  const [primeOpen, setPrimeOpen] = useState(false);
  const [primeName, setPrimeName] = useState("");
  const [primePath, setPrimePath] = useState("");
  const [primeHost, setPrimeHost] = useState("");
  // Two-step remove (assignment-zone pattern): first action arms the card,
  // the second click on the armed affordance removes. No window.confirm.
  const [armedRemoveId, setArmedRemoveId] = useState<string | null>(null);
  const disarmTimer = useRef<number | null>(null);

  const load = async () => {
    try {
      const result = await invokeNative<{ paddocks: Paddock[] }>(
        "farm.paddock.list",
      );
      setPaddocks(result.paddocks);
    } catch {
      setPaddocks([]);
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

  const armRemove = (id: string) => {
    setArmedRemoveId(id);
    if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setArmedRemoveId(null), 4000);
  };
  const remove = async (id: string) => {
    setArmedRemoveId(null);
    try {
      await invokeNative("farm.paddock.remove", { id });
      await load();
      onChanged?.();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };
  const prime = async () => {
    const path = primePath.trim();
    if (!path) return;
    try {
      await invokeNative("farm.paddock.prime", {
        ...(primeName.trim() ? { name: primeName.trim() } : {}),
        path,
        ...(primeHost.trim() ? { host: primeHost.trim() } : {}),
      });
      setPrimeOpen(false);
      setPrimeName("");
      setPrimePath("");
      setPrimeHost("");
      await load();
      onChanged?.();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      {paddocks && !paddocks.length ? (
        <div className="grid min-h-[6rem] place-items-center gap-3 p-4">
          <p className="type-caption text-center">
            No primed worktrees yet. Sessions currently attach to the project
            root directly.
          </p>
          <Button variant="outline" size="sm" onClick={() => setPrimeOpen(true)}>
            <PlusIcon className="size-3.5" />
            Prime {vocab.paddock.toLowerCase()}
          </Button>
        </div>
      ) : (
        <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {(paddocks || []).map((paddock) => {
            const facts = paddockFacts(paddock);
            const armed = armedRemoveId === paddock.id;
            return (
              <article
                key={paddock.id}
                className={cn(
                  "group rounded-lg border bg-background p-3",
                  armed && "border-destructive/60",
                )}
                title={paddock.locator.path}
              >
                <header className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate type-list font-medium">
                    {paddock.name}
                  </h3>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        aria-label={`Actions for ${paddock.name}`}
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => armRemove(paddock.id)}
                      >
                        Remove…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </header>
                {paddock.exists === false ? (
                  <p className="mt-1 type-caption text-(--signal)">
                    missing — folder no longer exists
                  </p>
                ) : (
                  <p className="mt-1 truncate type-caption">{facts}</p>
                )}
                <div className="mt-2.5 flex items-center gap-1.5">
                  {paddock.locator.kind === "remote" ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono type-caption">
                      <GlobeIcon className="size-3" />
                      {paddock.locator.host || "remote"}
                    </span>
                  ) : (
                    paddock.branch && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono type-caption">
                        <GitBranchIcon className="size-3" />
                        {paddock.branch}
                      </span>
                    )
                  )}
                  {armed && (
                    <Button
                      variant="destructive"
                      size="xs"
                      className="ml-auto"
                      onClick={() => void remove(paddock.id)}
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
            onClick={() => setPrimeOpen(true)}
            className="grid min-h-[5.5rem] place-items-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
          >
            <span className="flex items-center gap-1.5 type-list">
              <PlusIcon className="size-3.5" />
              Prime {vocab.paddock.toLowerCase()}
            </span>
          </button>
        </div>
      )}
      <Dialog open={primeOpen} onOpenChange={setPrimeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Prime a {vocab.paddock.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Register a repo state agents can attach to without cloning,
              installing or rebuilding context.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="type-label">Name</span>
              <Input
                value={primeName}
                onChange={(event) => setPrimeName(event.target.value)}
                placeholder="defaults to the folder name"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="type-label">Path</span>
              <Input
                value={primePath}
                onChange={(event) => setPrimePath(event.target.value)}
                placeholder="/path/to/worktree"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void prime();
                  }
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="type-label">Remote host (optional)</span>
              <Input
                value={primeHost}
                onChange={(event) => setPrimeHost(event.target.value)}
                placeholder="user@build-box"
              />
              <span className="type-caption">
                Set a host to register a remote {vocab.paddock.toLowerCase()};
                local paths must be existing git checkouts.
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrimeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!primePath.trim()} onClick={() => void prime()}>
              Prime
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
