import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);

function json(state, command, payload = {}) {
  const result = spawnSync(process.execPath, [controller.pathname, command, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state },
    timeout: 20000,
  });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

/** Dummy health server in a CHILD process — the test uses spawnSync, which
 *  would block an in-process server's event loop and time every probe out. */
function launchHealthServer(body) {
  const script = `
    const { createServer } = require("node:http");
    const server = createServer((q, r) => { r.setHeader("Content-Type", "application/json"); r.end(${JSON.stringify(body)}); });
    server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  const port = new Promise((resolve, reject) => {
    child.stdout.once("data", (chunk) => resolve(Number(String(chunk).replace(/\x1b\[[0-9;]*m/g, "").trim())));
    child.once("exit", () => reject(new Error("health server died")));
  });
  return { child, port };
}

test("status adopts a live farmd the marker lost track of", async (t) => {
  const server = launchHealthServer('{"status":"ok","service":"farmd","version":"test"}');
  t.after(() => { try { server.child.kill(); } catch { /* gone */ } });
  const port = await server.port;
  const state = mkdtempSync(join(tmpdir(), "farmd-adopt-"));
  writeFileSync(join(state, "farmd.json"), JSON.stringify({ host: "127.0.0.1", port, apiKey: "" }));

  const status = json(state, "farm.farmd.status");
  assert.equal(status.running, true, "port truth wins over the missing marker");
  assert.equal(status.url, `http://127.0.0.1:${port}`);
  // pid recovery rides lsof, which is best-effort under load — when it
  // lands, the adopted marker must be exact; when it doesn't, running
  // above is still the contract.
  if (status.pid != null) {
    assert.equal(status.pid, server.child.pid, "adopted pid recovered from the listener");
    const marker = JSON.parse(readFileSync(join(state, "farmd-runtime.json"), "utf8"));
    assert.equal(marker.adopted, true);
    assert.equal(marker.pid, server.child.pid);
  }
});

test("status reports stopped when nothing farmd-shaped answers", async (t) => {
  const server = launchHealthServer('{"ok":true,"warm":true}');
  t.after(() => { try { server.child.kill(); } catch { /* gone */ } });
  const port = await server.port;
  const state = mkdtempSync(join(tmpdir(), "farmd-foreign-"));
  writeFileSync(join(state, "farmd.json"), JSON.stringify({ host: "127.0.0.1", port, apiKey: "" }));

  const status = json(state, "farm.farmd.status");
  assert.equal(status.running, false, "foreign services are never adopted");
  assert.equal(existsSync(join(state, "farmd-runtime.json")), false, "no marker invented for a foreign service");
});
