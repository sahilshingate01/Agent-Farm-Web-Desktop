import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { choreDurationDays, criticalPath } from "../src/lib/chores/critical-path.ts";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);

function fakeChore(id, overrides = {}) {
  return {
    id,
    title: id,
    notes: "",
    parentId: null,
    tags: [],
    status: "todo",
    lifecycle: "logged",
    assignee: { silo: null, provider: null, model: null },
    dependsOn: [],
    start: null,
    due: null,
    estimateHours: null,
    attachments: [],
    data: {},
    runs: [],
    order: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

function invoke(state, project, command, payload = {}) {
  return spawnSync(
    process.execPath,
    [controller.pathname, command, JSON.stringify({ projectRoot: project, ...payload })],
    {
      encoding: "utf8",
      env: { ...process.env, FARM_STATE: state, FARM_CLI: "/bin/true" },
      timeout: 10_000,
    },
  );
}

function ok(state, project, command, payload) {
  const result = invoke(state, project, command, payload);
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function fail(state, project, command, payload) {
  const result = invoke(state, project, command, payload);
  assert.notEqual(result.status, 0, `${command} should fail but returned: ${result.stdout}`);
  return result.stderr;
}

function scratch() {
  return {
    state: mkdtempSync(join(tmpdir(), "usage-farm-chores-state-")),
    project: mkdtempSync(join(tmpdir(), "usage-farm-chores-project-")),
  };
}

test("chores: create → list roundtrip with defaults and sibling ordering", () => {
  const { state, project } = scratch();
  const created = ok(state, project, "farm.chores.mutate", {
    type: "task.created",
    task: { title: "Plough the field", tags: ["prep"], notes: "North paddock first." },
  });
  assert.ok(created.id);
  const second = ok(state, project, "farm.chores.mutate", {
    type: "task.created",
    task: { title: "Sow the seed" },
  });
  const { tasks, settings, blocked } = ok(state, project, "farm.chores.list");
  assert.equal(tasks.length, 2);
  const plough = tasks.find((task) => task.id === created.id);
  assert.equal(plough.title, "Plough the field");
  assert.deepEqual(plough.tags, ["prep"]);
  assert.equal(plough.status, "todo");
  assert.equal(plough.lifecycle, "logged");
  assert.equal(plough.order, 0);
  assert.equal(tasks.find((task) => task.id === second.id).order, 1);
  assert.deepEqual(blocked, []);
  assert.deepEqual(settings, { autoRun: false, concurrency: 1 });
});

test("chores: patch updates fields and empty titles are rejected", () => {
  const { state, project } = scratch();
  const { id } = ok(state, project, "farm.chores.mutate", {
    type: "task.created",
    task: { title: "Fix the fence" },
  });
  const { tasks } = ok(state, project, "farm.chores.mutate", {
    type: "task.updated",
    taskId: id,
    patch: { notes: "Use the oak posts.", start: "2026-07-21", due: "2026-07-23", estimateHours: 6, data: { gate: "east" } },
  });
  const task = tasks.find((item) => item.id === id);
  assert.equal(task.notes, "Use the oak posts.");
  assert.equal(task.start, "2026-07-21");
  assert.equal(task.due, "2026-07-23");
  assert.equal(task.estimateHours, 6);
  assert.deepEqual(task.data, { gate: "east" });
  assert.match(fail(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "  " } }), /title/);
});

test("chores: subtasks nest, and a chore cannot become its own descendant's child", () => {
  const { state, project } = scratch();
  const parent = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Harvest" } });
  const child = ok(state, project, "farm.chores.mutate", {
    type: "task.created",
    task: { title: "Sharpen blades", parentId: parent.id },
  });
  const { tasks } = ok(state, project, "farm.chores.list");
  assert.equal(tasks.find((task) => task.id === child.id).parentId, parent.id);
  assert.match(
    fail(state, project, "farm.chores.mutate", { type: "task.moved", taskId: parent.id, parentId: child.id, order: 0 }),
    /nested under itself/,
  );
});

test("chores: status and lifecycle stay coupled like visual TODOs", () => {
  const { state, project } = scratch();
  const { id } = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Muck out" } });
  let snapshot = ok(state, project, "farm.chores.mutate", { type: "task.lifecycle", taskId: id, lifecycle: "queued" });
  let task = snapshot.tasks.find((item) => item.id === id);
  assert.equal(task.status, "todo");
  assert.equal(task.lifecycle, "queued");
  snapshot = ok(state, project, "farm.chores.mutate", { type: "task.status", taskId: id, status: "done" });
  task = snapshot.tasks.find((item) => item.id === id);
  assert.equal(task.lifecycle, "done");
  snapshot = ok(state, project, "farm.chores.mutate", { type: "task.status", taskId: id, status: "todo" });
  task = snapshot.tasks.find((item) => item.id === id);
  assert.equal(task.lifecycle, "logged");
});

test("chores: dependencies derive blocked and reject cycles", () => {
  const { state, project } = scratch();
  const a = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "A" } });
  const b = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "B" } });
  const c = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "C" } });
  ok(state, project, "farm.chores.mutate", { type: "task.dependency.added", taskId: b.id, dependsOn: a.id });
  const chained = ok(state, project, "farm.chores.mutate", { type: "task.dependency.added", taskId: c.id, dependsOn: b.id });
  assert.deepEqual(new Set(chained.blocked), new Set([b.id, c.id]));
  assert.match(
    fail(state, project, "farm.chores.mutate", { type: "task.dependency.added", taskId: a.id, dependsOn: c.id }),
    /cycle/,
  );
  assert.match(
    fail(state, project, "farm.chores.mutate", { type: "task.dependency.added", taskId: a.id, dependsOn: a.id }),
    /depend on itself/,
  );
  ok(state, project, "farm.chores.mutate", { type: "task.status", taskId: a.id, status: "done" });
  const after = ok(state, project, "farm.chores.list");
  assert.deepEqual(new Set(after.blocked), new Set([c.id]));
});

test("chores: delete hides, restore revives, and dangling edges are pruned", () => {
  const { state, project } = scratch();
  const dep = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Dig" } });
  const main = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Plant" } });
  ok(state, project, "farm.chores.mutate", { type: "task.dependency.added", taskId: main.id, dependsOn: dep.id });
  const gone = ok(state, project, "farm.chores.mutate", { type: "task.deleted", taskId: dep.id });
  assert.equal(gone.tasks.length, 1);
  assert.deepEqual(gone.tasks[0].dependsOn, []);
  assert.deepEqual(gone.blocked, []);
  const back = ok(state, project, "farm.chores.mutate", { type: "task.restored", taskId: dep.id });
  assert.equal(back.tasks.length, 2);
  assert.deepEqual(new Set(back.blocked), new Set([main.id]));
});

test("chores: attachments roundtrip, remove, and size cap", () => {
  const { state, project } = scratch();
  const { id } = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Screenshot the bug" } });
  const content = Buffer.from("not-really-a-png").toString("base64");
  const added = ok(state, project, "farm.chores.attachment.add", {
    taskId: id,
    name: "crash.png",
    content,
  });
  const task = added.tasks.find((item) => item.id === id);
  assert.equal(task.attachments.length, 1);
  assert.equal(task.attachments[0].kind, "image");
  const read = ok(state, project, "farm.chores.attachment.read", { taskId: id, attachmentId: added.id });
  assert.equal(Buffer.from(read.content, "base64").toString(), "not-really-a-png");
  const removed = ok(state, project, "farm.chores.mutate", {
    type: "task.attachment.removed",
    taskId: id,
    attachmentId: added.id,
  });
  assert.equal(removed.tasks.find((item) => item.id === id).attachments.length, 0);
  // An 11 MB payload cannot ride argv — deliver it as a file to copy.
  const oversized = join(state, "huge.bin");
  writeFileSync(oversized, Buffer.alloc(11 * 1024 * 1024));
  assert.match(
    fail(state, project, "farm.chores.attachment.add", {
      taskId: id,
      name: "huge.bin",
      sourcePath: oversized,
    }),
    /10 MB/,
  );
});

test("critical path: durations fall back date-span → estimate → one day", () => {
  assert.equal(choreDurationDays(fakeChore("a", { start: "2026-07-20", due: "2026-07-22" })), 3);
  assert.equal(choreDurationDays(fakeChore("b", { estimateHours: 30 })), 2);
  assert.equal(choreDurationDays(fakeChore("c")), 1);
});

test("critical path: picks the longer dependency branch and its edges", () => {
  // a → b → d (1+1+1=3 days)  vs  a → c(3 days) → d (1+3+1=5) — c wins.
  const tasks = [
    fakeChore("a"),
    fakeChore("b", { dependsOn: ["a"] }),
    fakeChore("c", { dependsOn: ["a"], start: "2026-07-21", due: "2026-07-23" }),
    fakeChore("d", { dependsOn: ["b", "c"] }),
  ];
  const result = criticalPath(tasks);
  assert.deepEqual([...result.taskIds].sort(), ["a", "c", "d"]);
  assert.deepEqual([...result.edges].sort(), ["a->c", "c->d"]);
});

test("critical path: done tasks drop out and lone tasks are no path", () => {
  const chain = [
    fakeChore("a", { status: "done" }),
    fakeChore("b", { dependsOn: ["a"] }),
    fakeChore("c", { dependsOn: ["b"] }),
  ];
  const result = criticalPath(chain);
  assert.deepEqual([...result.taskIds].sort(), ["b", "c"]);
  assert.deepEqual([...criticalPath([fakeChore("solo")]).taskIds], []);
  assert.deepEqual([...criticalPath([]).taskIds], []);
});

function seedLedgerEvent(state, project, event) {
  const directory = join(state, "tasks", project.replaceAll("/", "-"));
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(directory, "ledger.jsonl"), `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
}

test("autorun tick: off, unassigned, blocked, and capped chores never dispatch", () => {
  const { state, project } = scratch();
  const a = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "A" } });
  const b = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "B" } });
  ok(state, project, "farm.chores.mutate", { type: "task.lifecycle", taskId: a.id, lifecycle: "queued" });
  ok(state, project, "farm.chores.mutate", { type: "task.lifecycle", taskId: b.id, lifecycle: "queued" });

  // Toggle off → nothing moves even though A is queued.
  let tick = ok(state, project, "farm.chores.autorun.tick");
  assert.deepEqual(tick.dispatched, []);

  // On, but neither chore has an assignment → still nothing.
  ok(state, project, "farm.chores.settings.save", { autoRun: true, concurrency: 1 });
  tick = ok(state, project, "farm.chores.autorun.tick");
  assert.deepEqual(tick.dispatched, []);

  // Assign B but block it behind A → still nothing.
  ok(state, project, "farm.chores.mutate", { type: "task.assigned", taskId: b.id, silo: "alpha", provider: null, model: null });
  ok(state, project, "farm.chores.mutate", { type: "task.dependency.added", taskId: b.id, dependsOn: a.id });
  tick = ok(state, project, "farm.chores.autorun.tick");
  assert.deepEqual(tick.dispatched, []);

  // Assign A too, but saturate the cap with an open seeded run → nothing.
  ok(state, project, "farm.chores.mutate", { type: "task.assigned", taskId: a.id, silo: "alpha", provider: null, model: null });
  seedLedgerEvent(state, project, { type: "task.run.started", taskId: a.id, jobId: "ghost-job", silo: "alpha" });
  tick = ok(state, project, "farm.chores.autorun.tick");
  assert.deepEqual(tick.dispatched, []);
  assert.equal(tick.active, 1);
});

test("dispatch guards: unassigned and blocked chores are refused", () => {
  const { state, project } = scratch();
  const dep = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Dig" } });
  const main = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Plant" } });
  assert.match(fail(state, project, "farm.chores.dispatch", { taskId: main.id }), /Assign the chore/);
  ok(state, project, "farm.chores.mutate", { type: "task.assigned", taskId: main.id, silo: "alpha", provider: null, model: null });
  ok(state, project, "farm.chores.mutate", { type: "task.dependency.added", taskId: main.id, dependsOn: dep.id });
  assert.match(fail(state, project, "farm.chores.dispatch", { taskId: main.id }), /blocked/);
});

test("run reconciliation: terminal visual TODO metadata closes the run and finishes the chore", () => {
  const { state, project } = scratch();
  const { id } = ok(state, project, "farm.chores.mutate", { type: "task.created", task: { title: "Reap" } });
  seedLedgerEvent(state, project, { type: "task.run.started", taskId: id, jobId: "job-done", silo: "alpha" });
  const visualTodoDir = join(state, "tasks", "visual-todo");
  mkdirSync(visualTodoDir, { recursive: true });
  writeFileSync(join(visualTodoDir, "job-done.json"), JSON.stringify({ id: "job-done", status: "completed" }));
  const { tasks } = ok(state, project, "farm.chores.list");
  const task = tasks.find((item) => item.id === id);
  assert.equal(task.runs[0].outcome, "done");
  assert.equal(task.status, "done");
  assert.equal(task.lifecycle, "done");
});

test("visual TODO task status migrates the pre-publication queue directory", () => {
  const { state, project } = scratch();
  const previous = join(state, "tasks", ["clu", "so"].join(""));
  mkdirSync(previous, { recursive: true });
  writeFileSync(
    join(previous, "job-old.json"),
    JSON.stringify({
      id: "job-old",
      status: "failed",
      provider: "claude-code",
      projectRoot: project,
      log: join(previous, "job-old.log"),
      todo: { id: "vt-old" },
    }),
  );
  writeFileSync(
    join(previous, "job-old.job.json"),
    JSON.stringify({
      id: "job-old",
      metadataPath: join(previous, "job-old.json"),
      logPath: join(previous, "job-old.log"),
      controllerPath: join(previous, "controller.mjs"),
    }),
  );

  const status = ok(state, project, "farm.visual-todo.status", {
    todoIds: ["vt-old"],
  });
  assert.equal(status.tasks[0].id, "job-old");
  const migrated = join(state, "tasks", "visual-todo", "job-old.json");
  assert.equal(existsSync(previous), false);
  assert.equal(existsSync(migrated), true);
  assert.match(JSON.parse(readFileSync(migrated, "utf8")).log, /visual-todo/);
  assert.match(
    JSON.parse(
      readFileSync(
        join(state, "tasks", "visual-todo", "job-old.job.json"),
        "utf8",
      ),
    ).metadataPath,
    /visual-todo/,
  );
});

test("visual TODO task migration leaves an unrelated schema-matching directory alone", () => {
  const { state, project } = scratch();
  const tasksRoot = join(state, "tasks");
  const otherQueue = join(tasksRoot, "other-queue");
  mkdirSync(otherQueue, { recursive: true });
  writeFileSync(
    join(otherQueue, "other.json"),
    JSON.stringify({
      id: "other",
      status: "failed",
      projectRoot: project,
      todo: { id: "other" },
    }),
  );
  const unrelated = join(tasksRoot, "unrelated");
  mkdirSync(unrelated, { recursive: true });
  writeFileSync(join(unrelated, "settings.json"), JSON.stringify({ enabled: true }));

  const status = ok(state, project, "farm.visual-todo.status", {});
  assert.deepEqual(status.tasks, []);
  assert.equal(existsSync(otherQueue), true);
  assert.equal(existsSync(unrelated), true);
});

test("visual TODO sync: imports visual todos and reflects chore status back", () => {
  const { state, project } = scratch();
  mkdirSync(join(project, ".agensis"), { recursive: true });
  writeFileSync(
    join(project, ".agensis", "visual-todos.jsonl"),
    `${JSON.stringify({ type: "todo.created", todoId: "vt-1", todo: { id: "vt-1", comment: "Fix the gate latch" }, at: new Date().toISOString() })}\n`,
  );
  const first = ok(state, project, "farm.chores.sync.visual-todo");
  assert.equal(first.imported, 1);
  const chore = first.tasks.find((task) => task.data.visualTodoId === "vt-1");
  assert.ok(chore);
  assert.equal(chore.title, "Fix the gate latch");
  assert.deepEqual(chore.tags, ["from-visual-todo"]);

  // Re-sync is idempotent.
  const second = ok(state, project, "farm.chores.sync.visual-todo");
  assert.equal(second.imported, 0);

  // Finish the chore → the visual todo follows.
  ok(state, project, "farm.chores.mutate", { type: "task.status", taskId: chore.id, status: "done" });
  const third = ok(state, project, "farm.chores.sync.visual-todo");
  assert.equal(third.reflected, 1);
  const todos = ok(state, project, "farm.visual-todo.todo.sync", {});
  assert.equal(todos.todos.find((todo) => String(todo.id) === "vt-1").status, "done");
});

test("visual TODO sync upgrades an earlier TodoId foreign key without duplicating", () => {
  const { state, project } = scratch();
  mkdirSync(join(project, ".agensis"), { recursive: true });
  writeFileSync(
    join(project, ".agensis", "visual-todos.jsonl"),
    `${JSON.stringify({ type: "todo.created", todoId: "vt-legacy", todo: { id: "vt-legacy", comment: "Keep the existing chore" }, at: new Date().toISOString() })}\n`,
  );
  const legacyKey = ["clu", "so", "TodoId"].join("");
  ok(state, project, "farm.chores.mutate", {
    type: "task.created",
    task: {
      title: "Existing linked chore",
      data: { [legacyKey]: "vt-legacy" },
    },
  });

  const synced = ok(state, project, "farm.chores.sync.visual-todo");
  assert.equal(synced.imported, 0);
  assert.equal(synced.tasks.length, 1);
  assert.equal(synced.tasks[0].data.visualTodoId, "vt-legacy");
});

test("visual TODO sync ignores unrelated TodoId fields", () => {
  const { state, project } = scratch();
  mkdirSync(join(project, ".agensis"), { recursive: true });
  writeFileSync(
    join(project, ".agensis", "visual-todos.jsonl"),
    `${JSON.stringify({ type: "todo.created", todoId: "vt-real", todo: { id: "vt-real", comment: "Import this TODO" }, at: new Date().toISOString() })}\n`,
  );
  ok(state, project, "farm.chores.mutate", {
    type: "task.created",
    task: {
      title: "External issue",
      data: { jiraTodoId: "vt-real" },
    },
  });

  const synced = ok(state, project, "farm.chores.sync.visual-todo");
  assert.equal(synced.imported, 1);
  assert.equal(synced.tasks.length, 2);
  const external = synced.tasks.find((task) => task.title === "External issue");
  assert.equal(external.data.visualTodoId, undefined);
});

test("chores: board settings roundtrip and clamp", () => {
  const { state, project } = scratch();
  const saved = ok(state, project, "farm.chores.settings.save", { autoRun: true, concurrency: 99 });
  assert.deepEqual(saved.settings, { autoRun: true, concurrency: 4 });
  const { settings } = ok(state, project, "farm.chores.list");
  assert.deepEqual(settings, { autoRun: true, concurrency: 4 });
});
