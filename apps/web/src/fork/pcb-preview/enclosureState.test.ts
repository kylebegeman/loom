import { expect, it } from "vite-plus/test";
import { enclosureAssemblyPath, enclosureState } from "./enclosureState";
it("uses the design directory and detects stale board revisions across capabilities", () => {
  expect(enclosureAssemblyPath("boards/sensor.v1.kicad_pro")).toBe(
    "boards/sensor.loom-assembly.json",
  );
  expect(
    enclosureState(
      ["pcb-enclosure-fit"],
      "../.loom/pcb-references/board-0123456789abcdef.glb",
      "0123456789abcdef-extra",
    ),
  ).toEqual({ enabled: true, assembly: false, python: false, stale: false });
  expect(
    enclosureState(
      ["pcb-enclosure-fit", "model-assemblies", "model-python-cad"],
      "board-0123456789abcdef.glb",
      "ffffffffffffffff",
    ),
  ).toEqual({ enabled: true, assembly: true, python: true, stale: true });
  expect(enclosureState([], "arbitrary.glb", "changed").stale).toBe(false);
});
