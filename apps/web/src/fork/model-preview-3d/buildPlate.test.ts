import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  BUILD_PLATE_PRESETS,
  BuildPlateSetting,
  DEFAULT_MODEL_PREVIEW_SETTINGS,
} from "@t3tools/contracts/fork";
import { buildPlateOptions, fitsBuildVolume, resolveBuildVolume } from "./buildPlate";
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
it("accepts every listed printer in saved settings and offers custom last", () => {
  const decode = Schema.decodeUnknownSync(BuildPlateSetting);
  const options = buildPlateOptions([100, 200, 300]);
  for (const id of Object.keys(BUILD_PLATE_PRESETS))
    expect(decode({ preset: id, customMm: [100, 200, 300] }).preset).toBe(id);
  expect(options.map((option) => option.id)).toEqual([
    ...Object.keys(BUILD_PLATE_PRESETS),
    "custom",
  ]);
  expect(options.at(-1)?.volumeMm).toEqual([100, 200, 300]);
});
