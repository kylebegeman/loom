import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  CircleGeometry,
} from "three";
import type { BuildPlatePattern } from "@t3tools/contracts/fork";

const SPACING = {
  "grid-mm": { step: 10, majorEvery: 5 },
  "grid-inch": { step: 25.4 / 4, majorEvery: 4 },
} as const;

/**
 * Line segments (x, y, z triples) for a width × depth bed centred on the origin. Lines step out
 * from the centre, so the centre lines are major, and none sit on the outline.
 */
export function bedLines(
  width: number,
  depth: number,
  pattern: BuildPlatePattern,
  shape: "rectangle" | "round" = "rectangle",
) {
  const minor: number[] = [],
    major: number[] = [];
  if (pattern !== "plain") {
    const { step, majorEvery } = SPACING[pattern];
    for (const axis of [0, 1] as const) {
      const half = (axis === 0 ? width : depth) / 2,
        across = (axis === 0 ? depth : width) / 2,
        count = Math.ceil(half / step) - 1;
      for (let k = -count; k <= count; k++) {
        const at = k * step;
        const extent =
          shape === "round"
            ? Math.sqrt(Math.max(0, Math.min(width, depth) ** 2 / 4 - at ** 2))
            : across;
        if (shape === "round" && Math.abs(at) >= Math.min(width, depth) / 2) continue;
        (k % majorEvery === 0 ? major : minor).push(
          ...(axis === 0 ? [at, -extent, 0, at, extent, 0] : [-extent, at, 0, extent, at, 0]),
        );
      }
    }
  }
  const [x, y] = [width / 2, depth / 2];
  const corners = [
    [-x, -y],
    [x, -y],
    [x, y],
    [-x, y],
  ] as const;
  const outline =
    shape === "round"
      ? Array.from({ length: 64 }, (_, i) => {
          const a = (i * Math.PI * 2) / 64,
            b = ((i + 1) * Math.PI * 2) / 64,
            radius = Math.min(width, depth) / 2;
          return [
            Math.cos(a) * radius,
            Math.sin(a) * radius,
            0,
            Math.cos(b) * radius,
            Math.sin(b) * radius,
            0,
          ];
        }).flat()
      : corners.flatMap(([ax, ay], i) => {
          const [bx, by] = corners[(i + 1) % 4]!;
          return [ax, ay, 0, bx, by, 0];
        });
  return { minor, major, outline };
}

const COLORS = {
  dark: { fill: 0x1b2028, minor: 0x262d37, major: 0x353e4a, outline: 0x5b6573 },
  light: { fill: 0xe6e9ed, minor: 0xd9dde3, major: 0xc3c9d1, outline: 0x98a1ad },
};

/**
 * The plate under the model. It draws first and never tests or writes depth, so the model always
 * paints over it: a part resting on the plate cannot z-fight with it.
 */
export function createBed(
  width: number,
  depth: number,
  pattern: BuildPlatePattern,
  shape: "rectangle" | "round" = "rectangle",
) {
  const bed = new Group();
  bed.name = "bed";
  const flat = { depthTest: false, depthWrite: false } as const;
  const fill = new Mesh(
    shape === "round"
      ? new CircleGeometry(Math.min(width, depth) / 2, 64)
      : new PlaneGeometry(width, depth),
    new MeshBasicMaterial(flat),
  );
  fill.renderOrder = -4;
  bed.add(fill);
  const { minor, major, outline } = bedLines(width, depth, pattern, shape);
  const lines = [minor, major, outline].map((positions, index) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const segments = new LineSegments(geometry, new LineBasicMaterial(flat));
    segments.renderOrder = index - 3;
    bed.add(segments);
    return segments;
  });
  const setTheme = (dark: boolean) => {
    const colors = dark ? COLORS.dark : COLORS.light;
    fill.material.color = new Color(colors.fill);
    for (const [index, key] of (["minor", "major", "outline"] as const).entries())
      lines[index]!.material.color = new Color(colors[key]);
  };
  const dispose = () => {
    fill.geometry.dispose();
    fill.material.dispose();
    for (const segments of lines) {
      segments.geometry.dispose();
      segments.material.dispose();
    }
  };
  return { object: bed, setTheme, dispose };
}
