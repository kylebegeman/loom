import { expect, it } from "@effect/vitest";
import { EMPTY_MODEL_WORKSPACE, type ModelCamera } from "@t3tools/contracts/fork";
import { applyWorkspaceOperation } from "./workspace.ts";
const camera: ModelCamera = {
  projection: "perspective",
  position: [10, 10, 10],
  target: [0, 0, 0],
  near: 0.1,
  far: 1000,
  wireframe: false,
  overhangs: false,
  gridVisible: true,
  axesVisible: false,
  navigationMode: "orbit",
  section: { enabled: false, axis: "z", offset: 0, flipped: false, caps: true },
};
it("merges independent identities, preserves order and removes dangling capture presets", () => {
  let state = EMPTY_MODEL_WORKSPACE;
  for (const id of ["a", "b"])
    state = applyWorkspaceOperation(state, {
      kind: "view",
      item: { id, name: id, sourceRevision: "v1", camera },
    });
  state = applyWorkspaceOperation(state, {
    kind: "view",
    item: { ...state.views[0]!, name: "Renamed" },
  });
  expect(state.views.map((v) => v.id)).toEqual(["a", "b"]);
  state = applyWorkspaceOperation(state, {
    kind: "preset",
    item: { id: "p", name: "Pair", viewIds: ["a", "b"], includeMeasurements: true },
  });
  state = applyWorkspaceOperation(state, { kind: "remove", collection: "views", id: "a" });
  expect(state.presets[0]!.viewIds).toEqual(["b"]);
  state = applyWorkspaceOperation(state, { kind: "remove", collection: "views", id: "b" });
  expect(state.presets).toEqual([]);
});
it("rejects unbounded workspace data and nonfinite spatial coordinates", () => {
  expect(() =>
    applyWorkspaceOperation(EMPTY_MODEL_WORKSPACE, {
      kind: "measurement",
      item: {
        id: "m",
        kind: "distance",
        name: "invalid",
        sourceRevision: "v1",
        start: [NaN, 0, 0],
        end: [0, 0, 0],
        visible: true,
      },
    }),
  ).toThrow();
  let state = EMPTY_MODEL_WORKSPACE;
  for (let i = 0; i < 30; i++)
    state = applyWorkspaceOperation(state, {
      kind: "view",
      item: { id: String(i), name: String(i), sourceRevision: "v1", camera },
    });
  expect(() =>
    applyWorkspaceOperation(state, {
      kind: "view",
      item: { id: "overflow", name: "overflow", sourceRevision: "v1", camera },
    }),
  ).toThrow("Keep up to 30 saved views. Delete some before adding more.");
  // A full collection still accepts edits to the items it keeps.
  expect(
    applyWorkspaceOperation(state, {
      kind: "view",
      item: { id: "0", name: "Renamed", sourceRevision: "v1", camera },
    }).views[0]!.name,
  ).toBe("Renamed");
  let variants = EMPTY_MODEL_WORKSPACE;
  const variant = (id: string) => ({
    kind: "variant" as const,
    item: {
      id,
      name: id,
      values: {},
      sourceRevision: "v1",
      thumbnail: null,
      dimensions: null,
      triangles: null,
      renderedRevision: null,
      origin: "agent" as const,
    },
  });
  for (let i = 0; i < 24; i++) variants = applyWorkspaceOperation(variants, variant(String(i)));
  expect(() => applyWorkspaceOperation(variants, variant("overflow"))).toThrow(
    "Keep up to 24 variants. Delete some before adding more.",
  );
});

it("sets, replaces and resets orientation while preserving independent workspace entities", () => {
  const base = applyWorkspaceOperation(EMPTY_MODEL_WORKSPACE, {
    kind: "view",
    item: { id: "v", name: "Front", sourceRevision: "v1", camera },
  });
  const set = applyWorkspaceOperation(base, {
    kind: "orientation",
    item: { quaternion: [0, 0, 0, -1.0005], sourceRevision: "v1" },
  });
  expect(set.orientation).toEqual({ quaternion: [-0, -0, -0, 1], sourceRevision: "v1" });
  expect(set.views).toEqual(base.views);
  expect(set.measurements).toEqual(base.measurements);
  expect(set.annotations).toEqual(base.annotations);
  expect(set.presets).toEqual(base.presets);
  expect(set.variants).toEqual(base.variants);
  const replaced = applyWorkspaceOperation(set, {
    kind: "orientation",
    item: { quaternion: [1, 0, 0, 0], sourceRevision: "v2" },
  });
  expect(replaced.orientation).toEqual({ quaternion: [1, 0, 0, 0], sourceRevision: "v2" });
  const removed = applyWorkspaceOperation(replaced, {
    kind: "remove",
    collection: "views",
    id: "v",
  });
  expect(removed.views).toEqual([]);
  expect(removed.orientation).toEqual(replaced.orientation);
  expect(
    applyWorkspaceOperation(removed, { kind: "orientation", item: null }).orientation,
  ).toBeNull();
});
