import { it, expect } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  PcbFabCapabilities,
  PcbFabCapability,
  PcbFabCheckInput,
  PcbFabPackageInput,
} from "./pcb-fab.ts";
const decodeCapabilities = Schema.decodeUnknownSync(PcbFabCapabilities);
const decodeCapability = Schema.decodeUnknownSync(PcbFabCapability);
const decodeCheck = Schema.decodeUnknownSync(PcbFabCheckInput);
const valid = Schema.is(PcbFabCapability);
const validCapabilities = Schema.is(PcbFabCapabilities);
const entry = {
  id: "custom",
  name: "Custom",
  tier: "standard",
  minTrackMm: 0.1,
  minSpaceMm: 0.1,
  minDrillMm: 0.2,
  minAnnularRingMm: 0.15,
  minViaMm: 0.5,
  layerCounts: [2],
  thicknessesMm: [1.6],
  finishes: ["ENIG"],
  notes: "",
  sourceUrl: "",
  checkedOn: "2026-10-11",
};
it("old capability records decode defaults", () => {
  expect(decodeCapabilities({})).toEqual({
    version: 0,
    entries: [],
    defaultId: null,
  });
  expect(decodeCapability(entry)).toMatchObject({
    minEdgeClearanceMm: null,
    minHoleToHoleMm: null,
  });
  expect(decodeCheck({ threadId: "one", designId: "board" })).toEqual({
    threadId: "one",
    designId: "board",
  });
});
it("rejects unit mistakes, IDs, excess profiles and malformed dates", () => {
  expect(valid({ ...entry, minDrillMm: 0 })).toBe(false);
  expect(valid({ ...entry, minDrillMm: 10 })).toBe(false);
  expect(valid({ ...entry, id: "../custom" })).toBe(false);
  expect(valid({ ...entry, checkedOn: "yesterday" })).toBe(false);
  expect(
    validCapabilities({
      version: 0,
      entries: Array.from({ length: 25 }, () => ({
        ...entry,
        minEdgeClearanceMm: null,
        minHoleToHoleMm: null,
      })),
      defaultId: null,
    }),
  ).toBe(false);
});

const decodePackage = Schema.decodeUnknownSync(PcbFabPackageInput);
it("fabrication package requests default to generic assembly without forcing", () => {
  expect(decodePackage({ threadId: "one", designId: "board" })).toEqual({
    threadId: "one",
    designId: "board",
    profile: "generic",
    assembly: true,
    force: false,
  });
});
