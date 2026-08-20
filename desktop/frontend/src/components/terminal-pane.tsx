import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { hasNativeBridge, invokeNative } from "@/lib/native";
import { cssToken } from "@/lib/utils";

type TerminalSnapshot = {
  alive: boolean;
  output: string;
  session?: string;
  shellAccount?: string;
};

export function TerminalPane({
  projectRoot,
  sessionId,
  /** Silo name for `farm shell <acct>`. Omit or pass `"host"` for this Mac. */
  shellAccount,
  initialCommand,
}: {
  projectRoot?: string;
  sessionId: string;
  shellAccount?: string | null;
  /** Typed into the terminal once it is warm (legacy / worktree path). Prefer
   *  `shellAccount` for silo shells so the pane starts inside the container. */
  initialCommand?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      convertEol: true,
      fontFamily: cssToken("--font-mono", '"JetBrains Mono Variable", "SF Mono", monospace'),
      fontSize: 11,
      lineHeight: 1.25,
      scrollback: 10000,
      // Tokens resolve at mount; the pane keeps the theme it opened with.
      theme: {
        background: "#00000000",
        foreground: cssToken("--foreground", "#d4d4d4"),
        cursor: cssToken("--primary", "#4f7fe8"),
        selectionBackground: `${cssToken("--primary", "#4f7fe8")}55`,
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    let disposed = false;
    let polling = false;
    let lastOutput = "";
    let workerUrl = "";
    let lastError = "";
    let inputChain = Promise.resolve();
    let sentInitial = false;
    const useNative = hasNativeBridge();
    const account =
      shellAccount && shellAccount !== "host" ? shellAccount : undefined;
    const basePayload = {
      projectRoot,
      sessionId,
      ...(account ? { shellAccount: account } : {}),
    };

    const renderSnapshot = (snapshot: TerminalSnapshot) => {
      const output = snapshot.output.replace(/[\t \r\n]+$/, "");
      if (disposed || output === lastOutput) return;
      lastOutput = output;
      lastError = "";
      terminal.reset();
      terminal.write(output.replace(/\n/g, "\r\n"));
    };

    const terminalRequest = async <T,>(
      path: string,
      payload?: Record<string, unknown>,
    ) => {
      if (useNative) {
        const command =
          path === "/terminal"
            ? "farm.terminal.open"
            : path === "/terminal/input"
              ? "farm.terminal.input"
              : path === "/terminal/resize"
                ? "farm.terminal.resize"
                : null;
        if (!command) throw new Error(`Unknown terminal path: ${path}`);
        return invokeNative<T>(command, { ...basePayload, ...payload });
      }
      if (!workerUrl) throw new Error("Terminal worker is starting.");
      const response = await fetch(`${workerUrl}${path}`, payload ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      } : undefined);
      if (!response.ok) throw new Error(await response.text());
      return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
    };

    const poll = async () => {
      if (polling || disposed) return;
      polling = true;
      try {
        renderSnapshot(await terminalRequest<TerminalSnapshot>("/terminal"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) {
          lastError = message;
          terminal.writeln(`\r\nTerminal error: ${message}`);
        }
      } finally {
        polling = false;
      }
    };

    const resize = () => {
      if (disposed) return;
      try {
        fit.fit();
        if (useNative || workerUrl) {
          void terminalRequest("/terminal/resize", {
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      } catch {
        // A later ResizeObserver pass will retry after the pane has dimensions.
      }
    };

    const inputDisposable = terminal.onData((data) => {
      inputChain = inputChain
        .then(() => terminalRequest<TerminalSnapshot>("/terminal/input", { data }))
        .then(renderSnapshot)
        .catch((error) =>
          terminal.writeln(
            `\r\nTerminal input error: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const warm = useNative
      ? Promise.resolve()
      : invokeNative<{ url?: string; ready?: boolean }>("farm.visual-todo.worker.start", {
          projectRoot,
          sessionId,
        }).then((worker) => {
          if (!worker.ready || !worker.url) throw new Error("Terminal worker did not start.");
          // The native WebKit host rejects direct cross-origin localhost fetches.
          // Vite proxies this stable same-origin path to the warm worker in dev.
          workerUrl = "/__visual_todo_worker";
        });

    void warm
      .then(() => {
        resize();
        return poll();
      })
      .then(() => {
        // Native silo terminals start `farm shell <acct>` when the tmux session
        // is created. Worker fallback (and worktree `cd`) still types commands.
        if (sentInitial) return;
        const bootCommands: string[] = [];
        if (!useNative && account) bootCommands.push(`farm shell ${account}`);
        if (initialCommand) bootCommands.push(initialCommand);
        if (!bootCommands.length) return;
        sentInitial = true;
        for (const command of bootCommands) {
          inputChain = inputChain
            .then(() =>
              terminalRequest<TerminalSnapshot>("/terminal/input", {
                data: command,
              }),
            )
            .then(() =>
              terminalRequest<TerminalSnapshot>("/terminal/input", { data: "\r" }),
            )
            .then(renderSnapshot)
            .catch(() => {
              /* pane still opens; the prompt just stays put */
            });
        }
      })
      .then(() => terminal.focus())
      .catch((error) =>
        terminal.writeln(
          `Terminal startup error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    const timer = window.setInterval(() => void poll(), 250);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      observer.disconnect();
      inputDisposable.dispose();
      terminal.dispose();
    };
  }, [projectRoot, sessionId, shellAccount, initialCommand]);

  return <div ref={hostRef} className="h-full min-h-0 w-full overflow-hidden bg-background p-2" />;
}
