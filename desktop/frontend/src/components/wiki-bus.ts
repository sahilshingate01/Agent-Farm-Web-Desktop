/**
 * Tiny request bus between the main sidebar and the Wiki workspace. The
 * sidebar's agentic sections live outside the AgenticWorkspace subtree (and
 * the workspace may not be mounted yet when a row is clicked), so requests
 * are buffered until a subscriber appears.
 */
export type WikiRequest =
  | { kind: "open"; path: string }
  /** Absolute path readable only via farm.agentic.read (outside the
   *  workspace root, or a non-document extension) — opens read-only. */
  | { kind: "open-readonly"; path: string }
  | { kind: "create"; prefix: string };

let pending: WikiRequest | null = null;
const listeners = new Set<(request: WikiRequest) => void>();

export function requestWiki(request: WikiRequest) {
  if (listeners.size) {
    for (const listener of listeners) listener(request);
  } else {
    pending = request;
  }
}

export function subscribeWiki(listener: (request: WikiRequest) => void) {
  listeners.add(listener);
  if (pending) {
    const request = pending;
    pending = null;
    listener(request);
  }
  return () => {
    listeners.delete(listener);
  };
}

// App-wide event contract: any surface can dispatch
// `agensis:open-wiki-doc` with a workspace-relative path; the bus buffers
// it until the Wiki workspace subscribes.
if (typeof window !== "undefined") {
  window.addEventListener("agensis:open-wiki-doc", (event) => {
    const path = (event as CustomEvent<{ path?: string }>).detail?.path;
    if (typeof path === "string" && path) requestWiki({ kind: "open", path });
  });
}
