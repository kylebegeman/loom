import type {
  PcbCheckResult,
  PcbFabCheckResult,
  PcbFabChecklistItem,
  PcbFabPreviewLayer,
} from "@t3tools/contracts/fork";
import { parseSexp, child, children, atom } from "./semantics.ts";
export const LCSC_FIELDS = [
  "LCSC Part #",
  "LCSC Part",
  "LCSC PN",
  "LCSC P/N",
  "LCSC Part No.",
  "LCSC Part Number",
  "JLCPCB Part #",
  "JLCPCB Part",
  "JLC Part #",
  "LCSC",
  "JLC",
];
const ROTATION_FIELDS = [
  "JLCPCB Rotation Offset",
  "FT Rotation Offset",
  "Rotation Offset",
  "RotOffset",
];
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export type FabPart = {
  reference: string;
  value: string;
  footprint: string;
  side: "top" | "bottom";
  dnp: boolean;
  excludeBom: boolean;
  excludePosition: boolean;
  properties: Record<string, string>;
};
export type BomRow = { value: string; footprint: string; references: string[]; lcsc: string };
export type Position = {
  reference: string;
  value: string;
  footprint: string;
  x: number;
  y: number;
  rotation: number;
  side: "top" | "bottom";
};
export type RotationRule = { pattern: RegExp; degrees: number };
const field = (props: Record<string, string>, names: readonly string[]) =>
  names
    .map(
      (name) =>
        Object.entries(props).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1],
    )
    .find(Boolean) ?? "";
export function footprintParts(board: string): FabPart[] {
  const root = parseSexp(board)[0];
  if (!Array.isArray(root) || root[0] !== "kicad_pcb") throw new Error("Invalid board");
  return children(root, "footprint").map((fp) => {
    const properties = Object.fromEntries(
      children(fp, "property").map((p) => [atom(p), atom(p, 2)]),
    );
    const attrs = new Set(child(fp, "attr").slice(1));
    return {
      reference: properties.Reference ?? atom(child(fp, "fp_text"), 2),
      value:
        properties.Value ??
        children(fp, "fp_text")
          .find((p) => p[1] === "value")?.[2]
          ?.toString() ??
        "",
      footprint: atom(fp),
      side: atom(child(fp, "layer")) === "B.Cu" ? "bottom" : "top",
      dnp: attrs.has("dnp") || atom(child(fp, "dnp")) === "yes",
      excludeBom: attrs.has("exclude_from_bom"),
      excludePosition: attrs.has("exclude_from_pos_files"),
      properties,
    };
  });
}
export function lcscField(source: string) {
  const keys = new Set<string>();
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node[0] === "property" && typeof node[1] === "string") keys.add(node[1].toLowerCase());
    for (const value of node) if (Array.isArray(value)) visit(value);
  };
  visit(parseSexp(source));
  return LCSC_FIELDS.find((name) => keys.has(name.toLowerCase()));
}
function groupBom(
  parts: readonly { reference: string; value: string; footprint: string; lcsc: string }[],
): BomRow[] {
  const rows = new Map<string, BomRow>();
  for (const part of parts) {
    const key = JSON.stringify([part.value, part.footprint, part.lcsc]);
    const row = rows.get(key) ?? {
      value: part.value,
      footprint: part.footprint,
      lcsc: part.lcsc,
      references: [],
    };
    row.references.push(part.reference);
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, references: r.references.sort(natural) }))
    .sort((a, b) => natural(a.references[0] ?? "", b.references[0] ?? ""));
}
export function bomFromFootprints(parts: readonly FabPart[]) {
  return groupBom(
    parts
      .filter((p) => !p.dnp && !p.excludeBom && p.reference)
      .map((p) => ({ ...p, lcsc: field(p.properties, LCSC_FIELDS) })),
  );
}
const quote = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
export const csv = (rows: readonly (readonly (string | number)[])[]) =>
  rows.map((row) => row.map(quote).join(",")).join("\n") + "\n";
export const genericBom = (rows: readonly BomRow[]) =>
  csv([
    ["Reference", "Value", "Footprint", "Qty", "DNP", "LCSC"],
    ...rows.map((r) => [
      r.references.join(","),
      r.value,
      r.footprint,
      r.references.length,
      "",
      r.lcsc,
    ]),
  ]);
export const jlcpcbBom = (rows: readonly BomRow[]) =>
  csv([
    ["Comment", "Designator", "Footprint", "LCSC Part #"],
    ...rows.map((r) => [
      r.value,
      r.references.join(","),
      r.footprint.split(":").at(-1) ?? r.footprint,
      r.lcsc,
    ]),
  ]);
/** CSV parser accepts quoted commas, doubled quotes, CRLF and quoted newlines. */
export function parseCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function parseKicadBom(source: string): BomRow[] {
  const [header, ...rows] = parseCsv(source);
  if (!header) throw new Error("Empty BOM");
  const index = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  for (const key of ["Reference", "Value", "Footprint"])
    if (index(key) < 0) throw new Error("Missing BOM column");
  return rows
    .filter((r) => !/[1y]/i.test(r[index("DNP")] ?? ""))
    .map((r) => ({
      references: (r[index("Reference")] ?? "").split(/[,\s]+/).filter(Boolean),
      value: r[index("Value")] ?? "",
      footprint: r[index("Footprint")] ?? "",
      lcsc: r[index("LCSC")] ?? "",
    }));
}
export function parseKicadPositions(source: string): Position[] {
  const [header, ...rows] = parseCsv(source);
  const names = ["Ref", "Val", "Package", "PosX", "PosY", "Rot", "Side"];
  if (!header || names.some((n) => !header.includes(n))) throw new Error("Missing position column");
  return rows.map((row) => {
    const get = (n: string) => row[header.indexOf(n)] ?? "";
    const position = {
      reference: get("Ref"),
      value: get("Val"),
      footprint: get("Package"),
      x: Number(get("PosX")),
      y: Number(get("PosY")),
      rotation: Number(get("Rot")),
      side: /back|bottom/i.test(get("Side")) ? ("bottom" as const) : ("top" as const),
    };
    if (
      !position.reference ||
      ["PosX", "PosY", "Rot"].some((n) => !get(n).trim()) ||
      ![position.x, position.y, position.rotation].every(Number.isFinite)
    )
      throw new Error("Invalid position");
    return position;
  });
}
export const genericPositions = (positions: readonly Position[]) =>
  csv([
    ["Ref", "Val", "Package", "PosX", "PosY", "Rot", "Side"],
    ...positions.map((p) => [
      p.reference,
      p.value,
      p.footprint,
      p.x,
      p.y,
      p.rotation,
      p.side === "top" ? "front" : "back",
    ]),
  ]);
export function parseRotationsCsv(source: string) {
  const rules: RotationRule[] = [],
    warnings: string[] = [];
  for (const [i, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    try {
      const row = parseCsv(line)[0];
      const pattern = row?.[0]?.trim() ?? "",
        degrees = Number(row?.[1]);
      if (
        !pattern ||
        pattern.length > 200 ||
        row?.length !== 2 ||
        !row[1]?.trim() ||
        !Number.isFinite(degrees) ||
        Math.abs(degrees) > 3600 ||
        /\\[1-9]|\(\?|\)[+*{]/.test(pattern)
      )
        throw new Error("Invalid rotation");
      rules.push({ pattern: new RegExp(pattern), degrees });
      if (rules.length > 1000) throw new Error("Too many rotations");
    } catch {
      warnings.push(`Rotation rule on line ${i + 1} is invalid.`);
    }
  }
  return { rules: rules.slice(0, 1000), warnings: warnings.slice(0, 16) };
}
export function jlcpcbCpl(
  positions: readonly Position[],
  parts: readonly FabPart[],
  rules: readonly RotationRule[],
) {
  const indexed = new Map(parts.map((p) => [p.reference, p]));
  let corrected = 0;
  const warnings: string[] = [];
  const rows = positions.map((p) => {
    const raw = field(indexed.get(p.reference)?.properties ?? {}, ROTATION_FIELDS);
    let offset =
      rules.find((r) => r.pattern.test(p.footprint.split(":").at(-1) ?? p.footprint))?.degrees ?? 0;
    if (raw) {
      if (Number.isFinite(Number(raw))) offset = Number(raw);
      else warnings.push(`Invalid rotation offset for ${p.reference}.`);
    }
    if (offset) corrected++;
    return [
      p.reference,
      p.x.toFixed(4),
      p.y.toFixed(4),
      p.side === "top" ? "Top" : "Bottom",
      ((((p.rotation + offset) % 360) + 360) % 360).toFixed(4),
    ];
  });
  return {
    text: csv([["Designator", "Mid X", "Mid Y", "Layer", "Rotation"], ...rows]),
    corrected,
    warnings: warnings.slice(0, 16),
  };
}
export function circuitAssembly(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Invalid circuit JSON");
  const elements = value.map(record),
    sources = new Map(
      elements.filter((e) => e.type === "source_component").map((e) => [e.source_component_id, e]),
    );
  const parts: FabPart[] = [],
    positions: Position[] = [];
  for (const e of elements.filter((e) => e.type === "pcb_component")) {
    const source = sources.get(e.source_component_id) ?? {},
      supplier = record(source.supplier_part_numbers);
    const supplied = Array.isArray(supplier.jlcpcb) ? supplier.jlcpcb[0] : undefined;
    const reference =
      typeof source.name === "string" ? source.name : typeof e.name === "string" ? e.name : "";
    if (!reference) continue;
    const metadata = record(record(e.metadata).kicad_footprint),
      attributes = record(metadata.attributes);
    const footprint =
      typeof metadata.footprintName === "string"
        ? metadata.footprintName
        : typeof e.footprint === "string"
          ? e.footprint
          : typeof source.footprint === "string"
            ? source.footprint
            : "";
    const part: FabPart = {
      reference,
      value: String(source.display_value ?? source.value ?? ""),
      footprint,
      side: e.layer === "bottom" ? "bottom" : "top",
      dnp: source.do_not_populate === true,
      excludeBom: source.exclude_from_bom === true || attributes.exclude_from_bom === true,
      excludePosition:
        source.exclude_from_position_files === true || attributes.exclude_from_pos_files === true,
      properties: { LCSC: typeof supplied === "string" ? supplied : "" },
    };
    parts.push(part);
    const center = record(e.center);
    if (
      !part.dnp &&
      !part.excludePosition &&
      typeof center.x === "number" &&
      typeof center.y === "number" &&
      Number.isFinite(center.x) &&
      Number.isFinite(center.y)
    )
      positions.push({
        reference,
        value: part.value,
        footprint,
        x: center.x,
        y: center.y,
        rotation: typeof e.rotation === "number" && Number.isFinite(e.rotation) ? e.rotation : 0,
        side: part.side,
      });
  }
  const board = elements.find((e) => e.type === "pcb_board");
  if (!board) throw new Error("A fabrication package needs a board");
  return {
    parts,
    bom: bomFromFootprints(parts),
    positions,
    copperLayers:
      typeof board?.num_layers === "number"
        ? board.num_layers
        : typeof board?.layers === "number"
          ? board.layers
          : 4,
    plated: elements.some((e) => e.type === "pcb_via" || e.type === "pcb_plated_hole"),
    npth: elements.some((e) => e.type === "pcb_hole"),
  };
}
export function inspectGerbers(files: readonly { path: string; text: string }[]) {
  const layers: PcbFabPreviewLayer[] = [];
  let outline = false,
    copper = 0,
    pth = false,
    npth = false;
  for (const f of files) {
    const fn =
      /(?:%TF\.FileFunction,|;\s*#@!\s*TF\.FileFunction,)([^*\r\n%]+)/i
        .exec(f.text)?.[1]
        ?.split(",") ?? [];
    const kind = fn[0]?.toLowerCase();
    let layer: PcbFabPreviewLayer | null = null;
    const side = /bot|bottom/i.test(fn.join())
      ? ("bottom" as const)
      : /top/i.test(fn.join())
        ? ("top" as const)
        : ("inner" as const);
    if (/\.drl$|\.xln$/i.test(f.path) || kind === "plated" || kind === "nonplated") {
      const non = kind === "nonplated" || /npth/i.test(f.path);
      npth ||= non;
      pth ||= !non;
      layer = { path: f.path, layer: non ? "NPTH" : "PTH", side: "all", type: "drill" };
    } else if (kind === "copper") {
      copper++;
      const n = Number(fn[1]?.replace(/^l/i, ""));
      layer = {
        path: f.path,
        layer: side === "top" ? "F.Cu" : side === "bottom" ? "B.Cu" : `In${Math.max(1, n - 1)}.Cu`,
        side,
        type: "copper",
      };
    } else if (kind === "profile" || /edge[_ .-]?cuts|\.gko$/i.test(f.path)) {
      outline ||= /D0?1\*/i.test(f.text);
      layer = { path: f.path, layer: "Edge.Cuts", side: "all", type: "outline" };
    } else {
      const type =
        kind === "soldermask"
          ? "soldermask"
          : kind === "legend"
            ? "silkscreen"
            : kind === "paste"
              ? "solderpaste"
              : null;
      if (type)
        layer = {
          path: f.path,
          layer: `${side === "bottom" ? "B" : "F"}.${type === "soldermask" ? "Mask" : type === "silkscreen" ? "Silkscreen" : "Paste"}`,
          side: side === "inner" ? "top" : side,
          type,
        };
    }
    if (!layer) {
      const match = /([FB]|In\d+)[_.](Cu|Mask|Silkscreen|Paste)/i.exec(f.path),
        ext = /\.(gtl|gbl|gts|gbs|gto|gbo|gtp|gbp)$/i.exec(f.path)?.[1]?.toLowerCase();
      const suffix =
        match?.[2] ??
        (ext?.endsWith("l")
          ? "Cu"
          : ext?.endsWith("s")
            ? "Mask"
            : ext?.endsWith("o")
              ? "Silkscreen"
              : ext?.endsWith("p")
                ? "Paste"
                : null);
      if (suffix) {
        const prefix = match?.[1] ?? (ext?.startsWith("gb") ? "B" : "F");
        const type =
          suffix.toLowerCase() === "cu"
            ? "copper"
            : suffix.toLowerCase() === "mask"
              ? "soldermask"
              : suffix.toLowerCase() === "paste"
                ? "solderpaste"
                : "silkscreen";
        layer = {
          path: f.path,
          layer: `${prefix}.${suffix}`,
          side: prefix === "B" ? "bottom" : prefix === "F" ? "top" : "inner",
          type,
        };
        if (type === "copper") copper++;
      }
    }
    if (layer) layers.push(layer);
  }
  return { layers: layers.slice(0, 64), outline, copper, pth, npth };
}
export function evaluateChecklist(f: {
  gerbers: ReturnType<typeof inspectGerbers>;
  copperLayers: number;
  plated: boolean;
  npth: boolean;
  kind: "kicad" | "tscircuit";
  drc: PcbCheckResult | null;
  erc: PcbCheckResult | null;
  fab: PcbFabCheckResult | null;
  fabChosen: boolean;
  zones: boolean;
  refilled: boolean;
  assembly: boolean;
  profile: "generic" | "jlcpcb";
  bom: readonly BomRow[];
  positions: readonly Position[];
  corrected: number;
}) {
  const items: PcbFabChecklistItem[] = [];
  const add = (
    id: PcbFabChecklistItem["id"],
    status: PcbFabChecklistItem["status"],
    title: string,
    detail: string,
  ) => items.push({ id, status, title, detail: detail.slice(0, 2000) });
  const broken = f.drc?.violations.some((v) => !v.excluded && /outline|edge.*cuts/i.test(v.type));
  add(
    "outline",
    f.gerbers.outline && !broken ? "pass" : "fail",
    "Board outline",
    broken
      ? "DRC found an outline issue."
      : f.gerbers.outline
        ? "A nonempty profile Gerber is present."
        : "A nonempty profile Gerber is missing.",
  );
  add(
    "copper-layers",
    f.gerbers.copper === f.copperLayers ? "pass" : "fail",
    "Copper layers",
    `${f.gerbers.copper} copper outputs for ${f.copperLayers} board layers.`,
  );
  add(
    "drill",
    (!f.plated || f.gerbers.pth) && (!f.npth || f.gerbers.npth) ? "pass" : "fail",
    "Drill files",
    "Confirm plated and non-plated holes in the fab's viewer.",
  );
  const checkStatus = (r: PcbCheckResult | null) =>
    !r || r.outcome === "failed" || r.outcome === "timed-out"
      ? "fail"
      : r.counts.errors
        ? "fail"
        : r.counts.warnings
          ? "warning"
          : "pass";
  add(
    "drc",
    f.kind === "tscircuit" ? "skipped" : checkStatus(f.drc),
    "Design rules",
    f.kind === "tscircuit"
      ? "KiCad DRC is unavailable for circuit source."
      : f.drc
        ? `${f.drc.counts.errors} errors, ${f.drc.counts.warnings} warnings. ${f.drc.outcome}`
        : "No DRC report.",
  );
  add(
    "erc",
    !f.erc ? "skipped" : checkStatus(f.erc) === "pass" ? "pass" : "warning",
    "Electrical rules",
    f.erc
      ? `${f.erc.counts.errors} errors, ${f.erc.counts.warnings} warnings. ${f.erc.outcome}`
      : "No KiCad schematic check available.",
  );
  add(
    "zones",
    !f.zones ? "skipped" : f.refilled ? "pass" : "manual",
    "Copper zones",
    f.refilled ? "Zones refilled for the outputs." : "Refill zones (B) and save before packaging.",
  );
  add(
    "fab-check",
    !f.fabChosen ? "skipped" : f.fab?.outcome === "clean" ? "pass" : "fail",
    "Fab capabilities",
    f.fab ? `${f.fab.capability.name}: ${f.fab.outcome}.` : "No fab check available.",
  );
  const bomRefs = new Set(f.bom.flatMap((r) => r.references)),
    posRefs = new Set(f.positions.map((p) => p.reference));
  const missingMetadata = f.bom
    .filter((row) => !row.value || !row.footprint)
    .flatMap((row) => row.references);
  const differences = [
    ...[...bomRefs].filter((r) => !posRefs.has(r)),
    ...[...posRefs].filter((r) => !bomRefs.has(r)),
  ];
  add(
    "bom-cpl",
    !f.assembly ? "skipped" : differences.length || missingMetadata.length ? "warning" : "pass",
    "BOM and placements",
    differences.length
      ? `References differ: ${differences.slice(0, 10).join(", ")}.`
      : missingMetadata.length
        ? `Missing value or footprint: ${missingMetadata.slice(0, 10).join(", ")}.`
        : "BOM and placement references match.",
  );
  const missing = f.bom.filter((r) => !/^C\d+$/i.test(r.lcsc)).flatMap((r) => r.references);
  add(
    "lcsc",
    !f.assembly || f.profile !== "jlcpcb" ? "skipped" : missing.length ? "warning" : "pass",
    "LCSC numbers",
    missing.length
      ? `${missing.length} parts need valid LCSC numbers: ${missing.slice(0, 10).join(", ")}.`
      : "Every BOM row has an LCSC number.",
  );
  add(
    "rotations",
    f.assembly && f.profile === "jlcpcb" ? "manual" : "skipped",
    "Placement rotations",
    `Check rotations in JLCPCB's placement preview. ${f.corrected} parts have corrections.`,
  );
  add(
    "polarity",
    f.assembly ? "manual" : "skipped",
    "Polarity and pin 1",
    "Check diodes, LEDs, ICs and polarised capacitors before ordering.",
  );
  return {
    checklist: items,
    verdict: items.some((i) => i.status === "fail")
      ? ("not-ready" as const)
      : items.some((i) => i.status === "warning")
        ? ("needs-review" as const)
        : ("ready" as const),
  };
}
export const checklistText = (items: readonly PcbFabChecklistItem[]) =>
  items.map((i) => `- [${i.status}] ${i.title}: ${i.detail}`).join("\n") + "\n";
export function boardHoleFacts(source: string) {
  const root = parseSexp(source)[0];
  if (!Array.isArray(root)) throw new Error("Invalid board");
  const pads = children(root, "footprint").flatMap((fp) => children(fp, "pad"));
  return {
    plated: children(root, "via").length > 0 || pads.some((p) => p[2] === "thru_hole"),
    npth: pads.some((p) => p[2] === "np_thru_hole"),
    zones: children(root, "zone").length > 0,
    revision: atom(child(child(root, "title_block"), "rev")),
    copperLayers: child(root, "layers")
      .slice(1)
      .filter((l) => Array.isArray(l) && typeof l[1] === "string" && l[1].endsWith(".Cu")).length,
  };
}
