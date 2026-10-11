import type { PcbBounds } from "@t3tools/contracts/fork";
import { atom, child, children, localPosition, number, type Sexp } from "./sexp.ts";

export type OutlinePoint = { x: number; y: number };
export type OutlineLoops = {
  source: "edge-cuts" | "circuit-outline" | "bounds";
  loops: OutlinePoint[][];
  outer: number;
};
const JOIN_MM = 0.001;
const CHORD_ERROR_MM = 0.005;
const TAU = 2 * Math.PI;
const normal = (angle: number) => ((angle % TAU) + TAU) % TAU;
const near = (a: OutlinePoint, b: OutlinePoint) => Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_MM;
const position = (node: Sexp[]) => ({ x: number(node), y: number(node, 2) });
export function signedOutlineArea(points: readonly OutlinePoint[]) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
function curve(center: OutlinePoint, radius: number, start: number, sweep: number): OutlinePoint[] {
  if (!Number.isFinite(radius) || radius <= 0) return [];
  const step = 2 * Math.acos(Math.max(-1, 1 - CHORD_ERROR_MM / radius));
  const count = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  if (count > 100000) throw new Error("Board outline curve exceeds the inspection limit.");
  const angles = Array.from({ length: count + 1 }, (_, i) => (i * Math.abs(sweep)) / count);
  // Include exact extrema, so bounds never depend on curve sampling density.
  for (const cardinal of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const progress = sweep > 0 ? normal(cardinal - start) : normal(start - cardinal);
    if (progress <= Math.abs(sweep)) angles.push(progress);
  }
  return angles
    .toSorted((a, b) => a - b)
    .map((progress) => {
      const angle = start + Math.sign(sweep) * progress;
      return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
    });
}
function edgePoints(edge: Sexp[], transform: (p: OutlinePoint) => OutlinePoint): OutlinePoint[] {
  const name = atom(edge, 0).replace(/^fp_/, "gr_");
  const point = (key: string) => transform(position(child(edge, key)));
  if (name === "gr_line") return [point("start"), point("end")];
  if (name === "gr_rect") {
    const a = position(child(edge, "start")),
      b = position(child(edge, "end"));
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a].map(transform);
  }
  if (name === "gr_poly") {
    const points = children(child(edge, "pts"), "xy").map((p) => transform(position(p)));
    return points.length ? [...points, points[0]!] : [];
  }
  if (name === "gr_circle") {
    const center = point("center"),
      end = point("end");
    return curve(center, Math.hypot(center.x - end.x, center.y - end.y), 0, TAU);
  }
  if (name === "gr_arc" && child(edge, "mid").length) {
    const a = point("start"),
      b = point("mid"),
      c = point("end");
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) <= 1e-12) return [];
    const aa = a.x ** 2 + a.y ** 2,
      bb = b.x ** 2 + b.y ** 2,
      cc = c.x ** 2 + c.y ** 2;
    const center = {
      x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
      y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d,
    };
    const start = Math.atan2(a.y - center.y, a.x - center.x);
    const end = Math.atan2(c.y - center.y, c.x - center.x);
    const mid = Math.atan2(b.y - center.y, b.x - center.x);
    const ccw = normal(mid - start) <= normal(end - start);
    const points = curve(
      center,
      Math.hypot(a.x - center.x, a.y - center.y),
      start,
      ccw ? normal(end - start) : -normal(start - end),
    );
    if (points.length) {
      points[0] = a;
      points[points.length - 1] = c;
    }
    return points;
  }
  return [];
}
function kicadPaths(board: Sexp[]) {
  const paths: OutlinePoint[][] = [];
  const add = (nodes: Sexp[], transform: (p: OutlinePoint) => OutlinePoint) => {
    for (const node of nodes) {
      if (!Array.isArray(node) || atom(child(node, "layer")) !== "Edge.Cuts") continue;
      paths.push(edgePoints(node, transform));
    }
  };
  add(board, (p) => p);
  for (const footprint of children(board, "footprint")) {
    const at = child(footprint, "at");
    add(footprint, (p) => localPosition(at, ["at", String(p.x), String(p.y)]));
  }
  return paths;
}
export function kicadOutlineBounds(board: Sexp[]): PcbBounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const points of kicadPaths(board))
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : null;
}
function loopsResult(loops: OutlinePoint[][], source: OutlineLoops["source"]): OutlineLoops | null {
  if (
    !loops.length ||
    loops.some((loop) => loop.length < 3 || Math.abs(signedOutlineArea(loop)) < 1e-9)
  )
    return null;
  let outer = 0;
  for (let i = 1; i < loops.length; i++)
    if (Math.abs(signedOutlineArea(loops[i]!)) > Math.abs(signedOutlineArea(loops[outer]!)))
      outer = i;
  if (signedOutlineArea(loops[outer]!) < 0) loops[outer]!.reverse();
  return { loops, outer, source };
}
/** Chain every Edge.Cuts path; an incomplete outer boundary must not become a cutout-only board. */
export function kicadOutline(board: Sexp[]): OutlineLoops | null {
  const paths = kicadPaths(board);
  if (paths.some((path) => path.length < 2)) return null;
  const loops: OutlinePoint[][] = [],
    open: OutlinePoint[][] = [];
  for (const path of paths) {
    if (near(path[0]!, path.at(-1)!)) loops.push(path.slice(0, -1));
    else open.push(path);
  }
  const bucket = new Map<string, { index: number; end: boolean; point: OutlinePoint }[]>();
  const key = (x: number, y: number) => `${x}:${y}`;
  for (const [index, path] of open.entries())
    for (const end of [false, true]) {
      const point = (end ? path.at(-1) : path[0])!;
      const k = key(Math.floor(point.x / JOIN_MM), Math.floor(point.y / JOIN_MM));
      const rows = bucket.get(k) ?? [];
      rows.push({ index, end, point });
      bucket.set(k, rows);
    }
  const unused = new Set(open.map((_, index) => index));
  for (const [index, path] of open.entries()) {
    if (!unused.delete(index)) continue;
    const chain = [...path];
    while (!near(chain[0]!, chain.at(-1)!)) {
      const endpoint = chain.at(-1)!;
      const bx = Math.floor(endpoint.x / JOIN_MM),
        by = Math.floor(endpoint.y / JOIN_MM);
      const candidates: { index: number; end: boolean }[] = [];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          for (const row of bucket.get(key(bx + dx, by + dy)) ?? []) {
            if (unused.has(row.index) && near(endpoint, row.point)) candidates.push(row);
          }
        }
      if (candidates.length !== 1) return null;
      const next = candidates[0]!;
      unused.delete(next.index);
      const points = next.end ? open[next.index]!.toReversed() : open[next.index]!;
      chain.push(...points.slice(1));
    }
    loops.push(chain.slice(0, -1));
  }
  return loopsResult(loops, "edge-cuts");
}
/** Circuit JSON uses Y-up coordinates; every returned point is in the PCB drawing frame. */
export function circuitOutline(json: unknown): OutlineLoops | null {
  if (!Array.isArray(json)) return null;
  const board: unknown = json.find((row: unknown) => record(row)?.type === "pcb_board");
  const row = record(board);
  if (!row) return null;
  if (Array.isArray(row.outline) && row.outline.length) {
    if (row.outline.length > 100000) return null;
    const points: OutlinePoint[] = [];
    for (const raw of row.outline) {
      const point = record(raw);
      if (!point || !finite(point.x) || !finite(point.y)) return null;
      points.push({ x: point.x, y: -point.y });
    }
    if (points.length > 1 && near(points[0]!, points.at(-1)!)) points.pop();
    return loopsResult([points], "circuit-outline");
  }
  if (!finite(row.width) || !finite(row.height) || row.width <= 0 || row.height <= 0) return null;
  const center = record(row.center);
  const x = (finite(center?.x) ? center.x : 0) - row.width / 2;
  const y = -(finite(center?.y) ? center.y : 0) - row.height / 2;
  return loopsResult(
    [
      [
        { x, y },
        { x: x + row.width, y },
        { x: x + row.width, y: y + row.height },
        { x, y: y + row.height },
      ],
    ],
    "bounds",
  );
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
