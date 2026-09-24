import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

test("returns real tracked and untracked workspace patches", () => {
  const root = mkdtempSync(join(tmpdir(), "usage-farm-review-repo-"));
  const state = mkdtempSync(join(tmpdir(), "usage-farm-review-state-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  writeFileSync(join(root, "tracked.ts"), "export const value = 1;\n");
  git(root, "add", "tracked.ts");
  git(root, "commit", "-qm", "initial");
  writeFileSync(join(root, "tracked.ts"), "export const value = 2;\nexport const next = true;\n");
  writeFileSync(join(root, "new.ts"), "export const added = true;\n");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root }));

  const result = spawnSync(
    process.execPath,
    [controller.pathname, "farm.workspace.diff", "{}"],
    { encoding: "utf8", env: { ...process.env, FARM_STATE: state } },
  );
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.root, realpathSync(root));
  assert.equal(snapshot.files.length, 2);
  const tracked = snapshot.files.find((file) => file.path === "tracked.ts");
  assert.equal(tracked.status, "modified");
  assert.equal(tracked.additions, 2);
  assert.equal(tracked.deletions, 1);
  assert.match(tracked.patch, /@@ -1 \+1,2 @@/);
  const added = snapshot.files.find((file) => file.path === "new.ts");
  assert.equal(added.status, "untracked");
  assert.equal(added.additions, 1);
  assert.match(added.patch, /\+export const added = true/);
});
