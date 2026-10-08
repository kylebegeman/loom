import { expect, it } from "vite-plus/test";
import { cropPhysicalSvg, normalizeCircuitSvg } from "./svg.ts";
import { emptyInspection } from "./semantics.ts";
it("crops KiCad layer pages to one shared physical frame", () => {
  const svg = cropPhysicalSvg(
    '<svg width="297mm" height="210mm" viewBox="0 0 297 210"><path/></svg>',
    { x: 100, y: 80, width: 50, height: 30 },
  );
  expect(svg).toContain('viewBox="100 80 50 30"');
  expect(svg).toContain('width="50mm"');
  expect(svg.match(/viewBox=/g)).toHaveLength(1);
});
it("inverts renderer pixels into the physical board and schematic coordinate systems", () => {
  const inspection = {
    ...emptyInspection("test"),
    bounds: { x: -10, y: -10, width: 20, height: 20 },
  };
  const board =
    '<svg width="800" height="600"><path data-type="pcb_board" d="M 100 50 L 700 50 L 700 550 L 100 550 Z"/></svg>';
  expect(normalizeCircuitSvg(board, inspection, "pcb")).toContain(
    "matrix(0.03333333333333333 0 0 0.04 -13.333333333333334 -12)",
  );
  const schematic =
    '<svg width="800" height="600" data-real-to-screen-transform="matrix(20,0,0,-20,400,300)"><path/></svg>';
  expect(normalizeCircuitSvg(schematic, inspection, "schematic")).toContain(
    'viewBox="-20 -15 40 30"',
  );
  expect(() => normalizeCircuitSvg("<svg/>", inspection, "pcb")).toThrow();
});
