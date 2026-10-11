import { expect, it } from "vite-plus/test";
import erc from "./fixtures/erc.json" with { type: "json" };
import drc from "./fixtures/drc.json" with { type: "json" };
import { ercScaleFactor, parseKicadReport, unitScale } from "./kicadReports.ts";

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

it("corrects KiCad 10.0.6 ERC positions to sheet millimetres and leaves DRC alone", () => {
  const schematic = parseKicadReport(erc, "erc"),
    board = parseKicadReport(drc, "drc");
  // The fixture writes P101 at 0.4191, 0.3556; on the A4 sheet it sits at 41.91, 35.56 mm.
  const p101 = schematic.violations
    .flatMap((v) => v.items)
    .find((i) => i.description.startsWith("Symbol P101"));
  expect(p101).toMatchObject({ x: 41.91, y: 35.56 });
  expect(schematic.coordinateUnits).toBe("mm");
  expect(board.violations[0]?.items[0]?.x).toBe(drc.schematic_parity[0]?.items[0]?.pos?.x);
});

it("applies the ERC scale only to affected KiCad releases", () => {
  for (const version of ["8.0.4", "9.0.3", "10.0.0", "10.0.6", "(10.0.6-1)"])
    expect(ercScaleFactor("erc", version)).toBe(100);
  for (const version of ["10.0.7", "10.0.12", "11.0.0", "10.99.0", "unknown", ""])
    expect(ercScaleFactor("erc", version)).toBe(1);
  expect(ercScaleFactor("drc", "10.0.6")).toBe(1);
});

it("converts report units to millimetres and drops positions in unknown units", () => {
  const report = (coordinate_units: string) =>
    parseKicadReport(
      {
        kicad_version: "10.0.7",
        coordinate_units,
        violations: [
          {
            type: "x",
            description: "x",
            severity: "error",
            items: [{ description: "R1", pos: { x: 1, y: 2 } }],
          },
        ],
      },
      "drc",
    );
  expect(report("in").violations[0]?.items[0]).toMatchObject({ x: 25.4, y: 50.8 });
  expect(report("mils").violations[0]?.items[0]).toMatchObject({ x: 0.0254, y: 0.0508 });
  expect(report("furlongs").violations[0]?.items[0]).toEqual({ description: "R1" });
  expect(report("in").coordinateUnits).toBe("mm");
  expect(unitScale(undefined)).toBe(1);
});
