import { expect, it } from "vite-plus/test";
import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "@t3tools/contracts/fork";
import { fitsBuildVolume, resolveBuildVolume } from "./buildPlate";
it("resolves vendor build volumes and uses custom dimensions only for custom", () => {
  const base = DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate;
  expect(resolveBuildVolume(base)).toEqual([350, 320, 325]);
  expect(resolveBuildVolume({ ...base, preset: "bambu-h2c" })).toEqual([330, 320, 325]);
  expect(resolveBuildVolume({ ...base, preset: "anycubic-kobra-s1" })).toEqual([250, 250, 250]);
  expect(resolveBuildVolume({ ...base, preset: "custom", customMm: [100, 200, 300] })).toEqual([
    100, 200, 300,
  ]);
});
it("accepts exact boundaries and warns if any axis exceeds them", () => {
  expect(fitsBuildVolume([350, 320, 325], [350, 320, 325])).toBe(true);
  for (const size of [
    [351, 320, 325],
    [350, 321, 325],
    [350, 320, 326],
  ])
    expect(fitsBuildVolume(size, [350, 320, 325])).toBe(false);
});
