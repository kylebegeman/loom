import { Box3, Vector3 } from "three";
import type {
  ModelPoint,
  Pcb3dHeights,
  Pcb3dMeasurement,
  PcbInspection,
  PcbPoint,
} from "@t3tools/contracts/fork";
import type { BoardParts } from "./board3dParts";
const HEIGHT_PARTS_LIMIT = 100;
export function partHeights(parts: BoardParts): Pcb3dHeights | null {
  if (parts.top === null || parts.bottom === null) return null;
  const top = parts.top,
    bottom = parts.bottom;
  const all = parts.components.map((part) => {
    const box = new Box3().setFromObject(part.node, true);
    return {
      reference: part.reference,
      side: part.side,
      aboveMm: Math.max(0, box.max.z - top),
      belowMm: Math.max(0, bottom - box.min.z),
    };
  });
  const highest = (key: "aboveMm" | "belowMm") => {
    const part = all.toSorted((a, b) => b[key] - a[key])[0];
    return part ? { reference: part.reference, heightMm: part[key] } : null;
  };
  return {
    boardThicknessMm: top - bottom,
    above: highest("aboveMm"),
    below: highest("belowMm"),
    parts: all
      .filter((part): part is typeof part & { reference: string } => part.reference !== null)
      .sort((a, b) => Math.max(b.aboveMm, b.belowMm) - Math.max(a.aboveMm, a.belowMm))
      .slice(0, HEIGHT_PARTS_LIMIT),
    partCount: all.length,
  };
}
export function heightAt(parts: BoardParts, point: ModelPoint): Pcb3dMeasurement | null {
  if (parts.top === null || parts.bottom === null) return null;
  const side = point[2] < parts.bottom ? "back" : "front";
  const face = side === "front" ? parts.top : parts.bottom;
  return {
    kind: "height",
    side,
    start: [point[0], point[1], face],
    end: point,
    lengthMm: point[2] <= parts.top && point[2] >= parts.bottom ? 0 : Math.abs(point[2] - face),
  };
}
export function heightOfPart(parts: BoardParts, reference: string): Pcb3dMeasurement | null {
  const part = parts.components.find((part) => part.reference === reference);
  if (!part) return null;
  const box = new Box3().setFromObject(part.node, true),
    centre = box.getCenter(new Vector3());
  const result = heightAt(parts, [
    centre.x,
    centre.y,
    part.side === "front" ? box.max.z : box.min.z,
  ]);
  return result ? { ...result, reference } : null;
}
const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
/** Fit signs and translation using part positions, with a bounds-based fallback for sparse boards. */
export function boardFrame(
  parts: BoardParts,
  inspection: PcbInspection,
): { toModel(point: PcbPoint): [number, number] } | null {
  if (parts.top === null || !inspection.bounds) return null;
  const matches = parts.components.flatMap((part) => {
    const component = inspection.components.find(
      (component) => component.reference === part.reference,
    );
    if (!component?.pcb) return [];
    const centre = new Box3().setFromObject(part.node, true).getCenter(new Vector3());
    return [{ drawing: component.pcb, model: centre }];
  });
  let sx = parts.kind === "tscircuit" ? -1 : 1,
    sy = -sx,
    ox = 0,
    oy = 0;
  if (matches.length >= 3) {
    let residual = Infinity;
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        const dx = median(matches.map((part) => part.model.x - x * part.drawing.x)),
          dy = median(matches.map((part) => part.model.y - y * part.drawing.y));
        const error = median(
          matches.map((part) =>
            Math.hypot(
              part.model.x - (x * part.drawing.x + dx),
              part.model.y - (y * part.drawing.y + dy),
            ),
          ),
        );
        if (error < residual) {
          residual = error;
          sx = x;
          sy = y;
          ox = dx;
          oy = dy;
        }
      }
  } else {
    const box = new Box3();
    for (const body of parts.groups.board) box.union(new Box3().setFromObject(body, true));
    if (box.isEmpty()) return null;
    const centre = box.getCenter(new Vector3()),
      bounds = inspection.bounds;
    ox = centre.x - sx * (bounds.x + bounds.width / 2);
    oy = centre.y - sy * (bounds.y + bounds.height / 2);
  }
  return { toModel: (point) => [sx * point.x + ox, sy * point.y + oy] };
}
