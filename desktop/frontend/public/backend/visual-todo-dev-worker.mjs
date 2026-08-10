#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { delimiter, dirname, join, resolve } from "node:path";

const projectRoot = resolve(
  process.env.VISUAL_TODO_PROJECT_ROOT || process.cwd(),
);
const port = Number(process.env.VISUAL_TODO_WORKER_PORT || 4547);
const ledger = resolve(
  process.env.VISUAL_TODO_TASK_LEDGER
    || join(projectRoot, ".agensis", "agent-tasks.jsonl"),
);
mkdirSync(dirname(ledger), { recursive: true });

const clients = new Set();
const queue = [];
const states = new Map();
let active = null;
let child = null;
let stdoutBuffer = "";
let restartAttempts = 0;
let restartTimer = null;
let agentError = null;
const requestedAgentCommand = String(
  process.env.VISUAL_TODO_AGENT_COMMAND || "claude",
).trim();
const terminalName = `visual-todo-${createHash("sha256")
  .update(projectRoot)
  .digest("hex")
  .slice(0, 16)}`;

function tmux(args, options = {}) {
  return spawnSync("tmux", args, {
    encoding: "utf8",
    timeout: 2000,
    ...options,
  });
}

function executablePath(command) {
  const candidates = command.includes("/")
    ? [resolve(command)]
    : String(process.env.PATH || "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  return null;
}

function terminalOpen() {
  if (tmux(["has-session", "-t", terminalName]).status !== 0) {
    const started = tmux([
      "new-session",
      "-d",
      "-s",
      terminalName,
      "-c",
      projectRoot,
    ]);
    if (started.status !== 0) {
      throw new Error(started.stderr || "Unable to start terminal.");
    }
    tmux(["set-option", "-t", terminalName, "history-limit", "10000"]);
    tmux(["send-keys", "-t", terminalName, "Enter"]);
  }
  const captured = tmux([
    "capture-pane",
    "-p",
    "-e",
    "-J",
    "-S",
    "-1000",
    "-t",
    terminalName,
  ]);
  return { alive: true, output: captured.stdout || "" };
}

function terminalInput(data) {
  terminalOpen();
  const special = new Map([
    ["\r", "Enter"],
    ["\n", "Enter"],
    ["\u007f", "BSpace"],
    ["\b", "BSpace"],
    ["\t", "Tab"],
    ["\u0003", "C-c"],
    ["\u0004", "C-d"],
    ["\u001b", "Escape"],
    ["\u001b[A", "Up"],
    ["\u001b[B", "Down"],
    ["\u001b[C", "Right"],
    ["\u001b[D", "Left"],
  ]);
  if (special.has(data)) {
    tmux(["send-keys", "-t", terminalName, special.get(data)]);
  } else if (data) {
    tmux(["send-keys", "-t", terminalName, "-l", data]);
  }
  return terminalOpen();
}

function record(event) {
  const value = { ...event, at: new Date().toISOString() };
  appendFileSync(ledger, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  if (value.id && value.state) states.set(String(value.id), value.state);
  const packet = `data: ${JSON.stringify(value)}\n\n`;
  for (const response of clients) response.write(packet);
  return value;
}

function recover() {
  if (!existsSync(ledger)) return;
  const tasks = new Map();
  for (
    const line of readFileSync(ledger, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
  ) {
    try {
      const event = JSON.parse(line);
      if (!event.id) continue;
      const id = String(event.id);
      const current = tasks.get(id) || {};
      tasks.set(
        id,
        current.state === "done" && event.state !== "reset"
          ? current
          : { ...current, ...event },
      );
    } catch {
      // Ignore a partial final line after a crash.
    }
  }
  for (const task of tasks.values()) {
    if (task.id && task.state) states.set(String(task.id), task.state);
    if (
      ["logged", "queued", "in-progress"].includes(task.state)
      && task.prompt
    ) {
      queue.push({ id: String(task.id), prompt: task.prompt });
      record({ ...task, state: "queued", recovered: true });
    }
  }
}

function startAgent() {
  if (child && !child.killed) return true;
  const command = executablePath(requestedAgentCommand);
  if (!command) {
    agentError = `Agent command was not found: ${requestedAgentCommand}`;
    return false;
  }
  agentError = null;
  child = spawn(
    command,
    [
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--safe-mode",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--effort",
      "low",
      "--tools",
      "Read,Edit,Bash,Glob,Grep",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--prompt-suggestions",
      "false",
      "--permission-mode",
      "acceptEdits",
    ],
    {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_SAFE_MODE: "1" },
    },
  );
  child.once("error", (error) => {
    agentError = error instanceof Error ? error.message : String(error);
    if (active) {
      record({
        id: active.id,
        state: "logged",
        progress: `Warm agent failed to start: ${agentError}`,
      });
      active = null;
    }
    child = null;
  });
  const consume = (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!active) continue;
      const text = event?.message?.content?.find?.(
        (part) => part?.type === "text",
      )?.text;
      if (text) {
        record({
          id: active.id,
          state: "in-progress",
          progress: text.slice(0, 1000),
        });
      }
      if (event.type === "result") {
        record({
          id: active.id,
          state: event.subtype === "success" ? "done" : "logged",
          progress: event.result || null,
        });
        active = null;
        restartAttempts = 0;
        runNext();
      }
    }
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", (chunk) => {
    if (active) {
      record({
        id: active.id,
        state: "in-progress",
        progress: chunk.toString().slice(0, 1000),
      });
    }
  });
  child.once("exit", (code) => {
    child = null;
    if (active) {
      if (restartAttempts < 3) {
        queue.unshift(active);
        restartAttempts += 1;
        record({
          id: active.id,
          state: "queued",
          progress: `Warm agent stopped (${code ?? "unknown"}); retry ${restartAttempts}/3`,
        });
      } else {
        record({
          id: active.id,
          state: "logged",
          progress: `Warm agent stopped after 3 retries (${code ?? "unknown"}).`,
        });
        restartAttempts = 0;
      }
      active = null;
    }
    if (queue.length && !restartTimer) {
      const delay = Math.min(5000, 250 * (2 ** restartAttempts));
      restartTimer = setTimeout(() => {
        restartTimer = null;
        runNext();
      }, delay);
    }
  });
  return true;
}

function runNext() {
  if (active || !queue.length) return;
  if (!startAgent()) return;
  active = queue.shift();
  queue.forEach((task, index) => {
    record({ id: task.id, state: "queued", position: index + 1 });
  });
  record({ id: active.id, state: "in-progress" });
  child.stdin.write(
    `${JSON.stringify({
      type: "user",
      message: { role: "user", content: active.prompt },
    })}\n`,
  );
}

function enqueue(task) {
  const id = String(task.id || "").trim();
  const prompt = String(task.prompt || "").trim();
  if (!id || !prompt) throw new Error("Task id and prompt are required.");
  if (
    states.get(id) === "done"
    || active?.id === id
    || queue.some((item) => item.id === id)
  ) return;
  if (!executablePath(requestedAgentCommand)) {
    throw new Error(
      `Warm agent is unavailable: ${requestedAgentCommand} was not found.`,
    );
  }
  record({ id, prompt, state: "logged" });
  queue.push({ id, prompt });
  record({ id, prompt, state: "queued", position: queue.length });
  runNext();
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request, callback) {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => callback(body));
}

const allowedOrigins = new Set(
  String(
    process.env.VISUAL_TODO_ALLOWED_ORIGINS
      || "http://127.0.0.1:7417,http://localhost:7417",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export function isAllowedVisualTodoOrigin(origin) {
  return !origin || allowedOrigins.has(String(origin));
}

export function createVisualTodoDevServer() {
 return createServer((request, response) => {
  const origin = request.headers.origin;
  if (!isAllowedVisualTodoOrigin(origin)) {
    response.writeHead(403, { "Content-Type": "text/plain" });
    response.end("forbidden origin");
    return;
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(
      `data: ${JSON.stringify({
        type: "ready",
        active: active?.id || null,
        queued: queue.length,
      })}\n\n`,
    );
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, {
      ok: true,
      warm: Boolean(child),
      projectRoot,
      pid: process.pid,
      error: agentError,
      active: active?.id || null,
      queued: queue.length,
    });
    return;
  }
  if (request.method === "GET" && request.url === "/terminal") {
    try {
      json(response, 200, terminalOpen());
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (request.method === "POST" && request.url === "/terminal/input") {
    readBody(request, (body) => {
      try {
        json(response, 200, terminalInput(String(JSON.parse(body).data || "")));
      } catch (error) {
        response.writeHead(500);
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    return;
  }
  if (request.method === "POST" && request.url === "/terminal/resize") {
    readBody(request, (body) => {
      try {
        terminalOpen();
        const size = JSON.parse(body);
        tmux([
          "resize-window",
          "-t",
          terminalName,
          "-x",
          String(Math.max(20, Number(size.cols) || 80)),
          "-y",
          String(Math.max(5, Number(size.rows) || 24)),
        ]);
        response.writeHead(204);
        response.end();
      } catch (error) {
        response.writeHead(500);
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    return;
  }
  if (request.method === "POST" && request.url === "/tasks") {
    readBody(request, (body) => {
      try {
        enqueue(JSON.parse(body));
        response.writeHead(202);
        response.end("accepted");
      } catch (error) {
        response.writeHead(400);
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    return;
  }
  response.writeHead(404);
  response.end("not found");
 });
}

if (process.env.USAGE_FARM_VISUAL_TODO_WORKER_TEST !== "1") {
  recover();
  startAgent();
  runNext();
  createVisualTodoDevServer().listen(port, "127.0.0.1", () => {
    record({ type: "worker.ready", state: "ready", port, projectRoot });
  });
}
