import { it, expect } from "vite-plus/test";
import type { PcbFabFacts, PcbViolation } from "@t3tools/contracts/fork";
import { BUILT_IN_FABS } from "./fabData.ts";
import {
  fabRules,
  rulesFile,
  clearBoardMinimums,
  classifyViolations,
  FAB_RULE_TYPES,
  boardFacts,
  boardFindings,
  costDrivers,
} from "./fabCheck.ts";
const fab = BUILT_IN_FABS[0]!;
const facts: PcbFabFacts = {
  copperLayers: 2,
  sizeMm: { width: 100, height: 100 },
  areaMm2: 10000,
  thicknessMm: 1.6,
  finish: "ENIG",
  castellatedPads: 0,
  viaInPad: 0,
  viaSizes: [],
  smallestPadDrillMm: null,
};
it("appends minimums after user rules and skips unpublished constraints", () => {
  const rules = fabRules(fab);
  expect(rules.text).toContain("(constraint hole_size (min 0.2000mm))");
  expect(rules.text).toContain("(condition \"A.Type == 'Pad'\")");
  expect(fabRules(BUILT_IN_FABS[3]!).notChecked).toEqual(["edge-clearance"]);
  const source = '(version 1)\n(rule "custom" (constraint clearance (min 1mm)))';
  const result = rulesFile(source, fab);
  expect(result.startsWith(source)).toBe(true);
  expect(result.match(/\(version 1\)/g)).toHaveLength(1);
  expect(rulesFile(null, fab)).toContain("(version 1)");
});
it("clears absolute minimums without changing other project settings", () => {
  const source = {
    board: {
      design_settings: { rules: { min_track_width: 1, min_clearance: 1, max_error: 0.005 } },
    },
    other: { keep: true },
  };
  expect(JSON.parse(clearBoardMinimums(JSON.stringify(source))!)).toEqual({
    ...source,
    board: {
      design_settings: { rules: { min_track_width: 0, min_clearance: 0, max_error: 0.005 } },
    },
  });
  expect(clearBoardMinimums("bad")).toBeNull();
});
it("classifies fab keys, excludes libraries and preserves DRC-only counts", () => {
  const v = (type: string): PcbViolation => ({
    type,
    description: "rule min 0.1 mm; actual 0.0800 mm",
    severity: "error",
    excluded: false,
    group: "violation",
    items: [],
  });
  const result = classifyViolations(
    {
      violations: [
        ...Object.keys(FAB_RULE_TYPES).map(v),
        v("unconnected_items"),
        v("lib_footprint_issues"),
      ],
      truncated: false,
    },
    fab,
  );
  expect(result.violations).toHaveLength(Object.keys(FAB_RULE_TYPES).length);
  expect(result.alsoInDrc).toBe(1);
  expect(result.violations[0]?.measuredMm).toBe(0.08);
  expect(result.counts.errors).toBe(Object.keys(FAB_RULE_TYPES).length);
});
it("reads physical facts including rotated pads, holes and via-in-pad", () => {
  const source =
    '(kicad_pcb (general (thickness 1.6)) (layers (0 "F.Cu" signal) (31 "B.Cu" signal)) (setup (stackup (copper_finish "ENIG"))) (gr_rect (start 0 0) (end 20 10) (layer "Edge.Cuts")) (via (at 10 9) (size 0.4) (drill 0.15) (layers "F.Cu" "B.Cu")) (footprint "test" (at 10 10 90) (layer "F.Cu") (property "Reference" "U1") (pad "1" smd rect (at 1 0) (size 2 2) (layers "F.Cu")) (pad "2" thru_hole circle (size 1 1) (drill oval 0.5 0.8) (property pad_prop_castellated))))';
  expect(boardFacts(source)).toMatchObject({
    copperLayers: 2,
    sizeMm: { width: 20, height: 10 },
    thicknessMm: 1.6,
    finish: "ENIG",
    viaInPad: 1,
    castellatedPads: 1,
    smallestPadDrillMm: 0.5,
    viaSizes: [{ drillMm: 0.15, diameterMm: 0.4, count: 1 }],
  });
});
it("checks layer, thickness and finish order options with aliases", () => {
  expect(
    boardFindings(
      { ...facts, copperLayers: 4, thicknessMm: 0.8, finish: "OSP" },
      BUILT_IN_FABS[3]!,
    ).map((f) => f.id),
  ).toEqual(["layers", "thickness", "finish"]);
  expect(boardFindings({ ...facts, finish: "HAL" }, fab)).toEqual([]);
  expect(boardFindings(facts, BUILT_IN_FABS[2]!)).toEqual([]);
});
it.each([
  [0.15, 0.4, true],
  [0.2, 0.4, true],
  [0.2, 0.45, false],
  [0.3, 0.4, false],
])("JLC via boundary %s/%s", (drillMm, diameterMm, expected) => {
  expect(
    costDrivers({ ...facts, viaSizes: [{ drillMm, diameterMm, count: 4 }] }, fab).some(
      (d) => d.id === "small-via",
    ),
  ).toBe(expected);
});
it("cost boundaries use all drills and bounding area with dated pricing", () => {
  expect(costDrivers(facts, fab).some((d) => d.id === "board-size")).toBe(false);
  expect(
    costDrivers({ ...facts, sizeMm: { width: 100.1, height: 20 } }, fab).some(
      (d) => d.id === "board-size",
    ),
  ).toBe(true);
  const way = BUILT_IN_FABS[2]!;
  expect(
    costDrivers({ ...facts, smallestPadDrillMm: 0.19 }, way).some((d) => d.id === "drill-range"),
  ).toBe(true);
  expect(
    costDrivers({ ...facts, smallestPadDrillMm: 1, largestPadDrillMm: 6.1 }, way).some(
      (d) => d.id === "drill-range",
    ),
  ).toBe(true);
  for (const [index, price] of [
    [3, 5],
    [4, 10],
  ] as const)
    expect(
      costDrivers({ ...facts, sizeMm: { width: 25.4, height: 25.4 } }, BUILT_IN_FABS[index]!)[0]
        ?.detail,
    ).toContain(`$${price.toFixed(2)}`);
});
