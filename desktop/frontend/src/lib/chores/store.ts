import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import type { ChoresSnapshot, ChoreTask } from "@/types/farm";

/** Mutations mirror the controller's ledger events one-to-one — the store
 *  posts the event and adopts the returned snapshot. */
export type ChoreMutation =
  | { type: "task.created"; task: Partial<ChoreTask> & { title: string } }
  | { type: "task.updated"; taskId: string; patch: Partial<Pick<ChoreTask, "title" | "notes" | "tags" | "start" | "due" | "estimateHours" | "data">> }
  | { type: "task.status"; taskId: string; status: ChoreTask["status"] }
  | { type: "task.lifecycle"; taskId: string; lifecycle: ChoreTask["lifecycle"] }
  | { type: "task.moved"; taskId: string; parentId: string | null; order: number }
  | { type: "task.assigned"; taskId: string; silo: string | null; provider: string | null; model: string | null }
  | { type: "task.dependency.added"; taskId: string; dependsOn: string }
  | { type: "task.dependency.removed"; taskId: string; dependsOn: string }
  | { type: "task.attachment.removed"; taskId: string; attachmentId: string }
  | { type: "task.deleted"; taskId: string }
  | { type: "task.restored"; taskId: string };

export interface ChoresStore {
  snapshot: ChoresSnapshot | null;
  error: string | null;
  refresh: () => Promise<void>;
  mutate: (mutation: ChoreMutation) => Promise<ChoresSnapshot & { id?: string }>;
  byId: Map<string, ChoreTask>;
  childrenOf: (parentId: string | null) => ChoreTask[];
  blocked: Set<string>;
}

/** Would adding taskId→dependsOn close a loop? Same DFS the controller
 *  runs — the UI uses it to disable cycle-invalid picker options. */
export function choreWouldCycle(tasks: ChoreTask[], taskId: string, dependsOn: string): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of byId.get(current)?.dependsOn ?? []) stack.push(next);
  }
  return false;
}

export function useChores(pollMs = 5000): ChoresStore {
  const [snapshot, setSnapshot] = useState<ChoresSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!hasNativeBridge()) return;
    try {
      const next = await invokeNative<ChoresSnapshot>("farm.chores.list");
      if (alive.current) {
        setSnapshot(next);
        setError(null);
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [refresh, pollMs]);

  const mutate = useCallback(async (mutation: ChoreMutation) => {
    const next = await invokeNative<ChoresSnapshot & { id?: string }>("farm.chores.mutate", mutation);
    if (alive.current) {
      setSnapshot(next);
      setError(null);
    }
    return next;
  }, []);

  const byId = useMemo(
    () => new Map((snapshot?.tasks ?? []).map((task) => [task.id, task])),
    [snapshot],
  );

  const childrenIndex = useMemo(() => {
    const index = new Map<string | null, ChoreTask[]>();
    for (const task of snapshot?.tasks ?? []) {
      const list = index.get(task.parentId) ?? [];
      list.push(task);
      index.set(task.parentId, list);
    }
    return index;
  }, [snapshot]);

  const childrenOf = useCallback(
    (parentId: string | null) => childrenIndex.get(parentId) ?? [],
    [childrenIndex],
  );

  const blocked = useMemo(() => new Set(snapshot?.blocked ?? []), [snapshot]);

  return { snapshot, error, refresh, mutate, byId, childrenOf, blocked };
}
