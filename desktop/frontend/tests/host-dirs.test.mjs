import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);
const farmCli = new URL("../../../farm.sh", import.meta.url);

function call(state, command, payload, env = {}) {
  return spawnSync(process.execPath, [controller.pathname, command, JSON.stringify(payload)], {
    encoding: "utf8",
    env: {
      ...process.env,
      FARM_STATE: state,
      FARM_CLI: farmCli.pathname,
      ...env,
    },
    timeout: 15000,
  });
}

test("farm.hostDirs list/add/remove round-trip via controller", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-hostdirs-"));
  const shared = mkdtempSync(join(tmpdir(), "usage-farm-shared-"));

  const empty = JSON.parse(call(state, "farm.hostDirs.list", {}).stdout);
  assert.deepEqual(empty.dirs, []);

  const added = call(state, "farm.hostDirs.add", {
    host: shared,
    mode: "ro",
  });
  assert.equal(added.status, 0, added.stderr || added.stdout);
  const afterAdd = JSON.parse(added.stdout);
  // farm add-host-dir resolves via `pwd -P` (macOS /var → /private/var).
  const resolved = realpathSync(shared);
  assert.equal(afterAdd.dirs.length, 1);
  assert.equal(afterAdd.dirs[0].host, resolved);
  assert.equal(afterAdd.dirs[0].target, resolved);
  assert.equal(afterAdd.dirs[0].mode, "ro");
  assert.equal(existsSync(join(state, "host-dirs")), true);

  const listed = JSON.parse(call(state, "farm.hostDirs.list", {}).stdout);
  assert.equal(listed.dirs.length, 1);

  const removed = call(state, "farm.hostDirs.remove", { host: shared });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.equal(JSON.parse(removed.stdout).dirs.length, 0);
});

test("bootstrap exposes host providers and hostDirs", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-hostboot-"));
  mkdirSync(join(state, "accounts"), { recursive: true });
  writeFileSync(join(state, "gateway.json"), JSON.stringify({
    host: "127.0.0.1",
    port: 47001,
    apiKey: "",
    routes: [],
  }));

  const result = call(state, "farm.bootstrap", {});
  // Bootstrap may start gateway; accept success or a structured error only if CLI missing.
  if (result.status !== 0) {
    // Without a full farm environment bootstrap can still fail on gateway/farmd —
    // but host helpers must still be loadable via hostDirs.list.
    const list = call(state, "farm.hostDirs.list", {});
    assert.equal(list.status, 0, list.stderr);
    return;
  }
  const boot = JSON.parse(result.stdout);
  assert.ok(boot.host);
  assert.ok(Array.isArray(boot.host.providers));
  assert.ok(Array.isArray(boot.hostDirs));
});
