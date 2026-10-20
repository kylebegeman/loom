import * as NodeAssert from "node:assert/strict";
import type { PcbComponent } from "../../packages/contracts/src/fork/pcb-workspace.ts";
import { emptyInspection, mergeNetlist } from "../../apps/server/src/fork/pcb-preview/semantics.ts";
import { diffRegions } from "../../apps/web/src/fork/pcb-preview/drawingDiff.ts";
import { defineBenchmark, fingerprint } from "./harness.ts";

function netlistBenchmark(componentCount: number, pinCount: number) {
  const nets = Array.from({ length: 64 }, () => [] as string[]);
  const components = Array.from({ length: componentCount }, (_, i): PcbComponent => {
    const reference = `U${i + 1}`;
    for (let pin = 1; pin <= pinCount; pin++)
      nets[(i * pinCount + pin - 1) % nets.length]!.push(
        `(node (ref "${reference}") (pin "${pin}") (pinfunction "ALT_${pin}") (pintype "bidirectional"))`,
      );
    return {
      id: reference,
      reference,
      value: "MCU",
      footprint: "QFN",
      pcb: { x: i % 50, y: Math.floor(i / 50) },
      pins: Array.from({ length: pinCount }, (_, pin) => pin + 1)
        .filter((pin) => i % 3 !== 0 || pin % 2 === 0)
        .map((pin) => ({
          number: String(pin),
          name: `GPIO${pin}`,
          net: "",
          pcb: { x: (i % 50) + pin / 10, y: Math.floor(i / 50) },
        })),
    };
  });
  const inspection = { ...emptyInspection("performance-fixture"), components };
  const original = JSON.stringify(inspection);
  const netlist = `(export
    (components ${components.map((c) => `(comp (ref "${c.reference}") (libsource (lib "MCU") (part "Test")))`).join(" ")})
    (libparts (libpart (lib "MCU") (part "Test") (pins ${Array.from({ length: pinCount }, (_, pin) => `(pin (num "${pin + 1}") (name "GPIO${pin + 1}"))`).join(" ")})))
    (nets ${nets.map((members, i) => `(net (name "N${i}") ${members.join(" ")})`).join(" ")}))`;
  return defineBenchmark({
    id: `pcb.netlist.${componentCount}`,
    description:
      "Merge KiCad connectivity, library pin names and alternate pin functions into inspected components",
    workload: { components: componentCount, pins: componentCount * pinCount, nets: nets.length },
    run: () => mergeNetlist(inspection, netlist),
    check: (result) => {
      NodeAssert.equal(result.sourceHash, inspection.sourceHash);
      NodeAssert.equal(result.components.length, componentCount);
      NodeAssert.equal(result.nets.length, nets.length);
      NodeAssert.equal(
        result.nets.reduce((sum, net) => sum + net.members.length, 0),
        componentCount * pinCount,
      );
      for (const [i, component] of result.components.entries()) {
        const originalPart = inspection.components[i]!;
        NodeAssert.equal(component.reference, originalPart.reference);
        NodeAssert.equal(component.symbol, "MCU:Test");
        NodeAssert.deepEqual(component.pcb, originalPart.pcb);
        NodeAssert.equal(component.pins.length, pinCount);
        for (const pin of component.pins) {
          const number = Number(pin.number);
          NodeAssert.equal(pin.name, `ALT_${number}`);
          NodeAssert.equal(pin.baseName, `GPIO${number}`);
          NodeAssert.equal(pin.type, "bidirectional");
          NodeAssert.equal(pin.net, `N${(i * pinCount + number - 1) % nets.length}`);
          NodeAssert.deepEqual(
            pin.pcb,
            originalPart.pins.find((p) => p.number === pin.number)?.pcb,
          );
        }
      }
      NodeAssert.equal(JSON.stringify(inspection), original);
      return fingerprint(result);
    },
  });
}

function drawingBenchmark(size: number, mode: "sparse" | "identical" | "dense") {
  const a = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  const b = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  const regions: { x: number; y: number; width: number; height: number }[] = [];
  if (mode === "dense") b.data.fill(255);
  if (mode === "sparse")
    for (let y = 8; y < size - 8; y += 32)
      for (let x = 8; x < size - 8; x += 32) {
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 3; dx++) b.data[((y + dy) * size + x + dx) * 4] = 255;
        regions.push({ x: x - 4, y: y - 4, width: 12, height: 12 });
      }
  const expected = mode === "dense" ? [{ x: 0, y: 0, width: size, height: size }] : regions;
  return defineBenchmark({
    id: `pcb.drawing.${size}.${mode}`,
    description:
      "Detect changed PCB drawing regions, dilate and combine adjacent cells, and bound the output",
    workload: { width: size, height: size, pixels: size * size, mode },
    run: () => diffRegions(a, b),
    check: (result) => {
      NodeAssert.deepEqual(result.regions, expected.slice(0, 50));
      NodeAssert.equal(result.truncated, expected.length > 50);
      return fingerprint(result);
    },
  });
}

export const pcbBenchmarks = [
  netlistBenchmark(100, 8),
  netlistBenchmark(1000, 16),
  drawingBenchmark(256, "sparse"),
  drawingBenchmark(1024, "identical"),
  drawingBenchmark(1024, "dense"),
];
