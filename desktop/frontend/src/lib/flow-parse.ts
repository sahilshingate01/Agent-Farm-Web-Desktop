import { invokeNative } from "@/lib/native";

/** Workflow → node-graph parsing (the scan-style flow map, applied to
 *  process documents like skills and workflow definitions).
 *
 *  Two passes, by design:
 *  - `parseFlowDeterministic` — pure heuristics, same input same output:
 *    mermaid blocks (highest fidelity), numbered step lists, arrow chains,
 *    and stage-verb phrase splitting, with model/tool names folded into
 *    the stage that uses them. Returns null when the document has no
 *    recognizable process shape.
 *  - `parseFlowWithAI` — hands the document to the editor-assist model and
 *    validates the JSON it returns. Non-deterministic; only ever run on an
 *    explicit user action or as an offered fallback.
 */

export type FlowNodeKind =
  | "entry"
  | "stage"
  | "agent"
  | "model"
  | "tool"
  | "decision"
  | "output";

export interface FlowEmbed {
  label: string;
  kind: "model" | "tool";
}

export interface FlowNode {
  id: string;
  label: string;
  kind: FlowNodeKind;
  sub?: string;
  detail?: string;
  embeds?: FlowEmbed[];
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ParsedFlow {
  title: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 0..1 — how much recognizable structure backed the parse. */
  confidence: number;
  source: "deterministic" | "ai";
}

const MODEL_RE =
  /\b(?:claude[- ])?(opus|sonnet|haiku|fable|gpt[- ]?\d[\w.-]*|codex(?:\s+gpt[-\s]?[\d.]+)?|gemini[\w.-]*|o[13](?:-\w+)?|llama[\w.-]*|mistral[\w.-]*)(?:[- ][\d.]+)?\b/gi;
const TOOL_RE =
  /\b(bash|grep|glob|webfetch|websearch|mcp|playwright|browser|terminal|git|docker)\b/gi;
// Non-global twin for boolean tests — a `g` regex's .test() is stateful.
const MODEL_TEST_RE = new RegExp(MODEL_RE.source, "i");
const STAGE_VERB_RE =
  /^(plan|execute|escalate|review|verify|synthesize|merge|analy[sz]e|research|implement|test|deploy|scan|read|write|fix|build|route|dispatch|run|check|summari[sz]e|extract|parse|render|report)\b/i;
const DECISION_RE = /\b(escalate|if\b|when\b|fallback|otherwise|blocked|fails?|retry|unless)\b/i;
const OUTPUT_RE = /\b(final|ship|deliver|report|answer|output|advisor|done|complete)\b/i;

function clampLabel(text: string, max = 44): string {
  const clean = text.replace(/\s+/g, " ").replace(/[*_`>#]/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function findEmbeds(text: string): FlowEmbed[] {
  const embeds: FlowEmbed[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MODEL_RE)) {
    const label = clampLabel(match[0], 24);
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      embeds.push({ label, kind: "model" });
    }
  }
  for (const match of text.matchAll(TOOL_RE)) {
    const label = match[1].toLowerCase();
    if (!seen.has(label)) {
      seen.add(label);
      embeds.push({ label, kind: "tool" });
    }
  }
  return embeds.slice(0, 4);
}

function stageKind(text: string): FlowNodeKind {
  if (DECISION_RE.test(text) && /escalate|fallback|retry/i.test(text)) return "decision";
  if (OUTPUT_RE.test(text)) return "output";
  if (/\b(sub)?agents?\b|\breviewer\b|\bplanner\b|\bjudge\b/i.test(text)) return "agent";
  return "stage";
}

/** Conditional clause → edge label ("when blocked", "if tests fail"). */
function edgeLabelFor(text: string): string | undefined {
  const match = text.match(/\b(?:when|if|unless|only when)\b[^,.;]{0,32}/i);
  if (match) return clampLabel(match[0], 28);
  if (/\bescalate\b/i.test(text)) return "escalate";
  if (/\bfallback|otherwise\b/i.test(text)) return "fallback";
  return undefined;
}

interface Frontmatter {
  name: string | null;
  description: string | null;
  body: string;
}

function splitFrontmatter(markdown: string): Frontmatter {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { name: null, description: null, body: markdown };
  const head = match[1];
  const grab = (key: string) => {
    const line = head.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return line ? line[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  return {
    name: grab("name") || grab("title"),
    description: grab("description"),
    body: markdown.slice(match[0].length),
  };
}

/** Mermaid flowchart/graph blocks parse with full fidelity. */
function parseMermaid(markdown: string, title: string | null): ParsedFlow | null {
  const block = markdown.match(/```mermaid\s+(?:flowchart|graph)\s+\w+\n([\s\S]*?)```/);
  if (!block) return null;
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const ensure = (id: string, label?: string, shape?: string) => {
    const existing = nodes.get(id);
    if (existing) {
      if (label && existing.label === id) existing.label = clampLabel(label);
      return existing;
    }
    const node: FlowNode = {
      id,
      label: clampLabel(label || id),
      kind: shape === "{" ? "decision" : stageKind(label || id),
      embeds: findEmbeds(label || ""),
    };
    nodes.set(id, node);
    return node;
  };
  const nodeToken = /([\w-]+)\s*(?:(\[|\(|\{)\s*"?([^\]\)\}"]+)"?\s*(?:\]|\)|\}))?/y;
  for (const raw of block[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || /^(subgraph|end|classDef|class|style)\b/.test(line)) continue;
    const parts = line.split(/-{2,3}>?|==+>|-\.->/);
    if (parts.length < 2) {
      nodeToken.lastIndex = 0;
      const single = nodeToken.exec(line);
      if (single) ensure(single[1], single[3], single[2]);
      continue;
    }
    let previous: string | null = null;
    for (let index = 0; index < parts.length; index += 1) {
      const segment = parts[index].trim();
      const labelMatch = segment.match(/^\|([^|]+)\|\s*(.*)$/);
      const edgeLabel = labelMatch ? clampLabel(labelMatch[1], 28) : undefined;
      const nodePart = (labelMatch ? labelMatch[2] : segment).trim();
      if (!nodePart) continue;
      nodeToken.lastIndex = 0;
      const token = nodeToken.exec(nodePart);
      if (!token) continue;
      ensure(token[1], token[3], token[2]);
      if (previous) edges.push({ from: previous, to: token[1], label: edgeLabel });
      previous = token[1];
    }
  }
  if (nodes.size < 2) return null;
  return {
    title,
    nodes: [...nodes.values()],
    edges,
    confidence: 0.95,
    source: "deterministic",
  };
}

function chainFromPhrases(
  phrases: string[],
  title: string | null,
  confidence: number,
): ParsedFlow | null {
  const cleaned = phrases.map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 2);
  if (cleaned.length < 2) return null;
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  if (title) nodes.push({ id: "entry", label: clampLabel(title, 32), kind: "entry" });
  cleaned.slice(0, 12).forEach((phrase, index) => {
    const id = `s${index + 1}`;
    nodes.push({
      id,
      label: clampLabel(phrase),
      kind: stageKind(phrase),
      detail: phrase.length > 44 ? phrase : undefined,
      embeds: findEmbeds(phrase),
    });
    const from = index === 0 ? (title ? "entry" : null) : `s${index}`;
    if (from) edges.push({ from, to: id, label: index === 0 ? undefined : edgeLabelFor(phrase) });
  });
  if (nodes.length < 2) return null;
  return { title, nodes, edges, confidence, source: "deterministic" };
}

export function parseFlowDeterministic(markdown: string): ParsedFlow | null {
  const { name, description, body } = splitFrontmatter(markdown);
  const heading = body.match(/^#\s+(.+)$/m);
  const title = name || (heading ? heading[1].trim() : null);

  const mermaid = parseMermaid(body, title);
  if (mermaid) return mermaid;

  // Numbered steps — prefer the list under a process-ish heading, else the
  // first ordered list in the document.
  const sections = body.split(/^#{2,3}\s+/m);
  const processSection = sections.find((section) =>
    /^(steps|stages|flow|process|pipeline|chain|escalat|workflow|how it works)/i.test(section),
  );
  const listSource = processSection ?? body;
  const steps = [...listSource.matchAll(/^\s*(?:\d+[.)]|[-*])\s+(.+)$/gm)]
    .map((match) => match[1])
    .filter((step) => STAGE_VERB_RE.test(step) || DECISION_RE.test(step) || step.length > 24);
  if (steps.length >= 3) {
    const flow = chainFromPhrases(steps, title, processSection ? 0.75 : 0.6);
    if (flow) return flow;
  }

  // Arrow chains in prose: "plan → execute → review".
  const arrowLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => (line.match(/->|→/g) || []).length >= 2);
  if (arrowLine) {
    const flow = chainFromPhrases(arrowLine.split(/->|→/), title, 0.6);
    if (flow) return flow;
  }

  // Stage-verb phrase splitting over the description — the escalation-chain
  // shape: "Plan with X, execute with Y, escalate to Z, then W as advisor".
  const prose = description || body.split("\n").find((line) => STAGE_VERB_RE.test(line.trim())) || "";
  const phrases = prose
    .split(/,\s*(?:then\s+)?|;\s*|\.\s+/)
    .filter(
      (phrase) =>
        STAGE_VERB_RE.test(phrase.trim()) ||
        DECISION_RE.test(phrase) ||
        OUTPUT_RE.test(phrase) ||
        MODEL_TEST_RE.test(phrase),
    );
  if (phrases.length >= 2) {
    const flow = chainFromPhrases(phrases, title, 0.45);
    if (flow) return flow;
  }

  return null;
}

const AI_KINDS = new Set<FlowNodeKind>([
  "entry",
  "stage",
  "agent",
  "model",
  "tool",
  "decision",
  "output",
]);

/** Non-deterministic pass — the editor-assist model extracts the graph and
 *  we validate hard: unknown kinds clamp to "stage", dangling edges drop,
 *  node count caps at 14. Throws when the reply holds no usable JSON. */
export async function parseFlowWithAI(markdown: string, title: string | null): Promise<ParsedFlow> {
  const prompt = [
    "Extract the PROCESS described by this workflow document as a small node graph.",
    'Reply with ONLY minified JSON (no code fence, no prose) of the shape:',
    '{"nodes":[{"id":"n1","label":"Plan","kind":"entry|stage|agent|model|tool|decision|output","sub":"optional model or actor"}],"edges":[{"from":"n1","to":"n2","label":"optional condition"}]}',
    "Rules: at most 14 nodes; labels at most 5 words; use kind \"decision\" for branch points; put model names in sub; every edge endpoint must be a node id.",
    "",
    "DOCUMENT:",
    markdown.slice(0, 9000),
  ].join("\n");
  const reply = await invokeNative<{ result: string }>("farm.editor.assist", { prompt, timeoutMs: 45000 });
  const raw = reply.result.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) throw new Error("The assistant returned no JSON graph.");
  const parsed = JSON.parse(raw) as { nodes?: unknown[]; edges?: unknown[] };
  const nodes: FlowNode[] = (Array.isArray(parsed.nodes) ? parsed.nodes : [])
    .slice(0, 14)
    .flatMap((entry) => {
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : null;
      const label = typeof record.label === "string" ? record.label : null;
      if (!id || !label) return [];
      const kind = AI_KINDS.has(record.kind as FlowNodeKind) ? (record.kind as FlowNodeKind) : "stage";
      return [{
        id,
        label: clampLabel(label),
        kind,
        sub: typeof record.sub === "string" ? clampLabel(record.sub, 30) : undefined,
        embeds: findEmbeds(`${label} ${typeof record.sub === "string" ? record.sub : ""}`),
      }];
    });
  const ids = new Set(nodes.map((node) => node.id));
  const edges: FlowEdge[] = (Array.isArray(parsed.edges) ? parsed.edges : []).flatMap((entry) => {
    const record = entry as Record<string, unknown>;
    const from = typeof record.from === "string" ? record.from : null;
    const to = typeof record.to === "string" ? record.to : null;
    if (!from || !to || !ids.has(from) || !ids.has(to)) return [];
    return [{ from, to, label: typeof record.label === "string" ? clampLabel(record.label, 28) : undefined }];
  });
  if (nodes.length < 2) throw new Error("The assistant graph had fewer than two nodes.");
  return { title, nodes, edges, confidence: 0.5, source: "ai" };
}
