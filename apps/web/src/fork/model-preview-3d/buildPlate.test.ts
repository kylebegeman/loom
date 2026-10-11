import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  BUILD_PLATE_PRESETS,
  addCustomBed,
  selectBed,
  BuildPlateSetting,
  DEFAULT_MODEL_PREVIEW_SETTINGS,
} from "@t3tools/contracts/fork";
import {
  bedFit,
  buildPlateLabel,
  bedGroups,
  describeFit,
  fitsBuildVolume,
  resolveBuildVolume,
  resolvePlate,
  fitPlate,
  describeZoneFit,
} from "./buildPlate";
it("resolves vendor build volumes and uses custom dimensions only for custom", () => {
  const base = DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate;
  expect(resolveBuildVolume(base)).toEqual([350, 320, 325]);
  expect(resolveBuildVolume({ ...base, preset: "bambu-h2c" })).toEqual([330, 320, 325]);
  expect(resolveBuildVolume({ ...base, preset: "anycubic-kobra-s1" })).toEqual([250, 250, 250]);
  expect(resolveBuildVolume({ ...base, preset: "sheet-a4" })).toEqual([297, 210, null]);
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
  ] as const)
    expect(fitsBuildVolume(size, [350, 320, 325])).toBe(false);
});
it("tells a part that fits once turned 90° apart from one that does not fit", () => {
  expect(bedFit([340, 300, 100], [350, 320, 325])).toBe("fits");
  expect(bedFit([320, 340, 100], [350, 320, 325])).toBe("rotated");
  expect(bedFit([320, 340, 330], [350, 320, 325])).toBe("too-large");
  expect(bedFit([360, 360, 10], [350, 320, 325])).toBe("too-large");
  expect(bedFit([200, 290, 5000], [297, 210, null])).toBe("rotated");
});
it("checks only the footprint on a surface", () => {
  expect(fitsBuildVolume([297, 210, 5000], [297, 210, null])).toBe(true);
  expect(fitsBuildVolume([298, 210, 1], [297, 210, null])).toBe(false);
});
it("accepts every listed bed in saved settings and groups custom last", () => {
  const decode = Schema.decodeUnknownSync(BuildPlateSetting);
  const groups = bedGroups({
    ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate,
    customMm: [100, 200, 300],
  });
  for (const id of Object.keys(BUILD_PLATE_PRESETS))
    expect(decode({ preset: id, customMm: [100, 200, 300] }).preset).toBe(id);
  expect(groups.flatMap((group) => group.options.map((option) => option.id))).toEqual([
    ...Object.keys(BUILD_PLATE_PRESETS),
    "custom",
  ]);
  expect(groups.at(-1)?.options[0]?.volumeMm).toEqual([100, 200, 300]);
});
it("reads settings saved before beds had a pattern as a 10 mm grid", () => {
  const decode = Schema.decodeUnknownSync(BuildPlateSetting);
  expect(decode({ preset: "bambu-h2d", customMm: [350, 320, 325] }).pattern).toBe("grid-mm");
});

it("describes fits and per-axis overage using the supplied length format", () => {
  const mm = (value: number) => `${value.toFixed(1)} mm`;
  expect(describeFit({ status: "fits" }, mm)).toBe("Fits");
  expect(describeFit({ status: "fits-rotated" }, mm)).toBe("Fits rotated");
  expect(describeFit({ status: "too-big", overMm: [12, 0, 3] }, mm)).toBe(
    "12.0 mm too wide, 3.0 mm too tall",
  );
  expect(
    describeFit({ status: "too-big", overMm: [0, 25.4, 0] }, (value) => `${value / 25.4} in`),
  ).toBe("1 in too deep");
});

it("resolves nozzle zones and keeps fit zone-aware when their tint is off", () => {
  const plate = resolvePlate({ ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate, showZones: false });
  expect(plate.zones).toEqual(BUILD_PLATE_PRESETS["bambu-h2d"].zones);
  expect(plate.showZones).toBe(false);
  expect(fitPlate([200, 200, 323], plate).zone).toEqual({ reach: "one-zone", zoneIds: ["right"] });
  expect(
    resolvePlate({ ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate, preset: "sheet-a4" }).zones,
  ).toEqual([]);
});

it.each([
  { size: [250, 250, 100], short: "Both nozzles", long: "Fits, with either or both nozzles." },
  {
    size: [310, 310, 100],
    short: "Either nozzle, not both",
    long: "Fits, with either nozzle, not both. Printing with both nozzles needs 300 mm × 320 mm × 320 mm.",
  },
  {
    size: [200, 200, 323],
    short: "Right nozzle only",
    long: "Fits the right nozzle only. Printing with both nozzles needs 300 mm × 320 mm × 320 mm.",
  },
  {
    size: [340, 200, 100],
    short: "Same filament in both nozzles",
    long: "Fits only with the same filament in both nozzles.",
  },
  {
    size: [320, 290, 100],
    short: "Both nozzles, rotated",
    long: "Fits rotated, with either or both nozzles.",
  },
] as const)("describes H2D nozzle reach for $size", ({ size, short, long }) => {
  const plate = resolvePlate(DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate);
  expect(describeZoneFit(fitPlate(size, plate), plate.zones, (mm) => `${mm} mm`)).toEqual({
    short,
    long,
  });
});

it("uses the supplied units for zone requirements and omits constraints for failed fits", () => {
  const plate = resolvePlate({ ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate, preset: "bambu-h2c" });
  const result = fitPlate([310, 310, 100], plate);
  expect(describeZoneFit(result, plate.zones, (mm) => `${(mm / 25.4).toFixed(1)} in`)).toEqual({
    short: "Left nozzle only",
    long: "Fits the left nozzle only. Printing with both nozzles needs 11.8 in × 12.6 in × 12.6 in.",
  });
  expect(describeZoneFit(fitPlate([500, 500, 500], plate), plate.zones, String)).toBeNull();
  expect(describeZoneFit(result, [], String)).toBeNull();
});

it("shows named custom beds before the scratch size and hides unused presets", () => {
  const bed = { id: "custom-12345678", name: "Laser", volumeMm: [400, 300, null] as const };
  const named = addCustomBed(DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate, bed);
  expect(buildPlateLabel(named)).toBe("Laser");
  expect(resolvePlate(named)).toMatchObject({ volume: bed.volumeMm, zones: [] });
  expect(buildPlateLabel(selectBed(named, "custom"))).toBe("Custom size");
  const groups = bedGroups({ ...named, hiddenPresets: ["prusa-mini"] });
  expect(
    groups.find((group) => group.label === "Custom")?.options.map((option) => option.label),
  ).toEqual(["Laser", "Custom size"]);
  expect(
    groups.flatMap((group) => group.options).some((option) => option.id === "prusa-mini"),
  ).toBe(false);
});
