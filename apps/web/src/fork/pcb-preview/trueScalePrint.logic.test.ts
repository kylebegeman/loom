import { describe, expect, it } from "vite-plus/test";
import { initialPrintOptions, isPrintStale } from "./trueScalePrint.logic";
describe("true-scale print options", () => {
  it("mirrors the bottom and limits defaults to existing board layers", () => {
    expect(initialPrintOptions("bottom", ["F.Cu", "B.Cu", "B.Silkscreen", "Edge.Cuts"])).toEqual({
      side: "bottom",
      layers: ["B.Cu", "B.Silkscreen", "Edge.Cuts"],
      mirror: true,
      paper: "board",
      blackAndWhite: true,
    });
    expect(initialPrintOptions("top", ["F.Cu"]).layers).toEqual(["F.Cu", "Edge.Cuts"]);
  });
  it("keeps the generated PDF usable when its revision becomes stale", () => {
    expect(isPrintStale({ sourceHash: "old" }, "new")).toBe(true);
    expect(isPrintStale({ sourceHash: "same" }, "same")).toBe(false);
    expect(isPrintStale({ sourceHash: "old" }, null)).toBe(false);
  });
});
