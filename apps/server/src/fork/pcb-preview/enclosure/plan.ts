import type { EnclosureStarterParams } from "@t3tools/contracts/fork";
import type { BoardFeatures, Box, Facing } from "./features.ts";
export type EnclosurePlan = {
  params: EnclosureStarterParams;
  outline: [number, number][];
  boardTop: number;
  boardBottom: number;
  thickness: number;
  partsAbove: number;
  partsBelow: number;
  standoffs: { x: number; y: number; diameter: number; pilot: number }[];
  cutouts: { reference: string; box: Box; facing: Facing }[];
  proxies: Box[];
  outerMm: [number, number, number];
  innerMm: [number, number, number];
};
export function planEnclosure(f: BoardFeatures, p: EnclosureStarterParams): EnclosurePlan {
  const partsAbove = Math.max(0, ...f.parts.map((v) => v.box.max[2] - f.body.top)),
    partsBelow = Math.max(0, ...f.parts.map((v) => f.body.bottom - v.box.min[2]));
  const params = { ...p, standoffHeightMm: p.standoffHeightMm ?? Math.max(3, partsBelow + 1) };
  const standoffs = f.holes.map((h) => ({
    x: h.x,
    y: h.y,
    diameter: p.standoffDiameterMm ?? h.diameter + 3,
    pilot: p.pilotDiameterMm ?? Math.max(1, h.diameter - 0.6),
  }));
  if (standoffs.some((h) => h.diameter <= h.pilot))
    throw new Error("Standoff diameter must exceed pilot diameter.");
  const outline = f.outline.loops[f.outline.outer]!,
    xs = outline.map((v) => v[0]),
    ys = outline.map((v) => v[1]);
  const innerMm: [number, number, number] = [
    Math.max(...xs) - Math.min(...xs) + 2 * p.sideGapMm,
    Math.max(...ys) - Math.min(...ys) + 2 * p.sideGapMm,
    f.body.top - f.body.bottom + partsAbove + p.topGapMm + params.standoffHeightMm,
  ];
  return {
    params,
    outline,
    boardTop: f.body.top,
    boardBottom: f.body.bottom,
    thickness: f.body.top - f.body.bottom,
    partsAbove,
    partsBelow,
    standoffs,
    cutouts: f.connectors.map((c) => ({
      ...c,
      box: {
        min: c.box.min.map((v) => v - p.cutoutMarginMm) as Box["min"],
        max: c.box.max.map((v) => v + p.cutoutMarginMm) as Box["max"],
      },
    })),
    proxies: f.parts
      .toSorted((a, b) => b.box.max[2] - b.box.min[2] - (a.box.max[2] - a.box.min[2]))
      .slice(0, 300)
      .map((v) => v.box),
    innerMm,
    outerMm: [
      innerMm[0] + 2 * p.wallMm,
      innerMm[1] + 2 * p.wallMm,
      innerMm[2] + p.floorMm + p.lidMm,
    ],
  };
}
