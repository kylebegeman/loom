import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  activeBed,
  bedFitSummary,
  BedFitSummary,
  BUILD_PLATE_PRESETS,
  BuildPlateSetting,
  fitOnBed,
  fitBed,
  sharedZone,
  singleZoneStrips,
  type BedZone,
  listBeds,
  selectBed,
} from "./model-beds.ts";

const decodeBedFitSummary = Schema.decodeUnknownSync(BedFitSummary);

const setting: BuildPlateSetting = {
  preset: "bambu-h2d",
  customMm: [100, 200, 300],
  pattern: "grid-inch",
  showZones: true,
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

it.each([
  {
    size: [250, 250, 100],
    fit: { status: "fits" },
    zone: { reach: "all-zones" },
    withinMm: [300, 320, 320],
  },
  {
    size: [310, 310, 100],
    fit: { status: "fits" },
    zone: { reach: "one-zone", zoneIds: ["left", "right"] },
    withinMm: [325, 320, 320],
  },
  {
    size: [200, 200, 323],
    fit: { status: "fits" },
    zone: { reach: "one-zone", zoneIds: ["right"] },
    withinMm: [325, 320, 325],
  },
  {
    size: [340, 200, 100],
    fit: { status: "fits" },
    zone: { reach: "whole-bed" },
    withinMm: [350, 320, 320],
  },
  {
    size: [340, 200, 324],
    fit: { status: "too-big", overMm: [0, 0, 4] },
    zone: null,
    withinMm: [350, 320, 320],
  },
  {
    size: [200, 200, 330],
    fit: { status: "too-big", overMm: [0, 0, 5] },
    zone: null,
    withinMm: [325, 320, 325],
  },
  {
    size: [320, 290, 100],
    fit: { status: "fits-rotated" },
    zone: { reach: "all-zones" },
    withinMm: [300, 320, 320],
  },
] as const)("refines H2D fit by nozzle reach and height for $size", ({ size, ...expected }) => {
  expect(fitBed(size, BUILD_PLATE_PRESETS["bambu-h2d"])).toEqual(expected);
});

it("uses the H2C's narrower right nozzle and preserves ordinary bed fit", () => {
  expect(fitBed([310, 310, 100], BUILD_PLATE_PRESETS["bambu-h2c"]).zone).toEqual({
    reach: "one-zone",
    zoneIds: ["left"],
  });
  const bed = BUILD_PLATE_PRESETS["sheet-a4"];
  expect(fitBed([200, 290, 5000], bed)).toEqual({
    fit: { status: "fits-rotated" },
    zone: null,
    withinMm: bed.volumeMm,
  });
});

it("prefers an unturned single-nozzle fit while reporting every fitting nozzle", () => {
  const zones: readonly BedZone[] = [
    { id: "wide", label: "Wide", footprintMm: [100, 50], offsetMm: [0, 0] },
    { id: "deep", label: "Deep", footprintMm: [50, 100], offsetMm: [80, 0] },
  ];
  expect(fitBed([40, 90, 10], { volumeMm: [130, 100, 50], zones })).toEqual({
    fit: { status: "fits" },
    zone: { reach: "one-zone", zoneIds: ["wide", "deep"] },
    withinMm: [50, 100, 50],
  });
});

it("derives the shared area and front-left single-nozzle strips", () => {
  for (const preset of ["bambu-h2d", "bambu-h2c"] as const) {
    const bed = BUILD_PLATE_PRESETS[preset];
    expect(sharedZone(bed.zones, bed.volumeMm[2])).toEqual({
      offsetMm: [25, 0],
      footprintMm: [300, 320],
      heightMm: 320,
    });
    expect(singleZoneStrips(bed.zones)).toEqual([
      { zoneId: "left", offsetMm: [0, 0], footprintMm: [25, 320] },
      { zoneId: "right", offsetMm: [325, 0], footprintMm: [preset === "bambu-h2d" ? 25 : 5, 320] },
    ]);
  }
});

it("subtracts all four slabs, omits a contained zone and handles nonoverlap", () => {
  const zones: readonly BedZone[] = [
    { id: "outer", label: "Outer", footprintMm: [100, 100], offsetMm: [0, 0] },
    { id: "inner", label: "Inner", footprintMm: [40, 30], offsetMm: [20, 25] },
  ];
  expect(sharedZone(zones, 200)?.heightMm).toBe(200);
  expect(singleZoneStrips(zones)).toEqual([
    { zoneId: "outer", offsetMm: [0, 0], footprintMm: [20, 100] },
    { zoneId: "outer", offsetMm: [60, 0], footprintMm: [40, 100] },
    { zoneId: "outer", offsetMm: [20, 0], footprintMm: [40, 25] },
    { zoneId: "outer", offsetMm: [20, 55], footprintMm: [40, 45] },
  ]);
  const separated = [zones[0]!, { ...zones[1]!, offsetMm: [100, 100] as const }];
  expect(sharedZone(separated, null)).toBeNull();
  expect(singleZoneStrips(separated)).toEqual(
    separated.map(({ id, offsetMm, footprintMm }) => ({ zoneId: id, offsetMm, footprintMm })),
  );
  expect(sharedZone([], 200)).toBeNull();
  expect(singleZoneStrips([])).toEqual([]);
});

it("includes zone reach only for zoned beds in the agent summary", () => {
  const summary = bedFitSummary([310, 310, 100], setting);
  expect(summary.beds.find((bed) => bed.id === "bambu-h2d")?.zone).toEqual({
    reach: "one-zone",
    zoneIds: ["left", "right"],
  });
  expect(summary.beds.find((bed) => bed.id === "bambu-h2c")?.zone).toEqual({
    reach: "one-zone",
    zoneIds: ["left"],
  });
  expect(summary.beds.filter((bed) => bed.zone !== undefined)).toHaveLength(2);
  expect(decodeBedFitSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  expect(
    bedFitSummary([200, 200, 330], setting).beds.find((bed) => bed.id === "bambu-h2d")?.zone,
  ).toBeNull();
});

it("defaults old settings to visible zones and retains an explicit hidden preference", () => {
  const decode = Schema.decodeUnknownSync(BuildPlateSetting);
  expect(decode({ preset: setting.preset, customMm: setting.customMm }).showZones).toBe(true);
  expect(decode({ ...setting, showZones: false }).showZones).toBe(false);
  expect(selectBed({ ...setting, showZones: false }, "bambu-h2c").showZones).toBe(false);
});
