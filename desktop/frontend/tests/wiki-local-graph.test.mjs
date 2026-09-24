import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Strip types and eval the pure helper module for node:test (no ts-node).
const src = readFileSync(new URL("../src/lib/wiki-local-graph.ts", import.meta.url), "utf8")
  .replace(/\/\*\*[\s\S]*?\*\//g, "")
  .replace(/^export interface[\s\S]*?^}/gm, "")
  .replace(/^export /gm, "")
  .replace(/: WikiGraphSlice/g, "")
  .replace(/: string/g, "");
const { localLinkGraph } = new Function(`${src}; return { localLinkGraph };`)();

const node = (path) => ({ path, title: path.replace(/\.md$/, "") });
const edge = (source, target, kind = "wiki") => ({ source, target, kind });

const graph = {
  nodes: [node("a.md"), node("b.md"), node("c.md"), node("d.md"), node("loner.md")],
  edges: [
    edge("a.md", "b.md"),
    edge("b.md", "c.md"),
    edge("c.md", "d.md"),
    edge("a.md", "c.md", "md"),
  ],
};

test("keeps only the active doc and its direct neighbors", () => {
  const local = localLinkGraph(graph, "b.md");
  assert.deepEqual(
    local.nodes.map((n) => n.path).sort(),
    ["a.md", "b.md", "c.md"],
  );
  // d.md is two hops away; loner.md is unrelated — both gone.
  assert.ok(!local.nodes.some((n) => n.path === "d.md"));
  assert.ok(!local.nodes.some((n) => n.path === "loner.md"));
});

test("includes backlinks, not just outgoing links", () => {
  const local = localLinkGraph(graph, "c.md");
  // b→c and a→c are backlinks; c→d is outgoing. All three neighbors stay.
  assert.deepEqual(
    local.nodes.map((n) => n.path).sort(),
    ["a.md", "b.md", "c.md", "d.md"],
  );
});

test("keeps edges between neighbors so triangles still draw", () => {
  const local = localLinkGraph(graph, "b.md");
  // a→c connects two of b's neighbors and must survive the cut.
  assert.ok(
    local.edges.some((e) => e.source === "a.md" && e.target === "c.md"),
  );
  // c→d leaves the neighborhood and must not.
  assert.ok(
    !local.edges.some((e) => e.source === "c.md" && e.target === "d.md"),
  );
});

test("unlinked doc yields just itself with no edges", () => {
  const local = localLinkGraph(graph, "loner.md");
  assert.deepEqual(local.nodes.map((n) => n.path), ["loner.md"]);
  assert.deepEqual(local.edges, []);
});

test("active path missing from the graph yields an empty slice", () => {
  const local = localLinkGraph(graph, "ghost.md");
  assert.deepEqual(local.nodes, []);
  assert.deepEqual(local.edges, []);
});
