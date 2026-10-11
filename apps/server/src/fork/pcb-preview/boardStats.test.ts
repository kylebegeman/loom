import { expect, it } from "vite-plus/test";
import { annularRing, boardStats, outlineArea } from "./boardStats.ts";
import { kicadOutline } from "./outline.ts";
import { inspectBoard, inspectCircuitJson, parseSexp, type Sexp } from "./semantics.ts";
import type { GlbBounds } from "./glb.ts";
const source = `(kicad_pcb
  (general (thickness 1.6)) (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (gr_rect (start 0 0) (end 30 20) (layer "Edge.Cuts"))
  (footprint "MountingHole:M3_Pad" (layer "F.Cu") (at 5 5 90) (property "Reference" "H1")
    (pad "1" thru_hole circle (at 0 0) (size 6 6) (drill 3.2))
    (pad "1" thru_hole circle (at 1 0) (size 1 1) (drill 0.4)))
  (footprint "Connector" (layer "B.Cu") (at 15 10) (property "Reference" "J3") (model "connector.step")
    (pad "1" thru_hole rect (at 0 0) (size 2 3) (drill 1))
    (pad "" np_thru_hole oval (at 3 0) (size 2 4) (drill oval 2 4))
    (fp_rect (start 0 0) (end 2 4) (layer "Edge.Cuts")))
  (via (at 5 10) (size 0.6) (drill 0.3))
  (via blind (at 6 10) (size 0.5) (drill 0.2))
  (via micro (at 7 10) (size 0.4) (drill 0.1))
  (segment (start 0 0) (end 5 5) (width 0.2) (layer "F.Cu"))
  (arc (start 0 0) (mid 2 1) (end 4 0) (width 0.15) (layer "B.Cu"))
  (segment (start 0 0) (end 1 1) (width 0.01) (layer "F.Silkscreen"))
  (zone (min_thickness 0.01)))`;
const run = (board = source, project: string | null = null, glb: GlbBounds | null = null) =>
  boardStats({ kind: "kicad", board, project, glb, inspection: inspectBoard(board, "hash") });
it("measures holes, copper tracks and vias separately from rules", () => {
  const stats = run();
  expect(stats.size).toEqual({ width: 30, height: 20 });
  expect(stats.areaMm2).toBe(592);
  expect(stats.areaSource).toBe("outline");
  expect(stats.copperLayers).toBe(2);
  expect(stats.components).toEqual({ front: 1, back: 1 });
  expect(stats.holes).toEqual({ plated: 3, nonPlated: 1 });
  expect(stats.vias).toEqual({ through: 1, blindOrMicro: 2 });
  expect(stats.measured).toEqual({ drill: 0.1, track: 0.15, annularRing: 0.15, viaDiameter: 0.4 });
  expect(stats.rules).toBeNull();
  expect(stats.heights).toBe("needs-3d");
});
it("adds plated mounting footprints once and preserves component transforms", () => {
  const inspected = inspectBoard(source, "hash");
  expect(inspected.mountingHoles).toEqual([
    { x: 5, y: 5, diameter: 3.2, slotLength: 3.2, plated: true, footprint: "MountingHole:M3_Pad" },
    { x: 18, y: 10, diameter: 2, slotLength: 4, plated: false, footprint: "Connector" },
  ]);
  expect(inspected.components[0]).toMatchObject({ side: "front", rotation: 90 });
  expect(inspected.components[1]).toMatchObject({ side: "back", rotation: 0 });
});
it("falls back to bounds for incomplete outlines and includes footprint Edge.Cuts", () => {
  const open =
    '(kicad_pcb (gr_line (start 0 0) (end 10 20) (layer "Edge.Cuts")) (gr_rect (start 2 2) (end 3 3) (layer "Edge.Cuts")))';
  expect(run(open)).toMatchObject({ areaMm2: 200, areaSource: "bounds" });
  expect(
    inspectBoard(
      '(kicad_pcb (footprint "outline" (at 5 10 90) (fp_rect (start 0 0) (end 2 4) (layer "Edge.Cuts"))))',
      "hash",
    ).bounds,
  ).toEqual({ x: 5, y: 8, width: 4, height: 2 });
});
it("subtracts cutouts while ignoring an external loop", () => {
  const board = parseSexp(
    '(kicad_pcb (gr_rect (start 0 0) (end 10 10) (layer "Edge.Cuts")) (gr_rect (start 1 1) (end 3 3) (layer "Edge.Cuts")) (gr_rect (start 20 20) (end 21 21) (layer "Edge.Cuts")))',
  )[0] as Sexp[];
  expect(outlineArea(kicadOutline(board)!)).toBe(96);
});
it("measures supported annular rings and skips offset/custom/non-plated pads", () => {
  const ring = (definition: string) => annularRing(parseSexp(definition)[0] as Sexp[]);
  expect(ring('(pad "1" thru_hole circle (size 2 2) (drill 1))')).toBe(0.5);
  expect(ring('(pad "1" thru_hole rect (size 3 2) (drill oval 1 1.5))')).toBe(0.5);
  expect(ring('(pad "1" thru_hole circle (size 2 2) (drill 1 (offset 0.1 0)))')).toBeNull();
  expect(ring('(pad "1" thru_hole custom (size 2 2) (drill 1))')).toBeNull();
  expect(ring('(pad "" np_thru_hole circle (size 2 2) (drill 1))')).toBeNull();
});
it("reports board-wide rule provenance and treats zero/missing as unset", () => {
  const project = JSON.stringify({
    board: {
      design_settings: {
        rules: {
          min_clearance: 0.2,
          min_track_width: 0.15,
          min_through_hole_diameter: 0.3,
          min_via_annular_width: 0,
          min_copper_edge_clearance: 0.5,
        },
      },
    },
  });
  expect(run(source, project).rules).toEqual({
    clearance: 0.2,
    track: 0.15,
    drill: 0.3,
    viaDiameter: null,
    annularRing: null,
    holeClearance: null,
    edgeClearance: 0.5,
  });
  expect(run(source, "{}").rules).toBeNull();
});
const circuit = [
  { type: "pcb_board", width: 30, height: 20, num_layers: 4 },
  { type: "source_component", source_component_id: "j", name: "J3" },
  {
    type: "pcb_component",
    pcb_component_id: "p",
    source_component_id: "j",
    layer: "bottom",
    center: { x: 1, y: 2 },
    ccw_rotation: 90,
  },
  { type: "pcb_component", source_component_id: "r", layer: "top" },
  { type: "pcb_plated_hole", hole_diameter: 1, outer_diameter: 2 },
  { type: "pcb_hole", hole_width: 2, hole_height: 4, x: 3, y: 5 },
  { type: "pcb_via", hole_diameter: 0.3, outer_diameter: 0.6 },
  {
    type: "pcb_trace",
    route: [
      { route_type: "wire", width: 0.2 },
      { route_type: "via", hole_diameter: 0.2, outer_diameter: 0.5 },
    ],
  },
  { type: "cad_component", pcb_component_id: "p", size: { z: 11.2 } },
  null,
  { type: "pcb_trace", route: [null, { route_type: "wire", width: "bad" }] },
];
it("computes Circuit JSON variants without an inspection and preserves height provenance", () => {
  const stats = boardStats({ kind: "circuit-json", elements: circuit, glb: null });
  expect(stats).toEqual(
    boardStats({
      kind: "circuit-json",
      elements: circuit,
      inspection: inspectCircuitJson(circuit, "hash"),
      glb: null,
    }),
  );
  expect(stats).toMatchObject({
    areaMm2: 600,
    areaSource: "outline",
    copperLayers: 4,
    components: { front: 1, back: 1 },
    holes: { plated: 1, nonPlated: 1 },
    vias: { through: 2, blindOrMicro: 0 },
    measured: { drill: 0.2, track: 0.2, annularRing: 0.15, viaDiameter: 0.5 },
    tallest: { heightMm: 11.2, side: "back", reference: "J3", source: "circuit-json" },
    heights: "measured",
  });
  expect(inspectCircuitJson(circuit, "hash")).toMatchObject({
    thickness: 1.4,
    layers: ["top", "inner1", "inner2", "bottom"],
    mountingHoles: [{ x: 3, y: -5, diameter: 2, slotLength: 4, plated: false, footprint: "" }],
  });
});
const glb: GlbBounds = {
  meshes: [
    {
      name: "Board",
      nodes: ["Board"],
      materials: ["FR4"],
      min: [-0.015, -0.0008, -0.01],
      max: [0.015, 0.0008, 0.01],
    },
    {
      name: "model",
      nodes: ["Components", "J3"],
      materials: [],
      min: [-0.004, 0.0008, -0.004],
      max: [0.004, 0.012, 0.004],
    },
  ],
};
it("finds tallest front/back models from cached world bounds and ancestor references", () => {
  expect(run(source, null, glb).tallest).toEqual({
    heightMm: 11.2,
    side: "front",
    reference: "J3",
    source: "glb",
  });
  const back = {
    ...glb.meshes[1]!,
    min: [-0.004, -0.02, -0.004] as const,
    max: [0.004, -0.0008, 0.004] as const,
  };
  expect(run(source, null, { meshes: [...glb.meshes, back] }).tallest).toMatchObject({
    side: "back",
    reference: "J3",
  });
  expect(run(source, null, { meshes: [glb.meshes[0]!] })).toMatchObject({
    tallest: null,
    heights: "no-models",
  });
});
it("represents unavailable measurements without fabricated minima", () => {
  expect(run("(kicad_pcb)")).toMatchObject({
    areaMm2: null,
    areaSource: "none",
    measured: { drill: null, track: null, annularRing: null, viaDiameter: null },
    tallest: null,
    heights: "no-models",
  });
});
it("measures a rounded rectangle within the analytic area tolerance", () => {
  const line = (a: string, b: string) => `(gr_line (start ${a}) (end ${b}) (layer "Edge.Cuts"))`;
  const arc = (a: string, mid: string, b: string) =>
    `(gr_arc (start ${a}) (mid ${mid}) (end ${b}) (layer "Edge.Cuts"))`;
  const rounded = `(kicad_pcb ${[
    line("5 0", "25 0"),
    arc("25 0", "28.5355339059 1.4644660941", "30 5"),
    line("30 5", "30 15"),
    arc("30 15", "28.5355339059 18.5355339059", "25 20"),
    line("25 20", "5 20"),
    arc("5 20", "1.4644660941 18.5355339059", "0 15"),
    line("0 15", "0 5"),
    arc("0 5", "1.4644660941 1.4644660941", "5 0"),
  ].join(" ")})`;
  const expected = 600 - (4 - Math.PI) * 25;
  expect(Math.abs(run(rounded).areaMm2! - expected) / expected).toBeLessThan(0.001);
});

it("uses the principal oval drill when a plated mounting footprint also has stitching vias", () => {
  const inspection = inspectBoard(
    '(kicad_pcb (footprint "MountingHole:Slot_Pad" (at 0 0) (pad "1" thru_hole oval (drill oval 2 4)) (pad "1" thru_hole circle (drill 0.4))))',
    "hash",
  );
  expect(inspection.mountingHoles).toMatchObject([{ diameter: 2, slotLength: 4, plated: true }]);
});
it("keeps valid rectangular bounds when an explicit Circuit JSON outline is malformed", () => {
  const stats = boardStats({
    kind: "circuit-json",
    elements: [{ type: "pcb_board", width: 20, height: 10, outline: [{ x: 0, y: NaN }] }],
    glb: null,
  });
  expect(stats).toMatchObject({
    size: { width: 20, height: 10 },
    areaMm2: 200,
    areaSource: "bounds",
  });
});
