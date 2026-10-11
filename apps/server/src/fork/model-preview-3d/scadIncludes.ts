// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

export interface ScadReference {
  readonly kind: "include" | "use" | "import" | "surface";
  readonly path: string;
}

const quotedEnd = (source: string, start: number) => {
  let offset = start + 1;
  while (offset < source.length) {
    if (source[offset] === "\\") offset += 2;
    else if (source[offset++] === '"') break;
  }
  return offset;
};

/** Find literal references, excluding comments and reference-looking text inside strings. */
export function scadReferences(source: string): ScadReference[] {
  const clean = source.replace(/"(?:[^"\\]|\\[\s\S])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
    match.startsWith('"') ? match : match.replace(/[^\n]/g, " "),
  );
  const refs: ScadReference[] = [];
  let offset = 0;
  while (offset < clean.length) {
    if (clean[offset] === '"') {
      offset = quotedEnd(clean, offset);
      continue;
    }
    if (offset > 0 && /[\w$]/.test(clean[offset - 1]!)) {
      offset++;
      continue;
    }
    if (!/[ius]/.test(clean[offset]!)) {
      offset++;
      continue;
    }
    const remaining = clean.slice(offset);
    const include = /^(include|use)\s*<([^>\n]+)>/.exec(remaining);
    if (include) {
      refs.push({ kind: include[1] as "include" | "use", path: include[2]!.trim() });
      offset += include[0].length;
      continue;
    }
    const imported = /^(import|surface)\s*\(\s*(?:file\s*=\s*)?"((?:[^"\\\n]|\\.)*)"/.exec(
      remaining,
    );
    if (imported) {
      refs.push({ kind: imported[1] as "import" | "surface", path: imported[2]! });
      offset += imported[0].length;
      continue;
    }
    offset++;
  }
  return refs;
}

/** OpenSCAD first searches beside the including source; library directories are excluded. */
export function resolveScadReference(fromFile: string, reference: ScadReference): string {
  return NodePath.resolve(NodePath.dirname(fromFile), reference.path);
}
