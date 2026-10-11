import type { ScaleReference } from "@t3tools/contracts/fork";
import { Box3, Mesh, Vector3 } from "three";
import { expect, it, vi } from "vite-plus/test";
import { createReference, placeReference, REFERENCE_GAP_MM } from "./references";

const DIMENSIONS: readonly [Exclude<ScaleReference, "none">, readonly [number, number, number]][] =
  [
    ["card", [53.98, 85.6, 0.76]],
    ["coin-us", [24.26, 24.26, 1.75]],
    ["coin-euro", [23.25, 23.25, 2.33]],
    ["aa-battery", [14.5, 50.5, 14.5]],
    ["brick-2x4", [15.8, 31.8, 11.3]],
    ["m3-screw", [5.5, 13, 5.5]],
    ["hand", [115, 190, 2]],
  ];

it.each(DIMENSIONS)(
  "builds %s at its real size, centred and resting on the floor",
  (kind, size) => {
    const reference = createReference(kind)!;
    const bounds = new Box3().setFromObject(reference.object);
    const actual = bounds.getSize(new Vector3());
    for (const axis of [0, 1, 2]) expect(actual.getComponent(axis)).toBeCloseTo(size[axis]!, 2);
    expect(bounds.getCenter(new Vector3()).x).toBeCloseTo(0, 4);
    expect(bounds.getCenter(new Vector3()).y).toBeCloseTo(0, 4);
    expect(bounds.min.z).toBeCloseTo(0, 4);
    expect(reference.size.toArray()).toEqual(actual.toArray());
    let triangles = 0;
    reference.object.traverse((object) => {
      if (object instanceof Mesh)
        triangles +=
          (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
    });
    expect(triangles).toBeLessThan(2000);
    reference.dispose();
  },
);

it("does not build anything for none", () => {
  expect(createReference("none")).toBeNull();
});

it.each(["card", "aa-battery", "hand"] as const)("places %s beside an off-centre part", (kind) => {
  const reference = createReference(kind)!;
  const part = new Box3(new Vector3(-15, 25, 8), new Vector3(45, 95, 28));
  reference.object.position.copy(placeReference(part, reference.size));
  const bounds = new Box3().setFromObject(reference.object);
  expect(bounds.min.x - part.max.x).toBeCloseTo(REFERENCE_GAP_MM, 4);
  expect(bounds.getCenter(new Vector3()).y).toBeCloseTo(part.getCenter(new Vector3()).y, 4);
  expect(bounds.min.z).toBeCloseTo(part.min.z, 4);
  reference.dispose();
});

it("releases every geometry and the shared material once", () => {
  const reference = createReference("brick-2x4")!;
  const meshes = reference.object.children as Mesh[];
  const geometries = [...new Set(meshes.map((mesh) => mesh.geometry))];
  const releases = geometries.map((geometry) => vi.spyOn(geometry, "dispose"));
  const material = vi.spyOn(meshes[0]!.material as import("three").Material, "dispose");
  reference.dispose();
  for (const release of releases) expect(release).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
});
