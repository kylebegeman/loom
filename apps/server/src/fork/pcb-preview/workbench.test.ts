import { expect, it } from "vite-plus/test";
import {
  inspectBoard,
  inspectSchematic,
  inspectCircuitJson,
  compareInspections,
  parseSexp,
} from "./semantics.ts";
import { applyCircuitParameters, readCircuitParameterValues } from "./authoring.ts";
import { simulationNetlist, parseSpiceRaw } from "./simulation.ts";
import type { PcbSimulationSetup } from "@t3tools/contracts/fork";
const board =
  '(kicad_pcb (general (thickness 1.6)) (layers (0 "F.Cu" signal)) (footprint "R_0603" (at 10 20 90) (property "Reference" "R1") (property "Value" "1k") (pad "1" smd rect (at 1 0) (net 1 "VCC"))) (gr_rect (start 0 0) (end 30 40) (layer "Edge.Cuts")))';
it("reads physical board geometry and rotated pads", () => {
  const d = inspectBoard(board, "hash");
  expect(d.bounds).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  expect(d.components[0]?.pins[0]?.pcb?.x).toBeCloseTo(10);
  expect(d.components[0]?.pins[0]?.pcb?.y).toBeCloseTo(19);
  expect(d.nets[0]?.name).toBe("VCC");
});
it("reports structural changes using reference identity", () => {
  expect(
    compareInspections(inspectBoard(board, "a"), inspectBoard(board.replace('"1k"', '"2k"'), "b")),
  ).toEqual([{ kind: "changed", reference: "R1", detail: "value" }]);
});
it("rejects malformed S-expressions", () => {
  expect(() => parseSexp("(broken")).toThrow();
  expect(parseSexp('(value "a (b)")')).toEqual([["value", "a (b)"]]);
});
const params = [
  {
    key: "resistance",
    label: "Resistance",
    description: "",
    type: "number" as const,
    default: 1000,
    min: 10,
    max: 10000,
  },
];
it("only changes explicitly declared parameter literals", () => {
  expect(
    applyCircuitParameters(
      "const x = /* loom:param resistance */ 1000; const unchanged = 1000;",
      params,
      { resistance: 2200 },
    ),
  ).toBe("const x = /* loom:param resistance */ 2200; const unchanged = 1000;");
  expect(() => applyCircuitParameters("const x = 1000;", params, { resistance: 2200 })).toThrow();
  expect(() =>
    applyCircuitParameters("const x = /* loom:param resistance */ 1000;", params, {
      resistance: 0,
    }),
  ).toThrow();
});
const setup: PcbSimulationSetup = {
  id: "test",
  name: "Transient",
  analysis: "tran",
  probes: [],
  step: 0.001,
  stop: 0.01,
  startFrequency: 10,
  stopFrequency: 1000,
  points: 100,
  netlistPath: "",
  sweep: null,
};
it("replaces analysis and sweep settings without host file access", () => {
  const result = simulationNetlist(
    "Divider\n.param Rload=1000\nR1 in out {Rload}\n.tran 1 10\n.end",
    { ...setup, sweep: { parameter: "Rload", values: [2200] } },
    2200,
  );
  expect(result).toContain(".param Rload=2200");
  expect(result).toContain("tran 0.001 0.01");
  expect(result).not.toContain(".tran 1 10");
  expect(() => simulationNetlist("Circuit\n.include /etc/passwd", setup)).toThrow();
  expect(() => simulationNetlist("Circuit\n.control\nshell touch bad", setup)).toThrow();
});
it("parses complex probes and rejects invalid samples", () => {
  const raw =
    "Title: test\nFlags: complex\nNo. Variables: 2\nNo. Points: 2\nVariables:\n0 frequency frequency\n1 v(out) voltage\nValues:\n0 10,0 1,-2\n1 20,0 2,-3\n";
  expect(parseSpiceRaw(raw, ["v(out)"])).toEqual({
    label: "",
    x: [10, 20],
    series: [{ name: "v(out)", unit: "voltage", values: [1, 2], imaginary: [-2, -3] }],
  });
  expect(() => parseSpiceRaw(raw.replace("2,-3", "nan,0"), [])).toThrow();
});
it("keeps every operating-point voltage rather than treating the first as a time axis", () => {
  const raw =
    "Title: op\nFlags: real\nNo. Variables: 2\nNo. Points: 1\nVariables:\n0 v(in) voltage\n1 v(out) voltage\nValues:\n0 5 2.5\n";
  expect(parseSpiceRaw(raw, []).series.map((s) => s.name)).toEqual(["v(in)", "v(out)"]);
});

it("replaces exporter analyses without executing their output commands", () => {
  const netlist = simulationNetlist(
    "Circuit\nV1 in 0 5\nR1 in 0 1000\n.control\ntran 1u 1m\nwrite /tmp/export.raw all\nquit\n.endc\n.end",
    setup,
  );
  expect(netlist).not.toContain("/tmp/export.raw");
  expect(netlist).toContain("write results.raw all");
  expect(() => simulationNetlist("Circuit\n.control\nshell touch bad\n.endc", setup)).toThrow();
});

it("includes circle extrema and mounting drill dimensions", () => {
  const d = inspectBoard(
    '(kicad_pcb (gr_circle (center 10 20) (end 13 20) (layer "Edge.Cuts")) (footprint "Hole" (at 5 6) (property "Reference" "H1") (pad "" np_thru_hole circle (at 1 0) (drill 3.2))))',
    "a",
  );
  expect(d.bounds).toEqual({ x: 7, y: 17, width: 6, height: 6 });
  expect(d.mountingHoles).toEqual([{ x: 6, y: 6, diameter: 3.2, slotLength: 3.2 }]);
});
it("includes only arc extrema that lie on the curved edge", () => {
  const d = inspectBoard(
    '(kicad_pcb (gr_arc (start 1 0) (mid 0 1) (end -1 0) (layer "Edge.Cuts")))',
    "a",
  );
  expect(d.bounds?.width).toBeCloseTo(2);
  expect(d.bounds?.height).toBeCloseTo(1);
});

it("joins chained circuit traces and preserves physical pin positions on both drawings", () => {
  const rows = [
    { type: "source_component", source_component_id: "c", name: "R1" },
    ...[1, 2, 3].map((n) => ({
      type: "source_port",
      source_port_id: `p${n}`,
      source_component_id: "c",
      pin_number: n,
    })),
    { type: "source_trace", source_trace_id: "t1", connected_source_port_ids: ["p1", "p2"] },
    {
      type: "source_trace",
      source_trace_id: "t2",
      connected_source_port_ids: ["p2", "p3"],
      connected_source_net_ids: ["n"],
    },
    { type: "source_net", source_net_id: "n", name: "VCC" },
    { type: "pcb_port", source_port_id: "p1", x: 5, y: 8 },
    { type: "schematic_port", source_port_id: "p1", x: 1, y: 2 },
  ];
  const inspected = inspectCircuitJson(rows, "hash");
  expect(inspected.components[0]!.pins.map((p) => p.net)).toEqual(["VCC", "VCC", "VCC"]);
  expect(inspected.components[0]!.pins[0]!.schematic).toEqual({ x: 1, y: -2, sheet: "1.svg" });
  expect(inspected.components[0]!.pins[0]!.pcb).toEqual({ x: 5, y: -8 });
});
it("resolves inherited schematic pins and selects the correct repeated sheet instance", () => {
  const source =
    '(kicad_sch (lib_symbols (symbol "Base" (symbol "Base_1_1" (pin passive line (at 2 3 0) (name "IN") (number "1")))) (symbol "Derived" (extends "Base"))) (symbol (lib_id "Derived") (at 10 20 0) (mirror y) (property "Reference" "R1") (instances (project "Demo" (path "/root/a" (reference "R1")) (path "/root/b" (reference "R2"))))))';
  const symbols = inspectSchematic(source, "Demo-B.svg", "/root/b");
  expect(symbols.map((c) => c.reference)).toEqual(["R2"]);
  expect(symbols[0]!.pins[0]!.schematic).toEqual({ x: 8, y: 17, sheet: "Demo-B.svg" });
});

it("retains copper layer identities and their custom export labels", () => {
  const inspection = inspectBoard(
    '(kicad_pcb (layers (0 "F.Cu" signal) (4 "In1.Cu" power "PWR") (6 "In2.Cu" power "GND") (2 "B.Cu" signal)))',
    "layers",
  );
  expect(inspection).toMatchObject({
    layers: ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"],
    layerLabels: { "In1.Cu": "PWR", "In2.Cu": "GND" },
  });
});

it("reads current marked source values rather than stale schema defaults", () => {
  expect(readCircuitParameterValues("const x = /* loom:param resistance */ 2200;", params)).toEqual(
    { resistance: 2200 },
  );
  expect(
    readCircuitParameterValues("const s = /* loom:param label */ 'Case\\nA';", [
      { key: "label", label: "Label", description: "", type: "string", default: "" },
    ]),
  ).toEqual({ label: "Case\nA" });
  expect(
    readCircuitParameterValues("const x = /* loom:param resistance */ +2.2e3;", params),
  ).toEqual({ resistance: 2200 });
  expect(() => readCircuitParameterValues("const x = 2200;", params)).toThrow();
});

it("finds legacy reference/value text by kind, preserving anonymous mechanical footprints", () => {
  const inspection = inspectBoard(
    '(kicad_pcb (footprint "Resistor" (uuid "a") (fp_text value "1k") (fp_text reference "R1")) (footprint "Logo" (uuid "b")))',
    "hash",
  );
  expect(inspection.components[0]).toMatchObject({ reference: "R1", value: "1k" });
  expect(inspection.components[1]).toMatchObject({ id: "b", reference: "Unreferenced Logo (b)" });
});
it("reads and updates uppercase exponent literals", () => {
  const source = "const resistance = /* loom:param resistance */ 2.2E+3;";
  expect(readCircuitParameterValues(source, params)).toEqual({ resistance: 2200 });
  expect(applyCircuitParameters(source, params, { resistance: 3300 })).toContain("*/ 3300;");
});

it("includes circuit mounting holes and slot dimensions in enclosure metadata", () => {
  const inspection = inspectCircuitJson(
    [
      { type: "pcb_hole", hole_shape: "circle", x: 5, y: 8, hole_diameter: 3.2 },
      {
        type: "pcb_hole",
        hole_shape: "rotated_pill",
        x: 10,
        y: -4,
        hole_width: 2,
        hole_height: 6,
        ccw_rotation: 45,
      },
    ],
    "holes",
  );
  expect(inspection.mountingHoles).toEqual([
    { x: 5, y: -8, diameter: 3.2, slotLength: 3.2 },
    { x: 10, y: 4, diameter: 2, slotLength: 6 },
  ]);
});
