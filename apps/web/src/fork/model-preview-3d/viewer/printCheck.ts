import { Box3, PerspectiveCamera, Vector3 } from "three";
import type { ModelPoint } from "@t3tools/contracts/fork";
import { fitDistance } from "./views";
/** Frame a finding without choosing the back side of the part or starting an animation. */
export function frameFor(
  point: ModelPoint,
  normal: ModelPoint | null,
  radiusMm: number,
  camera: PerspectiveCamera,
  currentTarget: Vector3,
) {
  const target = new Vector3(...point);
  const direction = camera.position.clone().sub(currentTarget).normalize();
  if (!direction.lengthSq()) camera.getWorldDirection(direction).negate();
  const facing = normal && new Vector3(...normal).normalize();
  if (facing && facing.dot(direction) >= 0 && facing.lengthSq()) direction.copy(facing);
  const radius = Number.isFinite(radiusMm) ? Math.max(0.1, radiusMm) : 1;
  const box = new Box3(target.clone().addScalar(-radius), target.clone().addScalar(radius));
  return {
    target,
    position: target
      .clone()
      .addScaledVector(direction, fitDistance(box, camera.fov, camera.aspect)),
  };
}
