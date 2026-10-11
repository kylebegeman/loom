import { expect, it } from "vite-plus/test";
import type { PcbReviewResult, PcbCheckResult, PcbFinding } from "@t3tools/contracts/fork";
import {
  checkFindings,
  reviewFindings,
  orderFindings,
  stepFinding,
  hitFinding,
  markerSize,
  snapshotFinding,
} from "./findings";
const finding = (
  id: string,
  severity: PcbFinding["severity"] = "error",
  sheet = "root.svg",
  x = 1,
  y = 1,
): PcbFinding => ({ id, source: "erc", severity, message: id, sheet, pointMm: { x, y } });
const report: PcbCheckResult = {
  kind: "drc",
  outcome: "violations",
  sourceHash: "hash",
  ranAt: "2026-10-11T00:00:00Z",
  log: "",
  truncated: false,
  counts: { errors: 1, warnings: 0, excluded: 1 },
  violations: [
    {
      id: "drc-first",
      type: "x",
      description: "located",
      severity: "error",
      excluded: false,
      group: "violation",
      items: [
        { description: "missing" },
        { description: "first", x: 1, y: 2 },
        { description: "second", x: 3, y: 4 },
      ],
    },
    {
      type: "x",
      description: "excluded",
      severity: "warning",
      excluded: true,
      group: "violation",
      items: [{ description: "p", x: 1, y: 1 }],
    },
    {
      type: "x",
      description: "unlocated",
      severity: "warning",
      excluded: false,
      group: "parity",
      items: [],
    },
  ],
};
it("makes one marker per located violation with other item points and shared exclusions", () => {
  const values = checkFindings(report, "drc", { showExcluded: false });
  expect(values).toHaveLength(1);
  expect(values[0]).toMatchObject({
    id: "drc-first",
    pointMm: { x: 1, y: 2 },
    otherPoints: [{ x: 3, y: 4 }],
  });
  const excluded = checkFindings(report, "drc", { showExcluded: true });
  expect(excluded[1]).toMatchObject({ id: "drc-1", excluded: true });
  expect(checkFindings({ ...report, outcome: "failed" }, "drc", { showExcluded: true })).toEqual(
    [],
  );
  expect(snapshotFinding(values[0]!)).not.toHaveProperty("excluded");
});
it("orders severity before sheet and rounded rows, then x and identity", () => {
  const values = [
    finding("warning", "warning"),
    finding("sub", "error", "sub.svg", 0, 0),
    finding("right", "error", "root.svg", 2, 1.001),
    finding("left", "error", "root.svg", 1, 1.002),
    finding("info", "info"),
  ];
  expect(orderFindings(values, ["root.svg", "sub.svg"]).map((f) => f.id)).toEqual([
    "left",
    "right",
    "sub",
    "warning",
    "info",
  ]);
});
it("steps both directions and wraps, including no active or removed finding", () => {
  const values = [finding("a"), finding("b")];
  expect(stepFinding(values, null, 1)?.finding.id).toBe("a");
  expect(stepFinding(values, "gone", -1)?.finding.id).toBe("b");
  expect(stepFinding(values, "b", 1)).toMatchObject({
    finding: { id: "a" },
    wrapped: true,
    index: 0,
  });
  expect(stepFinding(values, "a", -1)).toMatchObject({
    finding: { id: "b" },
    wrapped: true,
    index: 1,
  });
  expect(stepFinding([], null, 1)).toBeNull();
});
it("hits the nearest pin within eight screen pixels and scales sizes consistently", () => {
  const values = [finding("a", "error", undefined, 0, 0), finding("b", "error", undefined, 2, 0)];
  expect(hitFinding(values, { x: 1.7, y: 0 }, 0.1)?.id).toBe("b");
  expect(hitFinding(values, { x: 3, y: 0 }, 0.1)).toBeNull();
  expect(hitFinding(values, { x: 0, y: 0 }, 0)).toBeNull();
  for (const scale of [0.01, 0.1, 1, 10]) expect(markerSize(scale).radius / scale).toBe(5);
});

it("review markers use each surface's anchor and ignored state", () => {
  const result: PcbReviewResult = {
    designKind: "kicad",
    outcome: "findings",
    sourceHash: "one",
    configHash: "one",
    rulesVersion: 1,
    counts: { errors: 0, warnings: 1, info: 0, waived: 0 },
    rules: [],
    notices: [],
    truncated: false,
    durationMs: 1,
    ranAt: "2026-10-11T12:00:00Z",
    log: "",
    findings: [
      {
        id: "r",
        rule: "decoupling",
        severity: "warning",
        message: "Missing",
        why: "Why",
        fix: "Fix",
        parts: ["U1"],
        nets: ["VDD"],
        waived: false,
        schematic: { x: 1, y: 2, sheet: "main.svg" },
        board: { x: 10, y: 20 },
      },
    ],
  };
  expect(reviewFindings(result, "schematic", { showExcluded: false })[0]).toMatchObject({
    source: "review",
    pointMm: { x: 1, y: 2 },
    sheet: "main.svg",
  });
  expect(reviewFindings(result, "pcb", { showExcluded: false })[0]?.pointMm).toEqual({
    x: 10,
    y: 20,
  });
  const ignored = { ...result, findings: result.findings.map((f) => ({ ...f, waived: true })) };
  expect(reviewFindings(ignored, "pcb", { showExcluded: false })).toEqual([]);
  expect(reviewFindings(ignored, "pcb", { showExcluded: true })[0]?.excluded).toBe(true);
});
