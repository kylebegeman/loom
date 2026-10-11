import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { ModelCamera, ModelWorkspace } from "./model-workspace.ts";

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
