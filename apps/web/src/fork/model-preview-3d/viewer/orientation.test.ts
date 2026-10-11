import { expect, it } from "vite-plus/test";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import {
  bakeRotation,
  bedDelta,
  buildAdjacency,
  coplanarRegion,
  createOrientationIndex,
  hullRestingNormal,
  restingQuaternion,
} from "./orientation";

it("sends a face to the bed and composes a second lay-flat with the current pose", () => {
  const first = restingQuaternion(new Vector3(0, 1, 0), null);
  expect(
    new Vector3(0, 1, 0)
      .applyQuaternion(new Quaternion(...first))
      .distanceTo(new Vector3(0, 0, -1)),
  ).toBeLessThan(1e-8);
  const sourceNormal = new Vector3(1, 0, 0);
  const second = restingQuaternion(
    sourceNormal.clone().applyQuaternion(new Quaternion(...first)),
    first,
  );
  expect(
    sourceNormal.applyQuaternion(new Quaternion(...second)).distanceTo(new Vector3(0, 0, -1)),
  ).toBeLessThan(1e-8);
  expect(second[3]).toBeGreaterThanOrEqual(0);
});

it("welds split box vertices in raycast order and leaves an open plane's border open", () => {
  const box = new BoxGeometry(10, 20, 30).toNonIndexed();
  const adjacency = buildAdjacency(box);
  expect(adjacency.neighbors).toHaveLength(36);
  expect([...adjacency.neighbors].every((neighbor) => neighbor >= 0)).toBe(true);
  expect(buildAdjacency(box)).toBe(adjacency);
  const plane = buildAdjacency(new PlaneGeometry(10, 20));
  expect([...plane.neighbors].filter((neighbor) => neighbor === -1)).toHaveLength(4);
});

it("keeps ambiguous edges and degenerate triangles out of a connected face region", () => {
  const geometry = new BufferGeometry().setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
      ],
      3,
    ),
  );
  const adjacency = buildAdjacency(geometry);
  expect(adjacency.neighbors[0]).toBe(-1);
  expect(adjacency.neighbors[3]).toBe(-1);
  expect(adjacency.neighbors[6]).toBe(-1);
  expect(coplanarRegion(geometry, adjacency, 3)).toBeNull();
});

it("floods a box's full side and measures its area rather than one triangle", () => {
  const geometry = new BoxGeometry(10, 20, 30).toNonIndexed();
  const region = coplanarRegion(geometry, buildAdjacency(geometry), 0)!;
  expect([...region.triangles].sort()).toEqual([0, 1]);
  expect(region.areaMm2).toBeCloseTo(600);
  expect(region.normal.toArray()).toEqual([1, 0, 0]);
  expect(coplanarRegion(geometry, buildAdjacency(geometry), -1)).toBeNull();
});

it("does not flood around a gently curved cylinder", () => {
  const geometry = new CylinderGeometry(10, 10, 20, 64).toNonIndexed();
  const adjacency = buildAdjacency(geometry);
  const region = coplanarRegion(geometry, adjacency, 0)!;
  expect(region.triangles).toHaveLength(2);
  const seed = new Vector3().fromArray(adjacency.normals, 0);
  for (const face of region.triangles)
    expect(
      (seed.angleTo(new Vector3().fromArray(adjacency.normals, face * 3)) * 180) / Math.PI,
    ).toBeLessThanOrEqual(2 + 1e-6);
});

it("auto selects a full cube side over a chamfer and a wedge's base over its smaller slopes", () => {
  const cube = [-5, 5].flatMap((x) =>
    [-5, 5].flatMap((y) =>
      [-5, 5].flatMap((z) => (x === 5 && y === 5 && z === 5 ? [] : [new Vector3(x, y, z)])),
    ),
  );
  cube.push(new Vector3(3, 5, 5), new Vector3(5, 3, 5), new Vector3(5, 5, 3));
  const normal = hullRestingNormal(cube)!;
  expect(Math.max(...normal.toArray().map(Math.abs))).toBeCloseTo(1);
  expect(Math.min(...normal.toArray())).toBeCloseTo(-1);
  const wedge = [
    [-5, -5, 0],
    [5, -5, 0],
    [-5, 5, 0],
    [5, 5, 0],
    [-5, 0, 2],
    [5, 0, 2],
  ].map((point) => new Vector3(...(point as [number, number, number])));
  expect(hullRestingNormal(wedge)!.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-8);
});

it("prefers the lowest resulting height for equal-area hull sides", () => {
  // 4 x 2 x 1: the two largest faces are 4 x 2 and both give height 1.
  const points = [-2, 2].flatMap((x) =>
    [-1, 1].flatMap((y) => [-0.5, 0.5].map((z) => new Vector3(x, y, z))),
  );
  const normal = hullRestingNormal(points)!;
  expect(Math.abs(normal.z)).toBeCloseTo(1);
  expect(hullRestingNormal(points.slice(0, 3))).toBeNull();
});

it("OpenSCAD Euler angles reproduce the exact quaternion matrix including Y gimbal lock", () => {
  const sources = [
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
    new Quaternion(0.2, -0.4, 0.3, 0.7).normalize(),
    new Quaternion(-0.7, 0.1, 0.3, -0.2).normalize(),
    new Quaternion(0, 0, 0, 1),
  ];
  for (const source of sources) {
    const result = bakeRotation(
      [source.x, source.y, source.z, source.w],
      new Vector3(3, 4, 5),
      -10,
    );
    const [x, y, z] = result.angles.map((angle) => (angle * Math.PI) / 180);
    const rebuilt = new Matrix4()
      .makeRotationZ(z!)
      .multiply(new Matrix4().makeRotationY(y!))
      .multiply(new Matrix4().makeRotationX(x!));
    const expected = new Matrix4().makeRotationFromQuaternion(source);
    for (let i = 0; i < 16; i++) expect(rebuilt.elements[i]).toBeCloseTo(expected.elements[i]!, 8);
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++)
        expect(result.matrix[row]![column]).toBeCloseTo(expected.elements[column * 4 + row]!, 8);
  }
});

it("bakes a translation that rests the origin-rotated part at Z zero", () => {
  const centre = new Vector3(30, -2, 12),
    q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  const corners = [-5, 5].flatMap((x) =>
    [-10, 10].flatMap((y) => [-15, 15].map((z) => new Vector3(x, y, z).add(centre))),
  );
  const rotatedMin = Math.min(...corners.map((point) => point.clone().applyQuaternion(q).z));
  const rootPosition = centre.clone().sub(centre.clone().applyQuaternion(q));
  const result = bakeRotation([q.x, q.y, q.z, q.w], centre, rotatedMin + rootPosition.z);
  expect(rotatedMin + result.dz).toBeCloseTo(0);
  const delta = bedDelta([0, 0, 0], [1, 2, 3], [q.x, q.y, q.z, q.w]);
  expect(delta[0]).toBeCloseTo(1);
  expect(delta[1]).toBeCloseTo(-3);
  expect(delta[2]).toBeCloseTo(2);
  expect(Math.hypot(...delta)).toBeCloseTo(Math.sqrt(14));
});

it("finds a transformed geometry face from model-space points and reuses the raycast region", () => {
  const root = new Group(),
    model = new Group();
  const mesh = new Mesh(new BoxGeometry(10, 20, 30), new MeshBasicMaterial());
  mesh.position.set(12, 5, 8);
  mesh.scale.set(2, 1, 1);
  model.add(mesh);
  root.add(model);
  root.position.set(100, 200, 300);
  root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3);
  const index = createOrientationIndex(model, root);
  const region = index.atPoint([22, 5, 8])!;
  expect(region.normal.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-8);
  expect(region.areaMm2).toBeCloseTo(600);
  expect(index.regionAt(mesh, region.faceIndex)).toBe(region);
  expect(index.regionAt(mesh, region.triangles[1]!)).toBe(region);
  expect(index.atPoint([1000, 1000, 1000])).toBeNull();
  const highlight = index.highlightGeometry(region);
  highlight.computeBoundingBox();
  expect(highlight.boundingBox!.min.x).toBeCloseTo(22);
  expect(highlight.boundingBox!.max.x).toBeCloseTo(22);
  highlight.dispose();
});

it("supports instance-local raycast triangles and accurate transformed face area", () => {
  const root = new Group(),
    model = new Group();
  const mesh = new InstancedMesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new Matrix4());
  mesh.setMatrixAt(1, new Matrix4().makeScale(1, 2, 3).setPosition(10, 0, 0));
  model.add(mesh);
  root.add(model);
  const index = createOrientationIndex(model, root);
  const region = index.atPoint([11, 0, 0])!;
  expect(region.instanceId).toBe(1);
  expect(region.areaMm2).toBeCloseTo(144);
  expect(index.regionAt(mesh, 0, 1)).toBe(region);
  expect(index.regionAt(mesh, 0)).toBeNull();
});

it("reports a concave face that cannot touch the bed and returns absolute auto orientation", () => {
  const root = new Group(),
    model = new Group();
  model.add(new Mesh(new BoxGeometry(20, 20, 10), new MeshBasicMaterial()));
  const shelf = new Mesh(new PlaneGeometry(5, 5), new MeshBasicMaterial());
  shelf.position.z = 1;
  model.add(shelf);
  root.add(model);
  const index = createOrientationIndex(model, root);
  const region = index.regionAt(shelf, 0)!;
  const current = restingQuaternion(new Vector3(1, 0, 0), null);
  const result = index.orientationFor(region, current);
  expect(result.floats).toBe(true);
  expect(result.areaMm2).toBeCloseTo(25);
  expect(region.normal.clone().applyQuaternion(new Quaternion(...result.quaternion)).z).toBeCloseTo(
    -1,
  );
  const outside = index.regionAt(model.children[0] as Mesh, 0)!;
  expect(index.orientationFor(outside, null).floats).toBe(false);
  expect(index.auto()).not.toBeNull();
});
