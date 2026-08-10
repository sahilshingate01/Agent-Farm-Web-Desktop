#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const jobPath = process.argv[2];
if (!jobPath) process.exit(2);

function update(job, patch) {
  try {
    const current = JSON.parse(readFileSync(job.metadataPath, "utf8"));
    writeFileSync(job.metadataPath, `${JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // The task log remains the source of truth if metadata is unavailable.
  }
}

let job;
try {
  job = JSON.parse(readFileSync(resolve(jobPath), "utf8"));
} catch (error) {
  process.stderr.write(`Unable to read VisualTodo task: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

if (!existsSync(job.projectRoot) || !Array.isArray(job.args) || !job.command) {
  update(job, { status: "failed", error: "Invalid VisualTodo task job." });
  process.exit(1);
}

const logFd = openSync(job.logPath, "a");

function append(message) {
  writeFileSync(job.logPath, `${message}\n`, { flag: "a" });
}

function latestProgress(line) {
  try {
    const event = JSON.parse(line);
    if (event?.item?.type === "agent_message" && typeof event.item.text === "string") return event.item.text;
    if (event?.message?.role === "assistant" && Array.isArray(event.message.content)) {
      const text = event.message.content.find((part) => part?.type === "text")?.text;
      if (typeof text === "string") return text;
    }
    if (event?.type === "result" && typeof event.result === "string") return event.result;
  } catch {
    // Non-JSON command output is still preserved in the task log.
  }
  return null;
}

function run(command, args, provider, model = null) {
  append(`\n[${new Date().toISOString()}] ${provider} task ${job.id}`);
  append(`project=${job.projectRoot}`);
  append(`command=${command} ${args.join(" ")}`);
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: job.projectRoot,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(job.env || {}) },
    });
    update(job, {
      status: "running",
      provider,
      model,
      command,
      pid: child.pid,
      progress: `${provider}${model ? ` (${model})` : ""} is working`,
    });
    let pending = "";
    const consume = (chunk) => {
      const text = chunk.toString();
      writeFileSync(job.logPath, text, { flag: "a" });
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        const progress = latestProgress(line);
        if (progress) update(job, { progress: progress.slice(0, 500) });
      }
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.once("error", (error) =>
      resolveRun({ code: null, signal: null, error: error.message }),
    );
    child.once("close", (code, signal) =>
      resolveRun({ code, signal, error: null }),
    );
  });
}

const primary = await run(job.command, job.args, job.provider, job.model || null);
let result = primary;
let provider = job.provider;

if (primary.code !== 0 && job.fallback?.command && Array.isArray(job.fallback.args)) {
  append(
    `[${new Date().toISOString()}] ${job.provider} failed; falling back to ${job.fallback.provider}.`,
  );
  update(job, {
    status: "falling-back",
    failedProvider: job.provider,
    primaryExitCode: primary.code,
    primarySignal: primary.signal,
    primaryError: primary.error,
    fallbackProvider: job.fallback.provider,
    fallbackModel: job.fallback.model || null,
  });
  provider = job.fallback.provider;
  result = await run(
    job.fallback.command,
    job.fallback.args,
    provider,
    job.fallback.model || null,
  );
}

closeSync(logFd);
if (result.code === 0) {
  update(job, {
    status: "completed",
    provider,
    exitCode: result.code,
    signal: result.signal,
  });
  process.exitCode = 0;
} else {
  update(job, {
    status: "failed",
    provider,
    exitCode: result.code,
    signal: result.signal,
    error: result.error,
  });
  process.exitCode = 1;
}

try { unlinkSync(resolve(jobPath)); } catch { /* Terminal metadata is retained; the runnable job is not. */ }

const activeLockPath = job.activeLockPath || `${dirname(job.metadataPath)}/.active-task.lock`;
try {
  const active = JSON.parse(readFileSync(activeLockPath, "utf8"));
  if (active?.id === job.id) unlinkSync(activeLockPath);
} catch {
  // The scheduler can safely reconcile an absent or stale lock.
}

// Advance exactly one queued job after this runner has made its terminal
// metadata update. The controller owns the shared lock, so multiple windows
// cannot start competing agents in the same worktree.
if (job.controllerPath && existsSync(job.controllerPath)) {
  const scheduler = spawn(process.execPath, [job.controllerPath, "farm.visual-todo.next", "{}"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...(job.env || {}) },
  });
  scheduler.unref();
}
