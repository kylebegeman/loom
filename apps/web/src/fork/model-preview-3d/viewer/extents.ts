type Point = [number, number, number];

/**
 * One overall dimension line. `a` and `b` are the line's ends, offset outside the part;
 * `from` holds the part corners its witness lines start at.
 */
export type Extent = {
  axis: "X" | "Y" | "Z";
  a: Point;
  b: Point;
  from: readonly [Point, Point];
  lengthMm: number;
};

/** Smallest offset between the part and its dimension lines, in mm. */
const MIN_OFFSET_MM = 2,
  OFFSET_SHARE = 0.08;

/** How far each line sits outside posed bounds of the given size. */
export function extentOffset(bounds: { min: readonly number[]; max: readonly number[] }) {
  const [x0 = 0, y0 = 0, z0 = 0] = bounds.min,
    [x1 = 0, y1 = 0, z1 = 0] = bounds.max;
  return Math.max(MIN_OFFSET_MM, OFFSET_SHARE * Math.max(x1 - x0, y1 - y0, z1 - z0));
}

/**
 * Overall X, Y and Z dimension lines on posed world bounds. X runs along the front edge,
 * Y along the right edge and Z up the front-left corner, each offset outside the part so
 * labels do not cover it. A flat axis gets no line.
 */
export function extentDimensions(bounds: {
  min: readonly number[];
  max: readonly number[];
}): Extent[] {
  const [x0 = 0, y0 = 0, z0 = 0] = bounds.min,
    [x1 = 0, y1 = 0, z1 = 0] = bounds.max,
    off = extentOffset(bounds);
  const lines: Extent[] = [
    {
      axis: "X",
      a: [x0, y0 - off, z0],
      b: [x1, y0 - off, z0],
      from: [
        [x0, y0, z0],
        [x1, y0, z0],
      ],
      lengthMm: x1 - x0,
    },
    {
      axis: "Y",
      a: [x1 + off, y0, z0],
      b: [x1 + off, y1, z0],
      from: [
        [x1, y0, z0],
        [x1, y1, z0],
      ],
      lengthMm: y1 - y0,
    },
    {
      axis: "Z",
      a: [x0 - off, y0, z0],
      b: [x0 - off, y0, z1],
      from: [
        [x0, y0, z0],
        [x0, y0, z1],
      ],
      lengthMm: z1 - z0,
    },
  ];
  return lines.filter((line) => line.lengthMm > 1e-6);
}
