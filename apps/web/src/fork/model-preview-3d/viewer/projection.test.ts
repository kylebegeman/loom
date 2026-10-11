import { Box3, MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { expect, it } from "vite-plus/test";
import { MARKER_SCALE, markerScale, syncOrthographic } from "./projection";
import { fitDistance } from "./views";

it("matches the rig's framing at the target plane and copies its orientation", () => {
  const rig = new PerspectiveCamera(40, 1.5);
  const target = new Vector3(10, 20, 30);
  rig.up.set(0, 0, 1);
  rig.position.set(50, -80, 100);
  rig.lookAt(target);
  rig.updateMatrixWorld(true);
  const ortho = new OrthographicCamera();
  syncOrthographic(ortho, rig, target, 50);
  const distance = rig.position.distanceTo(target);
  const halfHeight = distance * Math.tan(MathUtils.degToRad(40) / 2);
  expect(ortho.position).toEqual(rig.position);
  expect(ortho.quaternion.toArray()).toEqual(rig.quaternion.toArray());
  expect(ortho.up).toEqual(rig.up);
  expect(ortho.top).toBeCloseTo(halfHeight);
  expect(ortho.bottom).toBeCloseTo(-halfHeight);
  expect(ortho.right).toBeCloseTo(halfHeight * rig.aspect);
  expect(ortho.left).toBeCloseTo(-halfHeight * rig.aspect);
  const across = new Vector3(1, 0, 0).applyQuaternion(rig.quaternion);
  const point = target.clone().addScaledVector(across, 5);
  expect(point.clone().project(ortho).x).toBeCloseTo(point.clone().project(rig).x);
  expect(point.clone().project(ortho).y).toBeCloseTo(point.clone().project(rig).y);
});

it.each([0.5, 1, 2])("fits the bounding sphere with aspect %s", (aspect) => {
  const box = new Box3(new Vector3(-30, -20, -10), new Vector3(30, 20, 10));
  const radius = box.getSize(new Vector3()).length() / 2;
  const rig = new PerspectiveCamera(40, aspect);
  rig.position.z = fitDistance(box, rig.fov, aspect);
  const ortho = new OrthographicCamera();
  syncOrthographic(ortho, rig, new Vector3(), radius);
  expect(ortho.top).toBeGreaterThan(radius);
  expect(ortho.right).toBeGreaterThan(radius);
});

it("keeps the whole sphere visible when the eye is inside it", () => {
  const rig = new PerspectiveCamera(40, 1);
  rig.position.z = 2;
  const ortho = new OrthographicCamera();
  syncOrthographic(ortho, rig, new Vector3(), 100);
  expect(ortho.near).toBeLessThan(2 - 100);
  expect(ortho.far).toBeGreaterThan(2 + 100);
  for (const z of [-100, 100]) {
    const projected = new Vector3(0, 0, z).project(ortho);
    expect(Math.abs(projected.z)).toBeLessThan(1);
  }
});

it.each([1, 10, 500])("keeps marker screen size constant at distance %s", (distance) => {
  const tangent = Math.tan(MathUtils.degToRad(40) / 2);
  const perspectiveNdc = markerScale("perspective", distance) / tangent;
  const orthoNdc = markerScale("orthographic", distance) / (distance * tangent);
  expect(perspectiveNdc).toBeCloseTo(MARKER_SCALE / tangent);
  expect(orthoNdc).toBeCloseTo(perspectiveNdc);
});
