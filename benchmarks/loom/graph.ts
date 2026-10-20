import * as NodeAssert from "node:assert/strict";

import {
  parseGraph,
  search,
  summary,
  toNode,
  type CodeGraphIndex,
} from "../../apps/server/src/fork/code-graph/CodeGraphIndex.ts";
import { defineBenchmark, fingerprint } from "./harness.ts";

const nodesPerFile = 10;
const relations = ["calls", "imports", "contains", "references"] as const;
const offsets = [1, 17, 113, 997];

function graphFixture(nodeCount: number) {
  const fileCount = nodeCount / nodesPerFile;
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const fileIndex = (Math.floor(index / nodesPerFile) * 7_919) % fileCount;
    const name = `record-${fileIndex.toString().padStart(5, "0")}.ts`;
    return {
      id: `node-${index}`,
      label: index % nodesPerFile === 0 ? name : `loadRecord${index % 997}()`,
      source_file: `src/feature-${fileIndex % 61}/${name}`,
      source_location: `L${(index % nodesPerFile) * 7 + 1}`,
      community: fileIndex % 40,
    };
  });
  const links = nodes.flatMap((node, index) =>
    offsets.map((offset, relation) => ({
      source: node.id,
      target: `node-${(index + offset) % nodeCount}`,
      relation: relations[relation]!,
      source_location: node.source_location,
    })),
  );
  return {
    graph: { graphify_version: "0.9.83" },
    built_at_commit: "0123456789abcdef0123456789abcdef01234567",
    nodes,
    links,
  };
}

function fixtureIndex(graph: ReturnType<typeof graphFixture>): CodeGraphIndex {
  const parsed = parseGraph(graph);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.index;
}

export function makeGraphBenchmarks() {
  const smallGraph = graphFixture(10_000);
  const largeGraph = graphFixture(100_000);
  const small = fixtureIndex(smallGraph);
  const large = fixtureIndex(largeGraph);

  const searchCase = (id: string, index: CodeGraphIndex, query: string, description: string) =>
    defineBenchmark({
      id,
      description,
      workload: { nodes: index.nodes.length, edges: index.edgeCount, query, limit: 50 },
      run: () => search(index, query),
      check: (result) => {
        if (query === "no-such-code-map-symbol") {
          NodeAssert.deepEqual(result, { nodes: [], truncated: false });
        } else {
          NodeAssert.equal(result.nodes.length, 50);
          NodeAssert.equal(result.truncated, true);
          if (query === "loadRecord487()") {
            NodeAssert.ok(result.nodes.every((node) => node.label === query));
          } else {
            NodeAssert.ok(result.nodes.every((node) => /record/i.test(node.label)));
          }
        }
        return fingerprint(result);
      },
    });

  return [
    searchCase(
      "graph.search.broad.10k",
      small,
      "record",
      "Code map search with many matching files and duplicate symbols in a medium graph",
    ),
    searchCase(
      "graph.search.broad.100k",
      large,
      "record",
      "Code map search with many matching files and duplicate symbols in a large graph",
    ),
    searchCase(
      "graph.search.exact.100k",
      large,
      "loadRecord487()",
      "Exact symbol lookup with duplicate names across a large project",
    ),
    searchCase(
      "graph.search.miss.100k",
      large,
      "no-such-code-map-symbol",
      "Code map search that cannot match any symbol or file in a large graph",
    ),
    defineBenchmark({
      id: "graph.parse.100k",
      description: "Validate and index a large Graphify graph before serving Code map queries",
      workload: { nodes: largeGraph.nodes.length, edges: largeGraph.links.length },
      run: () => parseGraph(largeGraph),
      check: (result) => {
        if (!result.ok) throw new Error(result.problem);
        NodeAssert.equal(result.index.nodes.length, 100_000);
        NodeAssert.equal(result.index.edgeCount, 400_000);
        NodeAssert.equal(result.index.byFile.size, 10_000);
        return fingerprint({
          nodes: result.index.nodes.map(toNode),
          outgoing: result.index.out,
          incoming: result.index.in,
        });
      },
    }),
    defineBenchmark({
      id: "graph.summary.cold.100k",
      description: "Compute the Code map overview for an index without a cached summary",
      workload: { nodes: large.nodes.length, edges: large.edgeCount, communities: 40 },
      run: () => summary({ ...large }),
      check: (result) => {
        NodeAssert.equal(result.nodeCount, 100_000);
        NodeAssert.equal(result.edgeCount, 400_000);
        NodeAssert.equal(result.fileCount, 10_000);
        NodeAssert.equal(result.hubs.length, 20);
        NodeAssert.equal(result.communities.length, 30);
        return fingerprint(result);
      },
    }),
    defineBenchmark({
      id: "graph.summary.100k",
      description: "Open the Code map overview repeatedly for one unchanged large graph",
      workload: { nodes: large.nodes.length, edges: large.edgeCount, communities: 40 },
      run: () => summary(large),
      check: (result) => {
        NodeAssert.equal(result.nodeCount, 100_000);
        NodeAssert.equal(result.edgeCount, 400_000);
        NodeAssert.equal(result.fileCount, 10_000);
        NodeAssert.equal(result.hubs.length, 20);
        NodeAssert.equal(result.communities.length, 30);
        NodeAssert.equal(result.relations.length, 4);
        NodeAssert.ok(result.hubs.every((hub) => hub.degree === 6));
        return fingerprint(result);
      },
    }),
  ];
}
