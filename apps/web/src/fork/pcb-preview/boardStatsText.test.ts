import { expect, it } from "vite-plus/test";
import type { PcbBoardStats } from "@t3tools/contracts/fork";
import { boardStatsText } from "./boardStatsText";
it("keeps a quote summary in millimetres and distinguishes rule values from measured features", () => {
  const stats: PcbBoardStats = {
    size: { width: 50, height: 30 },
    areaMm2: 1400,
    areaSource: "outline",
    copperLayers: 2,
    components: { front: 12, back: 2 },
    holes: { plated: 3, nonPlated: 1 },
    vias: { through: 20, blindOrMicro: 1 },
    measured: { drill: 0.3, track: 0.2, annularRing: null, viaDiameter: 0.6 },
    rules: {
      clearance: 0.2,
      track: 0.15,
      drill: null,
      viaDiameter: null,
      annularRing: null,
      holeClearance: null,
      edgeClearance: null,
    },
    tallest: { heightMm: 11.2, side: "front", reference: "J3", source: "glb" },
    heights: "measured",
  };
  const text = boardStatsText(stats);
  expect(text).toContain("Size: 50 × 30 mm");
  expect(text).toContain("Area: 1400.00 mm² (outline)");
  expect(text).toContain("Smallest track: 0.2 mm (measured); 0.15 mm rule");
  expect(text).toContain("Clearance: 0.2 mm rule; run DRC to measure");
  expect(text).toContain("Tallest part: 11.2 mm, J3, front (3D board)");
  expect(boardStatsText({ ...stats, tallest: null, heights: "needs-3d" })).toContain(
    "Build the 3D board to measure heights",
  );
});
