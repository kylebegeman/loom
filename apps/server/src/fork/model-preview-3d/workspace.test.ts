import { expect, it } from "@effect/vitest";
import { EMPTY_MODEL_WORKSPACE, type ModelCamera } from "@t3tools/contracts/fork";
import { applyWorkspaceOperation } from "./workspace.ts";
const camera: ModelCamera = {
  position: [10, 10, 10],
  target: [0, 0, 0],
  near: 0.1,
  far: 1000,
  wireframe: false,
  gridVisible: true,
  axesVisible: false,
  navigationMode: "orbit",
  section: { enabled: false, axis: "z", offset: 0, flipped: false },
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
  ).toThrow();
});
