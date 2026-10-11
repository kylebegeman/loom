import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PcbReferenceMetadata, EnclosureStarterParams } from "@t3tools/contracts/fork";
import { boardFeatures } from "./features.ts";
import { planEnclosure } from "./plan.ts";
import { isUnedited, writeScad } from "./scad.ts";
const decodeParams = Schema.decodeUnknownSync(EnclosureStarterParams);

export const boardJson = {
  scenes: [{ nodes: [0, 1, 2, 3] }],
  nodes: [
    { mesh: 0, name: "board" },
    { mesh: 1, name: "U1" },
    { mesh: 2, name: "U2" },
    { mesh: 3, name: "J1" },
  ],
  materials: [{ name: "board" }, { name: "body" }],
  meshes: [0, 1, 2, 3].map((_, i) => ({
    primitives: [{ attributes: { POSITION: i }, material: i ? 1 : 0 }],
  })),
  accessors: [
    { min: [0, -0.0016, -0.04], max: [0.06, 0, 0] },
    { min: [0.009, 0, -0.011], max: [0.011, 0.005, -0.009] },
    { min: [0.029, 0, -0.031], max: [0.031, 0.003, -0.029] },
    { min: [0.057, 0, -0.025], max: [0.063, 0.012, -0.015] },
  ],
};
export const metadata = Schema.decodeUnknownSync(PcbReferenceMetadata)({
  designId: "board.kicad_pro",
  sourceHash: "abcdef",
  units: "mm",
  glbUnits: "metres",
  bounds: { x: 100, y: 200, width: 60, height: 40 },
  thickness: 1.6,
  mountingHoles: [
    {
      x: 105,
      y: 205,
      diameter: 3.2,
      slotLength: 3.2,
      plated: true,
      footprint: "MountingHole_3.2mm",
    },
  ],
  components: [
    { reference: "U1", value: "", footprint: "", position: { x: 110, y: 230 } },
    { reference: "U2", value: "", footprint: "", position: { x: 130, y: 210 } },
    { reference: "J1", value: "", footprint: "USB", position: { x: 160, y: 220 } },
    { reference: "U4", value: "", footprint: "", position: { x: 120, y: 220 } },
  ],
  note: "",
});
const options = { connectors: { include: [], exclude: [] }, edgeMarginMm: 1, assumedHeightMm: 10 };
it("fits the drawing frame, identifies edge connectors and includes missing model heights", () => {
  const f = boardFeatures(boardJson, metadata, options);
  expect(f.frame).toMatchObject({ sx: 1, sy: -1, ox: -100, oy: 240, matched: 3, mirrored: false });
  expect(f.holes[0]).toMatchObject({ x: 5, y: 35, diameter: 3.2 });
  expect(f.connectors[0]).toMatchObject({ reference: "J1", facing: "+x" });
  expect(f.parts.find((p) => p.reference === "U4")?.assumed).toBe(true);
  expect(
    boardFeatures(boardJson, metadata, { ...options, connectors: { include: [], exclude: ["J1"] } })
      .connectors,
  ).toEqual([]);
});
it("plans standoffs and deterministic guarded source without moving the board", () => {
  const f = boardFeatures(boardJson, metadata, options),
    p = planEnclosure(f, decodeParams({}));
  expect(p.params.standoffHeightMm).toBe(3);
  expect(p.standoffs[0]).toMatchObject({ diameter: 6.2, pilot: 2.6 });
  const source = writeScad(p, "board");
  expect(isUnedited(source)).toBe(true);
  expect(isUnedited(source + "// edit\n")).toBe(false);
  expect(writeScad(p, "board")).toBe(source);
  const raised = planEnclosure(f, { ...p.params, standoffHeightMm: 8 });
  expect(raised.boardBottom).toBe(p.boardBottom);
  expect(raised.outerMm[2] - p.outerMm[2]).toBe(5);
  expect(() => planEnclosure(f, { ...p.params, pilotDiameterMm: 10 })).toThrow("Standoff diameter");
});
