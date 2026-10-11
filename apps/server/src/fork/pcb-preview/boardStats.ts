import type { PcbBoardStats, PcbInspection } from "@t3tools/contracts/fork";
import type { GlbBounds, GlbMesh } from "./glb.ts";
import {
  circuitOutline,
  kicadOutline,
  signedOutlineArea,
  type OutlineLoops,
  type OutlinePoint,
} from "./outline.ts";
import {
  atom,
  child,
  children,
  inspectCircuitJson,
  number,
  parseSexp,
  type Sexp,
} from "./semantics.ts";

export type BoardStatsDesign =
  | {
      readonly kind: "kicad";
      readonly board: string;
      readonly project: string | null;
      readonly inspection: PcbInspection;
      readonly glb: GlbBounds | null;
    }
  | {
      readonly kind: "circuit-json";
      readonly elements: readonly unknown[];
      readonly inspection?: PcbInspection;
      readonly glb: GlbBounds | null;
    };
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const positive = (value: unknown) => (finite(value) && value > 0 ? value : null);
const smallest = (values: readonly (number | null)[]) => {
  let min: number | null = null;
  for (const value of values)
    if (value !== null && Number.isFinite(value) && value >= 0 && (min === null || value < min))
      min = value;
  return min;
};
function contains(points: readonly OutlinePoint[], p: OutlinePoint) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!,
      b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
/** Subtract cutouts from the outer loop; separate closed islands are not cutouts. */
export function outlineArea(outline: OutlineLoops): number {
  const outer = outline.loops[outline.outer];
  if (!outer) return 0;
  let area = Math.abs(signedOutlineArea(outer));
  for (let i = 0; i < outline.loops.length; i++) {
    const loop = outline.loops[i]!;
    if (i !== outline.outer && loop[0] && contains(outer, loop[0]))
      area -= Math.abs(signedOutlineArea(loop));
  }
  return Math.max(0, area);
}
function drillSize(node: Sexp[]) {
  const drill = child(node, "drill");
  return drill[1] === "oval"
    ? smallest([positive(number(drill, 2)), positive(number(drill, 3))])
    : positive(number(drill));
}
/** Conservative ring measurement: custom shapes and offset drills need pad geometry. */
export function annularRing(pad: Sexp[]): number | null {
  if (
    pad[0] === "pad" &&
    (pad[2] !== "thru_hole" || !["circle", "rect", "oval", "roundrect"].includes(atom(pad, 3)))
  )
    return null;
  if (child(child(pad, "drill"), "offset").length) return null;
  const size = child(pad, "size"),
    drill = drillSize(pad);
  const diameter =
    pad[0] === "via"
      ? positive(number(size))
      : smallest([positive(number(size)), positive(number(size, 2))]);
  if (diameter === null || drill === null || diameter < drill) return null;
  return (diameter - drill) / 2;
}
function rules(project: string | null): PcbBoardStats["rules"] {
  if (!project) return null;
  const value = record(record(record(JSON.parse(project)).board).design_settings).rules;
  if (Object.keys(record(value)).length === 0) return null;
  const raw = record(value);
  return {
    clearance: positive(raw.min_clearance),
    track: positive(raw.min_track_width),
    drill: positive(raw.min_through_hole_diameter),
    viaDiameter: positive(raw.min_via_diameter),
    annularRing: positive(raw.min_via_annular_width),
    holeClearance: positive(raw.min_hole_clearance),
    edgeClearance: positive(raw.min_copper_edge_clearance),
  };
}
function heightFromGlb(glb: GlbBounds | null, inspection: PcbInspection): PcbBoardStats["tallest"] {
  if (!glb?.meshes.length) return null;
  const area = (mesh: GlbMesh) => (mesh.max[0] - mesh.min[0]) * (mesh.max[2] - mesh.min[2]);
  const body = glb.meshes.reduce((a, b) =>
    area(b) > area(a) || (area(b) === area(a) && b.max[1] - b.min[1] > a.max[1] - a.min[1]) ? b : a,
  );
  const references = new Set(inspection.components.map((c) => c.reference));
  let tallest: PcbBoardStats["tallest"] = null;
  for (const mesh of glb.meshes) {
    if (mesh === body) continue;
    const above = Math.max(0, mesh.max[1] - body.max[1]);
    const below = Math.max(0, body.min[1] - mesh.min[1]);
    const heightMm = Math.max(above, below) * 1000;
    // Mask/copper films and tiny exporter roundoff are not component height data.
    if (heightMm <= 0.05 || (tallest && heightMm <= tallest.heightMm)) continue;
    const reference =
      [mesh.name, ...mesh.nodes.toReversed()].find(
        (name) => name !== null && references.has(name),
      ) ?? null;
    tallest = { heightMm, side: above >= below ? "front" : "back", reference, source: "glb" };
  }
  return tallest;
}
function common(
  inspection: PcbInspection,
  outline: OutlineLoops | null,
): Pick<PcbBoardStats, "size" | "areaMm2" | "areaSource"> {
  const size = inspection.bounds
    ? { width: inspection.bounds.width, height: inspection.bounds.height }
    : null;
  return {
    size,
    areaMm2: outline ? outlineArea(outline) : size ? size.width * size.height : null,
    areaSource: outline ? "outline" : size ? "bounds" : "none",
  };
}
/** Compute quote/enclosure statistics only from data the caller has already built. */
export function boardStats(design: BoardStatsDesign): PcbBoardStats {
  if (design.kind === "kicad") {
    const board = parseSexp(design.board)[0];
    if (!Array.isArray(board) || board[0] !== "kicad_pcb")
      throw new Error("Invalid KiCad board for statistics.");
    const footprints = children(board, "footprint"),
      pads = footprints.flatMap((f) => children(f, "pad"));
    const vias = children(board, "via");
    const tracks = [...children(board, "segment"), ...children(board, "arc")].filter((track) =>
      atom(child(track, "layer")).endsWith(".Cu"),
    );
    const blind = vias.filter((via) => via.includes("blind") || via.includes("micro")).length;
    const tallest = heightFromGlb(design.glb, design.inspection);
    return {
      ...common(design.inspection, kicadOutline(board)),
      copperLayers: design.inspection.layers.filter((layer) => layer.endsWith(".Cu")).length,
      components: {
        front: footprints.filter((f) => atom(child(f, "layer")) !== "B.Cu").length,
        back: footprints.filter((f) => atom(child(f, "layer")) === "B.Cu").length,
      },
      holes: {
        plated: pads.filter((pad) => pad[2] === "thru_hole" && drillSize(pad) !== null).length,
        nonPlated: pads.filter((pad) => pad[2] === "np_thru_hole" && drillSize(pad) !== null)
          .length,
      },
      vias: { through: vias.length - blind, blindOrMicro: blind },
      measured: {
        drill: smallest([...pads, ...vias].map(drillSize)),
        track: smallest(tracks.map((track) => positive(number(child(track, "width"))))),
        annularRing: smallest([...pads, ...vias].map(annularRing)),
        viaDiameter: smallest(vias.map((via) => positive(number(child(via, "size"))))),
      },
      rules: rules(design.project),
      tallest,
      heights: tallest
        ? "measured"
        : design.glb || !footprints.some((f) => children(f, "model").length)
          ? "no-models"
          : "needs-3d",
    };
  }
  const inspection = design.inspection ?? inspectCircuitJson(design.elements, "stats");
  const rows = design.elements.map(record);
  const of = (type: string) => rows.filter((row) => row.type === type);
  const board = of("pcb_board")[0];
  const pcbComponents = of("pcb_component");
  const drilled = [...of("pcb_plated_hole"), ...of("pcb_hole")];
  const viaRows = of("pcb_via");
  const route: Record<string, unknown>[] = of("pcb_trace").flatMap((trace) =>
    Array.isArray(trace.route) ? trace.route.map(record) : [],
  );
  const viaPoints = route.filter((point) => point.route_type === "via");
  const holeSize = (row: Record<string, unknown>) =>
    positive(row.hole_diameter) ?? smallest([positive(row.hole_width), positive(row.hole_height)]);
  const outerSize = (row: Record<string, unknown>) =>
    positive(row.outer_diameter ?? row.via_diameter) ??
    smallest([
      positive(row.outer_width ?? row.rect_pad_width),
      positive(row.outer_height ?? row.rect_pad_height),
    ]);
  const ring = (row: Record<string, unknown>) => {
    const outer = outerSize(row),
      hole = holeSize(row);
    return outer !== null && hole !== null && outer >= hole ? (outer - hole) / 2 : null;
  };
  let tallest = heightFromGlb(design.glb, inspection);
  const sources = new Map(of("source_component").map((row) => [row.source_component_id, row.name]));
  const placements = new Map(pcbComponents.map((row) => [row.pcb_component_id, row]));
  for (const cad of of("cad_component")) {
    const heightMm = positive(record(cad.size).z);
    if (heightMm === null || (tallest && heightMm <= tallest.heightMm)) continue;
    const placement = placements.get(cad.pcb_component_id);
    const reference = sources.get(cad.source_component_id ?? placement?.source_component_id);
    tallest = {
      heightMm,
      side: (cad.layer ?? placement?.layer) === "bottom" ? "back" : "front",
      reference: typeof reference === "string" && reference ? reference : null,
      source: "circuit-json",
    };
  }
  return {
    ...common(inspection, circuitOutline(design.elements)),
    copperLayers: board ? Math.max(0, Math.trunc(positive(board.num_layers) ?? 2)) : 0,
    components: {
      front: pcbComponents.filter((row) => row.layer !== "bottom").length,
      back: pcbComponents.filter((row) => row.layer === "bottom").length,
    },
    holes: {
      plated: of("pcb_plated_hole").filter((row) => holeSize(row) !== null).length,
      nonPlated: of("pcb_hole").filter((row) => holeSize(row) !== null).length,
    },
    vias: { through: viaRows.length + viaPoints.length, blindOrMicro: 0 },
    measured: {
      drill: smallest([...drilled, ...viaRows, ...viaPoints].map(holeSize)),
      track: smallest(
        route.filter((point) => point.route_type === "wire").map((point) => positive(point.width)),
      ),
      annularRing: smallest([...of("pcb_plated_hole"), ...viaRows, ...viaPoints].map(ring)),
      viaDiameter: smallest([...viaRows, ...viaPoints].map(outerSize)),
    },
    rules: null,
    tallest,
    heights: tallest ? "measured" : design.glb ? "no-models" : "needs-3d",
  };
}
