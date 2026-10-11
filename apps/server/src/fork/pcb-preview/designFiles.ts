// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { isPcbSource } from "./sourceFiles.ts";

export const isDesignSource = isPcbSource;
export const isReferenceSource = (kind: "kicad" | "tscircuit", name: string) =>
  kind === "tscircuit"
    ? /\.(?:[cm]?[jt]sx?|json)$/i.test(name)
    : /(?:\.kicad_sch|sym-lib-table|fp-lib-table)$/i.test(name);
export const designReferences = (kind: "kicad" | "tscircuit", text: string) =>
  Array.from(
    text.matchAll(
      kind === "tscircuit"
        ? /["'`]((?:\.\.?\/)[^"'`\r\n]+)["'`]/g
        : /(?:\(property\s+"Sheetfile"\s+"|\(uri\s+")([^"\n]+)"/gi,
    ),
    (match) => match[1]!,
  );
export const isDesignFile = (kind: "kicad" | "tscircuit", name: string) =>
  kind === "kicad" ? /\.kicad_(?:pro|sch|pcb|dru)$/i.test(name) : /\.(?:[cm]?[jt]sx?)$/i.test(name);
const ignored = new Set([
  "node_modules",
  ".git",
  ".t3",
  ".loom",
  "fab",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  "vendor",
]);
export const allowedDesignPath = (name: string) =>
  !NodePath.posix.isAbsolute(name) &&
  !name
    .split("/")
    .some(
      (part) =>
        part === ".." || ignored.has(part) || part.startsWith("~") || part.endsWith("-backups"),
    ) &&
  !/[\0\r\n\\]/.test(name);
export class DesignSetLimit extends Schema.TaggedError<DesignSetLimit>()("DesignSetLimit", {
  message: Schema.String,
}) {}
export interface DesignSetIo<E = never> {
  readonly read: (path: string) => Effect.Effect<string | null, E>;
  readonly list: (directory: string) => Effect.Effect<readonly string[], E>;
  readonly exists: (path: string) => Effect.Effect<boolean, E>;
}
/** Follow only this design's literal local references; neighbouring designs are never seeds. */
export const designSet = <E>(input: {
  kind: "kicad" | "tscircuit";
  seeds: readonly string[];
  projectDirectory: string;
  io: DesignSetIo<E>;
}) =>
  Effect.gen(function* () {
    const paths = new Set<string>();
    let frontier = [...input.seeds];
    for (let depth = 0; frontier.length; depth++) {
      if (depth > 16)
        return yield* new DesignSetLimit({ message: "This design's references exceed 16 levels." });
      const next: string[] = [];
      for (const candidate of frontier) {
        const name = NodePath.posix.normalize(candidate);
        if (!allowedDesignPath(name) || paths.has(name) || !(yield* input.io.exists(name)))
          continue;
        if (!isDesignSource(input.kind, name)) {
          next.push(...(yield* input.io.list(name)));
          continue;
        }
        paths.add(name);
        if (paths.size > 2000)
          return yield* new DesignSetLimit({
            message: "This design has more than 2,000 source files.",
          });
        if (!isReferenceSource(input.kind, name)) continue;
        const source = yield* input.io.read(name);
        if (source === null) continue;
        for (const raw of designReferences(input.kind, source)) {
          const expanded = raw.replaceAll("${KIPRJMOD}", "/" + input.projectDirectory);
          if (
            expanded.includes("${") ||
            (NodePath.posix.isAbsolute(expanded) && !raw.includes("${KIPRJMOD}"))
          )
            continue;
          // KIPRJMOD is workspace-relative here; absolute host references stay excluded.
          const target = raw.includes("${KIPRJMOD}")
            ? NodePath.posix.normalize(expanded).slice(1)
            : NodePath.posix.join(NodePath.posix.dirname(name), expanded);
          if (!allowedDesignPath(target)) continue;
          if (yield* input.io.exists(target)) next.push(target);
          else if (input.kind === "tscircuit") {
            for (const suffix of [
              ".tsx",
              ".ts",
              ".jsx",
              ".js",
              ".mjs",
              ".cjs",
              ".json",
              "/index.tsx",
              "/index.ts",
              "/index.js",
            ]) {
              if (yield* input.io.exists(target + suffix)) {
                next.push(target + suffix);
                break;
              }
            }
          }
        }
      }
      frontier = next;
    }
    return {
      design: [...paths].filter((name) => isDesignFile(input.kind, name)).sort(),
      supporting: [...paths].filter((name) => !isDesignFile(input.kind, name)).sort(),
    };
  });
export function designSeeds(kind: "kicad" | "tscircuit", entry: string, packageDirectory: string) {
  const directory = NodePath.posix.dirname(entry);
  const stem = entry.replace(/\.kicad_(?:pro|sch|pcb)$/i, "");
  return kind === "kicad"
    ? [
        entry,
        ...["pro", "sch", "pcb", "dru"].map((ext) => `${stem}.kicad_${ext}`),
        ...["sym-lib-table", "fp-lib-table"].map((name) => NodePath.posix.join(directory, name)),
      ]
    : [
        entry,
        ...["package.json", "tscircuit.config.json"].map((name) =>
          NodePath.posix.join(packageDirectory, name),
        ),
      ];
}
