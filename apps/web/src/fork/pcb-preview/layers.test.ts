import { expect, it } from "vite-plus/test";
import { findLayerPreset, resolveLayerPreset, type PcbLayerState } from "@t3tools/contracts/fork";
import {
  matchLayerSet,
  reconcileSaved,
  reconcileLayerChoice,
  resolveEditorLayers,
  sameVisibility,
  uniqueLayerSetName,
} from "./layers";

const names = ["F.Cu", "B.Cu", "F.Fab", "F.Silkscreen", "Edge.Cuts"];
const builtIn = resolveLayerPreset(findLayerPreset("assembly-front")!, names)!;
const saved = { id: "saved-front", name: "Build front", layers: builtIn };

it("matches a built-in before an identical saved set and clears after an eye toggle", () => {
  expect(matchLayerSet(builtIn, names, [saved])).toEqual({
    kind: "built-in",
    id: "assembly-front",
    name: "Assembly front",
  });
  const custom = builtIn.map((layer) =>
    layer.name === "B.Cu" ? { ...layer, visible: true } : layer,
  );
  expect(matchLayerSet(custom, names, [saved])).toBeNull();
  const customSaved = { ...saved, layers: custom };
  expect(matchLayerSet(custom, names, [customSaved])).toEqual({
    kind: "saved",
    id: saved.id,
    name: saved.name,
  });
});

it("compares identities and opacities regardless of saved layer order", () => {
  expect(sameVisibility(builtIn, builtIn.toReversed())).toBe(true);
  expect(
    sameVisibility(
      builtIn,
      builtIn.map((layer) => ({ ...layer, name: "Other" })),
    ),
  ).toBe(false);
  expect(
    sameVisibility(
      builtIn,
      builtIn.map((layer) => ({ ...layer, opacity: 0.5 })),
    ),
  ).toBe(false);
  const duplicate = [builtIn[0]!, builtIn[0]!];
  expect(sameVisibility(duplicate, duplicate)).toBe(false);
});

it("reconciles old saved sets by dropping removed layers, adding hidden ones and keeping opacity", () => {
  const savedLayers: PcbLayerState[] = [
    { name: "B.Cu", visible: true, opacity: 0.25 },
    { name: "Removed", visible: true, opacity: 0.5 },
    { name: "F.Cu", visible: false, opacity: 0.75 },
  ];
  const nextNames = ["F.Cu", "In1.Cu", "B.Cu"];
  const reconciled = reconcileSaved(savedLayers, nextNames);
  expect(reconciled).toEqual([
    { name: "F.Cu", visible: false, opacity: 0.75 },
    { name: "In1.Cu", visible: false, opacity: 1 },
    { name: "B.Cu", visible: true, opacity: 0.25 },
  ]);
  expect(matchLayerSet(reconciled, nextNames, [{ ...saved, layers: savedLayers }])).toEqual({
    kind: "saved",
    id: saved.id,
    name: saved.name,
  });
});

it("does not name empty controls or unavailable built-ins", () => {
  expect(matchLayerSet(null, names, [saved])).toBeNull();
  expect(matchLayerSet([], [], [saved])).toBeNull();
  expect(
    matchLayerSet([{ name: "Edge.Cuts", visible: true, opacity: 1 }], ["Edge.Cuts"], []),
  ).toBeNull();
});

it("duplicates names with an available suffix without replacing existing sets", () => {
  expect(uniqueLayerSetName("Fab review", [])).toBe("Fab review");
  expect(
    uniqueLayerSetName("Fab review", [
      { ...saved, name: " fab REVIEW " },
      { ...saved, id: "two", name: "Fab review 2" },
      { ...saved, id: "four", name: "Fab review 4" },
    ]),
  ).toBe("Fab review 3");
});

it("applies a named editor preset and reports its stable snapshot identity", () => {
  const selected = resolveEditorLayers({ name: "Assembly front" }, names, [saved])!;
  const active = matchLayerSet(selected, names, [saved]);
  expect(selected).toEqual(builtIn);
  expect(active?.kind === "built-in" ? active.id : active?.name).toBe("assembly-front");
  expect(() => resolveEditorLayers({ name: "unknown" }, names, [saved])).toThrow(
    "Unknown layer preset.",
  );
  expect(() => resolveEditorLayers({ name: "assembly-back" }, names, [])).toThrow(
    "none of the preset's layers",
  );
  expect(() => resolveEditorLayers({ name: "assembly-front", layers: [] }, names, [])).toThrow(
    "Pass layers or name, not both.",
  );
  expect(() =>
    resolveEditorLayers({ layers: [{ name: "missing", visible: true, opacity: 1 }] }, names, []),
  ).toThrow("Unknown layer.");
});

it("applies a saved editor set by id or name and reconciles its current board layers", () => {
  const old = {
    id: "detail-id",
    name: "Detail",
    layers: [{ name: "F.Cu", visible: true, opacity: 0.5 }],
  };
  const expected = reconcileSaved(old.layers, names);
  expect(resolveEditorLayers({ name: "Detail" }, names, [old])).toEqual(expected);
  expect(resolveEditorLayers({ name: "detail-id" }, names, [old])).toEqual(expected);
  expect(matchLayerSet(expected, names, [old])?.name).toBe("Detail");
  expect(resolveEditorLayers({}, names, [])).toBeUndefined();
});

it("keeps a selected copper preset active after a board adds or removes inner layers", () => {
  const twoLayer = ["F.Cu", "B.Cu", "Edge.Cuts"];
  const before = resolveEditorLayers({ name: "copper-only" }, twoLayer, [])!;
  const fourLayer = ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu", "Edge.Cuts"];
  const after = reconcileLayerChoice(before, fourLayer, "front");
  expect(after.filter((layer) => layer.visible).map((layer) => layer.name)).toEqual(
    fourLayer.slice(0, -1),
  );
  expect(matchLayerSet(after, fourLayer, [])?.id).toBe("copper-only");
  expect(reconcileLayerChoice(after, fourLayer, "front")).toBe(after);
  expect(reconcileLayerChoice(after, twoLayer, "front")).toEqual(before);
});
