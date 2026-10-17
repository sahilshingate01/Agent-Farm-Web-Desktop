/** Anthropic explicit prompt-cache breakpoints for direct gateway routes.
 *
 * This module is deliberately unaware of route/model names. The caller must
 * opt in only when it owns an Anthropic Messages request body.
 */

const MAX_BREAKPOINTS = 4;
const LOOKBACK_BLOCKS = 20;
const MARKER = Object.freeze({ type: "ephemeral" });
const CACHEABLE_CONTENT_TYPES = new Set(["text", "tool_use", "tool_result", "document"]);

function cloneJson(value) {
  return value == null ? value : structuredClone(value);
}

/** Objects on which Anthropic actually accepts cache_control. Do not recurse
 * into tool schemas or tool-use input: user data may legitimately contain a
 * cache_control-shaped property and must not consume a provider marker slot. */
function providerCacheTargets(body) {
  if (!body || typeof body !== "object") return [];
  const targets = [body];
  if (Array.isArray(body.tools)) targets.push(...body.tools);
  if (Array.isArray(body.system)) targets.push(...body.system);
  for (const message of body.messages || []) {
    if (Array.isArray(message?.content)) targets.push(...message.content);
  }
  return targets.filter((target) => target && typeof target === "object");
}

export function countCacheBreakpoints(body) {
  return providerCacheTargets(body)
    .filter((target) => target.cache_control?.type === "ephemeral")
    .length;
}

function canAdd(body) {
  return countCacheBreakpoints(body) < MAX_BREAKPOINTS;
}

function markObject(body, block) {
  if (!block || typeof block !== "object" || block.cache_control || !canAdd(body)) return false;
  block.cache_control = { ...MARKER };
  return true;
}

function eligibleBlock(block) {
  if (!block || typeof block !== "object") return false;
  const type = String(block.type || "");
  if (!CACHEABLE_CONTENT_TYPES.has(type)) return false;
  return type !== "text" || Boolean(String(block.text || "").trim());
}

function markStaticPrefix(body) {
  const system = body.system;
  if (typeof system === "string" && system.trim()) {
    if (!canAdd(body)) return;
    body.system = [{ type: "text", text: system, cache_control: { ...MARKER } }];
    return;
  }
  if (Array.isArray(system)) {
    const target = [...system].reverse().find(eligibleBlock);
    if (target) {
      markObject(body, target);
      return;
    }
  }
  if (Array.isArray(body.tools) && body.tools.length) {
    markObject(body, body.tools.at(-1));
  }
}

function rollingTarget(body, message) {
  if (!message || typeof message !== "object") return null;
  if (typeof message.content === "string") {
    if (!message.content.trim() || !canAdd(body)) return null;
    message.content = [{ type: "text", text: message.content }];
  }
  if (!Array.isArray(message.content)) return null;
  return [...message.content].reverse().find(eligibleBlock) || null;
}

function rollingCandidates(body) {
  if (!Array.isArray(body.messages)) return [];
  const candidates = [];
  for (let messageIndex = 0; messageIndex < body.messages.length; messageIndex += 1) {
    const message = body.messages[messageIndex];
    rollingTarget(body, message);
    if (!Array.isArray(message?.content)) continue;
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex += 1) {
      const block = message.content[blockIndex];
      if (eligibleBlock(block)) candidates.push({ block, messageIndex, blockIndex });
    }
  }
  return candidates;
}

function markRollingTail(body) {
  const candidates = rollingCandidates(body);
  if (!candidates.length) return;
  let available = Math.max(0, MAX_BREAKPOINTS - countCacheBreakpoints(body));
  const marked = new Set(candidates
    .map((candidate, index) => candidate.block.cache_control?.type === "ephemeral" ? index : null)
    .filter((index) => index !== null));
  const selected = new Set();
  const select = (index) => {
    if (index < 0 || marked.has(index) || selected.has(index) || available <= 0) return false;
    selected.add(index);
    available -= 1;
    return true;
  };

  // The current tail is the first anchor. A caller-owned marker already at the
  // tail anchors spacing without spending another one of our available slots.
  let anchor = candidates.length - 1;
  select(anchor);

  // Leapfrog backward at most twenty cacheable blocks at a time. An existing
  // caller marker inside that window becomes the next anchor; otherwise add a
  // marker exactly at the lookback boundary.
  while (available > 0 && anchor - LOOKBACK_BLOCKS >= 0) {
    const boundary = anchor - LOOKBACK_BLOCKS;
    let existing = null;
    for (let index = anchor - 1; index >= boundary; index -= 1) {
      if (marked.has(index)) {
        existing = index;
        break;
      }
    }
    if (existing !== null) {
      anchor = existing;
      continue;
    }
    select(boundary);
    anchor = boundary;
  }

  // For ordinary short conversations, use spare slots on prior message tails.
  for (let index = candidates.length - 2; index >= 0 && available > 0; index -= 1) {
    const nextMessage = candidates[index + 1]?.messageIndex;
    if (candidates[index].messageIndex !== nextMessage) select(index);
  }
  for (const index of [...selected].sort((left, right) => right - left)) {
    markObject(body, candidates[index].block);
  }
}

function hasExplicitTtl(body) {
  return providerCacheTargets(body)
    .some((target) => target.cache_control?.type === "ephemeral" && target.cache_control.ttl);
}

export function applyAnthropicPromptCaching(requestBody, { enabled = true } = {}) {
  const body = cloneJson(requestBody || {});
  // Preserve a caller-managed TTL strategy verbatim. Adding default 5-minute
  // markers around a 1-hour marker can violate Anthropic's required TTL order.
  if (!enabled || hasExplicitTtl(body)) return body;
  markStaticPrefix(body);
  markRollingTail(body);
  return body;
}

/** Serialize the provider-ordered prefix through its first real breakpoint.
 * This is the stable cache segment to fingerprint; unlike promptFrom(), it
 * includes tools before system and excludes the changing tail. */
export function anthropicCachePrefix(body) {
  const segments = [];
  const automatic = body?.cache_control?.type === "ephemeral";
  if (automatic) segments.push(["automatic", body.cache_control]);
  const append = (kind, value) => {
    if (value === undefined || value === null || value === "") return false;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      segments.push([kind, item]);
      if (!automatic && item?.cache_control?.type === "ephemeral") return true;
    }
    return false;
  };
  if (append("tool", body?.tools)) return JSON.stringify(segments);
  if (append("system", body?.system)) return JSON.stringify(segments);
  for (const message of body?.messages || []) {
    const content = Array.isArray(message.content)
      ? message.content
      : [{ type: "text", text: String(message.content || "") }];
    for (const block of content) {
      segments.push(["message", message.role || "user", block]);
      if (!automatic && block?.cache_control?.type === "ephemeral") return JSON.stringify(segments);
    }
  }
  return automatic ? JSON.stringify(segments) : null;
}
