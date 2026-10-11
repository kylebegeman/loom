import { describe, it, expect } from "vite-plus/test";
import { pcbChangeSet, changeCounts } from "./pcb-changes.ts";
import type { PcbInspection, PcbComponent } from "./pcb-workspace.ts";
const part = (reference = "R1"): PcbComponent => ({
  id: reference,
  reference,
  value: "10k",
  footprint: "0603",
  pcb: { x: 1, y: 2 },
  pins: [{ number: "1", name: "A", net: "N", pcb: { x: 2, y: 2 } }],
});
const inspection = (
  components: PcbComponent[],
  nets: PcbInspection["nets"] = [],
): PcbInspection => ({
  sourceHash: "hash",
  components,
  nets,
  layers: [],
  bounds: null,
  thickness: 1.6,
  mountingHoles: [],
  warnings: [],
});
describe("PCB structural changes", () => {
  it("translation is a move without pin noise, reorder and sub-tolerance jitter are ignored", () => {
    const a = part(),
      b = { ...a, pcb: { x: 4, y: 2 }, pins: [{ ...a.pins[0]!, pcb: { x: 5, y: 2 } }] };
    const set = pcbChangeSet(inspection([a]), inspection([b]));
    expect(set.components[0]).toMatchObject({
      kind: "moved",
      fields: ["pcb"],
      pcb: { from: a.pcb, to: b.pcb },
    });
    expect(
      pcbChangeSet(inspection([a]), inspection([{ ...a, pcb: { x: 1.01, y: 2 } }])).components,
    ).toEqual([]);
  });
  it("rotation and relative pin motion differ from changed pin identities and nets", () => {
    const a = part();
    expect(
      pcbChangeSet(
        inspection([a]),
        inspection([{ ...a, pins: [{ ...a.pins[0]!, pcb: { x: 1, y: 3 } }] }]),
      ).components[0]?.fields,
    ).toEqual(["orientation"]);
    expect(
      pcbChangeSet(
        inspection([a]),
        inspection([{ ...a, side: "back", pins: [{ ...a.pins[0]!, name: "B", net: "M" }] }]),
      ).components[0]?.fields,
    ).toEqual(["pcb", "pins", "nets"]);
  });
  it("orders naturally and tracks bounded net memberships", () => {
    const set = pcbChangeSet(
      inspection([part("R5")], [{ name: "OLD", members: [{ reference: "R5", pin: "1" }] }]),
      inspection(
        [part("R10"), part("R2")],
        [
          {
            name: "NEW",
            members: Array.from({ length: 51 }, (_, i) => ({ reference: `R${i}`, pin: "1" })),
          },
        ],
      ),
    );
    expect(set.components.map((c) => c.reference)).toEqual(["R2", "R10", "R5"]);
    expect(set.nets[0]?.joined).toHaveLength(50);
    expect(set.truncated).toBe(true);
    expect(changeCounts(set)).toEqual({ added: 2, removed: 1, moved: 0, changed: 0, nets: 2 });
  });
});
