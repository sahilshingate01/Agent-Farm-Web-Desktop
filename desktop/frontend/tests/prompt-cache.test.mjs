import assert from "node:assert/strict";
import test from "node:test";

const {
  anthropicCachePrefix,
  applyAnthropicPromptCaching,
  countCacheBreakpoints,
} = await import("../public/backend/prompt-cache.mjs");

const marker = { type: "ephemeral" };

test("adds a static breakpoint and uses remaining slots for the rolling tail", () => {
  const body = applyAnthropicPromptCaching({
    model: "test-model",
    system: "Stable system",
    tools: [{ name: "read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "working" },
          { type: "tool_use", id: "t1", name: "read", input: {} },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }],
      },
    ],
  });
  assert.deepEqual(body.system[0].cache_control, marker);
  assert.deepEqual(body.messages[0].content.at(-1).cache_control, marker);
  assert.deepEqual(body.messages[1].content.at(-1).cache_control, marker);
  assert.deepEqual(body.messages[2].content.at(-1).cache_control, marker);
  assert.equal(countCacheBreakpoints(body), 4);
});

test("uses the final tool as the static breakpoint when system is empty", () => {
  const body = applyAnthropicPromptCaching({
    model: "test-model",
    system: "",
    tools: [
      { name: "read", input_schema: { type: "object" } },
      { name: "write", input_schema: { type: "object" } },
    ],
    messages: [{ role: "user", content: "hello" }],
  });
  assert.deepEqual(body.tools[1].cache_control, marker);
  assert.equal(body.system, "");
});

test("preserves caller markers and never exceeds four breakpoints", () => {
  const body = applyAnthropicPromptCaching({
    cache_control: { type: "ephemeral" },
    system: [{ type: "text", text: "system", cache_control: marker }],
    messages: [
      { role: "user", content: [{ type: "text", text: "one", cache_control: marker }] },
      { role: "assistant", content: [{ type: "text", text: "two" }] },
      { role: "user", content: [{ type: "text", text: "three" }] },
    ],
  });
  assert.equal(countCacheBreakpoints(body), 4);
  assert.equal(body.messages[1].content[0].cache_control, undefined);
  assert.deepEqual(body.messages[2].content[0].cache_control, marker);
});

test("does not spend a rolling marker on an image-only message", () => {
  const body = applyAnthropicPromptCaching({
    system: "system",
    messages: [
      { role: "user", content: "earlier text" },
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "abc" },
          },
        ],
      },
    ],
  });
  assert.deepEqual(body.messages[0].content[0].cache_control, marker);
  assert.equal(body.messages[1].content[0].cache_control, undefined);
});

test("does not mark thinking or empty text blocks", () => {
  const body = applyAnthropicPromptCaching({
    system: "system",
    messages: [{
      role: "assistant",
      content: [
        { type: "text", text: "" },
        { type: "thinking", thinking: "private" },
        { type: "redacted_thinking", data: "opaque" },
      ],
    }],
  });
  assert.equal(countCacheBreakpoints(body), 1);
  assert.equal(body.messages[0].content.some((block) => block.cache_control), false);
});

test("caller TTL strategy is preserved without mixing in default TTL markers", () => {
  const input = {
    system: "system",
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: "caller-managed",
        cache_control: { type: "ephemeral", ttl: "1h" },
      }],
    }],
  };
  const body = applyAnthropicPromptCaching(input);
  assert.deepEqual(body, input);
  assert.equal(countCacheBreakpoints(body), 1);
});

test("tool schema properties named cache_control do not consume marker slots", () => {
  const body = applyAnthropicPromptCaching({
    system: "system",
    tools: [{
      name: "inspect",
      input_schema: {
        type: "object",
        properties: { cache_control: { type: "string" } },
      },
    }],
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(countCacheBreakpoints(body), 2);
});

test("marker-shaped tool input data is not mistaken for provider cache metadata", () => {
  const body = applyAnthropicPromptCaching({
    system: "system",
    messages: [{
      role: "assistant",
      content: [{
        type: "tool_use",
        id: "tool-1",
        name: "inspect",
        input: {
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      }],
    }],
  });
  assert.equal(countCacheBreakpoints(body), 2);
  assert.deepEqual(body.system[0].cache_control, marker);
});

test("tool-heavy single messages get leapfrog markers within twenty blocks", () => {
  const content = Array.from({ length: 25 }, (_, index) => ({
    type: "tool_use",
    id: `tool-${index}`,
    name: "inspect",
    input: { index },
  }));
  const body = applyAnthropicPromptCaching({
    system: "system",
    messages: [{ role: "assistant", content }],
  });
  const marked = body.messages[0].content
    .map((block, index) => block.cache_control ? index : null)
    .filter((index) => index !== null);
  assert.deepEqual(marked, [4, 24]);
});

test("a caller-marked tail does not consume a second rolling slot", () => {
  const content = Array.from({ length: 45 }, (_, index) => ({
    type: "tool_use",
    id: `tool-${index}`,
    name: "inspect",
    input: { index },
    ...(index === 44 ? { cache_control: marker } : {}),
  }));
  const body = applyAnthropicPromptCaching({
    system: "system",
    messages: [{ role: "assistant", content }],
  });
  const marked = body.messages[0].content
    .map((block, index) => block.cache_control ? index : null)
    .filter((index) => index !== null);
  assert.deepEqual(marked, [4, 24, 44]);
  assert.equal(countCacheBreakpoints(body), 4);
});

test("direct cache fingerprints include provider-ordered tools before system", () => {
  const first = applyAnthropicPromptCaching({
    tools: [{ name: "read", input_schema: { type: "object" } }],
    system: "stable",
    messages: [{ role: "user", content: "one" }],
  });
  const changedTool = applyAnthropicPromptCaching({
    tools: [{ name: "write", input_schema: { type: "object" } }],
    system: "stable",
    messages: [{ role: "user", content: "two" }],
  });
  assert.notEqual(anthropicCachePrefix(first), anthropicCachePrefix(changedTool));
  assert.match(anthropicCachePrefix(first), /read/);
  assert.doesNotMatch(anthropicCachePrefix(first), /one/);
});

test("top-level automatic caching fingerprints the full provider-ordered context", () => {
  const first = {
    cache_control: { type: "ephemeral", ttl: "1h" },
    system: "stable",
    messages: [{ role: "user", content: "one" }],
  };
  const second = {
    ...first,
    messages: [{ role: "user", content: "two" }],
  };
  assert.match(anthropicCachePrefix(first), /one/);
  assert.notEqual(anthropicCachePrefix(first), anthropicCachePrefix(second));
});

test("disabled caching returns an equal body with no markers", () => {
  const input = {
    system: "system",
    messages: [{ role: "user", content: "hello" }],
  };
  const body = applyAnthropicPromptCaching(input, { enabled: false });
  assert.deepEqual(body, input);
  assert.notEqual(body, input);
  assert.equal(countCacheBreakpoints(body), 0);
});

test("does not mutate the caller's request body", () => {
  const input = {
    system: "system",
    messages: [{ role: "user", content: "hello" }],
  };
  const before = structuredClone(input);
  applyAnthropicPromptCaching(input);
  assert.deepEqual(input, before);
});
