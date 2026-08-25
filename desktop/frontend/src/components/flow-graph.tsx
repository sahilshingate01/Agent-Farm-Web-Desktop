import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  BotIcon,
  FlagIcon,
  SparklesIcon,
  SplitIcon,
  WorkflowIcon,
  WrenchIcon,
  ZapIcon,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowNode, FlowNodeKind, ParsedFlow } from "@/lib/flow-parse";

/** Vertical flow map — the scan project's node concept (kind-colored icon
 *  cards, folded model/tool chips, traced edges) rebuilt on this app's
 *  tokens, laid out top-to-bottom so it reads in a side rail. Layout is a
 *  plain longest-path layering: depth = row, siblings share the row. */

const KIND_STYLE: Record<FlowNodeKind, { Icon: ComponentType<LucideProps>; chip: string; stroke: string }> = {
  entry: { Icon: ZapIcon, chip: "bg-primary/12 text-primary", stroke: "var(--primary)" },
  stage: { Icon: WorkflowIcon, chip: "bg-muted text-muted-foreground", stroke: "var(--muted-foreground)" },
  agent: { Icon: BotIcon, chip: "bg-signal/12 text-signal", stroke: "var(--signal)" },
  model: { Icon: SparklesIcon, chip: "bg-primary/12 text-primary", stroke: "var(--primary)" },
  tool: { Icon: WrenchIcon, chip: "bg-muted text-muted-foreground", stroke: "var(--muted-foreground)" },
  decision: { Icon: SplitIcon, chip: "bg-signal/12 text-signal", stroke: "var(--signal)" },
  output: { Icon: FlagIcon, chip: "bg-success/12 text-(--success)", stroke: "var(--success)" },
};

const ROW_GAP = 26;
const NODE_GAP = 8;
const EMBED_ROW_H = 20;

interface Placed extends FlowNode {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

/** Estimated from the label's wrap at the given width — labels get up to
 *  two lines so content stays readable instead of truncating. */
function nodeHeight(node: FlowNode, width: number): number {
  const usable = Math.max(width - 60, 60);
  const lines = Math.max(1, Math.min(2, Math.ceil((node.label.length * 7.2) / usable)));
  const head = 20 + lines * 20 + (node.sub ? 17 : 0);
  const embeds = node.embeds?.length ?? 0;
  return Math.max(54, head) + (embeds ? embeds * EMBED_ROW_H + 8 : 0);
}

/** Longest-path layering with a cycle guard; disconnected nodes append to
 *  the deepest row so nothing vanishes. */
function layerDepths(flow: ParsedFlow): Map<string, number> {
  const depths = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const node of flow.nodes) incoming.set(node.id, 0);
  for (const edge of flow.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const queue = flow.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of queue) depths.set(id, 0);
  let guard = flow.nodes.length * flow.edges.length + flow.nodes.length;
  while (queue.length && guard > 0) {
    guard -= 1;
    const current = queue.shift()!;
    const depth = depths.get(current) ?? 0;
    for (const edge of flow.edges) {
      if (edge.from !== current) continue;
      const next = depth + 1;
      if ((depths.get(edge.to) ?? -1) < next) {
        depths.set(edge.to, next);
        queue.push(edge.to);
      }
    }
  }
  const deepest = Math.max(0, ...depths.values());
  for (const node of flow.nodes) {
    if (!depths.has(node.id)) depths.set(node.id, deepest);
  }
  return depths;
}

export function FlowGraph({ flow, className }: { flow: ParsedFlow; className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [traceRoot, setTraceRoot] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setWidth(rect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!width) return null;
    const depths = layerDepths(flow);
    const rows = new Map<number, FlowNode[]>();
    for (const node of flow.nodes) {
      const depth = depths.get(node.id) ?? 0;
      const row = rows.get(depth) ?? [];
      row.push(node);
      rows.set(depth, row);
    }
    const placed = new Map<string, Placed>();
    let y = 4;
    for (const depth of [...rows.keys()].sort((a, b) => a - b)) {
      const row = rows.get(depth)!;
      const per = Math.min(row.length, 3);
      const nodeWidth = Math.min((width - 8 - NODE_GAP * (per - 1)) / per, 280);
      const rowWidth = nodeWidth * row.length + NODE_GAP * (row.length - 1);
      const start = Math.max(4, (width - rowWidth) / 2);
      let rowHeight = 0;
      row.forEach((node, index) => {
        const height = nodeHeight(node, nodeWidth);
        rowHeight = Math.max(rowHeight, height);
        placed.set(node.id, {
          ...node,
          x: start + index * (nodeWidth + NODE_GAP),
          y,
          width: nodeWidth,
          height,
          depth,
        });
      });
      y += rowHeight + ROW_GAP;
    }
    return { placed, height: y - ROW_GAP + 8 };
  }, [flow, width]);

  const trace = useMemo(() => {
    if (!traceRoot) return null;
    const nodes = new Set([traceRoot]);
    const queue = [traceRoot];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of flow.edges) {
        if (edge.from === current && !nodes.has(edge.to)) {
          nodes.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return nodes;
  }, [flow.edges, traceRoot]);

  const active = (id: string) => !trace || trace.has(id);

  return (
    <div
      ref={hostRef}
      className={cn("relative w-full", className)}
      style={{ height: layout?.height ?? 120 }}
      onClick={() => setTraceRoot(null)}
    >
      {layout && (
        <svg className="pointer-events-none absolute inset-0" width="100%" height={layout.height} aria-hidden>
          {flow.edges.map((edge, index) => {
            const from = layout.placed.get(edge.from);
            const to = layout.placed.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + from.width / 2;
            const y1 = from.y + from.height;
            const x2 = to.x + to.width / 2;
            const y2 = to.y - 5;
            const mid = (y1 + y2) / 2;
            const dim = trace ? !(trace.has(edge.from) && trace.has(edge.to)) : false;
            const stroke = KIND_STYLE[from.kind].stroke;
            return (
              <g key={index} opacity={dim ? 0.2 : 1} className="transition-opacity">
                <path
                  d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity="0.45"
                  strokeWidth="1.5"
                />
                <path
                  d={`M ${x2 - 4} ${y2 - 5} L ${x2} ${y2} L ${x2 + 4} ${y2 - 5}`}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity="0.7"
                  strokeWidth="1.5"
                />
                {edge.label && (
                  <text
                    x={(x1 + x2) / 2}
                    y={mid - 3}
                    textAnchor="middle"
                    className="fill-muted-foreground font-mono"
                    fontSize="9"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {layout &&
        flow.nodes.map((node) => {
          const placed = layout.placed.get(node.id);
          if (!placed) return null;
          const style = KIND_STYLE[node.kind];
          const Icon = style.Icon;
          return (
            <div
              key={node.id}
              className={cn(
                "absolute cursor-pointer overflow-hidden rounded-lg border bg-background px-2.5 py-2 transition-opacity",
                traceRoot === node.id && "border-primary/50 ring-1 ring-primary/25",
                !active(node.id) && "opacity-25",
              )}
              style={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
              title={node.detail || node.label}
              onClick={(event) => {
                event.stopPropagation();
                setTraceRoot((current) => (current === node.id ? null : node.id));
              }}
            >
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", style.chip)}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 type-list leading-snug text-foreground">
                    {node.label}
                  </span>
                  {node.sub && <span className="block truncate type-caption leading-tight">{node.sub}</span>}
                </span>
              </div>
              {node.embeds && node.embeds.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5">
                  {node.embeds.map((embed) => (
                    <span key={embed.label} className="flex items-center gap-1.5 truncate font-mono type-caption">
                      {embed.kind === "model" ? (
                        <SparklesIcon className="size-3 shrink-0 text-primary" />
                      ) : (
                        <WrenchIcon className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      {embed.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
