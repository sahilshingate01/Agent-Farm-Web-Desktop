import type { ChoreTask } from "@/types/farm";

/** Planning duration in days: calendar span when both dates exist,
 *  else the estimate rounded up to days, else one day. */
export function choreDurationDays(task: ChoreTask): number {
  if (task.start && task.due) {
    const span = (Date.parse(task.due) - Date.parse(task.start)) / 86_400_000;
    if (Number.isFinite(span)) return Math.max(span, 0) + 1;
  }
  if (task.estimateHours != null && task.estimateHours > 0) {
    return Math.max(1, Math.ceil(task.estimateHours / 24));
  }
  return 1;
}

export interface CriticalPathResult {
  /** Tasks on the longest-duration dependency chain among non-done tasks. */
  taskIds: Set<string>;
  /** Edges on that chain, keyed "depId->taskId". */
  edges: Set<string>;
}

/** Longest-path walk over the finish-to-start DAG of non-done chores.
 *  A lone task with no dependency edges is not a path — returns empty. */
export function criticalPath(tasks: ChoreTask[]): CriticalPathResult {
  const open = tasks.filter((task) => task.status !== "done");
  const ids = new Set(open.map((task) => task.id));
  const byId = new Map(open.map((task) => [task.id, task]));

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of open) {
    const deps = task.dependsOn.filter((dep) => ids.has(dep));
    indegree.set(task.id, deps.length);
    for (const dep of deps) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);
    }
  }

  const queue = open.filter((task) => indegree.get(task.id) === 0).map((task) => task.id);
  const finish = new Map<string, number>();
  const via = new Map<string, string | null>();
  while (queue.length) {
    const id = queue.shift()!;
    const task = byId.get(id)!;
    let best = 0;
    let bestDep: string | null = null;
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) continue;
      const done = finish.get(dep) ?? 0;
      if (done > best) {
        best = done;
        bestDep = dep;
      }
    }
    finish.set(id, best + choreDurationDays(task));
    via.set(id, bestDep);
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  let endId: string | null = null;
  let max = 0;
  for (const [id, value] of finish) {
    if (value > max) {
      max = value;
      endId = id;
    }
  }

  const taskIds = new Set<string>();
  const edges = new Set<string>();
  let cursor = endId;
  while (cursor) {
    taskIds.add(cursor);
    const prev = via.get(cursor) ?? null;
    if (prev) edges.add(`${prev}->${cursor}`);
    cursor = prev;
  }
  if (taskIds.size <= 1) return { taskIds: new Set(), edges: new Set() };
  return { taskIds, edges };
}
