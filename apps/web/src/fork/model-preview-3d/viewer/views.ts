import { Box3, Vector3 } from "three";
export type View = "iso" | "front" | "top" | "right";
export const STANDARD_VIEWS: readonly View[] = ["iso", "front", "top", "right"];
export const viewDirection = (view: View) =>
  new Vector3(
    ...(
      { iso: [1, -1, 0.8], front: [0, -1, 0], top: [0, 0, 1], right: [1, 0, 0] } satisfies Record<
        View,
        [number, number, number]
      >
    )[view],
  ).normalize();
export function fitDistance(box: Box3, fovDegrees: number, aspect: number) {
  const size = box.getSize(new Vector3());
  return (
    (Math.max(size.length() / 2, 0.5) /
      Math.sin(Math.atan(Math.tan((fovDegrees * Math.PI) / 360) * Math.min(aspect, 1)))) *
    1.15
  );
}
