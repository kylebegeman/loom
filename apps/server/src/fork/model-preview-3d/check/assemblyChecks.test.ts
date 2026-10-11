import { describe, it, expect } from "vite-plus/test";
import { partMatrix } from "@t3tools/contracts/fork";
import { runAssemblyChecks, readPart } from "./assemblyChecks.ts";
import { cubeSoup, binaryStl, joinSoup } from "./fixtures.ts";
import { weld, type TriangleSoup } from "./mesh.ts";
import type { AssemblyWorkerPart } from "./protocol.ts";
const part = (
  id: string,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
): AssemblyWorkerPart => ({
  id,
  format: "stl",
  files: [{ name: "test.stl", bytes: binaryStl(cubeSoup(size)) }],
  matrix: partMatrix(position, [0, 0, 0]),
  geometryRevision: id,
});
const check = (
  a: AssemblyWorkerPart,
  b: AssemblyWorkerPart,
  requiredMm = 1,
  limits = { maxTriangles: 3_000_000, intersections: 50_000_000, distances: 20_000_000 },
) =>
  runAssemblyChecks({
    kind: "assembly",
    parts: [a, b],
    pairs: [{ a: a.id, b: b.id, clearanceId: "fit", requiredMm }],
    limits,
  });
describe("assembly geometry", () => {
  it("distinguishes separated, touching, intersecting and enclosed solids", () => {
    const a = part("a", [10, 10, 10], [0, 0, 0]);
    const clear = check(a, part("b", [10, 10, 10], [12, 0, 0]));
    expect(clear.pairs[0]).toMatchObject({
      status: "clear",
      clearance: "ok",
      minDistanceMm: 2,
      complete: true,
    });
    expect(check(a, part("b", [10, 10, 10], [10, 0, 0])).pairs[0]).toMatchObject({
      status: "touching",
      minDistanceMm: 0,
    });
    expect(check(a, part("b", [10, 10, 10], [5, 2, 2])).pairs[0]?.status).toBe("intersects");
    expect(check(a, part("b", [2, 2, 2], [4, 4, 4])).pairs[0]?.status).toBe("inside");
  });
  it("detects aligned volume overlap without treating face, edge or vertex contact as intersection", () => {
    const a = part("a", [10, 10, 10], [0, 0, 0]);
    for (const offset of [
      [9, 0, 0],
      [9, 9, 0],
      [9, 9, 9],
      [0, 0, 0],
    ] as const) {
      expect(check(a, part("b", [10, 10, 10], offset)).pairs[0]).toMatchObject({
        status: "intersects",
        clearance: "tight",
        minDistanceMm: 0,
        complete: true,
      });
    }
    for (const offset of [
      [10, 0, 0],
      [10, 10, 0],
      [10, 10, 10],
    ] as const)
      expect(check(a, part("b", [10, 10, 10], offset)).pairs[0]?.status).toBe("touching");
  });
  it("does not infer volume overlap from bounding boxes across a closed cavity", () => {
    const hollow = {
      ...part("a", [10, 10, 10], [0, 0, 0]),
      files: [
        {
          name: "hollow.stl",
          bytes: binaryStl(joinSoup(cubeSoup([10, 10, 10]), cubeSoup([6, 6, 6], [2, 2, 2]))),
        },
      ],
    };
    expect(check(hollow, part("b", [6, 6, 6], [2, 2, 2])).pairs[0]?.status).toBe("touching");
  });
  it("finds edge-to-edge clearance and transforms every vertex for precise rotated bounds", () => {
    const a = part("a", [10, 10, 10], [0, 0, 0]),
      b = part("b", [10, 10, 10], [10.5, 0, 0]);
    expect(check(a, b).pairs[0]).toMatchObject({
      status: "clear",
      clearance: "tight",
      minDistanceMm: 0.5,
    });
    const rotated = { ...a, matrix: partMatrix([1, 2, 3], [0, 0, 45]) },
      bounds = weld(readPart(rotated, 100)).bounds;
    expect(bounds.min[0]).toBeCloseTo(1 - Math.sqrt(50), 4);
    expect(bounds.max[1]).toBeCloseTo(2 + Math.sqrt(200), 4);
  });
  it("marks bounded searches incomplete without claiming an exact distance", () => {
    const result = check(
      part("a", [10, 10, 10], [0, 0, 0]),
      part("b", [10, 10, 10], [5, 2, 2]),
      1,
      { maxTriangles: 100, intersections: 0, distances: 0 },
    );
    expect(result.complete).toBe(false);
    expect(result.pairs[0]?.complete).toBe(false);
    expect(result.pairs[0]?.atLeastMm).toBeNull();
  });
});

describe("assembly contact regions", () => {
  const face = (x: number): TriangleSoup => Float32Array.from([x, 0, 0, x + 0.1, 0, 0, x, 0.1, 0]);
  const contacts = (positions: readonly number[]) => {
    const soup = joinSoup(...positions.map(face));
    const a = {
      ...part("a", [1, 1, 1], [0, 0, 0]),
      files: [{ name: "contacts.stl", bytes: binaryStl(soup) }],
    };
    return check(a, { ...a, id: "b", geometryRevision: "b" });
  };
  it("keeps the largest contact cluster even when more than ten smaller regions come first", () => {
    const result = contacts([
      ...Array.from({ length: 11 }, (_, i) => i * 20),
      ...Array.from({ length: 12 }, (_, i) => 300 + i * 0.4),
    ]);
    const regions = result.pairs[0]!.regions;
    expect(result.pairs[0]!.status).toBe("touching");
    expect(regions).toHaveLength(10);
    expect(regions[0]!.point[0]).toBeGreaterThan(300);
    expect(regions[0]!.triangles).toBeGreaterThan(regions[1]!.triangles);
  });
  it("retains proved contact when the remaining search reaches its budget", () => {
    const a = part("a", [10, 10, 10], [0, 0, 0]);
    const result = check(a, { ...a, id: "b" }, 1, {
      maxTriangles: 100,
      intersections: 1,
      distances: 1,
    });
    expect(result.pairs[0]).toMatchObject({
      status: "touching",
      minDistanceMm: 0,
      complete: false,
    });
  });
  it("merges contact regions transitively across neighbouring 2 mm grid cells", () => {
    const regions = contacts([0, 6, 2.1, 4.1]).pairs[0]!.regions;
    expect(regions).toHaveLength(1);
    expect(regions[0]!.triangles).toBe(4);
    expect(regions[0]!.point[0]).toBeCloseTo(3.05, 4);
    expect(regions[0]!.radiusMm).toBeGreaterThanOrEqual(regions[0]!.point[0]);
  });
});
