import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const runner = new URL("../public/backend/visual-todo-task-runner.mjs", import.meta.url);

test("records the automatic Codex recovery model after the primary task fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "visual-todo-task-runner-test-"));
  const metadataPath = join(directory, "task.json");
  const jobPath = join(directory, "task.job.json");
  const logPath = join(directory, "task.log");
  const metadata = {
    id: "task",
    status: "queued",
    provider: "claude-code",
    model: null,
    projectRoot: directory,
    log: logPath,
    todo: { id: "visual-todo" },
  };
  const job = {
    ...metadata,
    metadataPath,
    logPath,
    command: process.execPath,
    args: ["-e", "process.exit(1)"],
    fallback: {
      provider: "codex",
      model: "gpt-5.4",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    },
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
  writeFileSync(jobPath, `${JSON.stringify(job)}\n`);

  const result = spawnSync(process.execPath, [runner.pathname, jobPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const finished = JSON.parse(readFileSync(metadataPath, "utf8"));
  assert.equal(finished.status, "completed");
  assert.equal(finished.provider, "codex");
  assert.equal(finished.model, "gpt-5.4");
  assert.equal(finished.fallbackProvider, "codex");
  assert.equal(finished.fallbackModel, "gpt-5.4");
});

test("advances the visual TODO queue through the registered scheduler command", async () => {
  const directory = mkdtempSync(join(tmpdir(), "visual-todo-scheduler-test-"));
  const metadataPath = join(directory, "task.json");
  const jobPath = join(directory, "task.job.json");
  const logPath = join(directory, "task.log");
  const recordPath = join(directory, "scheduler.json");
  const controllerPath = join(directory, "controller.mjs");
  writeFileSync(
    controllerPath,
    `import { writeFileSync } from "node:fs";\n`
      + `writeFileSync(process.env.SCHEDULER_RECORD, JSON.stringify(process.argv.slice(2)));\n`,
  );
  const metadata = {
    id: "task",
    status: "queued",
    provider: "codex",
    projectRoot: directory,
    log: logPath,
    todo: { id: "visual-todo" },
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
  writeFileSync(jobPath, `${JSON.stringify({
    ...metadata,
    metadataPath,
    logPath,
    controllerPath,
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    env: { SCHEDULER_RECORD: recordPath },
  })}\n`);

  const result = spawnSync(process.execPath, [runner.pathname, jobPath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  for (let attempt = 0; attempt < 80 && !existsSync(recordPath); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.deepEqual(
    JSON.parse(readFileSync(recordPath, "utf8")),
    ["farm.visual-todo.next", "{}"],
  );
});
