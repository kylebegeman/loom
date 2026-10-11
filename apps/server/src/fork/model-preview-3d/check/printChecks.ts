import type { PrintFinding } from "@t3tools/contracts/fork";
import {
  center,
  inverseQuaternion,
  normal,
  rotatePoint,
  unionFind,
  vertex,
  type IndexedMesh,
  type Quaternion,
  type Vec3,
} from "./mesh.ts";
import { edgeClass, topologyOf, type Topology } from "./topology.ts";
import { buildGrid, raycast } from "./grid.ts";
import type { CheckRequest, PrintCheckCore } from "./protocol.ts";
const IDS = [
  "mesh",
  "shells",
  "bed-fit",
  "first-layer",
  "overhangs",
  "islands",
  "walls",
  "small-features",
] as const;
const percentile = (values: number[], quantile: number) =>
  values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) * quantile)] ?? null;
const boundsCenter = (min: Vec3, max: Vec3): Vec3 => [
  (min[0] + max[0]) / 2,
  (min[1] + max[1]) / 2,
  (min[2] + max[2]) / 2,
];
const extent = (min: Vec3, max: Vec3): Vec3 => [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
const hullWidth = (points: Vec3[]) => {
  const sorted = points
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((p, i, a) => i === 0 || p[0] !== a[i - 1]![0] || p[1] !== a[i - 1]![1]);
  const cross = (a: Vec3, b: Vec3, c: Vec3) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list: Vec3[]) => {
    const result: Vec3[] = [];
    for (const p of list) {
      while (result.length >= 2 && cross(result[result.length - 2]!, result.at(-1)!, p) <= 0)
        result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  };
  const hull = [...half(sorted), ...half(sorted.toReversed())];
  if (hull.length < 3) return 0;
  let width = Infinity,
    opposite = 1;
  // Convex polygon antipodes advance monotonically: O(n) after the hull sort.
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!,
      b = hull[(i + 1) % hull.length]!,
      distance = (j: number) => Math.abs(cross(a, b, hull[j]!));
    while (distance((opposite + 1) % hull.length) > distance(opposite) + 1e-12)
      opposite = (opposite + 1) % hull.length;
    width = Math.min(width, distance(opposite) / Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return width;
};
const randomSource = (seed: number) => {
  let a = seed | 0,
    b = seed ^ 0x9e3779b9,
    c = seed ^ 0x243f6a88,
    d = 1;
  return () => {
    const t = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
};
/** Checks use the oriented frame; every pin is returned in the mesh's original frame. */
export const runPrintChecks = (
  mesh: IndexedMesh,
  params: CheckRequest["params"],
  seed: number,
  budgetMs = 15000,
  orientation: Quaternion | null = null,
): PrintCheckCore => {
  const started = performance.now(),
    stages: { name: string; ms: number }[] = [],
    findings: PrintFinding[] = [],
    summaries = new Map<string, string>(),
    overrides = new Map<string, "info" | "skipped">(),
    inverse = inverseQuaternion(orientation);
  const totals = new Map<string, number>(),
    emitted = new Map<string, number>();
  let truncated = false;
  const add = (
    check: PrintFinding["check"],
    code: PrintFinding["code"],
    severity: PrintFinding["severity"],
    message: string,
    value: number | null = null,
    limit: number | null = null,
    unit: PrintFinding["unit"] = null,
    point: Vec3 | null = null,
    n: Vec3 | null = null,
    radiusMm = 2,
  ) => {
    totals.set(check, (totals.get(check) ?? 0) + 1);
    const count = (emitted.get(code) ?? 0) + 1;
    emitted.set(code, count);
    const cap = code === "INVERTED_SHELL" ? 10 : code === "FEATURE_BELOW_NOZZLE" ? 20 : Infinity;
    if (count > cap) {
      truncated = true;
      return;
    }
    findings.push({
      id: "",
      check,
      code,
      severity,
      message,
      value,
      limit,
      unit,
      location: point
        ? {
            point: rotatePoint(point, inverse),
            normal: n ? rotatePoint(n, inverse) : null,
            radiusMm,
          }
        : null,
    });
  };
  const timed = <A>(name: string, operation: () => A): A => {
    const at = performance.now(),
      value = operation();
    stages.push({ name, ms: performance.now() - at });
    return value;
  };
  const topology = timed("topology", () => topologyOf(mesh)),
    size = extent(mesh.bounds.min, mesh.bounds.max),
    triangleCount = mesh.triangles.length / 3,
    surface = mesh.areas.reduce((sum, a) => sum + a, 0),
    z0 = mesh.bounds.min[2];
  let lowestVertex = 0;
  for (let i = 1; i < mesh.vertices.length / 3; i++)
    if (mesh.vertices[i * 3 + 2]! < mesh.vertices[lowestVertex * 3 + 2]!) lowestVertex = i;
  const low: Vec3 = mesh.vertices.length ? vertex(mesh, lowestVertex) : [0, 0, 0];
  if (!triangleCount) add("mesh", "EMPTY_GEOMETRY", "fail", "This file has no printable geometry.");
  if (mesh.degenerate)
    add(
      "mesh",
      "DEGENERATE_TRIANGLES",
      "info",
      `${mesh.degenerate} degenerate triangles were ignored.`,
      mesh.degenerate,
      null,
      "count",
    );
  const edgeGroups = (kind: "open" | "flipped" | "non-manifold", count: number) => {
    if (!count) return;
    const uf = unionFind(topology.vertices),
      slots: number[] = [];
    for (let s = 0; s < topology.keys.length; s++)
      if (topology.counts[s] && edgeClass(topology, s) === kind) {
        const a = Math.floor(topology.keys[s]! / topology.vertices),
          b = topology.keys[s]! % topology.vertices;
        uf.join(a, b);
        slots.push(s);
      }
    const groups = new Map<
      number,
      { min: number[]; max: number[]; sum: number[]; slots: number[]; length: number }
    >();
    for (const s of slots) {
      const a = vertex(mesh, Math.floor(topology.keys[s]! / topology.vertices)),
        b = vertex(mesh, topology.keys[s]! % topology.vertices),
        root = uf.find(Math.floor(topology.keys[s]! / topology.vertices));
      let g = groups.get(root);
      if (!g) {
        g = {
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
          sum: [0, 0, 0],
          slots: [],
          length: 0,
        };
        groups.set(root, g);
      }
      g.slots.push(s);
      g.length += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      for (let k = 0; k < 3; k++) {
        g.min[k] = Math.min(g.min[k]!, a[k]!, b[k]!);
        g.max[k] = Math.max(g.max[k]!, a[k]!, b[k]!);
        g.sum[k] = g.sum[k]! + (a[k]! + b[k]!) / 2;
      }
    }
    for (const g of [...groups.values()].toSorted((a, b) => b.length - a.length).slice(0, 5)) {
      const centroid = g.sum.map((n) => n / g.slots.length);
      let nearest: Vec3 = low,
        distance = Infinity;
      for (const s of g.slots) {
        const a = vertex(mesh, Math.floor(topology.keys[s]! / topology.vertices)),
          b = vertex(mesh, topology.keys[s]! % topology.vertices),
          p: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
          d = Math.hypot(p[0] - centroid[0]!, p[1] - centroid[1]!, p[2] - centroid[2]!);
        if (d < distance) {
          distance = d;
          nearest = p;
        }
      }
      add(
        "mesh",
        kind === "open"
          ? "OPEN_EDGES"
          : kind === "flipped"
            ? "FLIPPED_FACES"
            : "NON_MANIFOLD_EDGES",
        "warn",
        `${g.slots.length} ${kind} edges.`,
        g.slots.length,
        null,
        "count",
        nearest,
        null,
        Math.hypot(g.max[0]! - g.min[0]!, g.max[1]! - g.min[1]!, g.max[2]! - g.min[2]!) / 2,
      );
    }
  };
  timed("mesh", () => {
    edgeGroups("open", topology.open);
    edgeGroups("flipped", topology.flipped);
    edgeGroups("non-manifold", topology.nonManifold);
    for (const shell of topology.shells)
      if (shell.closed && shell.volume < 0)
        add(
          "mesh",
          "INVERTED_SHELL",
          "warn",
          "Faces point inward.",
          shell.volume,
          null,
          "mm3",
          shell.min,
        );
  });
  summaries.set(
    "mesh",
    topology.watertight
      ? "Watertight"
      : `Not watertight: ${topology.open} open, ${topology.nonManifold} non-manifold and ${topology.flipped} flipped edges`,
  );
  if (topology.shells.length > 1)
    add(
      "shells",
      "MULTIPLE_SHELLS",
      "info",
      `${topology.shells.length} separate bodies.`,
      topology.shells.length,
      null,
      "count",
    );
  summaries.set(
    "shells",
    `${topology.shells.length} ${topology.shells.length === 1 ? "body" : "separate bodies"}`,
  );
  let contactArea = 0,
    overhangArea = 0;
  const contact: Vec3[] = [],
    overhang = new Uint8Array(triangleCount),
    overhangUf = unionFind(triangleCount);
  timed("contact", () => {
    for (let t = 0; t < triangleCount; t++) {
      const n = normal(mesh, t),
        points = [
          vertex(mesh, mesh.triangles[t * 3]!),
          vertex(mesh, mesh.triangles[t * 3 + 1]!),
          vertex(mesh, mesh.triangles[t * 3 + 2]!),
        ];
      if (n[2] < -Math.cos((5 * Math.PI) / 180) && points.every((p) => p[2] <= z0 + 0.05)) {
        contactArea += mesh.areas[t]!;
        contact.push(...points);
      }
      if (
        n[2] < -Math.sin((params.overhangAngleDegrees * Math.PI) / 180) &&
        center(mesh, t)[2] > z0 + params.firstLayerMm
      ) {
        overhang[t] = 1;
        overhangArea += mesh.areas[t]!;
      }
    }
  });
  const width = hullWidth(contact);
  if (contactArea < 1 && triangleCount)
    add(
      "first-layer",
      "SMALL_BED_CONTACT",
      "fail",
      `Rests on a point or edge (${contactArea.toFixed(1)} mm² on the bed).`,
      contactArea,
      1,
      "mm2",
      low,
      [0, 0, -1],
    );
  else if (width > 0 && size[2] / width > 8)
    add(
      "first-layer",
      "TALL_THIN",
      "warn",
      `Tall and narrow on the bed (${size[2].toFixed(1)} mm tall on a ${width.toFixed(1)} mm footprint); it may tip or wobble.`,
      size[2] / width,
      8,
      "ratio",
      [mesh.bounds.min[0] + size[0] / 2, mesh.bounds.min[1] + size[1] / 2, z0],
    );
  summaries.set("first-layer", `${contactArea.toFixed(1)} mm² on the bed`);
  timed("overhangs", () => {
    for (let s = 0; s < topology.keys.length; s++)
      if (topology.counts[s]! >= 2 && overhang[topology.first[s]!] && overhang[topology.second[s]!])
        overhangUf.join(topology.first[s]!, topology.second[s]!);
    const regions = new Map<number, { area: number; point: number[]; tris: number[] }>();
    for (let t = 0; t < triangleCount; t++)
      if (overhang[t]) {
        const id = overhangUf.find(t),
          area = mesh.areas[t]!,
          p = center(mesh, t);
        let r = regions.get(id);
        if (!r) {
          r = { area: 0, point: [0, 0, 0], tris: [] };
          regions.set(id, r);
        }
        r.area += area;
        r.tris.push(t);
        for (let k = 0; k < 3; k++) r.point[k] = r.point[k]! + p[k]! * area;
      }
    for (const r of [...regions.values()]
      .filter((r) => r.area >= 5)
      .toSorted((a, b) => b.area - a.area)
      .slice(0, 10)) {
      const c = r.point.map((n) => n / r.area);
      let near = r.tris[0]!,
        distance = Infinity;
      for (const t of r.tris) {
        const p = center(mesh, t),
          d = Math.hypot(p[0] - c[0]!, p[1] - c[1]!, p[2] - c[2]!);
        if (d < distance) {
          near = t;
          distance = d;
        }
      }
      add(
        "overhangs",
        "OVERHANG_AREA",
        "warn",
        `${r.area.toFixed(1)} mm² may need supports.`,
        r.area,
        5,
        "mm2",
        center(mesh, near),
        normal(mesh, near),
        Math.max(2, Math.sqrt(r.area / Math.PI)),
      );
    }
  });
  summaries.set(
    "overhangs",
    `${overhangArea.toFixed(1)} mm² beyond ${params.overhangAngleDegrees} degrees`,
  );
  if (overhangArea > 0 && overhangArea < 5) overrides.set("overhangs", "info");
  timed("islands", () => findIslands(mesh, topology, z0, params.firstLayerMm, add));
  const grid = triangleCount ? timed("grid", () => buildGrid(mesh)) : null;
  if (grid)
    timed("shells", () => {
      for (let id = 0; id < Math.min(topology.shells.length, 200); id++) {
        const shell = topology.shells[id]!;
        if (!shell.closed) continue;
        const origin: Vec3 = [
          shell.min[0],
          shell.min[1] + (shell.max[1] - shell.min[1]) * 0.517,
          shell.max[2] - 1e-6,
        ];
        let p = origin,
          crossings = 0;
        for (let crossing = 0; crossing < 1000; crossing++) {
          const hit = raycast(grid, p, [1, 0, 0], Math.max(...size) + 1, -1, {
            accept: (t) =>
              topology.triangleShell[t] !== id &&
              topology.shells[topology.triangleShell[t]!]!.closed,
          });
          if (!hit) break;
          crossings++;
          p = [hit.point[0] + 1e-5, hit.point[1], hit.point[2]];
        }
        if (crossings % 2)
          add(
            "shells",
            "INTERNAL_SHELL",
            "warn",
            "A body sits inside another; slicers merge or drop it.",
            null,
            null,
            null,
            boundsCenter(shell.min, shell.max),
          );
      }
    });
  let samples = 0,
    incomplete = false;
  const thicknesses: number[] = [],
    thin: { point: Vec3; normal: Vec3; thickness: number }[] = [],
    target = Math.min(20000, Math.max(2000, Math.round(surface / params.nozzleMm ** 2))),
    minWall = 2 * params.nozzleMm;
  timed("walls", () => {
    if (!grid) return;
    const cumulative = new Float64Array(triangleCount);
    let cumulativeArea = 0;
    for (let t = 0; t < triangleCount; t++) cumulative[t] = cumulativeArea += mesh.areas[t]!;
    const random = randomSource(seed),
      at = performance.now();
    for (let i = 0; i < target; i++) {
      if (i % 64 === 0 && performance.now() - at >= budgetMs) {
        incomplete = true;
        break;
      }
      samples++;
      const pick = random() * surface;
      let lo = 0,
        hi = triangleCount - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cumulative[mid]! < pick) lo = mid + 1;
        else hi = mid;
      }
      const t = lo,
        a = vertex(mesh, mesh.triangles[t * 3]!),
        b = vertex(mesh, mesh.triangles[t * 3 + 1]!),
        c = vertex(mesh, mesh.triangles[t * 3 + 2]!),
        n = normal(mesh, t),
        u = Math.sqrt(random()),
        v = random(),
        p: Vec3 = [
          a[0] * (1 - u) + b[0] * u * (1 - v) + c[0] * u * v,
          a[1] * (1 - u) + b[1] * u * (1 - v) + c[1] * u * v,
          a[2] * (1 - u) + b[2] * u * (1 - v) + c[2] * u * v,
        ],
        direction: Vec3 = [-n[0], -n[1], -n[2]],
        origin: Vec3 = [p[0] - n[0] * 1e-4, p[1] - n[1] * 1e-4, p[2] - n[2] * 1e-4],
        hit = raycast(grid, origin, direction, 2 * minWall, t);
      if (!hit) continue;
      const hn = normal(mesh, hit.triangle);
      if (hn[0] * direction[0] + hn[1] * direction[1] + hn[2] * direction[2] < 0.5) continue;
      const thickness = hit.distance + 1e-4;
      thicknesses.push(thickness);
      if (thickness < minWall) thin.push({ point: p, normal: n, thickness });
    }
    clusterThin(thin, target, surface, minWall, params.nozzleMm, add);
  });
  for (const shell of topology.shells) {
    const dims = extent(shell.min, shell.max),
      largest = Math.max(...dims);
    if (largest < params.nozzleMm)
      add(
        "small-features",
        "FEATURE_BELOW_NOZZLE",
        "fail",
        `A ${largest.toFixed(1)} mm fragment is smaller than the nozzle.`,
        largest,
        params.nozzleMm,
        "mm",
        boundsCenter(shell.min, shell.max),
      );
  }
  const minimum = percentile(thicknesses, 0.01),
    approx = topology.watertight ? "" : " (approximate: the mesh is open)";
  summaries.set(
    "walls",
    incomplete
      ? `Partly checked (${samples.toLocaleString("en-US")} of ${target.toLocaleString("en-US")} samples)${approx}`
      : minimum === null
        ? `No walls below ${(2 * minWall).toFixed(1)} mm found${approx}`
        : `Thinnest wall ${minimum.toFixed(2)} mm (needs ${minWall.toFixed(2)} mm)${approx}`,
  );
  summaries.set(
    "small-features",
    incomplete
      ? `Partly checked (${samples.toLocaleString("en-US")} of ${target.toLocaleString("en-US")} samples)`
      : `Minimum feature ${minimum?.toFixed(2) ?? "not sampled"} mm; nozzle ${params.nozzleMm.toFixed(1)} mm`,
  );
  return {
    status: incomplete ? "incomplete" : "complete",
    truncated,
    summary: {
      triangles: triangleCount,
      vertices: mesh.vertices.length / 3,
      shells: topology.shells.length,
      watertight: topology.watertight,
      volumeMm3: topology.volume,
      surfaceAreaMm2: surface,
      sizeMm: size,
      contactAreaMm2: contactArea,
      overhangAreaMm2: overhangArea,
      minThicknessMm: minimum,
      thicknessSamples: samples,
    },
    orientation,
    modelCenter: rotatePoint(boundsCenter(mesh.bounds.min, mesh.bounds.max), inverse),
    findings,
    checks: IDS.map((check) => {
      const own = findings.filter((f) => f.check === check);
      return {
        check,
        status: own.some((f) => f.severity === "fail")
          ? "fail"
          : own.some((f) => f.severity === "warn")
            ? "warn"
            : own.length
              ? "info"
              : (overrides.get(check) ?? (check === "bed-fit" ? "skipped" : "pass")),
        summary:
          summaries.get(check) ??
          (check === "islands" ? "No unsupported starts" : "No issues found"),
        findings: totals.get(check) ?? 0,
      };
    }),
    stages,
    durationMs: performance.now() - started,
  };
};
type Add = (
  check: PrintFinding["check"],
  code: PrintFinding["code"],
  severity: PrintFinding["severity"],
  message: string,
  value?: number | null,
  limit?: number | null,
  unit?: PrintFinding["unit"],
  point?: Vec3 | null,
  n?: Vec3 | null,
  radiusMm?: number,
) => unknown;
const findIslands = (
  mesh: IndexedMesh,
  topology: Topology,
  z0: number,
  layer: number,
  add: Add,
) => {
  const count = mesh.vertices.length / 3,
    uf = unionFind(count);
  for (let s = 0; s < topology.keys.length; s++)
    if (topology.counts[s]) {
      const a = Math.floor(topology.keys[s]! / count),
        b = topology.keys[s]! % count;
      if (Math.abs(mesh.vertices[a * 3 + 2]! - mesh.vertices[b * 3 + 2]!) <= 1e-4) uf.join(a, b);
    }
  const rising = new Uint8Array(count);
  rising.fill(1);
  const nz = new Float64Array(count),
    sample = new Uint32Array(count);
  sample.fill(0xffffffff);
  for (let t = 0; t < mesh.triangles.length / 3; t++)
    for (let k = 0; k < 3; k++) {
      const v = mesh.triangles[t * 3 + k]!,
        id = uf.find(v);
      nz[id] = nz[id]! + mesh.normals[t * 3 + 2]! * mesh.areas[t]!;
      sample[id] = v;
    }
  for (let s = 0; s < topology.keys.length; s++)
    if (topology.counts[s]) {
      const a = Math.floor(topology.keys[s]! / count),
        b = topology.keys[s]! % count,
        ra = uf.find(a),
        rb = uf.find(b);
      if (ra === rb) continue;
      const za = mesh.vertices[a * 3 + 2]!,
        zb = mesh.vertices[b * 3 + 2]!;
      if (zb <= za + 1e-4) rising[ra] = 0;
      if (za <= zb + 1e-4) rising[rb] = 0;
    }
  const candidates: Vec3[] = [];
  for (let id = 0; id < count; id++)
    if (sample[id] !== 0xffffffff && rising[id] && nz[id]! < 0) {
      const p = vertex(mesh, sample[id]!);
      if (p[2] > z0 + layer) candidates.push(p);
    }
  const selected: Vec3[] = [];
  for (const p of candidates.toSorted((a, b) => a[2] - b[2])) {
    if (selected.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1)) continue;
    selected.push(p);
    add(
      "islands",
      "UNSUPPORTED_ISLAND",
      "warn",
      `Starts in mid-air ${(p[2] - z0).toFixed(1)} mm above the bed.`,
      p[2] - z0,
      null,
      "mm",
      p,
      [0, 0, -1],
    );
    if (selected.length === 20) break;
  }
};
const clusterThin = (
  samples: { point: Vec3; normal: Vec3; thickness: number }[],
  target: number,
  surface: number,
  minWall: number,
  nozzle: number,
  add: Add,
) => {
  const uf = unionFind(samples.length),
    cells = new Map<string, number[]>();
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!.point,
      x = Math.floor(p[0] / 2),
      y = Math.floor(p[1] / 2),
      z = Math.floor(p[2] / 2);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const other = cells.get(`${x + dx},${y + dy},${z + dz}`);
          if (other) uf.join(i, other[0]!);
        }
    const key = `${x},${y},${z}`,
      cell = cells.get(key) ?? [];
    cell.push(i);
    cells.set(key, cell);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < samples.length; i++) {
    const id = uf.find(i),
      g = groups.get(id) ?? [];
    g.push(i);
    groups.set(id, g);
  }
  const kept = [...groups.values()]
    .filter((g) => g.length >= 3 || (g.length / target) * surface >= 1)
    .toSorted((a, b) => b.length - a.length);
  let walls = 0,
    features = 0;
  for (const g of kept) {
    const below = g.filter((i) => samples[i]!.thickness < nozzle).length >= 3;
    if (below ? features++ >= 20 : walls++ >= 20) continue;
    const values = g.map((i) => samples[i]!.thickness),
      thinnest = g.reduce((a, b) => (samples[a]!.thickness < samples[b]!.thickness ? a : b)),
      s = samples[thinnest]!,
      value = percentile(values, 0.1)!;
    add(
      below ? "small-features" : "walls",
      below ? "FEATURE_BELOW_NOZZLE" : "THIN_WALL",
      below ? "fail" : "warn",
      below
        ? `Thinner than the ${nozzle.toFixed(1)} mm nozzle (${value.toFixed(2)} mm); the slicer will drop it.`
        : `Wall ${value.toFixed(2)} mm thick (needs ${minWall.toFixed(2)} mm).`,
      value,
      below ? nozzle : minWall,
      "mm",
      s.point,
      s.normal,
      Math.max(1, Math.sqrt(((g.length / target) * surface) / Math.PI)),
    );
  }
};
