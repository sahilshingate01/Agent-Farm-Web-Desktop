export interface GraphLabelLayoutNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
}

export interface GraphLabelLayoutLink {
  source: string | { id?: string | number | null };
  target: string | { id?: string | number | null };
}

export interface GraphLabelPlacement {
  nodeId: string;
  text: string;
  /** Measured text width (no chip padding) — kept so we can reproject without remeasure. */
  textWidthPx: number;
  anchor: "bottom" | "top" | "right" | "left";
  priority: number;
  selected: boolean;
  rect: { left: number; top: number; right: number; bottom: number };
  textX: number;
  textY: number;
}

/** Layout decision only — anchor + text. Reproject every frame so labels
 *  track moving nodes without re-running O(n) collision planning. */
export interface GraphLabelSticky {
  nodeId: string;
  text: string;
  textWidthPx: number;
  anchor: GraphLabelPlacement["anchor"];
  priority: number;
  selected: boolean;
}

interface Viewport {
  width: number;
  height: number;
}

interface PositionedNode {
  node: GraphLabelLayoutNode;
  screenX: number;
  screenY: number;
  radiusPx: number;
}

interface Candidate extends PositionedNode {
  text: string;
  textWidthPx: number;
  selected: boolean;
  degree: number;
  distanceToCenterPx: number;
}

const VIEWPORT_PADDING_PX = 8;
/** Label type size. Exported because the canvas that PAINTS these chips must
 *  use the same size the layout MEASURED them at — two literals drifting apart
 *  is how chips end up clipping their own text. Matches `type-caption` (12px
 *  at the default root); 10px read as unlabelled noise at a glance. */
export const LABEL_FONT_SIZE_PX = 12;
const LABEL_GAP_PX = 7;
const LABEL_PADDING_X_PX = 7;
const LABEL_PADDING_Y_PX = 4;
const LABEL_HEIGHT_PX = LABEL_FONT_SIZE_PX + LABEL_PADDING_Y_PX * 2;
const NODE_COLLISION_PADDING_PX = 2;

export function planGraphLabels({
  nodes,
  links,
  selectedId,
  viewport,
  maxLabels,
  maxLabelWidthPx,
  measureTextWidthPx,
  projectToScreen,
  getNodeRadiusPx,
}: {
  nodes: GraphLabelLayoutNode[];
  links: GraphLabelLayoutLink[];
  selectedId: string | null | undefined;
  viewport: Viewport;
  maxLabels: number;
  maxLabelWidthPx: number;
  measureTextWidthPx: (text: string) => number;
  projectToScreen: (x: number, y: number) => { x: number; y: number };
  getNodeRadiusPx: (node: GraphLabelLayoutNode) => number;
}): GraphLabelPlacement[] {
  if (maxLabels <= 0 || viewport.width <= 0 || viewport.height <= 0) return [];

  const degreeById = new Map<string, number>();
  for (const link of links) {
    for (const endpoint of [link.source, link.target]) {
      const id = typeof endpoint === "string" ? endpoint : endpoint.id == null ? null : String(endpoint.id);
      if (id) degreeById.set(id, (degreeById.get(id) ?? 0) + 1);
    }
  }

  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const positioned = nodes.flatMap<PositionedNode>((node) => {
    if (typeof node.x !== "number" || typeof node.y !== "number") return [];
    const screen = projectToScreen(node.x, node.y);
    return [{ node, screenX: screen.x, screenY: screen.y, radiusPx: getNodeRadiusPx(node) }];
  });

  const candidates = positioned.flatMap<Candidate>((positionedNode) => {
    const raw = positionedNode.node.label.trim();
    if (!raw) return [];
    const text = truncateLabel(raw, maxLabelWidthPx, measureTextWidthPx);
    const textWidthPx = measureTextWidthPx(text);
    if (textWidthPx <= 0) return [];
    return [{
      ...positionedNode,
      text,
      textWidthPx,
      selected: positionedNode.node.id === selectedId,
      degree: degreeById.get(positionedNode.node.id) ?? 0,
      distanceToCenterPx: Math.hypot(positionedNode.screenX - centerX, positionedNode.screenY - centerY),
    }];
  });

  candidates.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    if (a.distanceToCenterPx !== b.distanceToCenterPx) return a.distanceToCenterPx - b.distanceToCenterPx;
    if (a.degree !== b.degree) return b.degree - a.degree;
    return a.node.id.localeCompare(b.node.id);
  });

  const placements: GraphLabelPlacement[] = [];
  const acceptedRects: GraphLabelPlacement["rect"][] = [];
  for (let index = 0; index < candidates.length && placements.length < maxLabels; index += 1) {
    const candidate = candidates[index];
    for (const anchor of ["bottom", "top", "right", "left"] as const) {
      const placement = buildPlacement(candidate, anchor, candidates.length - index);
      if (!withinViewport(placement.rect, viewport)) continue;
      if (acceptedRects.some((rect) => intersects(rect, placement.rect))) continue;
      if (positioned.some((other) =>
        other.node.id !== candidate.node.id &&
        intersectsCircle(placement.rect, { x: other.screenX, y: other.screenY, radius: other.radiusPx + NODE_COLLISION_PADDING_PX }),
      )) continue;
      placements.push(placement);
      acceptedRects.push(placement.rect);
      break;
    }
  }
  return placements;
}

function truncateLabel(value: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(value) <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && measure(`${result}…`) > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function buildPlacement(candidate: Candidate, anchor: GraphLabelPlacement["anchor"], priority: number): GraphLabelPlacement {
  const width = candidate.textWidthPx + LABEL_PADDING_X_PX * 2;
  const halfWidth = width / 2;
  const halfHeight = LABEL_HEIGHT_PX / 2;
  let left = candidate.screenX - halfWidth;
  let top = candidate.screenY + candidate.radiusPx + LABEL_GAP_PX;
  if (anchor === "top") top = candidate.screenY - candidate.radiusPx - LABEL_GAP_PX - LABEL_HEIGHT_PX;
  if (anchor === "right") {
    left = candidate.screenX + candidate.radiusPx + LABEL_GAP_PX;
    top = candidate.screenY - halfHeight;
  }
  if (anchor === "left") {
    left = candidate.screenX - candidate.radiusPx - LABEL_GAP_PX - width;
    top = candidate.screenY - halfHeight;
  }
  return {
    nodeId: candidate.node.id,
    text: candidate.text,
    textWidthPx: candidate.textWidthPx,
    anchor,
    priority,
    selected: candidate.selected,
    rect: { left, top, right: left + width, bottom: top + LABEL_HEIGHT_PX },
    textX: left + halfWidth,
    textY: top + LABEL_PADDING_Y_PX,
  };
}

export function stickyFromPlacements(placements: GraphLabelPlacement[]): GraphLabelSticky[] {
  return placements.map((placement) => ({
    nodeId: placement.nodeId,
    text: placement.text,
    textWidthPx: placement.textWidthPx,
    anchor: placement.anchor,
    priority: placement.priority,
    selected: placement.selected,
  }));
}

/** Cheap per-frame follow: keep planned anchors/text, snap chips to current
 *  node screen positions. Collision may briefly overlap until the next plan. */
export function reprojectStickyLabels(
  sticky: GraphLabelSticky[],
  getNodeScreen: (nodeId: string) => { x: number; y: number; radiusPx: number } | null,
): GraphLabelPlacement[] {
  const placements: GraphLabelPlacement[] = [];
  for (const item of sticky) {
    const screen = getNodeScreen(item.nodeId);
    if (!screen) continue;
    const width = item.textWidthPx + LABEL_PADDING_X_PX * 2;
    const halfWidth = width / 2;
    const halfHeight = LABEL_HEIGHT_PX / 2;
    let left = screen.x - halfWidth;
    let top = screen.y + screen.radiusPx + LABEL_GAP_PX;
    if (item.anchor === "top") top = screen.y - screen.radiusPx - LABEL_GAP_PX - LABEL_HEIGHT_PX;
    if (item.anchor === "right") {
      left = screen.x + screen.radiusPx + LABEL_GAP_PX;
      top = screen.y - halfHeight;
    }
    if (item.anchor === "left") {
      left = screen.x - screen.radiusPx - LABEL_GAP_PX - width;
      top = screen.y - halfHeight;
    }
    placements.push({
      nodeId: item.nodeId,
      text: item.text,
      textWidthPx: item.textWidthPx,
      anchor: item.anchor,
      priority: item.priority,
      selected: item.selected,
      rect: { left, top, right: left + width, bottom: top + LABEL_HEIGHT_PX },
      textX: left + halfWidth,
      textY: top + LABEL_PADDING_Y_PX,
    });
  }
  return placements;
}

function withinViewport(rect: GraphLabelPlacement["rect"], viewport: Viewport): boolean {
  return rect.left >= VIEWPORT_PADDING_PX && rect.top >= VIEWPORT_PADDING_PX &&
    rect.right <= viewport.width - VIEWPORT_PADDING_PX && rect.bottom <= viewport.height - VIEWPORT_PADDING_PX;
}

function intersects(a: GraphLabelPlacement["rect"], b: GraphLabelPlacement["rect"]): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

function intersectsCircle(rect: GraphLabelPlacement["rect"], circle: { x: number; y: number; radius: number }): boolean {
  const nearestX = Math.min(rect.right, Math.max(rect.left, circle.x));
  const nearestY = Math.min(rect.bottom, Math.max(rect.top, circle.y));
  return Math.hypot(circle.x - nearestX, circle.y - nearestY) < circle.radius;
}
