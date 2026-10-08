import type { PcbBounds, PcbMeasurement, PcbPoint } from "@t3tools/contracts/fork";
export function svgFrame(svg: string): PcbBounds | null {
  const box = svg
    .match(/\bviewBox=["']([^"']+)["']/)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0)
    return null;
  return { x: box[0]!, y: box[1]!, width: box[2]!, height: box[3]! };
}
/** The headline value and its component breakdown, for lists that show them separately. */
export function measurementParts(measurement: Pick<PcbMeasurement, "kind" | "points">): {
  value: string;
  detail: string;
} {
  const [a, b, c] = measurement.points;
  if (!a || !b) return { value: "", detail: "" };
  if (measurement.kind === "angle" && c) {
    const u = { x: a.x - b.x, y: a.y - b.y },
      v = { x: c.x - b.x, y: c.y - b.y },
      den = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    return den
      ? {
          value: `${((Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / den))) * 180) / Math.PI).toFixed(1)}°`,
          detail: `Vertex ${b.x.toFixed(2)}, ${b.y.toFixed(2)}`,
        }
      : { value: "Undefined angle", detail: "" };
  }
  return {
    value: `${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)} mm`,
    detail: `Δx ${(b.x - a.x).toFixed(2)}, Δy ${(b.y - a.y).toFixed(2)}`,
  };
}
export function measurementLabel(measurement: Pick<PcbMeasurement, "kind" | "points">): string {
  const { value, detail } = measurementParts(measurement);
  return measurement.kind === "angle" || !detail ? value : `${value} (${detail})`;
}
export function snapPoint(point: PcbPoint, points: readonly PcbPoint[], radius: number): PcbPoint {
  let nearest = point,
    distance = radius;
  for (const candidate of points) {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d < distance) {
      nearest = candidate;
      distance = d;
    }
  }
  return nearest;
}
