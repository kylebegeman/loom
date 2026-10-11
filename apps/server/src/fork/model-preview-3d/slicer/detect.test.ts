import { expect, it } from "vite-plus/test";
import { slicerCandidates, slicerVersion } from "./detect.ts";
it("reads installed CLI versions after initialization messages and bounds platform discovery", () => {
  expect(
    slicerVersion(
      "[trace] Initializing StaticPrintConfigs\nBambuStudio-02.08.04.57:\nUsage: bambu-studio",
    ),
  ).toBe("02.08.04.57");
  expect(slicerVersion("PrusaSlicer 2.9.1 based on Slic3r")).toBe("2.9.1");
  expect(slicerVersion("No executable")).toBeNull();
  expect(slicerCandidates("bambu-studio", "/home/kyle", "darwin")).toContain(
    "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
  );
  expect(slicerCandidates("prusa-slicer", "/home/kyle", "linux")).toEqual(["prusa-slicer"]);
});
