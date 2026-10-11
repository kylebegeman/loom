import type { ModelOrientation } from "@t3tools/contracts/fork";
import { Vector3 } from "three";
import { bakeRotation } from "./viewer/orientation";

/** Drafts the exact file-space transform; the agent also clears the preview pose after baking. */
export function orientationRequest(
  path: string,
  format: string,
  orientation: ModelOrientation,
  partCentre: Vector3,
  orientedMinZ: number,
) {
  const { angles, matrix, dz } = bakeRotation(orientation.quaternion, partCentre, orientedMinZ);
  const rotation = JSON.stringify(matrix);
  const transform =
    format === "scad"
      ? `Wrap the top-level geometry in rotate(${JSON.stringify(angles)}) (degrees; OpenSCAD applies X, then Y, then Z). Exact equivalent: multmatrix(${rotation}).\nThen translate([0, 0, ${dz}]) so the lowest point sits at Z=0.`
      : `Re-export ${path} rotated by this matrix: ${rotation}, then translated by [0, 0, ${dz}] so the lowest point sits at Z=0. Keep the original file unless I say otherwise.`;
  return `Bake the Loom orientation into ${path}.\nOrientation set on geometry revision: ${orientation.sourceRevision}\n${transform}\nWhen the file re-renders, reset the Loom orientation with loom_model_preview_3d_save_workspace and { "kind": "orientation", "item": null } so the rotation is not applied twice. Preserve unrelated geometry and explain the change so I can review it in Loom.`;
}
