// @effect-diagnostics nodeBuiltinImport:off - Reads the graph.json fixture.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";

import { impact, parseGraph, type CodeGraphIndex } from "./CodeGraphIndex.ts";
import { formatImpact, formatNeighbors, formatPath, formatSearch } from "./mcp.ts";

const index = (() => {
  const parsed = parseGraph(
    JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(import.meta.dirname, "__fixtures__/graph.small.json"),
        "utf8",
      ),
    ),
  );
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.index;
})();

const idOf = (graph: CodeGraphIndex, id: string) => graph.byId.get(id)!;

describe("agent tool output", () => {
  it("lists matches with their place and id, and says when nothing matches", () => {
    const text = formatSearch(index, "pngInfo");
    expect(text.split("\n")[1]).toMatch(
      /^ {2}pngInfo\(\) \[symbol\] src\/hostDevices\.ts:\d+ {2}id=src_hostdevices_pnginfo$/,
    );
    expect(formatSearch(index, "zzzz-nothing")).toBe('No symbols or files match "zzzz-nothing".');
  });

  it("groups a symbol's edges into what it uses and what uses it", () => {
    const text = formatNeighbors(index, idOf(index, "src_hostdevices_pnginfo"));
    expect(text).toContain("Used by:");
    expect(text).toMatch(/imports pngInfo\(\)|imports DeviceQaService\.ts/);
  });

  it("traces a path with the direction of each hop", () => {
    const text = formatPath(
      index,
      idOf(index, "src_hostdevices_pnginfo"),
      idOf(index, "src_deviceqaservice"),
    );
    expect(text).toContain("(1 hops)");
    expect(text).toContain("<- imports DeviceQaService.ts src/DeviceQaService.ts");
  });

  it("summarizes impact by file and names files the graph does not know", () => {
    const text = formatImpact(impact(index, ["src/hostDevices.ts", "src/missing.ts"], 1));
    expect(text).toContain("Changed files in the graph: 1");
    expect(text).toContain("Not in the graph: src/missing.ts");
    expect(text).toMatch(/ {2}src\/DeviceQaService\.ts \(\d+ symbols?, 1 hop\)/);
    expect(formatImpact(impact(index, [], 2))).toBe("No changed files.");
  });
});
