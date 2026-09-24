import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);

function call(state, command, payload) {
  const result = spawnSync(process.execPath, [controller.pathname, command, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state, FARM_CLI: "/bin/true" },
    timeout: 10000,
  });
  return result;
}

function session(id, title, extra = {}) {
  const stamp = new Date().toISOString();
  return {
    id,
    title,
    model: "claude/sahil",
    createdAt: stamp,
    updatedAt: stamp,
    permissions: "ask",
    toolsEnabled: true,
    messages: [{ id: "m1", role: "user", content: "hello", createdAt: stamp }],
    queue: [],
    ...extra,
  };
}

test("farm.session save/list/get/remove round-trip with paging", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-sessions-test-"));

  const saved = call(state, "farm.session.save", { session: session("job-aaa", "First job") });
  assert.equal(saved.status, 0, saved.stderr);
  const meta = JSON.parse(saved.stdout);
  assert.equal(meta.id, "job-aaa");
  assert.equal(meta.messageCount, 1);
  assert.equal(existsSync(join(state, "sessions", "job-aaa.json")), true);
  const mode = statSync(join(state, "sessions", "job-aaa.json")).mode & 0o777;
  assert.equal(mode, 0o600);

  assert.equal(call(state, "farm.session.save", { session: session("job-bbb", "Second job", { source: "claude", originPath: "/tmp/x.jsonl" }) }).status, 0);
  // Force distinct mtimes so ordering is deterministic.
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(state, "sessions", "job-aaa.json"), past, past);

  const listed = JSON.parse(call(state, "farm.session.list", {}).stdout);
  assert.equal(listed.total, 2);
  assert.equal(listed.sessions[0].id, "job-bbb");
  assert.equal(listed.sessions[0].source, "claude");
  assert.equal(listed.sessions[0].messageCount, 1);
  assert.equal("messages" in listed.sessions[0], false);

  const page = JSON.parse(call(state, "farm.session.list", { offset: 1, limit: 1 }).stdout);
  assert.equal(page.sessions.length, 1);
  assert.equal(page.sessions[0].id, "job-aaa");
  assert.equal(page.total, 2);

  const queried = JSON.parse(call(state, "farm.session.list", { query: "second" }).stdout);
  assert.equal(queried.total, 1);
  assert.equal(queried.sessions[0].id, "job-bbb");

  const fetched = JSON.parse(call(state, "farm.session.get", { id: "job-aaa" }).stdout);
  assert.equal(fetched.messages.length, 1);
  assert.equal(fetched.messages[0].content, "hello");

  assert.equal(JSON.parse(call(state, "farm.session.remove", { id: "job-aaa" }).stdout).removed, "job-aaa");
  assert.equal(existsSync(join(state, "sessions", "job-aaa.json")), false);
  const removeMissing = call(state, "farm.session.remove", { id: "job-aaa" });
  assert.notEqual(removeMissing.status, 0);
});

test("the composer's model pick survives the store as list meta", () => {
  // Stubs hydrate from list metas alone. If catalogModel is not projected the
  // reopened session silently falls back to the route's pinned upstreamModel
  // while its effort — which IS projected — stays applied.
  const state = mkdtempSync(join(tmpdir(), "usage-farm-sessions-test-"));
  const saved = call(state, "farm.session.save", {
    session: session("job-pick", "Picked job", {
      catalogModel: "claude-sonnet-5",
      effort: "high",
    }),
  });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).catalogModel, "claude-sonnet-5");

  const listed = JSON.parse(call(state, "farm.session.list", {}).stdout);
  assert.equal(listed.sessions[0].catalogModel, "claude-sonnet-5");
  assert.equal(listed.sessions[0].effort, "high");

  const fetched = JSON.parse(call(state, "farm.session.get", { id: "job-pick" }).stdout);
  assert.equal(fetched.catalogModel, "claude-sonnet-5");
});

test("farm.session.adopt imports a native claude transcript with provenance, idempotently", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-sessions-test-"));
  const archive = join(state, "accounts", "sahil", "claude-home", "projects", "-work");
  spawnSync("mkdir", ["-p", archive]);
  const transcript = join(archive, "abc123.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "<environment_context>\n<cwd>/x</cwd>\n</environment_context>" }, timestamp: "2026-07-15T09:59:59Z" }),
    JSON.stringify({ type: "user", message: { role: "user", content: "fix the login bug" }, timestamp: "2026-07-15T10:00:00Z" }),
    JSON.stringify({ type: "user", message: { role: "user", content: "<system-reminder>noise</system-reminder>" }, timestamp: "2026-07-15T10:00:30Z" }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done — patched auth.ts" }] }, timestamp: "2026-07-15T10:01:00Z" }),
  ];
  spawnSync("sh", ["-c", `cat > ${JSON.stringify(transcript)}`], { input: lines.join("\n") });

  const adopted = call(state, "farm.session.adopt", { path: transcript });
  assert.equal(adopted.status, 0, adopted.stderr);
  const meta = JSON.parse(adopted.stdout);
  assert.match(meta.id, /^adopted-[a-f0-9]{12}$/);
  assert.equal(meta.source, "claude");
  assert.equal(meta.originPath, transcript);
  assert.equal(meta.messageCount, 2);
  assert.equal(meta.title, "fix the login bug");
  assert.equal(meta.model, "claude/sahil");

  const again = JSON.parse(call(state, "farm.session.adopt", { path: transcript }).stdout);
  assert.equal(again.id, meta.id);
  assert.equal(JSON.parse(call(state, "farm.session.list", {}).stdout).total, 1);

  const outside = call(state, "farm.session.adopt", { path: "/etc/hosts" });
  assert.notEqual(outside.status, 0);
});

test("farm.session rejects traversal ids and payloads without ids", () => {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-sessions-test-"));
  const traversal = call(state, "farm.session.save", { session: session("../evil", "Nope") });
  // The id sanitizer strips path characters and leading dots — the file must
  // land inside sessions/ under the sanitized name, never beside the store.
  assert.equal(traversal.status, 0, traversal.stderr);
  assert.equal(existsSync(join(state, "sessions", "evil.json")), true);
  assert.equal(existsSync(join(state, "evil.json")), false);

  const missingId = call(state, "farm.session.save", { session: { title: "no id" } });
  assert.notEqual(missingId.status, 0);
});
