export interface WikiGraphSlice {
  nodes: { path: string; title: string }[];
  edges: { source: string; target: string; kind: "wiki" | "md" }[];
}

/** The open document's local neighborhood: the doc itself, every doc it
 *  links to or is linked from (depth 1), and all edges among that set so
 *  cross-links between neighbors still draw. The graph tab answers "what
 *  touches this page", not "map the whole wiki" — the full workspace graph
 *  was unreadable at any real doc count. */
export function localLinkGraph(graph: WikiGraphSlice, activePath: string): WikiGraphSlice {
  const keep = new Set([activePath]);
  for (const edge of graph.edges) {
    if (edge.source === activePath) keep.add(edge.target);
    if (edge.target === activePath) keep.add(edge.source);
  }
  const nodes = graph.nodes.filter((node) => keep.has(node.path));
  // A stale graph may not know the active doc yet — no anchor, no slice.
  if (!nodes.some((node) => node.path === activePath)) return { nodes: [], edges: [] };
  return {
    nodes,
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
  };
}
