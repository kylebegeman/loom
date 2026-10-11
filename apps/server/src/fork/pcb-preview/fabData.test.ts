import { it, expect } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PcbFabCapability } from "@t3tools/contracts/fork";
import {
  BUILT_IN_FABS,
  decodeFabCapabilitiesLenient,
  toCatalog,
  isPlainHttpUrl,
} from "./fabData.ts";
const isCapability = Schema.is(PcbFabCapability);
it("built-ins carry valid dimensions, unique IDs and dated sources", () => {
  expect(new Set(BUILT_IN_FABS.map((f) => f.id)).size).toBe(5);
  for (const fab of BUILT_IN_FABS) {
    expect(isCapability(fab)).toBe(true);
    expect(fab.sourceUrl.startsWith("https:")).toBe(true);
    expect(fab.checkedOn).toBe("2026-10-10");
    expect(fab.minViaMm).toBeGreaterThan(fab.minDrillMm);
  }
});
it("one corrupt profile does not hide valid entries, duplicates or defaults", () => {
  const good = { ...BUILT_IN_FABS[0]!, id: "custom" };
  const stored = decodeFabCapabilitiesLenient(
    JSON.stringify({ version: 3, defaultId: "deleted", entries: [good, { id: "bad" }, good] }),
  );
  expect(stored.entries).toEqual([good]);
  expect(stored.skipped).toEqual(["bad", "custom"]);
  expect(toCatalog(stored).defaultId).toBe("jlcpcb-standard");
  expect(() => decodeFabCapabilitiesLenient("broken")).toThrow();
  expect(decodeFabCapabilitiesLenient("{}").entries).toEqual([]);
});
it("source links reject embedded credentials and executable protocols", () => {
  expect(isPlainHttpUrl("https://example.com/capabilities")).toBe(true);
  expect(isPlainHttpUrl("https://user:secret@example.com")).toBe(false);
  expect(isPlainHttpUrl("javascript:alert(1)")).toBe(false);
});
it("stored unsafe or inconsistent profiles are skipped", () => {
  const good = { ...BUILT_IN_FABS[0]!, id: "custom" };
  for (const override of [
    { sourceUrl: "https://user:secret@example.com" },
    { minViaMm: 0.1 },
    { layerCounts: [] },
    { finishes: [] },
  ]) {
    expect(
      decodeFabCapabilitiesLenient(JSON.stringify({ entries: [{ ...good, ...override }] })).entries,
    ).toEqual([]);
  }
});
