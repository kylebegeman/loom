import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import {
  ModelCamera,
  ModelWorkspace,
  ModelWorkspaceOperation,
  EMPTY_MODEL_WORKSPACE,
  normalizeQuaternion,
  quaternionMatrix,
} from "./model-workspace.ts";

const legacyCamera = {
  position: [10, -10, 10],
  target: [0, 0, 0],
  near: 0.01,
  far: 10000,
  wireframe: false,
  gridVisible: true,
  axesVisible: false,
  navigationMode: "orbit",
  section: { enabled: false, axis: "z", offset: 0, flipped: false },
};
const decode = Schema.decodeUnknownSync(ModelCamera);
const encode = Schema.encodeSync(ModelCamera);
const decodeWorkspace = Schema.decodeUnknownSync(ModelWorkspace);

it("restores legacy saved view and annotation cameras as perspective", () => {
  const camera = decode(legacyCamera);
  expect(camera.projection).toBe("perspective");
  const workspace = decodeWorkspace({
    views: [{ id: "v", name: "Front", sourceRevision: "one", camera: legacyCamera }],
    annotations: [
      {
        id: "a",
        name: "Hole",
        sourceRevision: "one",
        points: [[0, 0, 0]],
        referenceImage: null,
        request: "Move the hole",
        status: "open",
        reviewedRevision: null,
        camera: legacyCamera,
        parameters: {},
      },
    ],
    measurements: [],
    presets: [],
    variants: [],
  });
  expect(workspace.views[0]!.camera.projection).toBe("perspective");
  expect(workspace.annotations[0]!.camera.projection).toBe("perspective");
});

it("round-trips orthographic cameras and rejects unknown projections", () => {
  const camera = decode({ ...legacyCamera, projection: "orthographic" });
  expect(decode(encode(camera))).toEqual(camera);
  expect(() => decode({ ...legacyCamera, projection: "oblique" })).toThrow();
});

it("defaults legacy workspaces and section caps without rejecting a stored non-unit rotation", () => {
  const { orientation: _oldOrientation, ...legacy } = EMPTY_MODEL_WORKSPACE;
  expect(decodeWorkspace(legacy).orientation).toBeNull();
  expect(decode(legacyCamera).section.caps).toBe(true);
  expect(
    decodeWorkspace({ ...legacy, orientation: { quaternion: [0, 0, 0, 2], sourceRevision: "old" } })
      .orientation?.quaternion,
  ).toEqual([0, 0, 0, 2]);
});

it("validates orientation writes at the operation boundary and accepts reset", () => {
  const operation = Schema.decodeUnknownSync(ModelWorkspaceOperation);
  expect(() =>
    operation({ kind: "orientation", item: { quaternion: [0, 0, 0, 2], sourceRevision: "v1" } }),
  ).toThrow("Use a unit quaternion");
  expect(operation({ kind: "orientation", item: null })).toEqual({
    kind: "orientation",
    item: null,
  });
  expect(
    operation({ kind: "orientation", item: { quaternion: [0, 0, 0, 1], sourceRevision: "v1" } })
      .kind,
  ).toBe("orientation");
  expect(() =>
    operation({ kind: "orientation", item: { quaternion: [0, NaN, 0, 1], sourceRevision: "v1" } }),
  ).toThrow();
});

it("normalizes quaternions canonically and handles zero and extreme stored components", () => {
  expect(normalizeQuaternion([0, 0, 0, 0])).toEqual([0, 0, 0, 1]);
  expect(normalizeQuaternion([0, 0, 0, -2])).toEqual([-0, -0, -0, 1]);
  expect(normalizeQuaternion([0, 0, 0, 1e308])).toEqual([0, 0, 0, 1]);
  expect(Math.hypot(...normalizeQuaternion([1e308, 1e308, 1e308, 1e308]))).toBeCloseTo(1);
  const rotation = quaternionMatrix([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  expect(rotation[0][1]).toBeCloseTo(0);
  expect(rotation[1][1]).toBeCloseTo(0);
  expect(rotation[2][1]).toBeCloseTo(1);
});
