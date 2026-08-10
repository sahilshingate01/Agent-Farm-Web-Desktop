import { invokeNative } from "@/lib/native";
import type { MarkdownWorkspaceIndex } from "@/types/farm";

// Workspace indexing can walk a large tree. Keep one shared snapshot and one
// in-flight request so independent panels never trigger duplicate scans.
const TTL_MS = 15_000;
let snapshot: MarkdownWorkspaceIndex | null = null;
let loadedAt = 0;
let pending: Promise<MarkdownWorkspaceIndex> | null = null;

export function getWorkspaceIndex(options: { force?: boolean } = {}) {
  const fresh = snapshot && Date.now() - loadedAt < TTL_MS;
  if (!options.force && fresh) return Promise.resolve(snapshot!);
  if (pending) return pending;
  pending = invokeNative<MarkdownWorkspaceIndex>("farm.workspace.list")
    .then((next) => {
      snapshot = next;
      loadedAt = Date.now();
      return next;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function invalidateWorkspaceIndex() {
  snapshot = null;
  loadedAt = 0;
}

if (typeof window !== "undefined") {
  window.addEventListener("agensis:workspace-root-changed", invalidateWorkspaceIndex);
}
