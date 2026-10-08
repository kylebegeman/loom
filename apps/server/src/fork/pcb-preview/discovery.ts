// @effect-diagnostics nodeBuiltinImport:off -- Workspace-relative grouping uses host-independent paths.
import * as NodePathPosix from "node:path/posix";
import * as Schema from "effect/Schema";

const Config = Schema.Struct({ mainEntrypoint: Schema.optional(Schema.String) });
const decodeConfig = Schema.decodeUnknownSync(Config);
export const DESIGN_SUFFIXES = [
  ".kicad_pro",
  ".kicad_sch",
  ".kicad_pcb",
  ".circuit.tsx",
  "tscircuit.config.json",
] as const;
export function innerCopperLayers(header: string) {
  return [
    ...new Set(Array.from(header.matchAll(/\(\s*\d+\s+"(In\d+\.Cu)"/g), (m) => m[1]!)),
  ].toSorted((a, b) => Number(a.slice(2, -3)) - Number(b.slice(2, -3)));
}
export function referencedSheets(source: string) {
  return Array.from(source.matchAll(/\(property\s+"Sheetfile"\s+"([^"\n]+)"/gi), (m) => m[1]!);
}
export function groupDesigns(
  entries: ReadonlyArray<string>,
  configs: ReadonlyMap<string, unknown> = new Map(),
  sources: ReadonlyMap<string, string> = new Map(),
) {
  const files = new Set(
    entries.filter((name) => DESIGN_SUFFIXES.some((suffix) => name.endsWith(suffix))),
  );
  const referenced = new Set(
    [...sources].flatMap(([name, source]) =>
      referencedSheets(source).map((child) =>
        NodePathPosix.normalize(NodePathPosix.join(NodePathPosix.dirname(name), child)),
      ),
    ),
  );
  const result: {
    id: string;
    kind: "kicad" | "tscircuit";
    name: string;
    schematicPath?: string;
    boardPath?: string;
  }[] = [];
  const covered = new Set<string>();
  const addKiCad = (id: string) => {
    const stem = id.replace(/\.kicad_(?:pro|sch|pcb)$/, "");
    const schematicPath = files.has(stem + ".kicad_sch") ? stem + ".kicad_sch" : undefined;
    const boardPath = files.has(stem + ".kicad_pcb") ? stem + ".kicad_pcb" : undefined;
    if (schematicPath) covered.add(schematicPath);
    if (boardPath) covered.add(boardPath);
    result.push({
      id,
      kind: "kicad",
      name: NodePathPosix.basename(stem),
      ...(schematicPath ? { schematicPath } : {}),
      ...(boardPath ? { boardPath } : {}),
    });
  };
  for (const name of [...files].sort()) if (name.endsWith(".kicad_pro")) addKiCad(name);
  for (const name of [...files].sort()) {
    if (covered.has(name) || referenced.has(name)) continue;
    if (/\.kicad_(sch|pcb)$/.test(name)) addKiCad(name);
    if (name.endsWith(".circuit.tsx"))
      result.push({
        id: name,
        kind: "tscircuit",
        name: NodePathPosix.basename(name, ".circuit.tsx"),
        schematicPath: name,
        boardPath: name,
      });
  }
  for (const [name, value] of configs) {
    try {
      const entry = decodeConfig(value).mainEntrypoint;
      if (!entry || NodePathPosix.isAbsolute(entry) || entry.includes("\\") || entry.includes("\0"))
        continue;
      const id = NodePathPosix.normalize(NodePathPosix.join(NodePathPosix.dirname(name), entry));
      if (id === ".." || id.startsWith("../") || result.some((r) => r.id === id)) continue;
      result.push({
        id,
        kind: "tscircuit",
        name: NodePathPosix.basename(id).replace(/\.[^.]+$/, ""),
        schematicPath: id,
        boardPath: id,
      });
    } catch {
      /* Invalid project config does not hide other designs. */
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
