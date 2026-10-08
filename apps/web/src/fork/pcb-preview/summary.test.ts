import { expect, it } from "vite-plus/test";
import type { PcbCheckResult, PcbViolation } from "@t3tools/contracts/fork";
import { appendSummary, checkSummary, electronicsDesignUrl } from "./summary";
const violation: PcbViolation = {
  type: "clearance",
  description: "Too close",
  severity: "error",
  excluded: false,
  group: "violation",
  items: [{ description: "R1 pad 1", x: 1, y: 2 }],
};
const design = { name: "Board", id: "hw/board.kicad_pro" };
const result: PcbCheckResult = {
  kind: "drc",
  outcome: "violations",
  sourceHash: "hash",
  counts: { errors: 1, warnings: 0, excluded: 1 },
  violations: [violation, { ...violation, description: "Excluded finding", excluded: true }],
  truncated: false,
  log: "",
  ranAt: "2026-10-07T12:00:00.000Z",
  kicadVersion: "10.0.6",
  coordinateUnits: "mm",
};
it("keeps counts, positions, saved-zone caveat and revision status without excluded findings", () => {
  const summary = checkSummary(design, result, true);
  expect(summary).toContain("1 errors, 0 warnings");
  expect(summary).toContain("R1 pad 1 (1, 2 mm)");
  expect(summary).toContain("Files changed");
  expect(summary).toContain("Zones as saved");
  expect(summary).not.toContain("Excluded finding");
});
it("bounds findings with full omitted totals, and distinguishes clean results from failures", () => {
  expect(
    checkSummary(design, {
      ...result,
      counts: { errors: 501, warnings: 0, excluded: 0 },
      violations: Array.from({ length: 500 }, () => violation),
      truncated: true,
    }),
  ).toContain("and 401 more findings.");
  expect(
    checkSummary(design, {
      ...result,
      outcome: "clean",
      counts: { errors: 0, warnings: 0, excluded: 0 },
      violations: [],
    }),
  ).toContain("No violations.");
  expect(checkSummary(design, { ...result, outcome: "failed", log: "CLI failed" })).toContain(
    "failed to run.\nCLI failed",
  );
});
it("appends to the current draft without erasing text", () => {
  expect(appendSummary("My question", "Report")).toBe("My question\n\nReport");
  expect(appendSummary("   ", "Report")).toBe("Report");
});
it("preserves URL prefixes and encodes host paths", () => {
  expect(electronicsDesignUrl("http://mini:7450", "/hw/board #1.kicad_pro")).toBe(
    electronicsDesignUrl("http://mini:7450/", "/hw/board #1.kicad_pro"),
  );
  const url = new URL(
    electronicsDesignUrl("https://host/electronics/?old=1#anchor", "/hw/board #1.kicad_pro")!,
  );
  expect(url.pathname).toBe("/electronics/designs/by-path");
  expect(url.searchParams.get("path")).toBe("/hw/board #1.kicad_pro");
  expect(url.searchParams.has("old")).toBe(false);
  for (const invalid of [
    "invalid",
    "file:///tmp/app",
    "javascript:alert(1)",
    "http://user:pass@host",
  ])
    expect(electronicsDesignUrl(invalid, "/hw/board")).toBeNull();
});
