import type { CodeGraphNeighborhood, CodeGraphNode } from "@t3tools/contracts/fork";

export interface PlacedNode {
  readonly node: CodeGraphNode;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
}

export interface RadialLayout {
  readonly nodes: ReadonlyArray<PlacedNode>;
  readonly edges: ReadonlyArray<{ readonly from: PlacedNode; readonly to: PlacedNode }>;
}

/** Rings as fractions of the half size; the outer ring leaves room for labels. */
const RING = [0, 0.42, 0.82];

/**
 * The focus in the center, its direct neighbors on an inner ring grouped by the relation that
 * links them, and second-hop nodes on an outer ring next to the neighbor they hang from.
 * Deterministic and computed once per neighborhood: no physics, no animation.
 */
export function radialLayout(hood: CodeGraphNeighborhood, size: number): RadialLayout {
  const center = size / 2;
  const depthOf = new Map(hood.nodes.map((entry) => [entry.node.id, entry.depth]));
  depthOf.set(hood.focus.id, 0);
  const relationToFocus = new Map<string, string>();
  const parentOf = new Map<string, string>();
  for (const edge of hood.edges) {
    for (const [near, far] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      if (near === hood.focus.id && depthOf.get(far) === 1 && !relationToFocus.has(far))
        relationToFocus.set(far, edge.relation);
      if (depthOf.get(near) === 1 && depthOf.get(far) === 2 && !parentOf.has(far))
        parentOf.set(far, near);
    }
  }

  const byLabel = (a: CodeGraphNode, b: CodeGraphNode) =>
    a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  const inner = hood.nodes
    .filter((entry) => entry.depth === 1)
    .map((entry) => entry.node)
    .toSorted(
      (a, b) =>
        (relationToFocus.get(a.id) ?? "").localeCompare(relationToFocus.get(b.id) ?? "") ||
        byLabel(a, b),
    );
  const innerIndex = new Map(inner.map((node, index) => [node.id, index]));
  const outer = hood.nodes
    .filter((entry) => entry.depth === 2)
    .map((entry) => entry.node)
    .toSorted(
      (a, b) =>
        (innerIndex.get(parentOf.get(a.id) ?? "") ?? 0) -
          (innerIndex.get(parentOf.get(b.id) ?? "") ?? 0) || byLabel(a, b),
    );

  const ring = (nodes: ReadonlyArray<CodeGraphNode>, depth: number): PlacedNode[] =>
    nodes.map((node, index) => {
      // Start at the top and go clockwise.
      const angle = (index / nodes.length) * 2 * Math.PI - Math.PI / 2;
      const radius = RING[depth]! * center;
      return {
        node,
        depth,
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle),
      };
    });
  const placed = [
    { node: hood.focus, depth: 0, x: center, y: center },
    ...ring(inner, 1),
    ...ring(outer, 2),
  ];
  const at = new Map(placed.map((entry) => [entry.node.id, entry]));
  const edges = hood.edges.flatMap((edge) => {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    return from && to ? [{ from, to }] : [];
  });
  return { nodes: placed, edges };
}
