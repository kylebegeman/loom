import type {
  PcbFabCapability,
  PcbFabRule,
  PcbFabFacts,
  PcbFabBoardFinding,
  PcbFabViolation,
  PcbFabCostDriver,
  PcbViolation,
  PcbBoardStats,
} from "@t3tools/contracts/fork";
import {
  parseSexp,
  child,
  children,
  atom,
  number,
  localPosition,
  inspectBoard,
} from "./semantics.ts";
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const FAB_RULE_TYPES: Readonly<Record<string, PcbFabRule>> = {
  track_width: "track",
  clearance: "space",
  drill_out_of_range: "drill",
  via_diameter: "via",
  annular_width: "annular-ring",
  copper_edge_clearance: "edge-clearance",
  hole_to_hole: "hole-to-hole",
  microvia_drill_out_of_range: "drill",
  microvia_diameter: "via",
};
const LIMITS: Record<PcbFabRule, keyof PcbFabCapability> = {
  track: "minTrackMm",
  space: "minSpaceMm",
  drill: "minDrillMm",
  via: "minViaMm",
  "annular-ring": "minAnnularRingMm",
  "edge-clearance": "minEdgeClearanceMm",
  "hole-to-hole": "minHoleToHoleMm",
};
const CONSTRAINTS: Record<PcbFabRule, string> = {
  track: "track_width",
  space: "clearance",
  drill: "hole_size",
  via: "via_diameter",
  "annular-ring": "annular_width",
  "edge-clearance": "edge_clearance",
  "hole-to-hole": "hole_to_hole",
};
export function fabRules(capability: PcbFabCapability) {
  const lines: string[] = [],
    notChecked: PcbFabRule[] = [];
  for (const [rule, field] of Object.entries(LIMITS) as [PcbFabRule, keyof PcbFabCapability][]) {
    const value = capability[field];
    if (typeof value !== "number") {
      notChecked.push(rule);
      continue;
    }
    const condition =
      rule === "via"
        ? " (condition \"A.Type == 'Via'\")"
        : rule === "annular-ring"
          ? " (condition \"A.Type == 'Pad'\")"
          : "";
    lines.push(
      `(rule "loom_fab_${rule.replaceAll("-", "_")}"${condition} (constraint ${CONSTRAINTS[rule]} (min ${value.toFixed(4)}mm)))`,
    );
  }
  return { text: lines.join("\n"), notChecked };
}
export function rulesFile(userRules: string | null, capability: PcbFabCapability) {
  const header = userRules?.trim() ? userRules : "(version 1)";
  return `${/^\s*\(version\s/m.test(header) ? "" : "(version 1)\n"}${header}\n\n# Added by Loom for the fab check. Later rules take precedence.\n${fabRules(capability).text}\n`;
}
/** Board minimums are absolute and otherwise mask the appended fab constraints. */
export function clearBoardMinimums(projectJson: string): string | null {
  try {
    const data: unknown = JSON.parse(projectJson);
    const root = record(data),
      rules = record(record(record(root.board).design_settings).rules);
    for (const key of [
      "min_clearance",
      "min_track_width",
      "min_through_hole_diameter",
      "min_via_diameter",
      "min_via_annular_width",
      "min_hole_clearance",
      "min_hole_to_hole",
      "min_copper_edge_clearance",
      "min_microvia_diameter",
      "min_microvia_drill",
    ]) {
      if (Object.hasOwn(rules, key)) rules[key] = 0;
    }
    return JSON.stringify(root);
  } catch {
    return null;
  }
}
export function classifyViolations(
  parsed: { violations: readonly PcbViolation[]; truncated: boolean },
  capability: PcbFabCapability,
) {
  const violations: PcbFabViolation[] = [],
    notChecked = new Set(fabRules(capability).notChecked);
  let alsoInDrc = 0;
  for (const v of parsed.violations) {
    if (v.type === "lib_footprint_issues" || v.type === "lib_footprint_mismatch") continue;
    const rule = FAB_RULE_TYPES[v.type];
    if (!rule || notChecked.has(rule)) {
      alsoInDrc++;
      continue;
    }
    const limit = capability[LIMITS[rule]],
      actual = /actual\s+([0-9]+(?:\.[0-9]+)?)\s*mm/i.exec(v.description);
    violations.push({
      ...v,
      rule,
      ...(typeof limit === "number" ? { limitMm: limit } : {}),
      ...(actual ? { measuredMm: Number(actual[1]) } : {}),
    });
  }
  violations.sort(
    (a, b) =>
      Number(a.excluded) - Number(b.excluded) ||
      Number(b.severity === "error") - Number(a.severity === "error") ||
      a.rule.localeCompare(b.rule),
  );
  return {
    violations: violations.slice(0, 500),
    truncated: parsed.truncated || violations.length > 500,
    alsoInDrc,
    counts: {
      errors: violations.filter((v) => !v.excluded && v.severity === "error").length,
      warnings: violations.filter((v) => !v.excluded && v.severity === "warning").length,
      excluded: violations.filter((v) => v.excluded).length,
    },
  };
}
export function boardFacts(source: string, stats?: PcbBoardStats): PcbFabFacts {
  const board = parseSexp(source)[0];
  if (!Array.isArray(board) || board[0] !== "kicad_pcb") throw new Error("Invalid board");
  const inspection = inspectBoard(source, "facts");
  const viaSizes = new Map<string, { drillMm: number; diameterMm: number; count: number }>(),
    pads: { x: number; y: number; radius: number; layers: string[] }[] = [],
    drills: number[] = [];
  let castellatedPads = 0;
  for (const footprint of children(board, "footprint"))
    for (const pad of children(footprint, "pad")) {
      const drill = child(pad, "drill"),
        dimensions = child(pad, "size");
      const d = drill[1] === "oval" ? Math.min(number(drill, 2), number(drill, 3)) : number(drill);
      if (d > 0) drills.push(d);
      if (children(pad, "property").some((p) => p[1] === "pad_prop_castellated")) castellatedPads++;
      if (pad[2] === "smd")
        pads.push({
          ...localPosition(child(footprint, "at"), child(pad, "at")),
          radius: Math.max(number(dimensions), number(dimensions, 2)) / 2,
          layers: child(pad, "layers")
            .slice(1)
            .filter((l): l is string => typeof l === "string"),
        });
    }
  let viaInPad = 0;
  for (const via of children(board, "via")) {
    const drillMm = number(child(via, "drill")),
      diameterMm = number(child(via, "size"));
    const key = `${drillMm}:${diameterMm}`,
      previous = viaSizes.get(key);
    if (drillMm > 0 && diameterMm > 0)
      viaSizes.set(key, { drillMm, diameterMm, count: (previous?.count ?? 0) + 1 });
    const at = child(via, "at"),
      layers = new Set(child(via, "layers").slice(1));
    if (
      pads.some(
        (p) =>
          p.layers.some((l) => l === "*.Cu" || layers.has(l)) &&
          Math.hypot(p.x - number(at), p.y - number(at, 2)) <= p.radius,
      )
    )
      viaInPad++;
  }
  const sizeMm =
    stats?.size ??
    (inspection.bounds
      ? { width: inspection.bounds.width, height: inspection.bounds.height }
      : null);
  return {
    copperLayers: stats?.copperLayers ?? inspection.layers.filter((l) => l.endsWith(".Cu")).length,
    sizeMm,
    areaMm2: stats?.areaMm2 ?? (sizeMm ? sizeMm.width * sizeMm.height : null),
    thicknessMm: number(child(child(board, "general"), "thickness"), 1, 0) || null,
    finish: atom(child(child(child(board, "setup"), "stackup"), "copper_finish")) || null,
    castellatedPads,
    viaInPad,
    viaSizes: [...viaSizes.values()].sort((a, b) => b.count - a.count).slice(0, 32),
    smallestPadDrillMm: drills.length ? Math.min(...drills) : null,
    largestPadDrillMm: drills.length ? Math.max(...drills) : null,
  };
}
const finishName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\bhal\b/g, "hasl")
    .replace(/enig|immersion gold/g, "gold")
    .replace(/[^a-z0-9]/g, "");
export function boardFindings(
  facts: PcbFabFacts,
  capability: PcbFabCapability,
): PcbFabBoardFinding[] {
  const out: PcbFabBoardFinding[] = [];
  if (!capability.layerCounts.includes(facts.copperLayers))
    out.push({
      id: "layers",
      severity: "error",
      message: `${capability.name} does not offer ${facts.copperLayers} copper layers.`,
    });
  if (
    facts.thicknessMm !== null &&
    !capability.thicknessesMm.some((v) => Math.abs(v - facts.thicknessMm!) <= 0.05)
  )
    out.push({
      id: "thickness",
      severity: "warning",
      message: `${facts.thicknessMm} mm thickness is not listed for ${capability.name}. Check order options.`,
    });
  if (facts.finish && !capability.finishes.some((f) => finishName(f) === finishName(facts.finish!)))
    out.push({
      id: "finish",
      severity: "warning",
      message: `${facts.finish} finish is not listed for ${capability.name}. Check order options.`,
    });
  return out;
}
/** Qualitative cost drivers are not quotes. Unpublished generic factors are labelled as such. */
export function costDrivers(facts: PcbFabFacts, capability: PcbFabCapability): PcbFabCostDriver[] {
  const out: PcbFabCostDriver[] = [];
  const add = (id: string, title: string, detail: string, count?: number) =>
    out.push({
      id,
      title,
      detail,
      ...(count !== undefined ? { count } : {}),
      ...(capability.sourceUrl ? { sourceUrl: capability.sourceUrl } : {}),
    });
  const jlc = capability.id.startsWith("jlcpcb-"),
    way = capability.id === "pcbway-standard",
    osh = capability.id.startsWith("oshpark-");
  if (osh) {
    if (facts.sizeMm) {
      const area = (facts.sizeMm.width * facts.sizeMm.height) / 645.16,
        rate = capability.id === "oshpark-4-layer" ? 10 : 5;
      add(
        "area-price",
        "Published area-price estimate",
        `About $${(area * rate).toFixed(2)} for three boards (${area.toFixed(2)} sq in at $${rate} per sq in), from OSH Park's published rate checked 2026-10-10. Bounding rectangle estimate.`,
      );
    }
    return out;
  }
  if (jlc) {
    const count = facts.viaSizes
      .filter((v) => v.drillMm < 0.2 || (v.drillMm < 0.3 && v.diameterMm < 0.45))
      .reduce((n, v) => n + v.count, 0);
    if (count)
      add(
        "small-via",
        "Small vias cost extra",
        `${count} vias use a drill or pad size in JLCPCB's surcharge range.`,
        count,
      );
    if (facts.finish && finishName(facts.finish) === "gold")
      add(
        "finish",
        "Gold finish may cost more",
        "General cost driver: compare finish options when ordering.",
      );
    if (facts.thicknessMm !== null && Math.abs(facts.thicknessMm - 1.6) > 0.05)
      add(
        "thickness",
        "Nonstandard thickness may cost more",
        "General cost driver: compare thickness options when ordering.",
      );
  }
  if (
    way &&
    (facts.viaSizes.some((v) => v.drillMm < 0.2 || v.drillMm > 6) ||
      (facts.smallestPadDrillMm !== null && facts.smallestPadDrillMm < 0.2) ||
      (facts.largestPadDrillMm ?? facts.smallestPadDrillMm ?? 0) > 6)
  )
    add(
      "drill-range",
      "Drill sizes cost extra",
      "PCBWay publishes extra charges for holes below 0.2 mm or above 6 mm.",
    );
  if (facts.copperLayers > 2)
    add(
      "layers",
      "Extra copper layers",
      "General cost driver: more than two copper layers often increases cost.",
    );
  if (facts.castellatedPads)
    add(
      "castellated",
      "Castellated edges",
      `General cost driver: ${facts.castellatedPads} castellated pads need additional processing.${jlc ? " JLCPCB lists 0.5 mm minimum holes and a 10 x 10 mm minimum board." : ""}`,
      facts.castellatedPads,
    );
  if (facts.viaInPad && (!jlc || facts.copperLayers < 6))
    add(
      "via-in-pad",
      "Possible via-in-pad",
      `${facts.viaInPad} vias appear inside SMD pads. This is a placement heuristic; confirm filling and capping requirements.${jlc ? " JLCPCB lists filled/capped vias as standard from six layers." : " General cost driver."}`,
      facts.viaInPad,
    );
  if (!way && facts.sizeMm && (facts.sizeMm.width > 100 || facts.sizeMm.height > 100))
    add(
      "board-size",
      "Above 100 x 100 mm",
      jlc
        ? "Outside JLCPCB's advertised two-layer low-price size tier."
        : "General cost driver: compare size tiers when ordering.",
    );
  return out.slice(0, 24);
}
