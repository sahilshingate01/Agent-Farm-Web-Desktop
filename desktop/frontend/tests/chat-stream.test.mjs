import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Strip types and eval the pure helper module for node:test (no ts-node) —
// same trick as ascii-diagram.test.mjs.
const src = readFileSync(new URL("../src/lib/chat-stream.ts", import.meta.url), "utf8")
  .replace(/^import type .*$/gm, "")
  .replace(/^export interface [\s\S]*?^}$/gm, "")
  .replace(/^export /gm, "")
  .replace(/: SseSplit/g, "")
  .replace(/: ChatToolEvent\[\]/g, "")
  .replace(/: unknown\[\]/g, "")
  .replace(/: string/g, "")
  .replace(/\)\s*{/g, ") {");
const { parseSseFrames, mergeToolEvents } = new Function(
  `${src}; return { parseSseFrames, mergeToolEvents };`,
)();

const frame = (delta) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;

test("splits complete events and holds the trailing partial back", () => {
  const { frames, rest } = parseSseFrames(
    `${frame({ content: "one" })}${frame({ content: "two" })}data: {"choices":[{"del`,
  );
  assert.equal(frames.length, 2);
  assert.equal(frames[0].choices[0].delta.content, "one");
  assert.equal(rest, `data: {"choices":[{"del`);
});

test("a torn or non-JSON frame is skipped, not thrown", () => {
  // The caller's catch replaces the whole message with an error string, so a
  // throw here would discard every token already streamed.
  const { frames } = parseSseFrames(
    `${frame({ content: "before" })}data: {not json}\n\n${frame({ content: "after" })}`,
  );
  assert.equal(frames.length, 2);
  assert.equal(frames[0].choices[0].delta.content, "before");
  assert.equal(frames[1].choices[0].delta.content, "after");
});

test("[DONE] and comment/heartbeat lines are ignored", () => {
  const { frames } = parseSseFrames(
    `: keep-alive\n\n${frame({ content: "x" })}data: [DONE]\n\n`,
  );
  assert.equal(frames.length, 1);
});

test("accepts data: with or without the conventional space", () => {
  const { frames } = parseSseFrames(`data:{"a":1}\n\ndata: {"a":2}\n\n`);
  assert.deepEqual(frames, [{ a: 1 }, { a: 2 }]);
});

test("reasoning accumulates across the chunks that carry it", () => {
  // gateway.mjs emits farm.reasoning only on chunks that produced it and bare
  // {content} chunks in between; replacing rather than appending erased the
  // trace on the very next token.
  const stream = [
    frame({ role: "assistant", content: "", farm: { reasoning: "think " } }),
    frame({ content: "Hello" }),
    frame({ farm: { reasoning: "harder" } }),
    frame({ content: " world" }),
  ].join("");
  let content = "";
  let reasoning = "";
  for (const chunk of parseSseFrames(stream).frames) {
    const delta = chunk.choices?.[0]?.delta || {};
    content += delta.content || "";
    if (delta.farm?.reasoning) reasoning += delta.farm.reasoning;
  }
  assert.equal(content, "Hello world");
  assert.equal(reasoning, "think harder");
});

test("tool deltas merge by id instead of replacing the list", () => {
  const first = mergeToolEvents([], [
    { id: "t1", name: "Read", status: "running", input: { path: "a.ts" } },
  ]);
  const second = mergeToolEvents(first, [
    { id: "t2", name: "Bash", status: "running" },
  ]);
  assert.equal(second.length, 2);
  assert.deepEqual(
    second.map((tool) => tool.id),
    ["t1", "t2"],
  );
});

test("a generic tool_result keeps the earlier real name and input", () => {
  const running = mergeToolEvents([], [
    { id: "t1", name: "Read", status: "running", input: { path: "a.ts" } },
  ]);
  const done = mergeToolEvents(running, [
    { id: "t1", name: "tool result", status: "completed", output: "ok" },
  ]);
  assert.equal(done.length, 1);
  assert.equal(done[0].name, "Read");
  assert.equal(done[0].status, "completed");
  assert.deepEqual(done[0].input, { path: "a.ts" });
  assert.equal(done[0].output, "ok");
});

test("tools without an id are appended rather than dropped", () => {
  const merged = mergeToolEvents([], [{ name: "Anon", status: "completed" }]);
  assert.equal(merged.length, 1);
});
