import { describe, expect, it } from "vite-plus/test";
import type { ModelAnnotation, ModelMeasurement, ModelSection } from "@t3tools/contracts/fork";
import { applyToList, describeChange, listPatch, operationField, samePin } from "./undoSlice";

const line = (id: string, name = "Distance 1"): ModelMeasurement => ({
  id,
  name,
  kind: "distance",
  sourceRevision: "r1",
  start: [0, 0, 0],
  end: [1, 0, 0],
  visible: true,
});
const pin = (id: string, request = "Thicker"): ModelAnnotation => ({
  id,
  name: "Pin",
  request,
  sourceRevision: "r1",
  points: [[0, 0, 0]],
  status: "open",
  reviewedRevision: null,
  resolvedIn: null,
  camera: null as unknown as ModelAnnotation["camera"],
  parameters: {},
  referenceImage: "https://host/a.jpg?sig=1",
});

describe("describeChange", () => {
  it("names measurement edits and keys each point by its measurement", () => {
    const moved = { ...line("m1"), end: [2, 0, 0] as ModelMeasurement["end"] };
    expect(describeChange({ measurements: [line("m1")] }, { measurements: [moved] })).toEqual({
      label: "moved a point",
      key: "measurements:point-m1",
    });
    expect(
      describeChange({ measurements: [line("m1")] }, { measurements: [line("m1", "Gap")] }).label,
    ).toBe("renamed a measurement");
    expect(
      describeChange({ measurements: [line("m1"), line("m2")] }, { measurements: [] }).label,
    ).toBe("cleared measurements");
    expect(
      describeChange(
        { measurements: [line("m1"), line("m2"), line("m3")] },
        { measurements: [line("m1")] },
      ).label,
    ).toBe("deleted measurements");
    expect(describeChange({ measurements: [] }, { measurements: [line("m1")] })).toEqual({
      label: "added a measurement",
      key: "measurements:add-m1",
    });
    // Different items keep different keys, so quick adds or deletes do not merge.
    expect(
      describeChange({ measurements: [line("m1")] }, { measurements: [line("m1"), line("m2")] })
        .key,
    ).toBe("measurements:add-m2");
    expect(
      describeChange({ measurements: [line("m1"), line("m2")] }, { measurements: [line("m1")] })
        .key,
    ).toBe("measurements:delete-m2");
    expect(
      describeChange(
        { measurements: [line("m1")] },
        { measurements: [{ ...line("m1"), visible: false }] },
      ).label,
    ).toBe("hid a measurement");
  });

  it("names pin edits", () => {
    expect(
      describeChange({ annotations: [pin("p1")] }, { annotations: [pin("p1", "Wider")] }),
    ).toEqual({ label: "edited a pin", key: "annotations:text-p1" });
    expect(
      describeChange(
        { annotations: [pin("p1")] },
        { annotations: [{ ...pin("p1"), status: "review" }] },
      ).label,
    ).toBe("changed a pin's status");
    expect(describeChange({ annotations: [pin("p1")] }, { annotations: [] }).label).toBe(
      "deleted a pin",
    );
  });

  it("names section changes by the setting that moved", () => {
    const section: ModelSection = {
      enabled: true,
      axis: "z",
      offset: 0,
      flipped: false,
      caps: true,
    };
    expect(describeChange({ section }, { section: { ...section, offset: 4 } })).toEqual({
      label: "moved the section",
      key: "section:offset",
    });
    expect(describeChange({ section }, { section: { ...section, enabled: false } }).label).toBe(
      "turned the section off",
    );
    expect(describeChange({ section }, { section: { ...section, caps: false } }).label).toBe(
      "turned the filled cut off",
    );
  });

  it("names orientation and parameter changes", () => {
    const quaternion = [0, 0, 0, 1] as [number, number, number, number];
    expect(
      describeChange({ orientation: null }, { orientation: { quaternion, sourceRevision: "r" } }),
    ).toEqual({ label: "changed the orientation", key: "orientation:orientation" });
    expect(
      describeChange({ orientation: { quaternion, sourceRevision: "r" } }, { orientation: null })
        .label,
    ).toBe("reset the orientation");
    const base = { overrides: { width: "10" }, setName: null };
    expect(
      describeChange({ parameters: base }, { parameters: { ...base, overrides: { width: "12" } } }),
    ).toEqual({ label: "changed a parameter", key: "parameters:parameter-width" });
    expect(
      describeChange({ parameters: base }, { parameters: { overrides: {}, setName: "Wide" } })
        .label,
    ).toBe("chose a parameter set");
  });
});

describe("workspace undo patches", () => {
  it("applies upserts in place and appends new items, as the server does", () => {
    const list = [line("a"), line("b")];
    expect(
      applyToList(list, { kind: "upsert", item: line("a", "Gap") }).map((m) => m.name),
    ).toEqual(["Gap", "Distance 1"]);
    expect(applyToList(list, { kind: "upsert", item: line("c") }).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(applyToList(list, { kind: "remove", id: "a" }).map((m) => m.id)).toEqual(["b"]);
    expect(operationField({ kind: "measurement", item: line("a") })).toBe("measurements");
    expect(operationField({ kind: "remove", collection: "views", id: "v" })).toBeNull();
  });

  it("reverts only the items a step changed and leaves items changed elsewhere", () => {
    const before = [line("a"), line("b")],
      after = [line("a", "Gap"), line("b"), line("c")];
    // Undo: the rename reverts and the added item goes; the agent's item d is untouched.
    expect(listPatch([...after, line("d")], after, before)).toEqual({
      upserts: [line("a")],
      removes: ["c"],
      settled: 0,
      conflicts: 0,
    });
    // An item edited since the step is a conflict rather than overwritten.
    expect(listPatch([line("a", "Agent"), line("b"), line("c")], after, before)).toEqual({
      upserts: [],
      removes: ["c"],
      settled: 0,
      conflicts: 1,
    });
    // An item already where the step would take it needs no edit and is no conflict.
    expect(listPatch([line("a", "Gap"), line("b")], after, before)).toEqual({
      upserts: [line("a")],
      removes: [],
      settled: 1,
      conflicts: 0,
    });
    // Redoing a deletion removes the item again; undoing it brings the item back.
    expect(listPatch([line("a"), line("b")], [line("a"), line("b")], [line("a")]).removes).toEqual([
      "b",
    ]);
    expect(listPatch([line("a")], [line("a")], [line("a"), line("b")]).upserts).toEqual([
      line("b"),
    ]);
  });

  it("compares pins without their freshly signed image URL", () => {
    expect(samePin(pin("p"), { ...pin("p"), referenceImage: "https://host/a.jpg?sig=2" })).toBe(
      true,
    );
    expect(samePin(pin("p"), pin("p", "Other"))).toBe(false);
    expect(samePin(undefined, undefined)).toBe(true);
    expect(samePin(pin("p"), undefined)).toBe(false);
  });
});
