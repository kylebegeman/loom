import { it, expect } from "vite-plus/test";
import type { PcbFabCapability } from "@t3tools/contracts/fork";
import {
  duplicateCapability,
  parseLengthList,
  capabilityErrors,
  removeCapability,
} from "./fabCapabilities.logic";
const fab: PcbFabCapability = {
  id: "custom",
  name: "Custom",
  tier: "standard",
  minTrackMm: 0.1,
  minSpaceMm: 0.1,
  minDrillMm: 0.2,
  minAnnularRingMm: 0.15,
  minViaMm: 0.5,
  minEdgeClearanceMm: null,
  minHoleToHoleMm: null,
  layerCounts: [2],
  thicknessesMm: [1.6],
  finishes: ["ENIG"],
  notes: "",
  sourceUrl: "",
  checkedOn: "2026-10-11",
};
it("copies profiles without collisions and deleting the default reverses it", () => {
  expect(duplicateCapability(fab, ["custom-copy"]).id).toBe("custom-copy-2");
  expect(removeCapability({ entries: [fab], defaultId: fab.id }, fab.id)).toEqual({
    entries: [],
    defaultId: "jlcpcb-standard",
  });
});
it("list input rejects junk and validates physical limits", () => {
  expect(parseLengthList(" 1, 2, 4, 2 ")).toEqual([1, 2, 4]);
  expect(parseLengthList("2,,4")).toBeNull();
  expect(parseLengthList("abc")).toBeNull();
  expect(capabilityErrors(fab)).toEqual([]);
  expect(capabilityErrors({ ...fab, minDrillMm: 0.6 })).toContain(
    "Via pad diameter must be greater than its drill.",
  );
  expect(
    capabilityErrors({ ...fab, sourceUrl: "https://user:secret@example.com" }).length,
  ).toBeGreaterThan(0);
});
