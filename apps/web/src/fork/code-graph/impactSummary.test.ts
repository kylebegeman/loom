import type { CodeGraphImpactResult } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import { SUMMARY_MAX_LINES, impactSummary } from "./impactSummary";

const result = (files: number, hits: number): CodeGraphImpactResult => ({
  seedFiles: ["src/a.ts"],
  unknownFiles: [],
  hits: Array.from({ length: hits }, (_, i) => ({
    node: {
      id: `n${i}`,
      label: `fn${i}()`,
      kind: "symbol" as const,
      file: `src/f${i}.ts`,
      line: 3,
      community: null,
    },
    depth: 1,
    viaRelation: "calls",
    viaNodeId: "a",
    viaLine: 12,
  })),
  files: Array.from({ length: files }, (_, i) => ({
    file: `src/f${i}.ts`,
    minDepth: i < 2 ? 1 : 2,
    hitCount: 1,
  })),
  communities: 1,
  truncated: false,
  stale: false,
});

describe("impactSummary", () => {
  it("lists affected files nearest first and the most direct symbols", () => {
    const text = impactSummary(result(3, 2), "the working tree", 2);
    expect(text).toBe(
      [
        "Code graph impact of the working tree (1 changed file, up to 2 hops):",
        "Files that can be affected:",
        "- src/f0.ts (1 symbol, 1 hop)",
        "- src/f1.ts (1 symbol, 1 hop)",
        "- src/f2.ts (1 symbol, 2 hops)",
        "",
        "Most direct symbols:",
        "- fn0() in src/f0.ts:12 (calls, 1 hop)",
        "- fn1() in src/f1.ts:12 (calls, 1 hop)",
      ].join("\n"),
    );
  });

  it("stays within the line limit and says how many files it left out", () => {
    const lines = impactSummary(result(200, 50), "turn 3", 3).split("\n");
    expect(lines.length).toBeLessThanOrEqual(SUMMARY_MAX_LINES);
    expect(lines).toContainEqual(expect.stringMatching(/^- and \d+ more files$/));
  });

  it("says when nothing depends on the changes", () => {
    expect(impactSummary(result(0, 0), "the working tree", 2)).toContain(
      "Nothing else depends on them.",
    );
  });
});
