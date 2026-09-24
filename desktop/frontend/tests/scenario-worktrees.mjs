/** Non-destructive WT scenario: temp FARM_STATE + temp repo, driven through
 *  farm.sh and controller.mjs exactly like the desktop app would. Captures
 *  every payload the Worktrees workspace consumes into fixtures JSON. */
// Usage: node desktop/frontend/tests/scenario-worktrees.mjs
// Everything lands in a mkdtemp FARM_STATE — the real farm state, the real
// repo, and the app are never touched. Prints the temp state path and
// writes the captured payloads beside it as wt-scenario-fixtures.json.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const controller = join(here, "..", "public", "backend", "controller.mjs");
const farmCli = join(here, "..", "..", "..", "farm.sh");
const state = mkdtempSync(join(tmpdir(), "wt-scenario-"));
const ws = join(state, "src");
mkdirSync(ws, { recursive: true });

const sh = (cwd, cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, FARM_STATE: state, ...env }, timeout: 60000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout;
};
const git = (cwd, args, env = {}) => sh(cwd, "git", args, env);
const farm = (...args) => sh(ws, "bash", [farmCli, ...args]);
const ctl = (command, payload = {}) => JSON.parse(sh(ws, process.execPath, [controller, command, JSON.stringify(payload)]));
const HOUR = 3600000;
const at = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const commit = (cwd, msg, hoursAgo) =>
  git(cwd, ["commit", "-qam", msg], { GIT_AUTHOR_DATE: at(hoursAgo), GIT_COMMITTER_DATE: at(hoursAgo) });

// --- main history: 10 commits across 5 days -------------------------------
git(ws, ["init", "-q", "-b", "main"]);
git(ws, ["config", "user.email", "t@t"]);
git(ws, ["config", "user.name", "t"]);
const mainHashes = [];
const subjects = ["Bootstrap app", "Wire routing", "Checkout skeleton", "Payment client", "Session store", "Design tokens", "Guest flow stub", "Docs scaffold", "Perf pass", "Release prep"];
for (let i = 0; i < 10; i++) {
  writeFileSync(join(ws, "app.txt"), Array.from({ length: 20 }, (_, l) => `line ${l} rev ${i <= l ? i : ""}`).join("\n"));
  writeFileSync(join(ws, `mod${i % 3}.txt`), `module rev ${i}\n`);
  if (i === 0) git(ws, ["add", "."]);
  git(ws, ["add", "."]);
  commit(ws, `${subjects[i]}`, 120 - i * 12);
  mainHashes.push(git(ws, ["rev-parse", "HEAD"]).trim());
}

// --- branches forked at real points in main -------------------------------
git(ws, ["branch", "feature/checkout-v2", mainHashes[6]]);
git(ws, ["branch", "bugfix/payment-timeout", mainHashes[4]]);
git(ws, ["branch", "docs/update-readme", mainHashes[7]]);
git(ws, ["branch", "refactor/api-client", mainHashes[2]]);
writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: ws }));
farm("clone", ws, "proj");

const wt = (branch, silo, name) => {
  farm("wt", "proj", silo, branch, name);
  return join(state, "work", name);
};

// feature: active, ahead, dirty
const feat = wt("feature/checkout-v2", "sahil", "wt-golden-furrow");
const featCommits = [["Add guest checkout step", 40], ["Validate email before payment", 30], ["Refactor address form", 20], ["Guest flow polish", 8], ["Wire 3DS fallback", 2]];
for (const [msg, h] of featCommits) {
  writeFileSync(join(feat, "guest.txt"), `${msg}\n${"x".repeat(h)}\n`);
  git(feat, ["add", "."]);
  commit(feat, msg, h);
}
writeFileSync(join(feat, "wip.txt"), "uncommitted work\n");
writeFileSync(join(feat, "guest.txt"), "dirty edit\n");

// bugfix: conflicts with a later main edit
const bug = wt("bugfix/payment-timeout", "jk", "wt-misty-paddock");
writeFileSync(join(bug, "mod1.txt"), "SILO fix for timeout\n");
git(bug, ["add", "."]);
commit(bug, "Fix timeout on 3DS", 26);
writeFileSync(join(bug, "mod1.txt"), "SILO fix for timeout v2\n");
git(bug, ["add", "."]);
commit(bug, "Harden retry loop", 6);
// conflicting workspace edit on main
writeFileSync(join(ws, "mod1.txt"), "WORKSPACE hotfix\n");
git(ws, ["add", "."]);
commit(ws, "Hotfix payment module", 4);

// docs: committed, then merged back through OUR merge flow
const docs = wt("docs/update-readme", "gmail", "wt-rolling-orchard");
writeFileSync(join(docs, "README.md"), "# Getting started\nBetter docs.\n");
git(docs, ["add", "."]);
commit(docs, "Improve getting started", 30);
writeFileSync(join(docs, "README.md"), "# Getting started\nBetter docs, screenshots.\n");
git(docs, ["add", "."]);
commit(docs, "Add screenshots", 24);
const merged = ctl("farm.worktree.merge", { dir: "wt-rolling-orchard", mode: "apply" });
if (!["merged", "up-to-date"].includes(merged.status)) throw new Error(`docs merge: ${merged.status}`);

// refactor: long-running, conflicting AND dirty
const ref = wt("refactor/api-client", "hello", "wt-frosted-combine");
for (const [msg, h] of [["Extract api client", 90], ["Type the endpoints", 60], ["Retry middleware", 36], ["Kill legacy fetch", 12]]) {
  writeFileSync(join(ref, "mod2.txt"), `${msg}\n`);
  git(ref, ["add", "."]);
  commit(ref, msg, h);
}
writeFileSync(join(ref, "mod2.txt"), "refactor dirty state\n");
// conflicting workspace edit
writeFileSync(join(ws, "mod2.txt"), "WORKSPACE change to module 2\n");
git(ws, ["add", "."]);
commit(ws, "Adjust module 2 config", 3);

// crew links
ctl("farm.crew.save", { assignment: { title: "Guest checkout flow", silo: "sahil", paddockId: "wt-golden-furrow", status: "started" } });
ctl("farm.crew.save", { assignment: { title: "Fix timeout on 3DS", silo: "jk", paddockId: "wt-misty-paddock", status: "staged" } });

// --- capture every payload the workspace consumes -------------------------
const list = ctl("farm.worktree.list");
const fixtures = {
  state,
  "farm.worktree.list": list,
  "farm.worktree.branches": ctl("farm.worktree.branches"),
  "farm.worktree.graph": ctl("farm.worktree.graph"),
  "farm.worktree.mergeability": ctl("farm.worktree.mergeability"),
  "farm.crew.list": ctl("farm.crew.list"),
  status: Object.fromEntries(
    list.worktrees.map((w) => [w.dir, ctl("farm.worktree.status", { dir: w.dir })]),
  ),
};
const fixturesPath = join(state, "wt-scenario-fixtures.json");
writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2));
console.log("fixtures:", fixturesPath);
console.log("state:", state);
console.log("worktrees:", list.worktrees.map((w) => `${w.name}(${w.branch}) dirty=${w.dirty} +${w.additions}-${w.deletions}`).join("\n  "));
console.log("graph lanes:", fixtures["farm.worktree.graph"].lanes.map((l) => `${l.name}: ${l.commits.length} commits, base=${l.base?.hash}`).join("\n  "));
console.log("mergeability:", fixtures["farm.worktree.mergeability"].rows.map((r) => `${r.dir}: ahead=${r.ahead} behind=${r.behind} ff=${r.canFastForward} conflicts=${r.conflicts.length} merged=${r.alreadyMerged}`).join("\n  "));
