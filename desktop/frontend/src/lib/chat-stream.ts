/** SSE plumbing for the chat composer's streaming reads.
 *
 *  Both helpers exist because the gateway streams DELTAS: `farm.reasoning` and
 *  `farm.tools` ride only the chunks that produced them, with bare
 *  `{content}` chunks in between (gateway.mjs `streamChat` /
 *  `streamCommandChat`). Anything that writes a frame's fields straight onto
 *  the message erases the trace on the very next token, and anything that lets
 *  one bad frame throw discards the whole answer.
 */

import type { ChatToolEvent } from "@/types/farm";

export interface SseSplit {
  /** Parsed `data:` payloads, in order. Unparseable frames are dropped. */
  frames: unknown[];
  /** The trailing partial event, to prepend to the next read. */
  rest: string;
}

/** Split a decoded read into complete SSE events. A frame that is not valid
 *  JSON is skipped, never thrown — the caller's error path replaces the whole
 *  message, so one bad frame would cost every token already streamed. */
export function parseSseFrames(buffer: string): SseSplit {
  const events = buffer.split("\n\n");
  const rest = events.pop() || "";
  const frames: unknown[] = [];
  for (const raw of events) {
    const line = raw.split("\n").find((part) => part.startsWith("data:"));
    if (!line) continue;
    const payload = line.slice(line.indexOf(":") + 1).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      frames.push(JSON.parse(payload));
    } catch {
      /* torn or non-JSON frame — the stream continues */
    }
  }
  return { frames, rest };
}

/** Fold a chunk's tool deltas into the running list. Same id → the later event
 *  wins but keeps the earlier input/output and real name, so a "tool result"
 *  completion does not blank out what the tool_use said it was doing. */
export function mergeToolEvents(
  current: ChatToolEvent[],
  incoming: ChatToolEvent[],
): ChatToolEvent[] {
  let next = current;
  for (const tool of incoming) {
    if (!tool?.id) {
      next = [...next, tool];
      continue;
    }
    const previous = next.find((item) => item.id === tool.id);
    if (!previous) {
      next = [...next, tool];
      continue;
    }
    const generic =
      !tool.name || /^(tool|tool result|tool_result|tool_use)$/i.test(tool.name);
    next = next.map((item) =>
      item.id === tool.id
        ? {
            ...previous,
            ...tool,
            name: generic && previous.name ? previous.name : tool.name,
            input: tool.input ?? previous.input,
            output: tool.output ?? previous.output,
          }
        : item,
    );
  }
  return next;
}
