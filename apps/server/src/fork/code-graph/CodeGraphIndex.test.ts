// @effect-diagnostics nodeBuiltinImport:off - Reads the graph.json fixture.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";

import {
  impact,
  MAX_SEARCH_RESULTS,
  neighborhood,
  parseGraph,
  resolveNode,
  search,
  shortestPath,
  summary,
  type CodeGraphIndex,
} from "./CodeGraphIndex.ts";

/** Graphify 0.9.83 `extract --code-only` over Loom's Device QA server folder. */
const fixture = JSON.parse(
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "__fixtures__/graph.small.json"), "utf8"),
);

const load = (json: unknown = fixture): CodeGraphIndex => {
  const parsed = parseGraph(json);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.index;
};

const idOf = (index: CodeGraphIndex, id: string) => {
  const node = index.byId.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
};

describe("parseGraph", () => {
  it("indexes a real Graphify graph and reads its version and commit", () => {
    const index = load();
    expect(index.graphifyVersion).toBe("0.9.83");
    expect(index.builtAtCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(index.nodes).toHaveLength(203);
    expect(index.edgeCount).toBe(456);
  });

  it("infers file, method and symbol kinds and marks imports outside the tree external", () => {
    const index = load();
    expect(index.nodes[idOf(index, "src_hostdevices")]).toMatchObject({
      kind: "file",
      file: "src/hostDevices.ts",
      line: 1,
      external: false,
    });
    expect(index.nodes[idOf(index, "src_deviceqaservice_makewith")]).toMatchObject({
      kind: "symbol",
      label: "makeWith()",
    });
    expect(index.nodes[idOf(index, "ref_node_fs")]).toMatchObject({ external: true, file: "" });

    const withMethod = load({
      nodes: [
        { id: "a", label: "Store", source_file: "a.ts" },
        { id: "b", label: ".save()", source_file: "a.ts" },
      ],
      links: [{ source: "a", target: "b", relation: "method" }],
    });
    expect(withMethod.nodes.map((node) => node.kind)).toEqual(["symbol", "method"]);
  });

  it("names the first field that does not have the shape Loom reads", () => {
    const result = parseGraph({
      graph: { graphify_version: "0.10.2" },
      nodes: [{ id: "a", label: "a", source_file: "a.ts" }],
      links: [{ source: "a", target: "a" }],
    });
    expect(result).toEqual({
      ok: false,
      graphifyVersion: "0.10.2",
      problem: "links[0] has no relation",
    });
    expect(parseGraph([])).toMatchObject({ ok: false, problem: "the file is not a JSON object" });
    expect(parseGraph({ nodes: [] })).toMatchObject({ problem: "it has no links array" });
  });

  it("skips links to nodes the file does not list", () => {
    const index = load({
      nodes: [{ id: "a", label: "a", source_file: "a.ts" }],
      links: [{ source: "a", target: "gone", relation: "calls" }],
    });
    expect(index.edgeCount).toBe(0);
  });
});

describe("search", () => {
  it("ranks an exact name before prefixes and substrings, with or without ()", () => {
    const index = load();
    expect(search(index, "makeWith").nodes[0]).toMatchObject({ label: "makeWith()" });
    expect(search(index, "parseargentline()").nodes[0]).toMatchObject({
      id: "src_argent_parseargentline",
    });
    const labels = search(index, "parse").nodes.map((node) => node.label);
    expect(labels.length).toBeGreaterThan(3);
    expect(labels.every((label) => label.toLowerCase().includes("parse"))).toBe(true);
  });

  it("matches file paths, skips external nodes and caps the results", () => {
    const index = load();
    expect(search(index, "hostDevices.test").nodes.map((node) => node.file)).toContain(
      "src/hostDevices.test.ts",
    );
    expect(search(index, "ref_node").nodes).toEqual([]);
    expect(search(index, "  ").nodes).toEqual([]);
    const many = search(index, "s");
    expect(many.nodes).toHaveLength(MAX_SEARCH_RESULTS);
    expect(many.truncated).toBe(true);
  });
});

describe("resolveNode", () => {
  it("accepts a node id, a file path or a label", () => {
    const index = load();
    const host = idOf(index, "src_hostdevices");
    expect(resolveNode(index, "src_hostdevices")).toBe(host);
    expect(resolveNode(index, "./src/hostDevices.ts")).toBe(host);
    expect(resolveNode(index, "makeWith")).toBe(idOf(index, "src_deviceqaservice_makewith"));
    expect(resolveNode(index, "zzzzzz-nothing")).toBeNull();
  });
});

describe("neighborhood", () => {
  it("returns nodes nearest first and only edges among the returned nodes", () => {
    const index = load();
    const result = neighborhood(index, idOf(index, "src_hostdevices_pnginfo"), 2);
    expect(result.focus.label).toBe("pngInfo()");
    const depths = result.nodes.map((entry) => entry.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(result.nodes.map((entry) => entry.node.label)).toContain("makeWith()");
    const ids = new Set([result.focus.id, ...result.nodes.map((entry) => entry.node.id)]);
    expect(result.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    expect(result.edges).toContainEqual({
      from: "src_deviceqaservice_makewith",
      to: "src_hostdevices_pnginfo",
      relation: "calls",
    });
  });

  it("stops at the node cap and says so", () => {
    const index = load();
    const result = neighborhood(index, idOf(index, "src_deviceqaservice"), 2, 10);
    expect(result.nodes).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });
});

describe("shortestPath", () => {
  it("walks relations in either direction", () => {
    const index = load();
    const path = shortestPath(
      index,
      idOf(index, "src_hostdevices_pnginfo"),
      idOf(index, "src_deviceqaservice"),
    );
    expect(path?.map((step) => step.node.label)).toEqual(["pngInfo()", "DeviceQaService.ts"]);
    expect(path?.[1]?.via).toEqual({ relation: "imports", forward: false });
  });

  it("gives up beyond the hop limit", () => {
    const index = load({
      nodes: ["a", "b", "c"].map((id) => ({ id, label: id, source_file: `${id}.ts` })),
      links: [
        { source: "a", target: "b", relation: "calls" },
        { source: "b", target: "c", relation: "calls" },
      ],
    });
    expect(shortestPath(index, 0, 2, 1)).toBeNull();
    expect(shortestPath(index, 0, 2, 2)).toHaveLength(3);
  });
});

describe("impact", () => {
  it("lists callers and importers in other files, nearest first", () => {
    const index = load();
    const result = impact(index, ["src/hostDevices.ts", "src/missing.ts"], 1);
    expect(result.seedFiles).toEqual(["src/hostDevices.ts"]);
    expect(result.unknownFiles).toEqual(["src/missing.ts"]);
    expect(result.hits.every((hit) => hit.depth === 1)).toBe(true);
    expect(result.hits.every((hit) => hit.node.file !== "src/hostDevices.ts")).toBe(true);
    expect(result.hits).toContainEqual(
      expect.objectContaining({
        node: expect.objectContaining({ label: "makeWith()" }),
        viaRelation: "calls",
      }),
    );
    expect(result.files.map((entry) => entry.file)).toEqual(
      expect.arrayContaining(["src/DeviceQaService.ts", "src/hostDevices.test.ts"]),
    );
    expect(result.communities).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it("reaches further with more depth and ignores relations that do not carry impact", () => {
    const index = load({
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id, source_file: `${id}.ts` })),
      links: [
        { source: "b", target: "a", relation: "calls" },
        { source: "c", target: "b", relation: "imports" },
        { source: "d", target: "a", relation: "contains" },
      ],
    });
    const labels = (depth: 1 | 2) => impact(index, ["a.ts"], depth).hits.map((h) => h.node.label);
    expect(labels(1)).toEqual(["b"]);
    expect(labels(2)).toEqual(["b", "c"]);
    expect(impact(index, ["a.ts"], 2).files).toEqual([
      { file: "b.ts", minDepth: 1, hitCount: 1 },
      { file: "c.ts", minDepth: 2, hitCount: 1 },
    ]);
  });

  it("lists a file reached only through an import without counting it as a symbol", () => {
    const index = load({
      nodes: [
        { id: "a", label: "a()", source_file: "a.ts" },
        { id: "fb", label: "b.ts", source_file: "b.ts" },
        { id: "c", label: "c()", source_file: "c.ts" },
      ],
      links: [
        { source: "fb", target: "a", relation: "imports" },
        { source: "c", target: "fb", relation: "calls" },
      ],
    });
    const result = impact(index, ["a.ts"], 2);
    expect(result.hits.map((hit) => hit.node.label)).toEqual(["c()"]);
    expect(result.files).toEqual([
      { file: "b.ts", minDepth: 1, hitCount: 0 },
      { file: "c.ts", minDepth: 2, hitCount: 1 },
    ]);
  });
});

describe("summary", () => {
  it("counts the graph and lists communities and hubs without external nodes", () => {
    const index = load();
    const result = summary(index);
    expect(result.nodeCount).toBe(177);
    expect(result.fileCount).toBe(19);
    expect(result.edgeCount).toBe(456);
    expect(result.relations[0]).toEqual({ relation: "contains", count: 158 });
    const sizes = result.communities.map((community) => community.size);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(result.hubs[0]?.node.label).toBe("makeWith()");
    expect(result.hubs.every((hub) => hub.node.file !== "" && hub.node.kind !== "file")).toBe(true);
  });
});
