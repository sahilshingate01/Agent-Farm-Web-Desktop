import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);
const farmCli = new URL("../../../farm.sh", import.meta.url).pathname;

function run(state, command, payload = {}) {
  const result = spawnSync(process.execPath, [controller.pathname, command, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state },
    timeout: 20000,
  });
  return result;
}

function json(state, command, payload = {}) {
  const result = run(state, command, payload);
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function farm(state, ...args) {
  const result = spawnSync("bash", [farmCli, ...args], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state },
    timeout: 20000,
  });
  assert.equal(result.status, 0, `farm ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/** A temp farm state with a git workspace and one worktree of the given branch. */
function scaffold({ file = "app.txt", body = "l1\nl2\nl3\n", branch = "main", wtName = "wt-alpha" } = {}) {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-wt-test-"));
  const workspace = join(state, "src");
  mkdirSync(workspace, { recursive: true });
  git(workspace, "init", "-q", "-b", "main");
  git(workspace, "config", "user.email", "t@t");
  git(workspace, "config", "user.name", "t");
  writeFileSync(join(workspace, file), body);
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "init");
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: workspace }));
  farm(state, "clone", workspace, "proj");
  farm(state, "wt", "proj", "acct", branch, wtName);
  return { state, workspace, worktree: join(state, "work", wtName), wtName };
}

test("list reports a worktree created via the CLI", () => {
  const { state, wtName } = scaffold();
  const { worktrees } = json(state, "farm.worktree.list");
  const found = worktrees.find((w) => w.dir === wtName);
  assert.ok(found, "worktree should be listed");
  assert.equal(found.repo, "proj");
  assert.equal(found.branch, "main");
});

test("conflicting merge: preview predicts, apply conflicts, resolve theirs, continue", () => {
  const { state, workspace, worktree, wtName } = scaffold();
  // Divergent edits to the same line on main.
  writeFileSync(join(worktree, "app.txt"), "l1\nSILO\nl3\n");
  git(worktree, "commit", "-qam", "silo edit");
  writeFileSync(join(workspace, "app.txt"), "l1\nWORKSPACE\nl3\n");
  git(workspace, "commit", "-qam", "workspace edit");

  const preview = json(state, "farm.worktree.merge", { dir: wtName, mode: "preview" });
  assert.equal(preview.status, "preview");
  assert.equal(preview.preview.ahead, 1);
  assert.deepEqual(preview.preview.conflicts, ["app.txt"]);
  assert.equal(preview.preview.canFastForward, false);

  const applied = json(state, "farm.worktree.merge", { dir: wtName, mode: "apply" });
  assert.equal(applied.status, "conflicts");
  assert.deepEqual(applied.merge.conflicts, ["app.txt"]);

  const resolved = json(state, "farm.worktree.resolveConflict", { path: "app.txt", resolution: "theirs" });
  assert.deepEqual(resolved.merge.conflicts, []);

  const done = json(state, "farm.worktree.merge", { mode: "continue" });
  assert.equal(done.status, "merged");
  assert.equal(done.merge.inProgress, false);
  assert.equal(readFileSync(join(workspace, "app.txt"), "utf8"), "l1\nSILO\nl3\n");
  // Merge commit has two parents.
  assert.equal(git(workspace, "rev-list", "--count", "--merges", "HEAD").trim(), "1");
});

test("clean merge of a non-conflicting branch commits straight away", () => {
  const { state, workspace, worktree } = scaffold({ branch: "feature/x", wtName: "wt-beta" });
  git(workspace, "checkout", "-q", "-b", "feature/x");
  writeFileSync(join(worktree, "new.txt"), "fresh\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-qm", "add new.txt");

  const applied = json(state, "farm.worktree.merge", { dir: "wt-beta", mode: "apply" });
  assert.equal(applied.status, "merged");
  assert.equal(applied.preview.conflicts.length, 0);
  assert.equal(readFileSync(join(workspace, "new.txt"), "utf8"), "fresh\n");
});

test("abort restores the workspace and clears merge state", () => {
  const { state, workspace, worktree, wtName } = scaffold();
  writeFileSync(join(worktree, "app.txt"), "l1\nSILO\nl3\n");
  git(worktree, "commit", "-qam", "silo edit");
  writeFileSync(join(workspace, "app.txt"), "l1\nWS\nl3\n");
  git(workspace, "commit", "-qam", "workspace edit");

  const applied = json(state, "farm.worktree.merge", { dir: wtName, mode: "apply" });
  assert.equal(applied.status, "conflicts");

  const aborted = json(state, "farm.worktree.merge", { mode: "abort" });
  assert.equal(aborted.status, "aborted");
  assert.equal(aborted.merge.inProgress, false);
  assert.equal(readFileSync(join(workspace, "app.txt"), "utf8"), "l1\nWS\nl3\n");
  assert.equal(git(workspace, "status", "--porcelain").trim(), "");
});

test("resolveConflict rejects a path that is not currently conflicted", () => {
  const { state } = scaffold();
  const result = run(state, "farm.worktree.resolveConflict", { path: "app.txt", resolution: "ours" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No merge is in progress|not currently conflicted/);
});

test("status reports files, line counts, commits and ahead/behind", () => {
  const { state, workspace, worktree, wtName } = scaffold({ branch: "feature/wt", wtName: "wt-status" });
  git(workspace, "checkout", "-q", "-b", "feature/wt");
  git(workspace, "checkout", "-q", "main");
  // One committed change in the worktree (ahead of main) + one dirty edit.
  writeFileSync(join(worktree, "app.txt"), "l1\nl2\nl3\nl4\n");
  git(worktree, "commit", "-qam", "grow app");
  writeFileSync(join(worktree, "app.txt"), "l1\nl2\nl3\nl4\nl5\n");
  writeFileSync(join(worktree, "fresh.txt"), "new\n");

  const status = json(state, "farm.worktree.status", { dir: wtName });
  assert.equal(status.dir, wtName);
  assert.equal(status.target, "main");
  assert.equal(status.ahead, 1);
  assert.equal(status.behind, 0);
  const app = status.files.find((f) => f.path === "app.txt");
  assert.ok(app, "dirty tracked file listed");
  assert.equal(app.status, "modified");
  assert.equal(app.additions, 1);
  const fresh = status.files.find((f) => f.path === "fresh.txt");
  assert.equal(fresh.status, "untracked");
  assert.ok(status.commits.length >= 2, "recent commits included");
  assert.equal(status.commits[0].subject, "grow app");
  assert.equal(status.stashes, 0);
});

test("graph returns the workspace lane plus a worktree lane with a fork base", () => {
  const { state, workspace, worktree, wtName } = scaffold({ branch: "feature/graph", wtName: "wt-graph" });
  git(workspace, "checkout", "-q", "-b", "feature/graph");
  git(workspace, "checkout", "-q", "main");
  writeFileSync(join(worktree, "app.txt"), "l1\nl2\nl3\nl4\n");
  git(worktree, "commit", "-qam", "wt work");

  const graph = json(state, "farm.worktree.graph");
  assert.equal(graph.target.name, "main");
  assert.ok(graph.target.commits.length >= 1, "target lane has commits");
  const lane = graph.lanes.find((l) => l.name === wtName.replace(/^wt-/, "") || l.branch === "feature/graph");
  assert.ok(lane, "worktree lane present");
  assert.ok(lane.commits.length >= 2, "lane has commits");
  assert.equal(lane.commits[0].subject, "wt work");
  assert.ok(lane.base && lane.base.hash, "fork base resolved");
  assert.ok(Number.isFinite(lane.base.t), "fork base has a timestamp");
});

test("mergeability predicts conflicts and clean fast-forwards per worktree", () => {
  const { state, workspace, worktree, wtName } = scaffold();
  writeFileSync(join(worktree, "app.txt"), "l1\nSILO\nl3\n");
  git(worktree, "commit", "-qam", "silo edit");
  writeFileSync(join(workspace, "app.txt"), "l1\nWORKSPACE\nl3\n");
  git(workspace, "commit", "-qam", "workspace edit");

  const result = json(state, "farm.worktree.mergeability");
  assert.equal(result.target, "main");
  const row = result.rows.find((r) => r.dir === wtName);
  assert.ok(row, "row for the worktree");
  assert.equal(row.ahead, 1);
  assert.equal(row.behind, 1);
  assert.equal(row.canFastForward, false);
  assert.deepEqual(row.conflicts, ["app.txt"]);
  assert.equal(row.alreadyMerged, false);
});

test("worktrees are scoped to the active workspace project", () => {
  const { state, wtName } = scaffold();
  // Visible in the project that created it.
  assert.ok(json(state, "farm.worktree.list").worktrees.some((w) => w.dir === wtName));

  // Switch the workspace to a different project — the other project's
  // worktrees must disappear, and acting on one must fail loudly.
  const other = join(state, "other-project");
  mkdirSync(other, { recursive: true });
  git(other, "init", "-q", "-b", "main");
  git(other, "config", "user.email", "t@t");
  git(other, "config", "user.name", "t");
  writeFileSync(join(other, "readme.md"), "hello\n");
  git(other, "add", ".");
  git(other, "commit", "-qm", "init");
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: other }));

  assert.equal(json(state, "farm.worktree.list").worktrees.length, 0, "foreign worktrees hidden");
  const merge = run(state, "farm.worktree.merge", { dir: wtName, mode: "preview" });
  assert.notEqual(merge.status, 0, "cross-project merge refused");

  // Switching back restores them.
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: join(state, "src") }));
  assert.ok(json(state, "farm.worktree.list").worktrees.some((w) => w.dir === wtName));
});
