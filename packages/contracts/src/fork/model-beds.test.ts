import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  activeBed,
  bedFitSummary,
  BedFitSummary,
  BUILD_PLATE_PRESETS,
  BuildPlateSetting,
  fitOnBed,
  listBeds,
  selectBed,
} from "./model-beds.ts";

const decodeBedFitSummary = Schema.decodeUnknownSync(BedFitSummary);

const setting: BuildPlateSetting = {
  preset: "bambu-h2d",
  customMm: [100, 200, 300],
  pattern: "grid-inch",
};

it("fits exact boundaries and accepts the existing numerical tolerance", () => {
  expect(fitOnBed([350, 320, 325], [350, 320, 325])).toEqual({ status: "fits" });
  expect(fitOnBed([350 + 0.5e-6, 320, 325], [350, 320, 325])).toEqual({ status: "fits" });
  expect(fitOnBed([300, 300, 100], [350, 320, 325])).toEqual({ status: "fits" });
  expect(fitOnBed([0, 0, 0], [350, 320, 325])).toEqual({ status: "fits" });
});

it.each([
  { size: [351, 320, 325], overMm: [1, 0, 0] },
  { size: [350, 321, 325], overMm: [0, 1, 0] },
  { size: [350, 320, 326], overMm: [0, 0, 1] },
] as const)("reports each oversized axis as placed: $size", ({ size, overMm }) => {
  expect(fitOnBed(size, [350, 320, 325])).toEqual({ status: "too-big", overMm });
});

it("checks quarter-turn fit only when the height fits", () => {
  expect(fitOnBed([300, 340, 100], [350, 320, 325])).toEqual({ status: "fits-rotated" });
  expect(fitOnBed([300, 340, 330], [350, 320, 325])).toEqual({
    status: "too-big",
    overMm: [0, 20, 5],
  });
});

it("checks only the footprint for unlimited-height surfaces", () => {
  expect(fitOnBed([297, 210, 5000], [297, 210, null])).toEqual({ status: "fits" });
  expect(fitOnBed([210, 297, 5000], [297, 210, null])).toEqual({ status: "fits-rotated" });
  expect(fitOnBed([300, 220, 5000], [297, 210, null])).toEqual({
    status: "too-big",
    overMm: [3, 10, 0],
  });
});

it.each([
  [Number.NaN, 100, 100],
  [100, Number.POSITIVE_INFINITY, 100],
  [100, 100, Number.NEGATIVE_INFINITY],
  [-1, 100, 100],
] as const)("rejects invalid part dimensions %j", (...size) => {
  expect(() => fitOnBed(size, [350, 320, 325])).toThrow(RangeError);
  expect(() => bedFitSummary(size, setting)).toThrow(RangeError);
});

it.each([
  [0, 320, 325],
  [350, -1, 325],
  [350, 320, Number.NaN],
  [Number.POSITIVE_INFINITY, 320, null],
] as const)("rejects invalid bed dimensions %j", (...volume) => {
  expect(() => fitOnBed([100, 100, 100], volume)).toThrow(RangeError);
});

it("lists presets in stable table order and the custom slot last", () => {
  const beds = listBeds(setting);
  expect(beds.map((bed) => bed.id)).toEqual([...Object.keys(BUILD_PLATE_PRESETS), "custom"]);
  expect(new Set(beds.map((bed) => bed.id)).size).toBe(beds.length);
  expect(beds.at(-1)).toEqual({
    id: "custom",
    label: "Custom",
    kind: "custom",
    volumeMm: setting.customMm,
    note: null,
  });
  expect(activeBed(setting).id).toBe(setting.preset);
  expect(activeBed({ ...setting, preset: "custom" })).toEqual(beds.at(-1));
});

it("selects a known bed while retaining custom dimensions and pattern", () => {
  expect(selectBed(setting, "sheet-a4")).toEqual({ ...setting, preset: "sheet-a4" });
  expect(selectBed(setting, "custom")).toEqual({ ...setting, preset: "custom" });
  expect(selectBed(setting, "missing")).toBe(setting);
  expect(selectBed(setting, "__proto__")).toBe(setting);
  expect(selectBed(setting, "constructor")).toBe(setting);
});

it("summarizes every bed with nullable overage and decodes through the wire schema", () => {
  const summary = bedFitSummary([300, 340, 100], setting);
  expect(summary.sizeMm).toEqual([300, 340, 100]);
  expect(summary.activeBedId).toBe(setting.preset);
  expect(summary.beds.map((bed) => bed.id)).toEqual(listBeds(setting).map((bed) => bed.id));
  expect(summary.beds.find((bed) => bed.id === "bambu-h2d")?.fit).toBe("fits-rotated");
  expect(summary.beds.find((bed) => bed.id === "plane-1m")?.fit).toBe("fits");
  for (const bed of summary.beds) {
    expect(bed.overMm === null).toBe(bed.fit !== "too-big");
  }
  expect(decodeBedFitSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  expect(() => decodeBedFitSummary({ ...summary, sizeMm: [NaN, 1, 1] })).toThrow();
  expect(() =>
    decodeBedFitSummary({ ...summary, beds: Array(65).fill(summary.beds[0]) }),
  ).toThrow();
});
