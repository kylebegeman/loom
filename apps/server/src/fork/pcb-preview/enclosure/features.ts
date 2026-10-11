import {
  ENCLOSURE_MAX_CONNECTORS,
  ENCLOSURE_MAX_HOLES,
  type PcbReferenceMetadata,
} from "@t3tools/contracts/fork";
import { readGlbBounds } from "../glb.ts";
export type Box = { min: [number, number, number]; max: [number, number, number] };
export type Facing = "+x" | "-x" | "+y" | "-y";
export type BoardFeatures = {
  revision: string;
  kind: "kicad" | "tscircuit" | "unknown";
  frame: { sx: 1 | -1; sy: 1 | -1; ox: number; oy: number; mirrored: boolean; matched: number };
  body: { top: number; bottom: number; box: Box };
  outline: {
    loops: [number, number][][];
    outer: number;
    source: "edge-cuts" | "circuit-outline" | "bounds";
  };
  holes: { x: number; y: number; diameter: number; footprint: string }[];
  parts: { reference: string | null; side: "front" | "back"; box: Box; assumed: boolean }[];
  connectors: { reference: string; box: Box; facing: Facing; edgeMm: number }[];
  warnings: string[];
};
export const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b),
    n = sorted.length;
  return n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : 0;
};
export function unionBoxes(boxes: readonly Box[]): Box {
  return {
    min: [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a]!))) as Box["min"],
    max: [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a]!))) as Box["max"],
  };
}
export const center = (b: Box) =>
  b.min.map((v, a) => (v + b.max[a]!) / 2) as [number, number, number];
export const facingVector = (f: Facing): [number, number, number] =>
  f === "+x" ? [1, 0, 0] : f === "-x" ? [-1, 0, 0] : f === "+y" ? [0, 1, 0] : [0, -1, 0];
export function nearestEdge(loop: readonly [number, number][], p: readonly [number, number]) {
  let best = { distance: Infinity, facing: "+x" as Facing, normal: [1, 0] as [number, number] };
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!,
      b = loop[(i + 1) % loop.length]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy);
    if (!len) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len)));
    const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    if (distance < best.distance)
      best = {
        distance,
        normal: [dy / len, -dx / len],
        facing: Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "+x" : "-x") : dx > 0 ? "-y" : "+y",
      };
  }
  return best;
}
export function boardFeatures(
  json: unknown,
  metadata: PcbReferenceMetadata,
  options: {
    connectors: { include: readonly string[]; exclude: readonly string[] };
    edgeMarginMm: number;
    assumedHeightMm: number;
  },
): BoardFeatures {
  const raw = readGlbBounds(json).meshes;
  const kind =
    metadata.kind ??
    (raw.some((m) => m.materials.includes("board"))
      ? "kicad"
      : raw.some((m) => m.nodes.includes("Loom millimetres to metres"))
        ? "tscircuit"
        : "unknown");
  const rows = raw.map((m) => ({
    ...m,
    box: {
      min: [1000 * m.min[0], -1000 * m.max[2], 1000 * m.min[1]],
      max: [1000 * m.max[0], -1000 * m.min[2], 1000 * m.max[1]],
    } as Box,
  }));
  let bodyRows = rows.filter((m) => m.materials.some((n) => n.toLowerCase() === "board"));
  if (!bodyRows.length) {
    const biggest = rows.toSorted(
      (a, b) =>
        (b.box.max[0] - b.box.min[0]) * (b.box.max[1] - b.box.min[1]) -
        (a.box.max[0] - a.box.min[0]) * (a.box.max[1] - a.box.min[1]),
    )[0];
    if (biggest) bodyRows = [biggest];
  }
  if (!bodyRows.length) throw new Error("The 3D board has no board body.");
  const bodyBox = unionBoxes(bodyRows.map((r) => r.box)),
    warnings: string[] = [];
  const refs = new Map(metadata.components.map((c) => [c.reference, c]));
  const groups = new Map<string, { reference: string | null; boxes: Box[] }>();
  for (const row of rows) {
    if (
      bodyRows.includes(row) ||
      row.materials.some((n) => /soldermask|silkscreen|copper|^pad$/i.test(n))
    )
      continue;
    const names = [...row.nodes, ...(row.name ? [row.name] : [])];
    const reference =
      names.map((n) => (refs.has(n) ? n : n.replace(/_\d+$/, ""))).find((n) => refs.has(n)) ?? null;
    const key =
      reference ??
      names.filter((n) => n !== "Loom millimetres to metres")[1] ??
      row.name ??
      `mesh-${groups.size}`;
    const group = groups.get(key) ?? { reference, boxes: [] };
    group.boxes.push(row.box);
    groups.set(key, group);
  }
  const parts: BoardFeatures["parts"] = [...groups.values()].map((g) => {
    const box = unionBoxes(g.boxes);
    return {
      reference: g.reference,
      box,
      side: center(box)[2] < (bodyBox.min[2] + bodyBox.max[2]) / 2 ? "back" : "front",
      assumed: false,
    };
  });
  const matches = parts.flatMap((p) => {
    const pos = p.reference ? refs.get(p.reference)?.position : null;
    return pos ? [{ pos, point: center(p.box) }] : [];
  });
  const bounds = metadata.bounds ?? {
    x: 0,
    y: 0,
    width: bodyBox.max[0] - bodyBox.min[0],
    height: bodyBox.max[1] - bodyBox.min[1],
  };
  const signs: [1 | -1, 1 | -1][] =
    kind === "tscircuit"
      ? [
          [-1, 1],
          [1, -1],
          [1, 1],
          [-1, -1],
        ]
      : [
          [1, -1],
          [-1, 1],
          [1, 1],
          [-1, -1],
        ];
  const frames = signs.map(([sx, sy]) => {
    const ox =
      matches.length >= 3
        ? median(matches.map((m) => m.point[0] - sx * m.pos.x))
        : center(bodyBox)[0] - sx * (bounds.x + bounds.width / 2);
    const oy =
      matches.length >= 3
        ? median(matches.map((m) => m.point[1] - sy * m.pos.y))
        : center(bodyBox)[1] - sy * (bounds.y + bounds.height / 2);
    return {
      sx,
      sy,
      ox,
      oy,
      residual: median(
        matches.map((m) =>
          Math.hypot(m.point[0] - sx * m.pos.x - ox, m.point[1] - sy * m.pos.y - oy),
        ),
      ),
    };
  });
  const chosen =
    matches.length >= 3 ? frames.toSorted((a, b) => a.residual - b.residual)[0]! : frames[0]!;
  const frame = { ...chosen, mirrored: chosen.sx === chosen.sy, matched: matches.length };
  if (frame.mirrored)
    warnings.push("The drawing frame is mirrored; the 3D board is used for fit checks.");
  if (matches.length < 3)
    warnings.push(
      "Fewer than three model references matched; the board frame uses centred drawing bounds.",
    );
  const point = (p: { x: number; y: number }): [number, number] => [
    frame.sx * p.x + frame.ox,
    frame.sy * p.y + frame.oy,
  ];
  const source = metadata.outline ?? {
    source: "bounds" as const,
    outer: 0,
    loops: [
      [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ],
    ],
  };
  if (!source.loops[source.outer] || source.loops.some((l) => l.length < 3))
    throw new Error("The board reference has an invalid outline.");
  const loops = source.loops.map((l) => {
    const mapped = l.map(point);
    let area = 0;
    for (let i = 0; i < mapped.length; i++) {
      const a = mapped[i]!,
        b = mapped[(i + 1) % mapped.length]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    return area < 0 ? mapped.toReversed() : mapped;
  });
  const candidates = metadata.mountingHoles
    .flatMap((h) => {
      const [x, y] = point(h);
      return /MountingHole/i.test(h.footprint) ||
        (h.diameter >= 2 &&
          !parts.some(
            (p) => x >= p.box.min[0] && x <= p.box.max[0] && y >= p.box.min[1] && y <= p.box.max[1],
          ))
        ? [{ x, y, diameter: h.diameter, footprint: h.footprint }]
        : [];
    })
    .toSorted((a, b) => b.diameter - a.diameter);
  if (candidates.length > ENCLOSURE_MAX_HOLES)
    warnings.push("Mounting holes were limited to the largest 32.");
  let assumed = 0;
  for (const c of metadata.components)
    if (
      c.position &&
      !parts.some((p) => p.reference === c.reference) &&
      !/^(H|MH|FID|TP|G|LOGO|NT|#)/i.test(c.reference) &&
      options.assumedHeightMm > 0
    ) {
      const [x, y] = point(c.position);
      parts.push({
        reference: c.reference,
        side: "front",
        box: {
          min: [x - 2.5, y - 2.5, bodyBox.max[2]],
          max: [x + 2.5, y + 2.5, bodyBox.max[2] + options.assumedHeightMm],
        },
        assumed: true,
      });
      assumed++;
    }
  if (assumed) warnings.push(`${assumed} components have no model; their height is assumed.`);
  const connectors = parts
    .flatMap((p) => {
      const ref = p.reference;
      if (p.assumed || !ref || options.connectors.exclude.includes(ref)) return [];
      const meta = refs.get(ref);
      if (
        !options.connectors.include.includes(ref) &&
        !/^(J|P|CN|USB|X)\d/i.test(ref) &&
        !/connector|usb|jack|header|terminal|barrel|rj45|sma|jst|molex/i.test(meta?.footprint ?? "")
      )
        return [];
      const c = center(p.box),
        edge = nearestEdge(loops[source.outer]!, [c[0], c[1]]),
        reach =
          (Math.abs(edge.normal[0]) * (p.box.max[0] - p.box.min[0])) / 2 +
          (Math.abs(edge.normal[1]) * (p.box.max[1] - p.box.min[1])) / 2;
      const edgeMm = edge.distance - reach;
      return edgeMm <= options.edgeMarginMm
        ? [{ reference: ref, box: p.box, facing: edge.facing, edgeMm }]
        : [];
    })
    .toSorted((a, b) => a.edgeMm - b.edgeMm);
  if (connectors.length > ENCLOSURE_MAX_CONNECTORS)
    warnings.push("Edge connectors were limited to the nearest 16.");
  return {
    revision: metadata.sourceHash,
    kind,
    frame,
    body: { top: bodyBox.max[2], bottom: bodyBox.min[2], box: bodyBox },
    outline: { loops, outer: source.outer, source: source.source },
    holes: candidates.slice(0, ENCLOSURE_MAX_HOLES),
    parts,
    connectors: connectors.slice(0, ENCLOSURE_MAX_CONNECTORS),
    warnings,
  };
}
