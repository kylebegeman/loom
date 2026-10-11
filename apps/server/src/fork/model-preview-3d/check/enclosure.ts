import {
  ENCLOSURE_MAX_FINDINGS,
  type EnclosureFinding,
  type EnclosureReport,
  type EnclosureRequirements,
  type AssemblyPairResult,
} from "@t3tools/contracts/fork";
import {
  center,
  facingVector,
  median,
  type BoardFeatures,
  type Facing,
} from "../../pcb-preview/enclosure/features.ts";
import { normal, type IndexedMesh, type Vec3 } from "./mesh.ts";
import { buildGrid, raycast } from "./grid.ts";
import { topologyOf } from "./topology.ts";
export type EnclosureRequest = {
  board: string;
  caseParts: readonly string[];
  features: BoardFeatures;
  requirements: EnclosureRequirements;
};
const MAX_RAYS = 70_000;
/** Feature rays share the assembly meshes and run under its worker timeout and permit. */
export function checkEnclosure(
  input: EnclosureRequest,
  matrix: readonly number[],
  meshes: ReadonlyMap<string, IndexedMesh>,
  pairs: readonly AssemblyPairResult[],
): EnclosureReport {
  const { features: f, requirements: r } = input,
    findings: EnclosureFinding[] = [],
    warnings = [...f.warnings];
  const cases = input.caseParts.flatMap((id) => {
    const mesh = meshes.get(id);
    if (!mesh) return [];
    const topology = topologyOf(mesh);
    return [{ id, grid: buildGrid(mesh), closed: topology.watertight, topology }];
  });
  let rays = 0,
    complete = cases.length === input.caseParts.length;
  const transform = (p: Vec3, direction = false): [number, number, number] =>
    [0, 1, 2].map(
      (a) =>
        matrix[a]! * p[0] +
        matrix[a + 4]! * p[1] +
        matrix[a + 8]! * p[2] +
        (direction ? 0 : matrix[a + 12]!),
    ) as [number, number, number];
  const cast = (p: Vec3, d: Vec3, max: number) => {
    if (++rays > MAX_RAYS) {
      complete = false;
      return null;
    }
    const direction = transform(d, true),
      rawOrigin = transform(p),
      o: Vec3 = [
        rawOrigin[0] - direction[0] * 0.0001,
        rawOrigin[1] - direction[1] * 0.0001,
        rawOrigin[2] - direction[2] * 0.0001,
      ];
    let best: { gap: number; inside: boolean; unchecked: boolean } | null = null;
    for (const part of cases) {
      const hit = raycast(part.grid, o, direction, max);
      if (!hit || (best && hit.distance >= best.gap)) continue;
      const n = normal(part.grid.mesh, hit.triangle),
        shell = part.topology.shells[part.topology.triangleShell[hit.triangle]!]!;
      // Closed shells may be consistently wound inward. Signed volume determines outward normals.
      const dot = n.reduce((sum, v, a) => sum + v * direction[a]!, 0) * (shell.volume < 0 ? -1 : 1);
      best = {
        gap: Math.max(0, hit.distance - 0.0001),
        inside: dot > 1e-8,
        unchecked: !part.closed,
      };
    }
    return best;
  };
  const result = (
    id: string,
    kind: EnclosureFinding["kind"],
    label: string,
    point: Vec3,
    hit: ReturnType<typeof cast>,
    required: number,
    missing: string,
  ): EnclosureFinding => ({
    id,
    kind,
    label,
    point: transform(point),
    status:
      !hit || hit.unchecked
        ? "unchecked"
        : hit.inside
          ? "interferes"
          : hit.gap + 1e-5 < required
            ? "tight"
            : "ok",
    detail: !hit
      ? missing
      : hit.unchecked
        ? "The case mesh is open or has inconsistent winding."
        : hit.inside
          ? "The feature starts inside the case."
          : `Clearance ${hit.gap.toFixed(2)} mm; required ${required.toFixed(2)} mm.`,
    measuredMm: hit?.gap ?? null,
    requiredMm: required,
  });
  const loop = f.outline.loops[f.outline.outer]!,
    lengths = loop.map((a, i) => {
      const b = loop[(i + 1) % loop.length]!;
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    }),
    perimeter = lengths.reduce((s, v) => s + v, 0),
    step = Math.max(1, perimeter / 2000);
  const walls = new Map<Facing, { point: Vec3; hit: ReturnType<typeof cast> }>();
  for (const side of ["+x", "-x", "+y", "-y"] as const)
    walls.set(side, { point: center(f.body.box), hit: null });
  // Uniform perimeter samples, independent of how many chords describe an arc.
  let segment = 0,
    base = 0;
  for (let distance = step / 2; distance < perimeter; distance += step) {
    if (rays >= MAX_RAYS) {
      complete = false;
      break;
    }
    while (segment < loop.length - 1 && distance > base + lengths[segment]!) {
      base += lengths[segment]!;
      segment++;
    }
    const a = loop[segment]!,
      b = loop[(segment + 1) % loop.length]!,
      len = lengths[segment]!;
    if (!len) continue;
    const t = (distance - base) / len,
      dx = (b[0] - a[0]) / len,
      dy = (b[1] - a[1]) / len,
      side: Facing = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "+x" : "-x") : dx > 0 ? "-y" : "+y";
    for (const z of [f.body.bottom, (f.body.top + f.body.bottom) / 2, f.body.top]) {
      const point: Vec3 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), z],
        hit = cast(point, [dy, -dx, 0], 50),
        old = walls.get(side)!;
      if (hit && (!old.hit || (hit.inside && !hit.unchecked) || hit.gap < old.hit.gap))
        walls.set(side, { point, hit });
    }
  }
  for (const [side, w] of walls)
    findings.push(
      result(
        `wall:${side}`,
        "wall",
        `Wall, ${side.toUpperCase()} side`,
        w.point,
        w.hit,
        r.wallGapMm,
        "No wall found within 50 mm.",
      ),
    );
  for (const side of ["front", "back"] as const) {
    const kind = side === "front" ? "above" : "below",
      dir: Vec3 = side === "front" ? [0, 0, 1] : [0, 0, -1],
      required = side === "front" ? r.lidGapMm : r.floorGapMm;
    let worst: EnclosureFinding | null = null;
    const parts = f.parts.filter((p) => !p.assumed && p.side === side).slice(0, 300);
    if (f.parts.filter((p) => !p.assumed && p.side === side).length > 300) complete = false;
    const boxes = parts.length ? parts : [{ reference: null, box: f.body.box }];
    for (const p of boxes) {
      const c = center(p.box),
        z = side === "front" ? p.box.max[2] : p.box.min[2],
        points: Vec3[] = [[c[0], c[1], z]];
      for (const x of [0.1, 0.9])
        for (const y of [0.1, 0.9])
          points.push([
            p.box.min[0] + x * (p.box.max[0] - p.box.min[0]),
            p.box.min[1] + y * (p.box.max[1] - p.box.min[1]),
            z,
          ]);
      let nearest: ReturnType<typeof cast> = null,
        at = points[0]!;
      for (const point of points) {
        const hit = cast(point, dir, 200);
        if (hit && (!nearest || (hit.inside && !hit.unchecked) || hit.gap < nearest.gap)) {
          nearest = hit;
          at = point;
        }
      }
      const finding = result(
        `${kind}:${p.reference ?? "board"}`,
        kind,
        `${p.reference ?? "Board"} ${kind} clearance`,
        at,
        nearest,
        required,
        side === "front" ? "No lid found above the board." : "No floor found below the board.",
      );
      if (p.reference && finding.status !== "ok") findings.push(finding);
      if (
        !worst ||
        finding.status === "interferes" ||
        (finding.measuredMm !== null &&
          (worst.measuredMm === null || finding.measuredMm < worst.measuredMm))
      )
        worst = finding;
    }
    if (worst)
      findings.push({
        ...worst,
        id: `${kind}:summary`,
        label: side === "front" ? "Lid clearance" : "Floor clearance",
      });
  }
  for (const c of f.connectors) {
    const d = facingVector(c.facing),
      axis = d[0] ? 0 : 1,
      cross = axis === 0 ? 1 : 0,
      sign = d[axis]!,
      face = sign > 0 ? c.box.max[axis]! : c.box.min[axis]!,
      margin = r.connectorMarginMm;
    let core = 0,
      blocked = 0,
      clear = 0,
      unchecked = false;
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 5; j++) {
        const u =
            c.box.min[cross]! -
            margin +
            (i * (c.box.max[cross]! - c.box.min[cross]! + 2 * margin)) / 6,
          z = c.box.min[2] - margin + (j * (c.box.max[2] - c.box.min[2] + 2 * margin)) / 4,
          p: [number, number, number] = [0, 0, z];
        p[axis] = face;
        p[cross] = u;
        const hit = cast(p, d, 30);
        if (hit) {
          unchecked ||= hit.unchecked;
          blocked++;
          if (
            u >= c.box.min[cross]! &&
            u <= c.box.max[cross]! &&
            z >= c.box.min[2] &&
            z <= c.box.max[2]
          )
            core++;
        } else clear++;
      }
    let setback: number | null = null;
    for (let i = 0; i < 8; i++) {
      const p = center(c.box);
      p[axis] = face;
      p[cross] = i < 4 ? c.box.min[cross]! - margin - 1 : c.box.max[cross]! + margin + 1;
      p[2] = c.box.min[2] + (((i % 4) + 0.5) * (c.box.max[2] - c.box.min[2])) / 4;
      const hit = cast(p, d, 30);
      if (hit && !hit.unchecked) setback = Math.min(setback ?? Infinity, hit.gap);
    }
    findings.push({
      id: `connector:${c.reference}`,
      kind: "connector",
      label: `${c.reference} opening`,
      status: unchecked ? "unchecked" : core ? "interferes" : blocked ? "tight" : "ok",
      detail: unchecked
        ? "The case mesh is open or has inconsistent winding."
        : core
          ? `${c.reference} opening is blocked by the case.`
          : blocked
            ? `${c.reference} opening is narrower than the margin.`
            : "The connector opening is clear.",
      measuredMm: null,
      requiredMm: margin,
      point: transform(center(c.box)),
      connector: { openFraction: clear / 35, setbackMm: setback, facing: c.facing },
    });
  }
  const holeMoves: {
    state: string;
    gap: number;
    depth: number;
    offset: [number, number] | null;
  }[] = [];
  for (const [index, h] of f.holes.entries()) {
    const p: Vec3 = [h.x, h.y, f.body.bottom],
      ring: ReturnType<typeof cast>[] = [];
    const central = cast(p, [0, 0, -1], 20);
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6,
        rad = h.diameter / 2 + 0.6;
      ring.push(
        cast([h.x + Math.cos(a) * rad, h.y + Math.sin(a) * rad, f.body.bottom], [0, 0, -1], 20),
      );
    }
    const hits = ring.filter((v): v is NonNullable<typeof v> => !!v),
      gap = hits.length ? Math.min(...hits.map((v) => v.gap)) : 0;
    let state: NonNullable<EnclosureFinding["hole"]>["state"] = "seated",
      offset: [number, number] | null = null,
      depth = 0;
    const unchecked = hits.some((v) => v.unchecked) || central?.unchecked;
    if (hits.some((v) => v.inside) || central?.inside) {
      state = "inside";
      const up = cast([h.x, h.y, f.body.bottom - 5], [0, 0, 1], 20);
      depth = up ? Math.max(0, up.gap - 5) : gap;
    } else if (!hits.length) state = "missing";
    else if (hits.length < 12 || Math.max(...hits.map((v) => v.gap)) - gap > 0.3) {
      state = "off-centre";
      const points: [number, number][] = [];
      for (let dx = -6; dx <= 6; dx += 0.25)
        for (let dy = -6; dy <= 6; dy += 0.25) {
          if (dx * dx + dy * dy > 36) continue;
          const hit = cast([h.x + dx, h.y + dy, f.body.bottom], [0, 0, -1], 20);
          if (hit && !hit.inside && !hit.unchecked && Math.abs(hit.gap - gap) <= 0.3)
            points.push([dx, dy]);
        }
      if (points.length)
        offset = [
          points.reduce((s, v) => s + v[0], 0) / points.length,
          points.reduce((s, v) => s + v[1], 0) / points.length,
        ];
    } else if (gap > r.standoffToleranceMm) state = "gap";
    else if (central && Math.abs(central.gap - gap) <= 0.3) state = "solid";
    holeMoves.push({ state, gap, depth, offset });
    findings.push({
      id: `hole:${index + 1}`,
      kind: "hole",
      label: `Mounting hole ${index + 1}`,
      status: unchecked
        ? "unchecked"
        : state === "inside"
          ? "interferes"
          : state === "solid" || state === "seated"
            ? "ok"
            : "tight",
      detail: unchecked
        ? "The case mesh is open or has inconsistent winding."
        : state === "missing"
          ? `No standoff under hole ${index + 1}.`
          : state === "off-centre"
            ? "The standoff is off centre."
            : state === "inside"
              ? "The standoff extends into the board."
              : state === "gap"
                ? "The board is above the standoff."
                : state === "solid"
                  ? "The board is seated on a solid boss without a pilot hole."
                  : "The board is seated on the standoff.",
      measuredMm: state === "inside" ? -depth : state === "missing" ? null : gap,
      requiredMm: r.standoffToleranceMm,
      point: transform(p),
      hole: { state, offsetMm: offset },
    });
  }
  for (const pair of pairs) {
    const other = pair.a === input.board ? pair.b : pair.b === input.board ? pair.a : null;
    if (
      !other ||
      !input.caseParts.includes(other) ||
      (pair.status !== "intersects" && pair.status !== "inside")
    )
      continue;
    const part = cases.find((c) => c.id === other);
    if (!part?.closed) continue;
    findings.push({
      id: `pair:${other}`,
      kind: "interference",
      label: `Board and ${other}`,
      status: "interferes",
      detail: "The board intersects this case part.",
      measuredMm: null,
      requiredMm: null,
      point: pair.regions[0]?.point ?? transform(center(f.body.box)),
    });
  }
  let move: [number, number, number] = [0, 0, 0],
    hasMove = false;
  if (holeMoves.length && !holeMoves.some((h) => h.state === "missing")) {
    const offsets = holeMoves
      .filter((h) => h.state === "off-centre" && h.offset)
      .map((h) => h.offset!);
    if (offsets.length) {
      const x = median(offsets.map((v) => v[0])),
        y = median(offsets.map((v) => v[1]));
      if (
        offsets.filter((v) => Math.hypot(v[0] - x, v[1] - y) <= 0.3).length >=
        Math.ceil(holeMoves.length / 2)
      ) {
        move = [x, y, 0];
        hasMove = true;
      }
    }
    if (holeMoves.every((h) => h.state === "gap")) {
      move[2] = -median(holeMoves.map((h) => h.gap));
      hasMove = true;
    } else if (holeMoves.every((h) => h.state === "inside")) {
      move[2] = median(holeMoves.map((h) => h.depth));
      hasMove = true;
    }
  }
  if (cases.some((c) => !c.closed))
    warnings.push("Open case meshes cannot prove enclosure interference.");
  if (!cases.length) warnings.push("No case geometry was available for enclosure checks.");
  const priority = { interferes: 0, tight: 1, unchecked: 2, ok: 3 };
  findings.sort((a, b) => priority[a.status] - priority[b.status] || a.id.localeCompare(b.id));
  if (findings.length > ENCLOSURE_MAX_FINDINGS) complete = false;
  return {
    board: input.board,
    boardRevision: f.revision,
    status: findings.some((v) => v.status === "interferes")
      ? "interferes"
      : findings.some((v) => v.status === "tight")
        ? "tight"
        : !complete
          ? "incomplete"
          : "fits",
    frame: { mirrored: f.frame.mirrored, matchedParts: f.frame.matched },
    findings: findings.slice(0, ENCLOSURE_MAX_FINDINGS),
    suggestedMove: hasMove ? transform(move, true) : null,
    warnings: warnings.slice(0, 20),
    complete,
  };
}
