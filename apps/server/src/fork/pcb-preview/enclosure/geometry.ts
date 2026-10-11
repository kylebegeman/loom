import type { Box, Facing } from "./features.ts";

export const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b),
    n = sorted.length;
  return n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : 0;
};
export const center = (b: Box) =>
  b.min.map((v, a) => (v + b.max[a]!) / 2) as [number, number, number];
export const facingVector = (f: Facing): [number, number, number] =>
  f === "+x" ? [1, 0, 0] : f === "-x" ? [-1, 0, 0] : f === "+y" ? [0, 1, 0] : [0, -1, 0];
