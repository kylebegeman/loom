import { describe, expect, it } from "vite-plus/test";
import { linkParameter, regionAt, regionsPositions, type ParameterLink } from "./linking";
import { buildTopology, type Point } from "./snap";

/** An axis-aligned box from `min` to `max` as an outward-wound triangle soup. */
function box(min: Point, max: Point): number[] {
  const out: number[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, 1]) {
      const u = (axis + 1) % 3,
        v = (axis + 2) % 3,
        corner = (a: number, b: number): Point => {
          const p: Point = [0, 0, 0];
          p[axis] = side ? max[axis]! : min[axis]!;
          p[u] = a ? max[u]! : min[u]!;
          p[v] = b ? max[v]! : min[v]!;
          return p;
        };
      // Counter-clockwise from outside: (u, v) turns positively on the + side.
      const quad = side
        ? [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]
        : [corner(0, 0), corner(0, 1), corner(1, 1), corner(1, 0)];
      for (const i of [0, 1, 2, 0, 2, 3]) out.push(...quad[i]!);
    }
  return out;
}
const soup = (...parts: number[][]) => new Float32Array(parts.flat());
const cuboid = (width: number, depth: number, height: number, inset = 0) =>
  soup(box([inset, 0, 0], [width, depth, height]));

const base = buildTopology(cuboid(20, 30, 40), null);
/** The base region whose outward normal is `normal`. */
const face = (normal: Point) =>
  regionAt(
    base,
    normal.map((n, k) => (n > 0 ? [20, 30, 40][k]! : n < 0 ? 0 : 5)) as Point,
    normal,
  )!;
const rates = (link: ParameterLink) => {
  if (link.status !== "linked") throw new Error(link.status);
  return link.rates;
};

describe("linkParameter", () => {
  it("links width to the +X face and height to the +Z face only", () => {
    const width = rates(
        linkParameter(base, [
          { delta: 1, positions: cuboid(21, 30, 40) },
          { delta: -1, positions: cuboid(19, 30, 40) },
        ]),
      ),
      height = rates(linkParameter(base, [{ delta: 2, positions: cuboid(20, 30, 42) }]));
    expect([...width.keys()]).toEqual([face([1, 0, 0])]);
    expect(width.get(face([1, 0, 0]))).toBeCloseTo(1, 5);
    expect([...height.keys()]).toEqual([face([0, 0, 1])]);
    expect(height.get(face([0, 0, 1]))).toBeCloseTo(1, 5);
  });

  it("gives a face that moves inward as the value grows a negative rate", () => {
    const inset = rates(linkParameter(base, [{ delta: 1, positions: cuboid(20, 30, 40, 1) }]));
    expect([...inset.keys()]).toEqual([face([-1, 0, 0])]);
    expect(inset.get(face([-1, 0, 0]))).toBeCloseTo(-1, 5);
  });

  it("links nothing to a parameter that does not move the part", () => {
    expect(rates(linkParameter(base, [{ delta: 1, positions: cuboid(20, 30, 40) }])).size).toBe(0);
  });

  it("marks a parameter that adds a feature as changing the shape", () => {
    const withBoss = soup(box([0, 0, 0], [20, 30, 40]), box([50, 0, 0], [55, 5, 5]));
    expect(linkParameter(base, [{ delta: 1, positions: withBoss }]).status).toBe("changes-shape");
  });
});

describe("regionAt and regionsPositions", () => {
  it("finds the face under a pick and draws only its triangles", () => {
    const right = face([1, 0, 0]),
      top = face([0, 0, 1]);
    expect(right).not.toBe(top);
    // On the shared edge, the picked face's normal decides.
    expect(regionAt(base, [20, 15, 40], [0, 0, 1])).toBe(top);
    expect(regionAt(base, [20, 15, 40], [1, 0, 0])).toBe(right);
    const drawn = regionsPositions(base, new Set([right]));
    expect(drawn.length).toBe(2 * 9);
    for (let i = 0; i < drawn.length; i += 3) expect(drawn[i]).toBe(20);
  });
});
