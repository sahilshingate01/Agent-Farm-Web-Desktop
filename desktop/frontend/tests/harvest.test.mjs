import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const controller = new URL("../public/backend/controller.mjs", import.meta.url);

function run(state, command, payload, { timeout = 5000 } = {}) {
  return spawnSync(process.execPath, [controller.pathname, command, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, FARM_STATE: state },
    timeout,
  });
}

function scaffold({ suggestions = [] } = {}) {
  const state = mkdtempSync(join(tmpdir(), "usage-farm-harvest-test-"));
  const workspace = join(state, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(state, "workspace.json"), JSON.stringify({ root: workspace }));
  if (suggestions.length) {
    writeFileSync(
      join(state, "harvest.json"),
      JSON.stringify({
        suggestions,
        lastScanAt: null,
        lastError: null,
        scanning: false,
        scanPid: null,
        scanStartedAt: null,
      }),
    );
  }
  return { state, workspace };
}

const draft = (overrides = {}) => ({
  id: "harvest-testsuggest",
  kind: "wiki-doc",
  title: "Test doc",
  summary: "A test suggestion",
  citations: ["notes.md"],
  draftPath: "banked/test-doc.md",
  draft: "# Test doc\n\nBody.\n",
  status: "proposed",
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

test("harvest list starts empty", () => {
  const { state } = scaffold();
  const result = run(state, "farm.harvest.list", {});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    suggestions: [],
    lastScanAt: null,
    lastError: null,
    scanning: false,
    triaging: false,
    lastTriageAt: null,
    lastTriageError: null,
    lastTriageCounts: null,
  });
});

test("scan returns immediately and marks scanning (non-blocking bridge)", () => {
  const { state, workspace } = scaffold();
  writeFileSync(join(workspace, "notes.md"), "# Notes\n\nSomething harvestable.\n");
  const started = Date.now();
  const result = run(state, "farm.harvest.scan", {});
  const elapsed = Date.now() - started;
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.started, true);
  assert.equal(body.scanning, true);
  // Must not wait for the LLM worker — bridge hang was the beach-ball cause.
  assert.ok(elapsed < 3000, `scan start took ${elapsed}ms; should return immediately`);
  const stored = JSON.parse(readFileSync(join(state, "harvest.json"), "utf8"));
  assert.equal(stored.scanning, true);
  assert.ok(stored.scanPid);
});

test("worker path completes empty workspace without hanging", () => {
  const { state } = scaffold();
  const result = run(state, "farm.harvest.scan", { worker: true });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.scanning, false);
  assert.equal(body.scanned, 0);
  assert.match(body.lastError || "", /no readable documents/i);
});

test("second scan while already scanning is a no-op start", () => {
  const { state } = scaffold();
  writeFileSync(
    join(state, "harvest.json"),
    JSON.stringify({
      suggestions: [],
      lastScanAt: null,
      lastError: null,
      scanning: true,
      scanPid: process.pid, // this test process is alive
      scanStartedAt: new Date().toISOString(),
    }),
  );
  const result = run(state, "farm.harvest.scan", {});
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.started, false);
  assert.equal(body.scanning, true);
});

test("list heals a dead scanPid lock", () => {
  const { state } = scaffold();
  writeFileSync(
    join(state, "harvest.json"),
    JSON.stringify({
      suggestions: [],
      lastScanAt: null,
      lastError: null,
      scanning: true,
      scanPid: 999_999_999, // almost certainly not alive
      scanStartedAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  );
  const result = run(state, "farm.harvest.list", {});
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.scanning, false);
  assert.match(body.lastError || "", /stopped unexpectedly|timed out/i);
});

test("dismiss parks a suggestion without writing anything", () => {
  const { state, workspace } = scaffold({ suggestions: [draft()] });
  const result = run(state, "farm.harvest.resolve", { id: "harvest-testsuggest", action: "dismiss" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { id: "harvest-testsuggest", status: "dismissed" });
  assert.equal(existsSync(join(workspace, "banked/test-doc.md")), false);
  const stored = JSON.parse(readFileSync(join(state, "harvest.json"), "utf8"));
  assert.equal(stored.suggestions[0].status, "dismissed");
});

test("approve writes the draft inside the workspace and records it", () => {
  const { state, workspace } = scaffold({ suggestions: [draft()] });
  const result = run(state, "farm.harvest.resolve", { id: "harvest-testsuggest", action: "approve" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    id: "harvest-testsuggest",
    status: "approved",
    path: "banked/test-doc.md",
    merged: false,
  });
  assert.equal(readFileSync(join(workspace, "banked/test-doc.md"), "utf8"), "# Test doc\n\nBody.\n");
  const stored = JSON.parse(readFileSync(join(state, "harvest.json"), "utf8"));
  assert.equal(stored.suggestions[0].status, "approved");
  assert.equal(stored.suggestions[0].writtenTo, "banked/test-doc.md");
});

test("approve refuses a draft path that escapes the workspace", () => {
  const { state } = scaffold({ suggestions: [draft({ draftPath: "../escape.md" })] });
  const result = run(state, "farm.harvest.resolve", { id: "harvest-testsuggest", action: "approve" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /escapes the workspace/);
  assert.equal(existsSync(join(state, "escape.md")), false);
});

test("approve refuses to overwrite an existing file", () => {
  const { state, workspace } = scaffold({ suggestions: [draft()] });
  mkdirSync(join(workspace, "banked"), { recursive: true });
  writeFileSync(join(workspace, "banked/test-doc.md"), "precious existing content");
  const result = run(state, "farm.harvest.resolve", { id: "harvest-testsuggest", action: "approve" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/);
  assert.equal(readFileSync(join(workspace, "banked/test-doc.md"), "utf8"), "precious existing content");
});

test("approve with merge folds into an existing file instead of dead-ending", () => {
  // The old behaviour was a hard "already exists — resolve manually" with no
  // way forward; merge is what triage uses after re-reading the target.
  const { state, workspace } = scaffold({
    suggestions: [draft({ draft: "precious existing content\n\n# Test doc\n\nBody.\n" })],
  });
  mkdirSync(join(workspace, "banked"), { recursive: true });
  writeFileSync(join(workspace, "banked/test-doc.md"), "precious existing content");
  const result = run(state, "farm.harvest.resolve", {
    id: "harvest-testsuggest",
    action: "approve",
    merge: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.status, "approved");
  assert.equal(body.merged, true);
  const written = readFileSync(join(workspace, "banked/test-doc.md"), "utf8");
  assert.match(written, /precious existing content/);
  assert.match(written, /# Test doc/);
});

test("merge still refuses a path that escapes the workspace", () => {
  const { state } = scaffold({ suggestions: [draft({ draftPath: "../escape.md" })] });
  const result = run(state, "farm.harvest.resolve", {
    id: "harvest-testsuggest",
    action: "approve",
    merge: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /escapes the workspace/);
  assert.equal(existsSync(join(state, "escape.md")), false);
});

test("triage returns immediately and marks triaging (non-blocking bridge)", () => {
  const { state } = scaffold({ suggestions: [draft()] });
  const started = Date.now();
  const result = run(state, "farm.harvest.triage", {});
  const elapsed = Date.now() - started;
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.started, true);
  assert.equal(body.triaging, true);
  assert.ok(elapsed < 3000, `triage start took ${elapsed}ms; should return immediately`);
  const stored = JSON.parse(readFileSync(join(state, "harvest.json"), "utf8"));
  assert.ok(stored.triagePid);
});

test("triage worker with nothing proposed finishes without calling a model", () => {
  // No gateway and no silo in tests — reaching harvestComplete would throw,
  // so a clean finish proves the early-out works.
  const { state } = scaffold({ suggestions: [draft({ status: "approved" })] });
  const result = run(state, "farm.harvest.triage", { worker: true });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.triaging, false);
  assert.equal(body.lastTriageError, null);
  assert.ok(body.lastTriageAt);
});

test("a second triage while one is running is a no-op start", () => {
  const { state } = scaffold({ suggestions: [draft()] });
  const stored = JSON.parse(readFileSync(join(state, "harvest.json"), "utf8"));
  writeFileSync(
    join(state, "harvest.json"),
    JSON.stringify({ ...stored, triaging: true, triagePid: process.pid, triageStartedAt: new Date().toISOString() }),
  );
  const result = run(state, "farm.harvest.triage", {});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).started, false);
});

test("triage worker always clears its lock and leaves consistent state", () => {
  // Deliberately environment-independent: whether a model is reachable depends
  // on the machine (a dev box has a live gateway; CI does not). What must hold
  // either way is that the worker never crashes, never strands the lock, and
  // ends in exactly one of two states — errored with every suggestion
  // untouched, or triaged with a verdict recorded.
  const { state } = scaffold({ suggestions: [draft()] });
  const result = run(state, "farm.harvest.triage", { worker: true }, { timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.triaging, false, "lock must always be cleared");
  assert.ok(body.lastTriageAt, "the pass must always stamp when it ran");

  const stored = JSON.parse(readFileSync(join(state, "harvest.json"), "utf8"));
  assert.equal(stored.triagePid, null);
  const suggestion = stored.suggestions[0];
  if (body.lastTriageError) {
    assert.equal(suggestion.status, "proposed", "a failed triage must not touch the suggestion");
    assert.equal(suggestion.verdict, undefined);
  } else {
    assert.ok(["proposed", "approved", "dismissed"].includes(suggestion.status));
    assert.ok(suggestion.verdict, "a successful triage must record a verdict");
    assert.ok(suggestion.rating >= 1 && suggestion.rating <= 5, `rating ${suggestion.rating} out of range`);
    assert.ok(body.lastTriageCounts, "a successful triage must record counts");
    // A rejected suggestion must never also have been written to disk.
    if (suggestion.status === "dismissed") assert.equal(suggestion.writtenTo, undefined);
  }
});

test("editor assist rejects an empty prompt before shelling out", () => {
  const { state } = scaffold();
  const result = run(state, "farm.editor.assist", { prompt: "   " });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /needs a prompt/);
});
