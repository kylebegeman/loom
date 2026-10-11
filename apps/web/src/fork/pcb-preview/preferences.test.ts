import { afterEach, expect, it } from "vite-plus/test";
import { decodePreferences, usePcbPreferences } from "./preferences.ts";

const previous = usePcbPreferences.getState();
afterEach(() => usePcbPreferences.setState(previous));

it("keeps trust and selections from preferences saved before later fields existed", () => {
  const selections = { project: { designId: "board.kicad_pro", view: "pcb", layers: "front" } };
  const saved = JSON.stringify({ selections, trusted: ['["env","project"]'] });
  expect(decodePreferences(saved)).toEqual({
    selections,
    trusted: ['["env","project"]'],
    electronicsUrl: "",
    lengthUnit: "mm",
    hiddenLayerPresets: [],
    pngScale: 2,
  });
});
it("rejects invalid units and PNG scales so load can use its existing defaults", () => {
  expect(() => decodePreferences(JSON.stringify({ lengthUnit: "cm" }))).toThrow();
  expect(() => decodePreferences(JSON.stringify({ pngScale: 3 }))).toThrow();
});
it("round trips changed preferences without dropping trust, selections or unknown presets", () => {
  usePcbPreferences.setState({ trusted: ["trusted-design"], selections: previous.selections });
  const store = usePcbPreferences.getState();
  store.setLengthUnit("mil");
  store.setHiddenLayerPresets(["assembly-front", "future-preset", "future-preset"]);
  store.setPngScale(1);
  let next = decodePreferences(JSON.stringify(usePcbPreferences.getState()));
  expect(next.lengthUnit).toBe("mil");
  expect(next.hiddenLayerPresets).toEqual(["assembly-front", "future-preset"]);
  expect(next.pngScale).toBe(1);
  expect(next.trusted).toEqual(["trusted-design"]);
  expect(next.selections).toEqual(previous.selections);
  store.setHiddenLayerPresets(["future-preset"]);
  next = decodePreferences(JSON.stringify(usePcbPreferences.getState()));
  expect(next.hiddenLayerPresets).toEqual(["future-preset"]);
});
