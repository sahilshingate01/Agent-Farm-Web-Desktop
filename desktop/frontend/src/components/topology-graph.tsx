import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import {
  LABEL_FONT_SIZE_PX,
  planGraphLabels,
  reprojectStickyLabels,
  stickyFromPlacements,
  type GraphLabelLayoutLink,
  type GraphLabelLayoutNode,
  type GraphLabelSticky,
} from "@/components/graph-label-layout";
import { cssToken } from "@/lib/utils";

export type TopologyNodeKind = "document" | "skill" | "agent" | "account" | "session" | "route" | "memory";

export interface TopologyNode {
  id: string;
  label: string;
  kind: TopologyNodeKind;
  detail?: string;
  /** Explicit fill (e.g. wiki folder hue); falls back to the kind color. */
  color?: string;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
}

/** Categorical graph scale — node kinds and the wiki's folder hues both
 *  index it. The tokens (--chart-1..8, index.css) are the source of truth;
 *  fallbacks only cover a missing DOM. */
const GRAPH_PALETTE_TOKENS: readonly (readonly [token: string, fallback: string])[] = [
  ["--chart-1", "#8eafff"], // azure
  ["--chart-2", "#73d2a5"], // green
  ["--chart-3", "#f1c96b"], // amber
  ["--chart-4", "#c9a7ff"], // purple
  ["--chart-5", "#e58a70"], // terracotta
  ["--chart-6", "#72b8e8"], // sky
  ["--chart-7", "#e8a7c6"], // pink
  ["--chart-8", "#7fd4c1"], // teal
];

const KIND_PALETTE_INDEX: Record<TopologyNodeKind, number> = {
  document: 0,
  skill: 1,
  session: 2,
  account: 3,
  agent: 4,
  route: 5,
  memory: 6,
};

let colorScratch: CanvasRenderingContext2D | null = null;

/** Resolve a CSS color token to plain rgb()/rgba() by painting a 1px canvas
 *  and reading the pixel back — the tokens hold oklch() values that neither
 *  three.js nor canvas hex-alpha concatenation can parse. `alpha` multiplies
 *  onto whatever alpha the token itself carries (dark borders are
 *  white-alpha). */
export function resolveTokenColor(token: string, fallback: string, alpha = 1): string {
  try {
    if (!colorScratch) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      colorScratch = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!colorScratch) return fallback;
    colorScratch.clearRect(0, 0, 1, 1);
    colorScratch.fillStyle = "#000";
    colorScratch.fillStyle = cssToken(token, fallback);
    colorScratch.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorScratch.getImageData(0, 0, 1, 1).data;
    const opacity = Math.round((a / 255) * alpha * 1000) / 1000;
    return opacity >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${opacity})`;
  } catch {
    return fallback;
  }
}

/** The full categorical scale, resolved — the wiki graph hashes folder
 *  names onto this so both graphs speak one palette. Re-read per call so
 *  theme flips take effect. */
export function graphPalette(): string[] {
  return GRAPH_PALETTE_TOKENS.map(([token, fallback]) => resolveTokenColor(token, fallback));
}

/** Node kind → resolved palette color, for canvas fills and the 3D pane. */
export function topologyKindColors(): Record<TopologyNodeKind, string> {
  const palette = graphPalette();
  const colors = {} as Record<TopologyNodeKind, string>;
  for (const kind of Object.keys(KIND_PALETTE_INDEX) as TopologyNodeKind[]) {
    colors[kind] = palette[KIND_PALETTE_INDEX[kind]];
  }
  return colors;
}

type RenderNode = TopologyNode & { x?: number; y?: number };
type RenderLink = TopologyEdge & { source: string | RenderNode; target: string | RenderNode };

/** Orb radii in graph units. Sized so the LABEL is the thing you read and the
 *  orb is the marker — the previous radii were large enough that neighbouring
 *  orbs touched and their chips had nowhere to sit. */
export const NODE_RADIUS: Record<TopologyNodeKind, number> = {
  document: 9,
  skill: 9,
  agent: 12,
  account: 12,
  session: 14,
  route: 13,
  memory: 9,
};

/** Force tuning. Links are now LONGER than the radii they join and repulsion
 *  is stronger, so linked nodes sit apart with room for a label chip between
 *  them instead of bunching into a single blob. */
export const TOPOLOGY_FORCE = {
  /** Ideal edge length in simulation units. */
  linkDistance: 90,
  /** Link spring strength (0–1). Lower = edges pull less hard, so the
   *  repulsion below actually gets to spread the graph out. */
  linkStrength: 0.35,
  /** Coulomb charge — more negative = nodes push further apart. */
  chargeStrength: -240,
  /** Radial pull toward the origin so satellites and loose clusters
   *  condense into one constellation instead of drifting to the edges. */
  gravityStrength: 0.045,
  /** Keep orbs (and their label chips) from overlapping. */
  collidePadding: 16,
  /** Padding around the graph when fitting the camera. */
  fitPadding2d: 48,
} as const;

/** Minimal sim-body shape shared by the 2D and 3D force runtimes. */
interface SimBody {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

/** force-graph registers no collide force by default (d3Force("collide")
 *  returns undefined), so both panes install this one. O(n²) per tick is
 *  fine at our node counts and avoids a direct d3-force dependency. */
export function makeCollideForce<N extends SimBody>(getRadius: (node: N) => number) {
  let nodes: N[] = [];
  const force = () => {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      if (typeof a.x !== "number" || typeof a.y !== "number") continue;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        if (typeof b.x !== "number" || typeof b.y !== "number") continue;
        const minDistance = getRadius(a) + getRadius(b);
        let dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = (b.z ?? 0) - (a.z ?? 0);
        let distance = Math.hypot(dx, dy, dz);
        if (distance >= minDistance) continue;
        if (distance === 0) {
          dx = 1;
          distance = 1;
        }
        const push = ((minDistance - distance) / distance) * 0.5;
        a.vx = (a.vx ?? 0) - dx * push;
        a.vy = (a.vy ?? 0) - dy * push;
        b.vx = (b.vx ?? 0) + dx * push;
        b.vy = (b.vy ?? 0) + dy * push;
        if (typeof a.z === "number" && typeof b.z === "number") {
          a.vz = (a.vz ?? 0) - dz * push;
          b.vz = (b.vz ?? 0) + dz * push;
        }
      }
    }
  };
  force.initialize = (simNodes: N[]) => {
    nodes = simNodes;
  };
  return force;
}

/** Gentle centering pull — forceX/forceY/forceZ equivalent without a
 *  direct d3-force import. */
export function makeGravityForce<N extends SimBody>(strength: number) {
  let nodes: N[] = [];
  const force = (alpha: number) => {
    for (const node of nodes) {
      if (typeof node.x !== "number" || typeof node.y !== "number") continue;
      node.vx = (node.vx ?? 0) - node.x * strength * alpha;
      node.vy = (node.vy ?? 0) - node.y * strength * alpha;
      if (typeof node.z === "number") node.vz = (node.vz ?? 0) - node.z * strength * alpha;
    }
  };
  force.initialize = (simNodes: N[]) => {
    nodes = simNodes;
  };
  return force;
}

interface LabelPaint {
  font: string;
  label: string;
  chip: string;
  chipBorder: string;
  selected: string;
  selectedChip: string;
}

function drawLabelPlacements(
  ctx: CanvasRenderingContext2D,
  placements: ReturnType<typeof planGraphLabels>,
  paint: LabelPaint,
): void {
  ctx.font = paint.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (const placement of placements) {
    const width = placement.rect.right - placement.rect.left;
    const height = placement.rect.bottom - placement.rect.top;
    ctx.fillStyle = placement.selected ? paint.selectedChip : paint.chip;
    ctx.fillRect(placement.rect.left, placement.rect.top, width, height);
    ctx.strokeStyle = placement.selected ? paint.selected : paint.chipBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(placement.rect.left, placement.rect.top, width, height);
    ctx.fillStyle = placement.selected ? paint.selected : paint.label;
    ctx.fillText(placement.text, placement.textX, placement.textY);
  }
}

/** Force-directed relationship canvas for sessions, accounts, skills, and routes. */
export function TopologyGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedId?: string | null;
  onSelect?: (node: TopologyNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Sticky = expensive collision plan; reprojected every frame so chips track
  // moving orbs / camera without waiting for the throttle window.
  const labelCacheRef = useRef<{
    at: number;
    scale: number;
    selectedId: string | null | undefined;
    signature: string;
    sticky: GraphLabelSticky[];
  } | null>(null);
  const forceRef = useRef<ForceGraphMethods<NodeObject<RenderNode>, LinkObject<RenderNode, RenderLink>> | undefined>(undefined);
  const [dimensions, setDimensions] = useState({ width: 640, height: 420 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ChatWorkspace rebuilds these arrays on every render. Keep the force graph's
  // object identity stable until the actual topology changes, otherwise the
  // simulation continually reheats and nodes appear to pile up.
  const nodeSignature = nodes.map((node) => `${node.id}\u0000${node.label}\u0000${node.kind}\u0000${node.detail ?? ""}`).join("\u0001");
  const edgeSignature = edges.map((edge) => `${edge.source}\u0000${edge.target}\u0000${edge.label ?? ""}`).join("\u0001");
  const graphData = useMemo(() => ({
    nodes: nodes.map((node) => ({ ...node })),
    links: edges
      .filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target))
      .map((edge) => ({ ...edge })),
  }), [nodeSignature, edgeSignature]);

  // Degree-scaled sizing: hubs read as hubs instead of a flat constellation.
  const degree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graphData.links) {
      const source = typeof edge.source === "object" ? (edge.source as RenderNode).id : edge.source;
      const target = typeof edge.target === "object" ? (edge.target as RenderNode).id : edge.target;
      counts.set(source as string, (counts.get(source as string) || 0) + 1);
      counts.set(target as string, (counts.get(target as string) || 0) + 1);
    }
    return counts;
  }, [graphData]);
  const radiusOf = (node: NodeObject<RenderNode>) =>
    NODE_RADIUS[node.kind ?? "document"] + Math.min(10, (degree.get(node.id as string) || 0) * 1.6);

  const layoutNodes = graphData.nodes as GraphLabelLayoutNode[];
  const layoutLinks = graphData.links as GraphLabelLayoutLink[];
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  // Every canvas color below resolves a design token (rgb-flattened so the
  // hex-free rule holds even where three.js or alpha math is involved).
  const kindColors = useMemo(() => topologyKindColors(), [isDark]);
  const fillOf = (node: NodeObject<RenderNode>) => node.color || kindColors[node.kind ?? "document"];
  const backgroundColor = resolveTokenColor("--background", isDark ? "#111111" : "#ffffff");
  const foregroundColor = resolveTokenColor("--foreground", isDark ? "#e5e7eb" : "#1f2937");
  const rimColor = resolveTokenColor("--foreground", isDark ? "#e5e7eb" : "#1f2937", 0.42);
  const edgeColor = resolveTokenColor("--muted-foreground", isDark ? "#94a3b8" : "#64748b", isDark ? 0.42 : 0.32);
  const selectedColor = resolveTokenColor("--primary", "#4f7fe8");
  const selectedRingColor = resolveTokenColor("--primary", "#4f7fe8", 0.55);
  const labelPaint: LabelPaint = {
    // Must match what planGraphLabels measured with, or chips clip their text.
    font: `${LABEL_FONT_SIZE_PX}px ${cssToken("--font-ui", "Inter, system-ui, sans-serif")}`,
    label: foregroundColor,
    chip: resolveTokenColor("--card", isDark ? "#14171d" : "#ffffff", 0.9),
    chipBorder: resolveTokenColor("--border", isDark ? "#3a3f47" : "#dfe3e8"),
    selected: selectedColor,
    selectedChip: resolveTokenColor("--primary", "#4f7fe8", 0.13),
  };
  // Spread the layout: apply our own charge/link/collide tuning over
  // d3-force's defaults. Poll briefly — forceRef is null until ForceGraph2D
  // commits.
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      const force = forceRef.current;
      if (!force) return false;
      const charge = force.d3Force("charge") as { strength?: (v: number) => unknown } | undefined;
      charge?.strength?.(TOPOLOGY_FORCE.chargeStrength);
      const link = force.d3Force("link") as {
        distance?: (v: number | ((l: unknown) => number)) => unknown;
        strength?: (v: number) => unknown;
      } | undefined;
      link?.distance?.(TOPOLOGY_FORCE.linkDistance);
      link?.strength?.(TOPOLOGY_FORCE.linkStrength);
      // Collide keeps the big orbs from stacking when charge is soft;
      // gravity reels satellites back toward the constellation.
      force.d3Force(
        "collide",
        makeCollideForce<NodeObject<RenderNode>>((node) => radiusOf(node) + TOPOLOGY_FORCE.collidePadding),
      );
      force.d3Force("gravity", makeGravityForce(TOPOLOGY_FORCE.gravityStrength));
      force.d3ReheatSimulation();
      return true;
    };
    if (apply()) return;
    const poll = window.setInterval(() => {
      if (cancelled || apply()) window.clearInterval(poll);
    }, 40);
    const stop = window.setTimeout(() => window.clearInterval(poll), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [graphData, degree]);

  return (
    <div ref={containerRef} className="relative h-full min-h-[280px] w-full overflow-hidden" role="img" aria-label="Relationship topology">
      <ForceGraph2D
        ref={forceRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor={backgroundColor}
        nodeId="id"
        nodeRelSize={1}
        // force-graph derives pointer/arrow radius as sqrt(val) × relSize,
        // so val must be radius² for hits to match the drawn orb.
        nodeVal={(node: NodeObject<RenderNode>) => radiusOf(node) ** 2}
        nodeLabel={(node: NodeObject<RenderNode>) => node.detail ? `${node.label}\n${node.detail}` : node.label}
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={(node: NodeObject<RenderNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
          if (typeof node.x !== "number" || typeof node.y !== "number") return;
          const radius = radiusOf(node);
          const selected = selectedId === node.id;
          const fill = selected ? selectedColor : fillOf(node);
          // soft halo so nodes sit IN the canvas instead of floating on it
          ctx.save();
          ctx.globalAlpha *= 0.16;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = selected ? foregroundColor : rimColor;
          ctx.lineWidth = (selected ? 2.25 : 1.25) / Math.max(globalScale, 0.01);
          ctx.stroke();
          if (selected) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 3.5 / Math.max(globalScale, 0.01), 0, Math.PI * 2);
            ctx.strokeStyle = selectedRingColor;
            ctx.lineWidth = 1.75 / Math.max(globalScale, 0.01);
            ctx.stroke();
          }
        }}
        linkColor={() => edgeColor}
        linkWidth={1.75}
        linkCurvature={0.12}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        d3VelocityDecay={0.38}
        cooldownTicks={160}
        warmupTicks={50}
        onEngineStop={() => {
          const force = forceRef.current;
          if (force) {
            force.zoomToFit(280, TOPOLOGY_FORCE.fitPadding2d);
          }
        }}
        showPointerCursor={(node) => Boolean(node)}
        onNodeClick={(node: NodeObject<RenderNode>) => {
          const source = nodes.find((candidate) => candidate.id === node.id);
          if (source) onSelect?.(source);
        }}
        onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
          if (globalScale < 0.85 || !forceRef.current) return;
          const pixelRatio = window.devicePixelRatio || 1;
          ctx.save();
          ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          // Collision planning is O(nodes × anchors) — only re-run when the
          // topology/selection/zoom shifts. Every frame we cheaply reproject
          // the sticky anchors onto live node screen positions so labels
          // never lag the orbs during sim ticks or pan/zoom.
          const now = performance.now();
          const cache = labelCacheRef.current;
          const topologyKey = `${nodeSignature}\u0002${edgeSignature}`;
          const scaleDrift = cache
            ? Math.abs(cache.scale - globalScale) / Math.max(globalScale, 0.01)
            : 1;
          const needReplan =
            !cache ||
            cache.signature !== topologyKey ||
            cache.selectedId !== selectedId ||
            scaleDrift > 0.06 ||
            now - cache.at > 180;

          ctx.font = labelPaint.font;
          if (needReplan) {
            const planned = planGraphLabels({
              nodes: layoutNodes,
              links: layoutLinks,
              selectedId,
              viewport: dimensions,
              maxLabels: Math.min(18, Math.max(8, Math.floor(dimensions.width / 55))),
              maxLabelWidthPx: Math.min(180, Math.max(90, dimensions.width * 0.25)),
              measureTextWidthPx: (text) => ctx.measureText(text).width,
              projectToScreen: (x, y) => forceRef.current!.graph2ScreenCoords(x, y),
              // Screen-space radius: graph units × current zoom.
              getNodeRadiusPx: (node) =>
                radiusOf(
                  (graphData.nodes.find((item) => item.id === node.id) ?? {
                    kind: "document",
                  }) as NodeObject<RenderNode>,
                ) * globalScale,
            });
            labelCacheRef.current = {
              at: now,
              scale: globalScale,
              selectedId,
              signature: topologyKey,
              sticky: stickyFromPlacements(planned),
            };
            drawLabelPlacements(ctx, planned, labelPaint);
          } else {
            const nodesById = new Map(
              graphData.nodes.map((node) => [node.id, node as NodeObject<RenderNode>]),
            );
            const projected = reprojectStickyLabels(cache.sticky, (nodeId) => {
              const node = nodesById.get(nodeId);
              if (!node || typeof node.x !== "number" || typeof node.y !== "number") return null;
              const screen = forceRef.current!.graph2ScreenCoords(node.x, node.y);
              return {
                x: screen.x,
                y: screen.y,
                radiusPx: radiusOf(node) * globalScale,
              };
            });
            drawLabelPlacements(ctx, projected, labelPaint);
          }
          ctx.restore();
        }}
      />

      {/* Legend shows only the kinds actually present — a single-kind graph
          (e.g. the wiki's document graph) gets no noise from unused kinds;
          a one-kind legend is self-evident, so it is hidden entirely. */}
      {(() => {
        const presentKinds = [...new Set(nodes.map((node) => node.kind))];
        if (presentKinds.length < 2) return null;
        return (
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md border bg-background/75 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            {presentKinds.map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1">
                <i className="h-1.5 w-1.5 rounded-full" style={{ background: kindColors[kind] }} />
                {kind}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
