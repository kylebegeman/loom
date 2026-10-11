import type { ModelProjection } from "@t3tools/contracts/fork";
import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";

export const MARKER_SCALE = 0.015;

/** Keeps non-attenuating sprites the same screen size in either projection. */
export const markerScale = (projection: ModelProjection, distance: number) =>
  MARKER_SCALE * (projection === "orthographic" ? distance : 1);

/** Matches the perspective rig's framing at its target plane, including pan and zoom. */
export function syncOrthographic(
  ortho: OrthographicCamera,
  rig: PerspectiveCamera,
  target: Vector3,
  sceneRadius: number,
) {
  const distance = Math.max(rig.position.distanceTo(target), 0.000001);
  const halfHeight = distance * Math.tan(MathUtils.degToRad(rig.fov) / 2);
  ortho.position.copy(rig.position);
  ortho.quaternion.copy(rig.quaternion);
  ortho.up.copy(rig.up);
  ortho.left = -halfHeight * rig.aspect;
  ortho.right = halfHeight * rig.aspect;
  ortho.top = halfHeight;
  ortho.bottom = -halfHeight;
  ortho.zoom = 1;
  ortho.near = distance - 2 * sceneRadius;
  ortho.far = distance + 2 * sceneRadius;
  ortho.updateProjectionMatrix();
  ortho.updateMatrixWorld(true);
}
