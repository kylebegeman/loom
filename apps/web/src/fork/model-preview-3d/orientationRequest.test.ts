import { expect, it } from "vite-plus/test";
import { Vector3 } from "three";
import { orientationRequest } from "./orientationRequest";

it("drafts exact mesh transforms and reset instructions while preserving the original file", () => {
  const request = orientationRequest(
    "parts/bracket.glb",
    "glb",
    {
      quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      sourceRevision: "source-42",
    },
    new Vector3(5, 10, 15),
    5,
  );
  expect(request).toContain("Re-export parts/bracket.glb rotated by this matrix:");
  expect(request).toContain("Keep the original file unless I say otherwise.");
  expect(request).toContain("translated by [0, 0,");
  expect(request).toContain('"kind": "orientation", "item": null');
  expect(request).toContain("source-42");
  expect(request).not.toContain("rotate(");
});
