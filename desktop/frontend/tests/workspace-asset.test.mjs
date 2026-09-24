
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);

function run(state, command, payload) {
  return spawnSync(process.execPath, [controller.pathname, command, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state },
    timeout: 5000,
  });
}

test("workspace asset reads svg as utf8", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-asset-"));
  const workspace = join(state, "workspace");
  mkdirSync(join(workspace, "docs"), { recursive: true });
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: workspace }));
  writeFileSync(join(workspace, "docs/box.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const result = run(state, "farm.workspace.asset", { path: "docs/box.svg" });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.mime, "image/svg+xml");
  assert.equal(body.encoding, "utf8");
  assert.match(body.content, /<svg/);
});

test("workspace asset rejects non-images", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-asset-"));
  const workspace = join(state, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: workspace }));
  writeFileSync(join(workspace, "notes.md"), "# hi\n");
  const result = run(state, "farm.workspace.asset", { path: "notes.md" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /image assets/i);
});
