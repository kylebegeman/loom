import { it, expect } from "vite-plus/test";
import {
  footprintParts,
  bomFromFootprints,
  genericBom,
  parseKicadBom,
  parseKicadPositions,
  parseRotationsCsv,
  jlcpcbCpl,
  jlcpcbBom,
  inspectGerbers,
  evaluateChecklist,
  circuitAssembly,
  lcscField,
  boardHoleFacts,
  type Position,
} from "./fabOutputs.ts";
import type { PcbCheckResult } from "@t3tools/contracts/fork";
const board = `(kicad_pcb (layers (0 "F.Cu" signal)(31 "B.Cu" signal)) (title_block(rev "A"))
 (footprint "Lib:SOIC-8" (layer "B.Cu") (property "Reference" "U1")(property "Value" "Test, chip")(property "LCSC Part #" "C123")(property "JLCPCB Rotation Offset" "30")(pad "1" thru_hole circle))
 (footprint "Lib:R" (property "Reference" "R10")(property "Value" "10k"))
 (footprint "Lib:R" (property "Reference" "R2")(property "Value" "10k"))
 (footprint "Lib:R" (property "Reference" "R3")(attr dnp))
 (footprint "Lib:Hole" (property "Reference" "H1")(attr exclude_from_bom exclude_from_pos_files)(pad "" np_thru_hole circle)))`;
const position: Position = {
  reference: "U1",
  value: "chip",
  footprint: "Lib:SOIC-8",
  x: 1,
  y: 2,
  rotation: 350,
  side: "bottom",
};
it("reads footprint exclusions, prioritises LCSC fields, groups and quotes assembly BOMs", () => {
  const parts = footprintParts(board),
    bom = bomFromFootprints(parts);
  expect(parts[0]?.side).toBe("bottom");
  expect(bom).toHaveLength(2);
  expect(bom.find((b) => b.value === "10k")?.references).toEqual(["R2", "R10"]);
  expect(parseKicadBom(genericBom(bom))).toEqual(bom);
  expect(jlcpcbBom(bom)).toContain('"Test, chip"');
  expect(lcscField('(kicad_sch(symbol(property "lcsc" "C1")(property "LCSC PART #" "C2")))')).toBe(
    "LCSC Part #",
  );
  expect(boardHoleFacts(board)).toMatchObject({
    plated: true,
    npth: true,
    copperLayers: 2,
    revision: "A",
  });
});
it("position fields override rotation rules and keep KiCad bottom angles", () => {
  const rules = parseRotationsCsv("# comment\nSOIC.*,90\n[,3\nR,no\n(a+)+,30");
  expect(rules.rules).toHaveLength(1);
  expect(rules.warnings).toHaveLength(3);
  const cpl = jlcpcbCpl([position], footprintParts(board), rules.rules);
  expect(cpl.corrected).toBe(1);
  expect(cpl.text).toContain('"Bottom","20.0000"');
  expect(jlcpcbCpl([{ ...position, reference: "other" }], [], rules.rules).text).toContain(
    '"80.0000"',
  );
  expect(
    parseKicadPositions(
      '"Ref","Val","Package","PosX","PosY","Rot","Side"\n"U1","chip","Lib:SOIC-8",1,2,350,"bottom"',
    ),
  ).toEqual([position]);
  expect(() => parseKicadPositions("Ref,PosX\nU1,no")).toThrow();
});
const files = [
  { path: "gerbers/F_Cu.gtl", text: "%TF.FileFunction,Copper,L1,Top*%" },
  { path: "gerbers/B_Cu.gbl", text: "%TF.FileFunction,Copper,L2,Bot*%" },
  { path: "gerbers/Edge_Cuts.gm1", text: "%TF.FileFunction,Profile,NP*%\nX10Y10D01*" },
  { path: "gerbers/PTH.drl", text: "; #@! TF.FileFunction,Plated,1,2,PTH" },
  { path: "gerbers/NPTH.drl", text: "; #@! TF.FileFunction,NonPlated,1,2,NPTH" },
];
const clean: PcbCheckResult = {
  kind: "drc",
  outcome: "clean",
  sourceHash: "one",
  counts: { errors: 0, warnings: 0, excluded: 0 },
  violations: [],
  truncated: false,
  log: "",
  ranAt: "2026-10-10T12:00:00Z",
};
const facts = {
  gerbers: inspectGerbers(files),
  copperLayers: 2,
  plated: true,
  npth: true,
  kind: "kicad" as const,
  drc: clean,
  erc: null,
  fab: null,
  fabChosen: false,
  zones: false,
  refilled: true,
  assembly: true,
  profile: "generic" as const,
  bom: bomFromFootprints(footprintParts(board)),
  positions: [position, { ...position, reference: "R2" }, { ...position, reference: "R10" }],
  corrected: 0,
};
it("inspects X2 layers and separate drill types and evaluates blocking and manual checks", () => {
  expect(facts.gerbers).toMatchObject({ copper: 2, outline: true, pth: true, npth: true });
  expect(evaluateChecklist(facts).verdict).toBe("ready");
  expect(evaluateChecklist({ ...facts, gerbers: inspectGerbers(files.slice(0, 2)) }).verdict).toBe(
    "not-ready",
  );
  expect(
    evaluateChecklist({
      ...facts,
      drc: { ...clean, counts: { errors: 1, warnings: 0, excluded: 0 } },
    }).verdict,
  ).toBe("not-ready");
  expect(evaluateChecklist({ ...facts, profile: "jlcpcb" }).verdict).toBe("needs-review");
  expect(
    evaluateChecklist({
      ...facts,
      erc: { ...clean, kind: "erc", counts: { errors: 1, warnings: 0, excluded: 0 } },
    }).verdict,
  ).toBe("needs-review");
  const ts = evaluateChecklist({ ...facts, kind: "tscircuit", drc: null, assembly: false });
  expect(ts.checklist.find((i) => i.id === "drc")?.status).toBe("skipped");
  expect(ts.verdict).toBe("ready");
  expect(
    evaluateChecklist({ ...facts, positions: [], zones: true, refilled: false }).checklist.find(
      (i) => i.id === "zones",
    )?.status,
  ).toBe("manual");
});
it("circuit assembly joins source and PCB components by identity", () => {
  const result = circuitAssembly([
    { type: "pcb_board", num_layers: 4 },
    {
      type: "source_component",
      source_component_id: "a",
      name: "R1",
      display_value: "10k",
      supplier_part_numbers: { jlcpcb: ["C123"] },
    },
    {
      type: "pcb_component",
      source_component_id: "a",
      center: { x: 1, y: 2 },
      rotation: 90,
      layer: "bottom",
      footprint: "R_0805",
    },
    { type: "pcb_via" },
  ]);
  expect(result.bom[0]).toMatchObject({ references: ["R1"], lcsc: "C123" });
  expect(result.positions[0]).toMatchObject({ x: 1, y: 2, side: "bottom", rotation: 90 });
  expect(result.copperLayers).toBe(4);
  expect(result.plated).toBe(true);
});
