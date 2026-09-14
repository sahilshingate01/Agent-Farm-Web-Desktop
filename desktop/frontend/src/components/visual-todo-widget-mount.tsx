import {
  Component,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
  type CSSProperties,
} from "react";
import { CheckIcon, FilterIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import {
  VisualTodo,
  loadAllAnnotations,
  saveAnnotations,
  type VisualTodoAnnotation,
  type VisualTodoAnnotationStatus,
} from "visual-todo-widget";
import { invokeNative } from "@/lib/native";
import { cssToken } from "@/lib/utils";

type TodoItem = VisualTodoAnnotation & {
  status: VisualTodoAnnotationStatus;
  lifecycle?: "logged" | "queued" | "in-progress" | "done";
  progress?: string;
  createdAt: string;
  updatedAt: string;
};

const PROJECT_TODO_PATH = "AGENSIS_TODO.md";
const POLL_MS = 5000;
const DEFAULT_TINT = "#4f7fe8"; // --primary at default theme; runtime reads the live token

function hexToRgba(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function readTintColor() {
  try {
    const settings = JSON.parse(
      window.localStorage.getItem("feedback-toolbar-settings") || "{}",
    );
    return typeof settings.annotationColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(settings.annotationColor)
      ? settings.annotationColor
      : cssToken("--primary", DEFAULT_TINT);
  } catch {
    return cssToken("--primary", DEFAULT_TINT);
  }
}

function readWebhookUrl() {
  try {
    const settings = JSON.parse(
      window.localStorage.getItem("feedback-toolbar-settings") || "{}",
    );
    const url = settings.webhookUrl;
    return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

function shouldInstallManagedWebhook(
  currentValue: string | null,
  managedValue: string,
) {
  if (!currentValue) return true;
  try {
    const current = new URL(currentValue);
    const managed = new URL(managedValue);
    // Earlier development builds used another gateway-owned /hooks/* path.
    // Migrate that local default without disturbing a user-supplied receiver
    // on another origin.
    return (
      current.origin === managed.origin
      && current.pathname.startsWith("/hooks/")
      && current.pathname !== managed.pathname
    );
  } catch {
    return true;
  }
}

function logVisualTodoError(error: unknown, context: string) {
  console.error(`[visual-todo-widget] ${context}`, error);
  try {
    const key = "agensis-farm-visual-todo-errors-v1";
    const current = JSON.parse(window.localStorage.getItem(key) || "[]");
    const entry = {
      context,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
    window.localStorage.setItem(
      key,
      JSON.stringify(
        [entry, ...(Array.isArray(current) ? current : [])].slice(0, 20),
      ),
    );
  } catch {
    // Logging must never become a second failure path.
  }
}

class VisualTodoErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; retry: number }
> {
  state: { error: Error | null; retry: number } = { error: null, retry: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logVisualTodoError(
      { error, componentStack: info.componentStack },
      "render crash",
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="visual-todo-widget-error" data-visual-todo-toolbar role="alert">
          <strong>VisualTodo paused</strong>
          <span>{this.state.error.message || "The dev widget crashed."}</span>
          <button
            type="button"
            onClick={() =>
              this.setState({ error: null, retry: this.state.retry + 1 })
            }
          >
            Retry widget
          </button>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}

function markerAnnotations(): VisualTodoAnnotation[] {
  const markers = new Map<string, VisualTodoAnnotation>();
  for (const annotations of loadAllAnnotations<VisualTodoAnnotation>().values()) {
    for (const annotation of annotations) markers.set(annotation.id, annotation);
  }
  return [...markers.values()].sort(
    (left, right) => (left.timestamp || 0) - (right.timestamp || 0),
  );
}

async function syncTodoLedger(
  projectRoot?: string,
): Promise<{ todos: TodoItem[]; deletedIds: string[] }> {
  if (!window.zero) return { todos: [], deletedIds: [] };
  const result = await invokeNative<{ todos: TodoItem[]; deletedIds?: string[] }>(
    "farm.visual-todo.todo.sync",
    { projectRoot, annotations: markerAnnotations() },
  );
  return { todos: result.todos || [], deletedIds: result.deletedIds || [] };
}

async function appendTodoLedgerEvent(
  projectRoot: string | undefined,
  payload: Record<string, unknown>,
) {
  if (!window.zero) return;
  await invokeNative("farm.visual-todo.todo.append", { projectRoot, ...payload });
}

function todoMarkdown(todos: TodoItem[]) {
  const lines = [
    "# Agensis Farm TODO",
    "",
    "This file is maintained by the dev-only VisualTodo widget.",
    "",
  ];
  for (const todo of todos) {
    const checkbox = todo.status === "done" ? "x" : " ";
    const state = todo.status === "in-progress" ? "in progress" : todo.status;
    lines.push(`- [${checkbox}] ${todo.comment} — ${todo.element} (${state})`);
    if (todo.elementPath) lines.push(`  - Target: \`${todo.elementPath}\``);
    if (todo.selectedText) lines.push(`  - Selection: ${todo.selectedText}`);
    if (todo.progress) lines.push(`  - Progress: ${todo.progress}`);
  }
  if (!todos.length) lines.push("- [ ] No visual TODOs yet.");
  return `${lines.join("\n")}\n`;
}

function statusLabel(status: VisualTodoAnnotationStatus) {
  return status === "in-progress"
    ? "In progress"
    : status === "done"
      ? "Done"
      : "Todo";
}

function TodoStageIndicator({ lifecycle }: { lifecycle: NonNullable<TodoItem["lifecycle"]> }) {
  const queued = ["queued", "in-progress", "done"].includes(lifecycle);
  const running = ["in-progress", "done"].includes(lifecycle);
  const done = lifecycle === "done";
  return (
    <span className={`visual-todo-stage-indicator visual-todo-stage-${lifecycle}`} aria-label={lifecycle}>
      <span className={queued ? "is-reached" : ""} />
      <span className={running ? "is-reached" : ""}>
        {lifecycle === "in-progress" && <LoaderCircleIcon />}
      </span>
      <span className={done ? "is-reached" : ""}>
        {done && <CheckIcon />}
      </span>
    </span>
  );
}

async function readProjectStatuses(todos: TodoItem[]) {
  if (!window.zero || !todos.length) return null;
  try {
    const document = await invokeNative<{ content: string }>(
      "farm.workspace.read",
      {
        path: PROJECT_TODO_PATH,
      },
    );
    const statusByComment = new Map<string, VisualTodoAnnotationStatus>();
    const progressByComment = new Map<string, string>();
    let currentComment: string | null = null;
    for (const line of document.content.split(/\r?\n/)) {
      const match = line.match(/^- \[([ xX])\] (.+?) — /);
      if (match) {
        currentComment = match[2].replace(
          / \((?:in progress|done|todo)\)$/,
          "",
        );
        const status = /\(in progress\)/i.test(line)
          ? "in-progress"
          : /\[[xX]\]/.test(match[1]) || /\(done\)/i.test(line)
            ? "done"
            : "todo";
        statusByComment.set(currentComment, status);
        continue;
      }
      const progress = line.match(/^\s+- (?:Progress|Last response):\s*(.+)$/i);
      if (currentComment && progress)
        progressByComment.set(currentComment, progress[1]);
    }
    return todos.map((todo) => {
      const status = statusByComment.get(todo.comment);
      const progress = progressByComment.get(todo.comment);
      return {
        ...todo,
        ...(status && status !== todo.status ? { status } : {}),
        ...(progress && progress !== todo.progress ? { progress } : {}),
      };
    });
  } catch {
    return null;
  }
}

type VisualTodoTaskSnapshot = {
  todoId: string;
  status: string;
  provider: string | null;
  model: string | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  progress: string | null;
  error: string | null;
  exitCode: number | null;
  updatedAt?: string | null;
  queuePosition?: number;
};

function taskProgress(task: VisualTodoTaskSnapshot) {
  if (task.progress) return task.progress;
  const agent = task.provider || "agent";
  const model = task.model ? ` (${task.model})` : "";
  if (task.status === "falling-back") {
    const fallbackModel = task.fallbackModel ? ` (${task.fallbackModel})` : "";
    return `${agent}${model} unavailable — switching to ${task.fallbackProvider || "fallback agent"}${fallbackModel}`;
  }
  if (task.status === "running" || task.status === "started") {
    return `${agent}${model} is working`;
  }
  if (task.status === "queued" || task.status === "launching") {
    return task.queuePosition && task.queuePosition > 1
      ? `Queued · ${task.queuePosition - 1} ahead`
      : "Queued · next";
  }
  if (task.status === "completed") {
    return `${agent}${model} completed — checking its TODO update`;
  }
  if (task.status === "failed") {
    return task.error
      ? `${agent}${model} failed: ${task.error}`
      : `${agent}${model} exited with code ${task.exitCode ?? "unknown"}`;
  }
  return `${agent}${model}: ${task.status}`;
}

async function readTaskStatuses(todos: TodoItem[]) {
  if (!window.zero || !todos.length) return todos;
  try {
    const result = await invokeNative<{ tasks: VisualTodoTaskSnapshot[] }>(
      "farm.visual-todo.status",
      { todoIds: todos.map((todo) => todo.id) },
    );
    const latestByTodo = new Map<string, VisualTodoTaskSnapshot>();
    for (const task of result.tasks || []) {
      const current = latestByTodo.get(task.todoId);
      if (
        !current ||
        (current.status !== "completed" && task.status === "completed") ||
        (current.status !== "completed" &&
          Date.parse(task.updatedAt || "") > Date.parse(current.updatedAt || ""))
      ) {
        latestByTodo.set(task.todoId, task);
      }
    }
    return todos.map((todo) => {
      const task = latestByTodo.get(todo.id);
      if (!task || todo.status === "done") return todo;
      const status: VisualTodoAnnotationStatus = task.status === "completed"
        ? "done"
        : ["running", "started", "falling-back"].includes(task.status)
          ? "in-progress"
          : todo.status;
      const lifecycle: TodoItem["lifecycle"] = task.status === "completed"
        ? "done"
        : ["running", "started", "falling-back"].includes(task.status)
          ? "in-progress"
          : ["queued", "launching"].includes(task.status)
            ? "queued"
            : todo.lifecycle || "logged";
      return {
        ...todo,
        // Native task completion is a concrete transition for this exact TODO,
        // so it may advance the durable state. It never demotes a completed TODO.
        status,
        lifecycle,
        progress: taskProgress(task),
      };
    });
  } catch {
    return todos;
  }
}

export function VisualTodoWidgetMount({
  projectRoot,
  webhookUrl,
}: {
  projectRoot?: string;
  webhookUrl?: string;
}) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [widgetRevision, setWidgetRevision] = useState(0);
  const todosRef = useRef(todos);
  const dispatchingRef = useRef(new Set<string>());
  const [panelOpen, setPanelOpen] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [todoFilter, setTodoFilter] = useState<"all" | "logged" | "queued" | "in-progress" | "done">("all");
  const [tintColor, setTintColor] = useState(DEFAULT_TINT);

  // Ledger tombstones: ids deleted for good. EVERY update path filters
  // against this set — runner events for a dead id must not resurrect it
  // (the "why do these keep coming back" bug).
  const tombstonesRef = useRef(new Set<string>());
  const updateTodos = (updater: (current: TodoItem[]) => TodoItem[]) => {
    setTodos((current) => {
      const next = updater(current).filter((todo) => !tombstonesRef.current.has(String(todo.id)));
      todosRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    void syncTodoLedger(projectRoot).then(({ todos: next, deletedIds }) => {
      for (const id of deletedIds) tombstonesRef.current.add(String(id));
      todosRef.current = next;
      setTodos(next);
    }).catch((error) => logVisualTodoError(error, "TODO ledger sync failed"));
  }, [projectRoot]);

  useEffect(() => {
    if (!window.zero) return;
    let events: EventSource | null = null;
    let disposed = false;
    void invokeNative<{ url?: string; ready?: boolean }>("farm.visual-todo.worker.start", { projectRoot })
      .then((worker) => {
        if (disposed || !worker.ready || !worker.url) return;
        // Keep the embedded WebKit connection same-origin; Vite forwards this
        // to the persistent VisualTodo worker during development.
        events = new EventSource("/__visual_todo_worker/events");
        events.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data) as {
              id?: string;
              state?: TodoItem["lifecycle"] | "ready";
              progress?: string;
            };
            if (!event.id || !event.state || event.state === "ready") return;
            const lifecycle = event.state;
            const status: VisualTodoAnnotationStatus = lifecycle === "done"
              ? "done"
              : lifecycle === "in-progress"
                ? "in-progress"
                : "todo";
            updateTodos((current) => current.map((todo) =>
              todo.id === event.id
                ? { ...todo, lifecycle, status, ...(event.progress ? { progress: event.progress } : {}), updatedAt: new Date().toISOString() }
                : todo,
            ));
            void appendTodoLedgerEvent(projectRoot, {
              type: "todo.lifecycle",
              todoId: event.id,
              lifecycle,
              source: "worker",
            });
            if (event.progress) {
              void appendTodoLedgerEvent(projectRoot, {
                type: "todo.progress",
                todoId: event.id,
                progress: event.progress,
                source: "worker",
              });
            }
          } catch (error) {
            logVisualTodoError(error, "warm worker event failed");
          }
        };
      })
      .catch((error) => logVisualTodoError(error, "warm worker start failed"));
    return () => {
      disposed = true;
      events?.close();
    };
  }, [projectRoot]);

  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  useEffect(() => {
    if (!webhookUrl || !shouldInstallManagedWebhook(readWebhookUrl(), webhookUrl)) {
      return;
    }
    try {
      const current = JSON.parse(
        window.localStorage.getItem("feedback-toolbar-settings") || "{}",
      );
      window.localStorage.setItem(
        "feedback-toolbar-settings",
        JSON.stringify({
          ...current,
          webhookUrl,
          webhooksEnabled: true,
        }),
      );
      window.dispatchEvent(new Event("feedback-toolbar-settings-updated"));
    } catch (error) {
      logVisualTodoError(error, "default webhook setup failed");
    }
  }, [webhookUrl]);

  useEffect(() => {
    const refreshTint = () => setTintColor(readTintColor());
    refreshTint();
    const timer = window.setInterval(refreshTint, POLL_MS);
    window.addEventListener("storage", refreshTint);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", refreshTint);
    };
  }, []);

  useEffect(() => {
    const refresh = async () => {
      // The project markdown is an audit trail written asynchronously. Reading
      // it here can race a click and revert the visible state, so task metadata
      // and the in-memory local state are the only live sources of truth.
      const ledger = await syncTodoLedger(projectRoot);
      for (const id of ledger.deletedIds) tombstonesRef.current.add(String(id));
      const next = await readTaskStatuses(ledger.todos.length ? ledger.todos : todosRef.current);
      for (const todo of next) {
        const previous = todosRef.current.find((item) => item.id === todo.id);
        if (previous && previous.status !== todo.status) {
          await appendTodoLedgerEvent(projectRoot, {
            type: "todo.status",
            todoId: todo.id,
            status: todo.status,
            source: "task",
          });
        }
        if (previous && todo.lifecycle && previous.lifecycle !== todo.lifecycle) {
          await appendTodoLedgerEvent(projectRoot, {
            type: "todo.lifecycle",
            todoId: todo.id,
            lifecycle: todo.lifecycle,
            source: "task",
          });
        }
        if (previous && todo.progress && previous.progress !== todo.progress) {
          await appendTodoLedgerEvent(projectRoot, {
            type: "todo.progress",
            todoId: todo.id,
            progress: todo.progress,
            source: "task",
          });
        }
      }
      updateTodos((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const handleExternalUpdate = () => void refresh();
    window.addEventListener("agensis-farm:todo-updated", handleExternalUpdate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(
        "agensis-farm:todo-updated",
        handleExternalUpdate,
      );
    };
  }, [projectRoot]);

  useEffect(() => {
    if (window.zero) {
      void invokeNative("farm.workspace.write", {
        path: PROJECT_TODO_PATH,
        content: todoMarkdown(todos),
      }).catch((error) => logVisualTodoError(error, "project TODO write failed"));
    }
  }, [todos]);

  // A webhook may be started after the annotations already exist. Always send
  // a complete TODO snapshot on startup and after each local/status change so
  // the receiver can rebuild its queue without relying on missed events.
  useEffect(() => {
    const url = readWebhookUrl();
    if (!url) return;
    const payload = {
      event: "todo.snapshot",
      timestamp: Date.now(),
      projectRoot,
      todos,
      pending: todos.filter((todo) => todo.status !== "done"),
      completed: todos.filter((todo) => todo.status === "done").length,
      total: todos.length,
    };
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Webhook returned HTTP ${response.status}.`);
        }
      })
      .catch((error) => logVisualTodoError(error, "TODO snapshot webhook failed"));
  }, [projectRoot, todos]);

  const upsert = (annotation: VisualTodoAnnotation) => {
    setTodos((current) => {
      const now = new Date().toISOString();
      const existing = current.find((todo) => todo.id === annotation.id);
      const next: TodoItem = {
        ...annotation,
        status: existing?.status || "todo",
        progress: existing?.progress,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      return existing
        ? current.map((todo) => (todo.id === annotation.id ? next : todo))
        : [...current, next];
    });
  };

  const remove = (annotation: VisualTodoAnnotation) => {
    tombstonesRef.current.add(String(annotation.id));
    for (const [pathname, annotations] of loadAllAnnotations<VisualTodoAnnotation>()) {
      saveAnnotations(pathname, annotations.filter((item) => item.id !== annotation.id));
    }
    setWidgetRevision((revision) => revision + 1);
    updateTodos((current) => current.filter((todo) => todo.id !== annotation.id));
    dispatchingRef.current.delete(annotation.id);
    void appendTodoLedgerEvent(projectRoot, {
      type: "todo.deleted",
      todoId: annotation.id,
      source: "user",
    }).catch((error) => logVisualTodoError(error, "TODO deletion write failed"));
  };

  // Clearing VisualTodo annotations only clears visual markers. Durable TODOs are a
  // separate project record and remain until their own row-level delete action.
  const clear = (_annotations: VisualTodoAnnotation[]) => {};

  const setStatus = (id: string, status: VisualTodoAnnotationStatus) => {
    updateTodos((current) =>
      current.map((todo) =>
        todo.id === id
          ? {
              ...todo,
              status,
              lifecycle: status === "done" ? "done" : status === "in-progress" ? "in-progress" : "logged",
              updatedAt: new Date().toISOString(),
            }
          : todo,
      ),
    );
    void appendTodoLedgerEvent(projectRoot, { type: "todo.status", todoId: id, status, source: "user" })
      .catch((error) => logVisualTodoError(error, "TODO status write failed"));
  };

  const setProgress = (id: string, progress: string) => {
    updateTodos((current) =>
      current.map((todo) =>
        todo.id === id
          ? { ...todo, progress, updatedAt: new Date().toISOString() }
          : todo,
      ),
    );
    void appendTodoLedgerEvent(projectRoot, { type: "todo.progress", todoId: id, progress, source: "agent" })
      .catch((error) => logVisualTodoError(error, "TODO progress write failed"));
  };

  const setLifecycle = (id: string, lifecycle: NonNullable<TodoItem["lifecycle"]>) => {
    const status: VisualTodoAnnotationStatus = lifecycle === "done"
      ? "done"
      : lifecycle === "in-progress"
        ? "in-progress"
        : "todo";
    updateTodos((current) => current.map((todo) =>
      todo.id === id ? { ...todo, lifecycle, status, updatedAt: new Date().toISOString() } : todo,
    ));
    void appendTodoLedgerEvent(projectRoot, {
      type: "todo.lifecycle",
      todoId: id,
      lifecycle,
      source: "scheduler",
    }).catch((error) => logVisualTodoError(error, "TODO lifecycle write failed"));
  };

  const dispatchTodo = async (todo: TodoItem) => {
    if (!window.zero || todo.status === "done") return;
    if (dispatchingRef.current.has(todo.id)) return;
    dispatchingRef.current.add(todo.id);
    setLifecycle(todo.id, "queued");
    await appendTodoLedgerEvent(projectRoot, { type: "todo.progress", todoId: todo.id, progress: "Queued for agent", source: "agent" });
    setProgress(todo.id, "Starting agent…");

    const prompt = [
      "Implement exactly this visual TODO now.",
      `TODO: ${todo.comment}`,
      `Target: ${todo.element || "unknown"}`,
      todo.elementPath ? `Element path: ${todo.elementPath}` : "",
      todo.selectedText ? `Selected text: ${todo.selectedText}` : "",
      "Do not delegate, consult advisors, load MCP, browse broadly, or write a plan.",
      "Inspect only the target and its direct implementation. Make the smallest correct edit immediately.",
      "Run one narrow verification, then report the changed file and result. Do not edit unrelated TODOs.",
    ].filter(Boolean).join("\n");

    try {
      const result = await invokeNative<{
        provider?: string;
        model?: string;
        pid?: number;
        status?: string;
        position?: number;
      }>("farm.visual-todo.dispatch", {
        provider: "auto",
        projectRoot,
        todo,
        prompt,
      });
      setProgress(
        todo.id,
        result.status === "queued"
          ? result.position && result.position > 1
            ? `Queued · ${result.position - 1} ahead`
            : "Queued · next"
          : `Agent started${result.provider ? ` (${result.provider})` : ""}${result.pid ? ` · pid ${result.pid}` : ""}`,
      );
      if (result.status !== "queued") setLifecycle(todo.id, "in-progress");
    } catch (error) {
      dispatchingRef.current.delete(todo.id);
      setLifecycle(todo.id, "logged");
      setProgress(todo.id, "Agent dispatch failed — retrying on next run");
      logVisualTodoError(error, `agent dispatch failed for ${todo.comment}`);
    }
  };

  useEffect(() => {
    if (!window.zero) return;
    const active = todos.some(
      (todo) =>
        todo.status === "in-progress" &&
        /Starting agent|Agent started|is working|switching to|completed — checking/i.test(
          todo.progress || "",
        ),
    );
    if (active) return;
    const next = todos.find(
      (todo) => todo.status === "todo" && !dispatchingRef.current.has(todo.id),
    );
    if (next) void dispatchTodo(next);
    // One task owns the project worktree at a time. The next task is released
    // only after native status polling reports that this one has settled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot, todos]);

  const handleAnnotationAdd = (annotation: VisualTodoAnnotation) => {
    const now = new Date().toISOString();
    const todo: TodoItem = {
      ...annotation,
      status: "todo",
      createdAt: now,
      updatedAt: now,
    };
    void syncTodoLedger(projectRoot).then(({ todos: next, deletedIds }) => {
      for (const id of deletedIds) tombstonesRef.current.add(String(id));
      todosRef.current = next;
      setTodos(next);
      const created = next.find((item) => item.id === todo.id);
      if (created) void dispatchTodo(created);
    }).catch((error) => logVisualTodoError(error, "TODO marker sync failed"));
  };

  const handleAgentDispatch = async (payload: {
    annotations: VisualTodoAnnotation[];
  }) => {
    const byId = new Map(todos.map((todo) => [todo.id, todo]));
    for (const annotation of payload.annotations) {
      const todo = byId.get(annotation.id);
      if (todo) void dispatchTodo(todo);
    }
  };

  const statuses = Object.fromEntries(
    todos.map((todo) => [todo.id, todo.status]),
  ) as Record<string, VisualTodoAnnotationStatus>;
  const filteredTodos = todos.filter((todo) => {
    const lifecycle = todo.lifecycle || (todo.status === "done" ? "done" : todo.status === "in-progress" ? "in-progress" : "logged");
    if (todoFilter !== "all") return lifecycle === todoFilter;
    return true;
  }).sort((left, right) => {
    const lifecycle = (todo: TodoItem) => todo.lifecycle || (todo.status === "done" ? "done" : todo.status === "in-progress" ? "in-progress" : "logged");
    const priority = { "in-progress": 0, queued: 1, logged: 2, done: 3 } as const;
    const stateDifference = priority[lifecycle(left)] - priority[lifecycle(right)];
    if (stateDifference) return stateDifference;
    if (lifecycle(left) === "queued") {
      const position = (todo: TodoItem) => {
        if (/next/i.test(todo.progress || "")) return 0;
        return Number(todo.progress?.match(/(\d+) ahead/i)?.[1] || Number.MAX_SAFE_INTEGER);
      };
      const queueDifference = position(left) - position(right);
      if (queueDifference) return queueDifference;
    }
    return Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
  });

  return (
    <>
      <VisualTodoErrorBoundary>
        <VisualTodo
          key={widgetRevision}
          annotationStatuses={statuses}
          onAnnotationAdd={handleAnnotationAdd}
          onAnnotationUpdate={upsert}
          onAnnotationDelete={remove}
          onAnnotationsClear={clear}
          onAgentDispatch={handleAgentDispatch}
          visibleControls={{
            pause: true,
            markers: true,
            copy: true,
            // Comments are queued immediately. A second Send action implies a
            // manual dispatch step that this dev-only workflow does not have.
            send: false,
            clear: true,
            settings: true,
            inspector: true,
            exit: true,
          }}
        />
      </VisualTodoErrorBoundary>
      {todos.length > 0 && (
      <section
          className={`visual-todo-panel ${panelOpen ? "" : "visual-todo-panel-collapsed"}`}
          data-visual-todo-toolbar
          aria-label="Visual TODO list"
          style={
            {
              "--visual-todo-tint-color": tintColor,
              "--visual-todo-tint-bg": hexToRgba(tintColor, 0.12),
              "--visual-todo-tint-border": hexToRgba(tintColor, 0.24),
            } as CSSProperties
          }
        >
          <header className="visual-todo-panel-header">
            <button
              type="button"
              className="visual-todo-panel-toggle"
              onClick={() => setPanelOpen((open) => !open)}
              aria-expanded={panelOpen}
            >
              <span>Visual TODOs</span>
              <span className="visual-todo-count">
                {todos.filter((todo) => todo.status === "done").length}/
                {todos.length}
              </span>
            </button>
            <button
              type="button"
              className="visual-todo-filter"
              aria-label="Filter visual TODOs"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <FilterIcon />
            </button>
            {filterOpen && (
              <div className="visual-todo-filter-menu" role="menu">
                {(["all", "logged", "queued", "in-progress", "done"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    role="menuitemradio"
                    aria-checked={todoFilter === filter}
                    className={`visual-todo-filter-option ${todoFilter === filter ? "visual-todo-filter-option-active" : ""}`}
                    onClick={() => { setTodoFilter(filter); setFilterOpen(false); }}
                  >
                    <span>{filter === "in-progress" ? "In progress" : filter[0].toUpperCase() + filter.slice(1)}</span>
                    <span>{filter === "all" ? todos.length : todos.filter((todo) => {
                      const lifecycle = todo.lifecycle || (todo.status === "done" ? "done" : todo.status === "in-progress" ? "in-progress" : "logged");
                      return lifecycle === filter;
                    }).length}</span>
                  </button>
                ))}
              </div>
            )}
          </header>
          {panelOpen && (
            <div className="visual-todo-list">
              {filteredTodos.length === 0 && (
                <p className="visual-todo-empty">{todos.length === 0 ? "No visual TODOs yet." : `No ${todoFilter} TODOs.`}</p>
              )}
              {filteredTodos.map((todo) => (
                <article
                  key={todo.id}
                  className={`visual-todo-item visual-todo-${todo.status}`}
                >
                  <button
                    type="button"
                    className="visual-todo-status"
                    onClick={() =>
                      setStatus(
                        todo.id,
                        todo.status === "todo"
                          ? "in-progress"
                          : todo.status === "in-progress"
                            ? "done"
                            : "todo",
                      )
                    }
                    aria-label={`Mark ${todo.comment} as ${statusLabel(todo.status === "todo" ? "in-progress" : todo.status === "in-progress" ? "done" : "todo")}`}
                  >
                    <TodoStageIndicator
                      lifecycle={todo.lifecycle || (todo.status === "done" ? "done" : todo.status === "in-progress" ? "in-progress" : "logged")}
                    />
                  </button>
                  <div className="visual-todo-copy">
                    <p>{todo.comment}</p>
                    <small>
                      {todo.progress ||
                        (todo.status === "done"
                          ? "Completed"
                          : todo.status === "in-progress"
                            ? "Waiting for agent update"
                            : "Ready for agent")}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="visual-todo-remove"
                    onClick={() => remove(todo)}
                    aria-label={`Remove ${todo.comment}`}
                  >
                    <XIcon />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
