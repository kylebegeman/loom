import { expect, it } from "vite-plus/test";
import erc from "./fixtures/erc.json" with { type: "json" };
import drc from "./fixtures/drc.json" with { type: "json" };
import { parseKicadReport } from "./kicadReports.ts";

it("parses the actual KiCad 10.0.6 demo reports and preserves CLI counts", () => {
  const schematic = parseKicadReport(erc, "erc"),
    board = parseKicadReport(drc, "drc");
  expect(schematic.violations).toHaveLength(40);
  expect(board.violations).toHaveLength(68);
  expect(board.violations.every((v) => v.group === "parity")).toBe(true);
  expect(schematic.kicadVersion).toContain("10.0.6");
  expect(schematic.truncated).toBe(false);
  expect(board.truncated).toBe(false);
});
