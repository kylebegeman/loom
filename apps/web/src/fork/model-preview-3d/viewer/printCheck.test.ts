import { expect, it } from "vite-plus/test";
import { PerspectiveCamera, Vector3 } from "three";
import { frameFor } from "./printCheck";

it("frames a finding from its visible face without flipping to the back of the part", () => {
  const camera = new PerspectiveCamera(40, 2, 0.01, 1000);
  camera.position.set(0, -50, 20);
  const point = [10, 20, 30] as const;
  const visible = frameFor(point, [0, -1, 0], 2, camera, new Vector3());
  expect(visible.target.toArray()).toEqual([...point]);
  expect(
    visible.position
      .clone()
      .sub(visible.target)
      .normalize()
      .distanceTo(new Vector3(0, -1, 0)),
  ).toBeLessThan(1e-8);
  const behind = frameFor(point, [0, 1, 0], 2, camera, new Vector3());
  const original = camera.position.clone().normalize();
  expect(behind.position.clone().sub(behind.target).normalize().distanceTo(original)).toBeLessThan(
    1e-8,
  );
  expect(camera.position.toArray()).toEqual([0, -50, 20]);
});

it("uses a finite frame size for invalid or tiny radii and a fallback when the camera is at its target", () => {
  const camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  camera.position.set(0, 0, 0);
  for (const radius of [0, -1, NaN, Infinity]) {
    const frame = frameFor([1, 2, 3], null, radius, camera, new Vector3());
    expect(frame.position.toArray().every(Number.isFinite)).toBe(true);
    expect(frame.position.distanceTo(frame.target)).toBeGreaterThan(0);
  }
});
