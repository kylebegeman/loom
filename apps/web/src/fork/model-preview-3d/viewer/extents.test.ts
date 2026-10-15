import { Box3, BoxGeometry, Mesh } from "three";
import { describe, expect, it } from "vite-plus/test";
import { extentDimensions } from "./extents";

describe("overall extent dimensions", () => {
  it("measures a posed box and sits each line outside it", () => {
    // A 30 x 20 x 10 box turned 90 degrees about Z and moved: X and Y swap.
    const part = new Mesh(new BoxGeometry(30, 20, 10));
    part.rotation.z = Math.PI / 2;
    part.position.set(100, 50, 5);
    part.updateMatrixWorld(true);
    const box = new Box3().setFromObject(part, true),
      bounds = { min: box.min.toArray(), max: box.max.toArray() },
      lines = extentDimensions(bounds);
    expect(lines.map((line) => line.axis)).toEqual(["X", "Y", "Z"]);
    const [x, y, z] = lines.map((line) => line.lengthMm);
    expect(x).toBeCloseTo(20, 5);
    expect(y).toBeCloseTo(30, 5);
    expect(z).toBeCloseTo(10, 5);
    const [x0, y0] = bounds.min,
      [x1] = bounds.max,
      off = 0.08 * 30;
    expect(lines[0]!.a[1]).toBeCloseTo(y0! - off, 5);
    expect(lines[1]!.a[0]).toBeCloseTo(x1! + off, 5);
    expect(lines[2]!.a[0]).toBeCloseTo(x0! - off, 5);
    expect(lines[2]!.a[1]).toBeCloseTo(y0!, 5);
    // Each line spans its witness corners along its own axis.
    lines.forEach((line, i) => {
      expect(Math.abs(line.b[i]! - line.a[i]!)).toBeCloseTo(line.lengthMm, 5);
      expect(line.from[0][i]).toBeCloseTo(line.a[i]!, 5);
      expect(line.from[1][i]).toBeCloseTo(line.b[i]!, 5);
    });
  });

  it("keeps a minimum offset and drops a flat axis", () => {
    const lines = extentDimensions({ min: [0, 0, 0], max: [5, 4, 0] });
    expect(lines.map((line) => line.axis)).toEqual(["X", "Y"]);
    expect(lines[0]!.a[1]).toBe(-2);
  });
});
