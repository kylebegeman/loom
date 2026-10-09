import type { CodeGraphNeighborhood, CodeGraphNode } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import { radialLayout } from "./radialLayout";

const node = (id: string): CodeGraphNode => ({
  id,
  label: id,
  kind: "symbol",
  file: `${id}.ts`,
  line: 1,
  community: null,
});

const hood: CodeGraphNeighborhood = {
  focus: node("focus"),
  nodes: [
    { node: node("b"), depth: 1 },
    { node: node("a"), depth: 1 },
    { node: node("c"), depth: 1 },
    { node: node("b2"), depth: 2 },
  ],
  edges: [
    { from: "focus", to: "a", relation: "imports" },
    { from: "b", to: "focus", relation: "calls" },
    { from: "focus", to: "c", relation: "calls" },
    { from: "b", to: "b2", relation: "calls" },
  ],
  truncated: false,
};

describe("radialLayout", () => {
  it("centers the focus and groups direct neighbors by relation on the inner ring", () => {
    const layout = radialLayout(hood, 200);
    const at = new Map(layout.nodes.map((entry) => [entry.node.id, entry]));
    expect(at.get("focus")).toMatchObject({ x: 100, y: 100, depth: 0 });
    // "calls" sorts before "imports"; the first neighbor sits at the top.
    expect(layout.nodes.slice(1, 4).map((entry) => entry.node.id)).toEqual(["b", "c", "a"]);
    expect(at.get("b")!.x).toBeCloseTo(100);
    expect(at.get("b")!.y).toBeCloseTo(100 - 42);
  });

  it("puts second hops on the outer ring and draws every edge between placed nodes", () => {
    const layout = radialLayout(hood, 200);
    const outer = layout.nodes.find((entry) => entry.node.id === "b2")!;
    expect(Math.hypot(outer.x - 100, outer.y - 100)).toBeCloseTo(82);
    expect(layout.edges).toHaveLength(4);
    expect(radialLayout(hood, 200)).toEqual(layout);
  });
});
