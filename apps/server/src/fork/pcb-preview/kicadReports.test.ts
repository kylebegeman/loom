import { checkDelta } from "./kicadReports.ts";
import { expect, it } from "vite-plus/test";
import type { PcbCheckResult } from "@t3tools/contracts/fork";
import {
  parseKicadReport,
  normalizeCheckResult,
  findingId,
  ercSheetId,
  legacyErcScale,
  unitScale,
} from "./kicadReports.ts";
import erc from "./fixtures/erc.json" with { type: "json" };

const stored = (x: number): PcbCheckResult => ({
  ...parseKicadReport(erc, "erc"),
  kind: "erc",
  outcome: "violations",
  sourceHash: "hash",
  log: "",
  ranAt: "2026-10-10T00:00:00.000Z",
  pointsInMm: undefined,
  violations: [
    {
      type: "test",
      description: "test",
      severity: "error",
      excluded: false,
      group: "violation",
      sheet: "/",
      items: [{ description: "Symbol R1 [R]", x, y: x }],
    },
  ],
});
it("maps hierarchical report paths to sanitized drawing ids", () => {
  expect(unitScale("__proto__")).toBeNull();
  expect(ercSheetId("root", "/")).toBe("root.svg");
  expect(ercSheetId("root", "/ampli:ht/sub/")).toBe("root-ampli_ht-sub.svg");
});
it("keeps UUIDs, mm provenance and sheet ids on real reports", () => {
  const report = parseKicadReport(erc, "erc", { rootSheet: "root" });
  expect(report.pointsInMm).toBe(true);
  expect(report.violations.every((v) => v.id && v.sheetId && v.items.every((i) => i.uuid))).toBe(
    true,
  );
  expect(new Set(report.violations.map((v) => v.id)).size).toBe(report.violations.length);
});
it("makes ids independent of UUID order and separates sheets", () => {
  const items = [
    { description: "R1", uuid: "a" },
    { description: "R2", uuid: "b" },
  ];
  const id = findingId("erc", "violation", "rule", "/", items);
  expect(findingId("erc", "violation", "rule", "/", items.toReversed())).toBe(id);
  expect(findingId("erc", "violation", "rule", "/sub/", items)).not.toBe(id);
  expect(
    findingId("drc", "violation", "rule", undefined, [{ description: "R", x: 1.011, y: 2 }]),
  ).toBe(findingId("drc", "violation", "rule", undefined, [{ description: "R", x: 1.012, y: 2 }]));
});
it("upgrades raw legacy reports once and retains normalized positions", () => {
  const upgraded = normalizeCheckResult(stored(0.4), "root");
  expect(upgraded.violations[0]?.items[0]).toMatchObject({ x: 40, y: 40 });
  expect(upgraded.violations[0]).toMatchObject({ sheetId: "root.svg" });
  expect(normalizeCheckResult(upgraded, "root")).toBe(upgraded);
  expect(normalizeCheckResult(stored(40), "root", 1).violations[0]?.items[0]?.x).toBe(40);
});
it("uses schematic evidence to distinguish corrected unflagged ERC from raw ERC", () => {
  const components = [
    {
      id: "r1",
      reference: "R1",
      value: "R",
      footprint: "",
      pins: [],
      schematic: { x: 40, y: 40, sheet: "root.svg" },
    },
  ];
  expect(legacyErcScale(stored(0.4), "root", components)).toBe(100);
  expect(legacyErcScale(stored(40), "root", components)).toBe(1);
  expect(legacyErcScale(stored(8), "root", components)).toBeNull();
  const uncertain = normalizeCheckResult(stored(8), "root", null);
  expect(uncertain.violations[0]?.items[0]).toEqual({ description: "Symbol R1 [R]" });
  expect(uncertain.log).toContain("Run ERC again");
});
it("bounds enriched findings and keeps duplicate identities distinct", () => {
  const violation = {
    type: "rule",
    description: "repeat",
    severity: "error",
    items: [{ description: "R1", uuid: "same", pos: { x: 1, y: 2 } }],
  };
  const result = parseKicadReport(
    { kicad_version: "10.0.7", violations: Array.from({ length: 600 }, () => violation) },
    "drc",
  );
  expect(result.violations).toHaveLength(500);
  expect(result.violations[1]?.id).toBe(`${result.violations[0]?.id}-2`);
  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result.violations))).toBeLessThan(1024 * 1024);
});

it("deltas ignore excluded findings and bound added and resolved details", () => {
  const base = {
    kind: "drc" as const,
    sourceHash: "old",
    outcome: "violations" as const,
    counts: { errors: 1, warnings: 0, excluded: 0 },
    ranAt: "2026-10-11T00:00:00.000Z",
    log: "",
    truncated: true,
  };
  const violations = Array.from({ length: 300 }, (_, i) => ({
    id: `id-${i}`,
    group: "violation" as const,
    type: "clearance",
    description: "d".repeat(250),
    severity: "error" as const,
    excluded: false,
    items: [],
  }));
  const before = { ...base, violations },
    after = {
      ...base,
      sourceHash: "new",
      violations: violations
        .map((v) => ({ ...v, id: `new-${v.id}` }))
        .concat([{ ...violations[0]!, id: "excluded", excluded: true }]),
    };
  const delta = checkDelta(before, after)!;
  expect(delta.newCount).toBe(300);
  expect(delta.resolvedCount).toBe(300);
  expect(delta.added).toHaveLength(200);
  expect(delta.resolved).toHaveLength(50);
  expect(delta.resolved[0]?.description).toHaveLength(200);
  expect(delta.approximate).toBe(true);
  expect(checkDelta(before, { ...after, outcome: "failed" })).toBeUndefined();
});
