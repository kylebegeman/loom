import {
  EnclosureRequirements,
  EnclosureRequirementsPatch,
  EnclosureReport,
} from "./pcb-enclosure.ts";
import { ASSEMBLY_MAX_REGIONS } from "./model-check-limits.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ModelFormat } from "./model-preview-3d.ts";
import { ModelPoint } from "./model-workspace.ts";

export const ASSEMBLY_SUFFIX = ".loom-assembly.json";
export const ASSEMBLY_FILE_VERSION = 2;
export const ASSEMBLY_CHECK_VERSION = 2;
export const ASSEMBLY_MAX_PARTS = 32;
export const ASSEMBLY_MAX_CLEARANCES = 32;
export const ASSEMBLY_MAX_OPERATIONS = 64;
export const ASSEMBLY_MAX_BYTES = 256 * 1024;
export { ASSEMBLY_MAX_REGIONS } from "./model-check-limits.ts";

const finite = Schema.Number.check(Schema.isFinite());
const mm = finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 }));
const degrees = finite.check(Schema.isBetween({ minimum: -360, maximum: 360 }));
const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
export const AssemblyId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,47}$/));
export const AssemblyVec3 = Schema.Tuple([mm, mm, mm]);
export const AssemblyRotation = Schema.Tuple([degrees, degrees, degrees]);
export const AssemblyColor = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/));
const zero = Effect.succeed([0, 0, 0] as const);

export const AssemblyPart = Schema.Struct({
  id: AssemblyId,
  name: label,
  /** POSIX path relative to the assembly file's directory. May use "../". */
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  position: AssemblyVec3.pipe(Schema.withDecodingDefault(zero)),
  rotation: AssemblyRotation.pipe(Schema.withDecodingDefault(zero)),
  /** Overrides the file's materials. null keeps them. */
  color: Schema.NullOr(AssemblyColor).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  visible: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** SCAD only: name -> OpenSCAD literal, as ScadRenderInput.overrides. */
  parameters: Schema.Record(label, Schema.String.check(Schema.isMaxLength(2000)))
    .check(Schema.isMaxProperties(256))
    .pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  parameterSet: Schema.NullOr(label).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Explode offset in mm at full explode. null: away from the assembly centre. */
  explode: Schema.NullOr(AssemblyVec3).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});

export const AssemblyClearance = Schema.Struct({
  id: AssemblyId,
  a: AssemblyId,
  b: AssemblyId,
  requiredMm: finite.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
  label: Schema.NullOr(label).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});

export const AssemblyEnclosure = Schema.Struct({
  board: AssemblyId,
  parts: Schema.Array(AssemblyId)
    .check(Schema.isMaxLength(ASSEMBLY_MAX_PARTS))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  requirements: EnclosureRequirements.pipe(
    Schema.withDecodingDefault(Effect.succeed(Schema.decodeUnknownSync(EnclosureRequirements)({}))),
  ),
});
export const ModelAssembly = Schema.Struct({
  enclosure: Schema.NullOr(AssemblyEnclosure).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  format: Schema.Literal("loom-assembly"),
  version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  units: Schema.Literal("mm").pipe(Schema.withDecodingDefault(Effect.succeed("mm" as const))),
  name: label,
  parts: Schema.Array(AssemblyPart)
    .check(Schema.isMaxLength(ASSEMBLY_MAX_PARTS))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  clearances: Schema.Array(AssemblyClearance)
    .check(Schema.isMaxLength(ASSEMBLY_MAX_CLEARANCES))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

const Axis = Schema.Literals(["x", "y", "z"]);
export const AssemblyOperation = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("set-enclosure"),
    board: AssemblyId,
    parts: Schema.optional(AssemblyEnclosure.fields.parts),
    requirements: Schema.optional(EnclosureRequirementsPatch),
  }),
  Schema.Struct({ op: Schema.Literal("clear-enclosure") }),
  Schema.Struct({
    op: Schema.Literal("place-board"),
    id: AssemblyId,
    quarterTurns: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
    zMm: Schema.optional(mm),
  }),
  Schema.Struct({ op: Schema.Literal("swap-board"), id: AssemblyId, path: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("add-part"),
    path: Schema.String, // workspace-relative, as everywhere else in the 3D tools
    id: Schema.optional(AssemblyId),
    name: Schema.optional(label),
    position: Schema.optional(AssemblyVec3),
    rotation: Schema.optional(AssemblyRotation),
    color: Schema.optional(Schema.NullOr(AssemblyColor)),
    parameters: Schema.optional(AssemblyPart.fields.parameters),
    parameterSet: Schema.optional(Schema.NullOr(label)),
  }),
  Schema.Struct({
    op: Schema.Literal("update-part"),
    id: AssemblyId,
    name: Schema.optional(label),
    position: Schema.optional(AssemblyVec3),
    rotation: Schema.optional(AssemblyRotation),
    color: Schema.optional(Schema.NullOr(AssemblyColor)),
    visible: Schema.optional(Schema.Boolean),
    parameters: Schema.optional(AssemblyPart.fields.parameters),
    parameterSet: Schema.optional(Schema.NullOr(label)),
    explode: Schema.optional(Schema.NullOr(AssemblyVec3)),
  }),
  Schema.Struct({
    op: Schema.Literal("move-part"),
    id: AssemblyId,
    by: Schema.optional(AssemblyVec3),
    rotateBy: Schema.optional(AssemblyRotation),
  }),
  Schema.Struct({
    op: Schema.Literal("align"),
    id: AssemblyId,
    to: Schema.Union([AssemblyId, Schema.Literal("origin")]),
    axis: Axis,
    mode: Schema.Literals(["min", "center", "max", "after", "before"]),
    offsetMm: Schema.optional(mm),
  }),
  Schema.Struct({ op: Schema.Literal("remove-part"), id: AssemblyId }),
  Schema.Struct({
    op: Schema.Literal("set-clearance"),
    id: Schema.optional(AssemblyId),
    a: AssemblyId,
    b: AssemblyId,
    requiredMm: AssemblyClearance.fields.requiredMm,
    label: Schema.optional(Schema.NullOr(label)),
  }),
  Schema.Struct({ op: Schema.Literal("remove-clearance"), id: AssemblyId }),
  Schema.Struct({ op: Schema.Literal("set-name"), name: label }),
]);

export const AssemblyPartInfo = Schema.Struct({
  id: AssemblyId,
  path: Schema.NullOr(Schema.String), // workspace-relative; null when it escapes the workspace
  format: Schema.NullOr(Schema.suspend(() => ModelFormat)),
  sizeBytes: Schema.NullOr(Schema.Number),
  revision: Schema.NullOr(Schema.String), // the file's revision (fileUrl's), not a render's
  error: Schema.NullOr(Schema.String), // "The file was deleted or moved." and similar
});
export const AssemblyReadResult = Schema.Struct({
  path: Schema.String,
  revision: Schema.String, // sha256 of the file bytes, first 24 hex
  assembly: ModelAssembly,
  readOnly: Schema.Boolean,
  parts: Schema.Array(AssemblyPartInfo),
});

export const AssemblyRegion = Schema.Struct({
  point: ModelPoint,
  radiusMm: finite,
  triangles: Schema.Int,
});
export const AssemblyPairResult = Schema.Struct({
  a: AssemblyId,
  b: AssemblyId,
  clearanceId: Schema.NullOr(AssemblyId),
  requiredMm: Schema.NullOr(finite),
  status: Schema.Literals(["clear", "touching", "intersects", "inside"]),
  clearance: Schema.NullOr(Schema.Literals(["ok", "tight"])),
  minDistanceMm: Schema.NullOr(finite), // exact within the search radius, else null
  atLeastMm: Schema.NullOr(finite), // a proven lower bound when minDistanceMm is null
  closest: Schema.NullOr(Schema.Struct({ a: ModelPoint, b: ModelPoint })),
  regions: Schema.Array(AssemblyRegion).check(Schema.isMaxLength(ASSEMBLY_MAX_REGIONS)),
  complete: Schema.Boolean,
});
export const AssemblyCheckReport = Schema.Struct({
  enclosure: Schema.optional(EnclosureReport),
  version: Schema.Int,
  assemblyRevision: Schema.String,
  key: Schema.String, // cache key; the panel compares it to mark results stale
  checkedAt: Schema.String,
  durationMs: Schema.Number,
  cached: Schema.Boolean,
  complete: Schema.Boolean,
  parts: Schema.Array(
    Schema.Struct({
      id: AssemblyId,
      geometryRevision: Schema.String,
      triangles: Schema.Int,
      bounds: Schema.Struct({ min: ModelPoint, max: ModelPoint }),
    }),
  ),
  skipped: Schema.Array(Schema.Struct({ id: AssemblyId, reason: Schema.String })),
  summary: Schema.Struct({
    pairsTested: Schema.Int,
    intersecting: Schema.Int,
    touching: Schema.Int,
    tight: Schema.Int,
  }),
  pairs: Schema.Array(AssemblyPairResult), // every clearance pair, plus pairs not "clear"
});
export const AssemblyCheckResult = Schema.Struct({
  status: Schema.Literals(["ok", "cancelled"]),
  report: Schema.NullOr(AssemblyCheckReport),
});
export const AssemblyCheckOptions = Schema.Struct({
  /** Pairs to test. Default: every pair of visible parts. Clearance pairs are always tested. */
  pairs: Schema.optional(
    Schema.Array(Schema.Tuple([AssemblyId, AssemblyId])).check(Schema.isMaxLength(64)),
  ),
  allowLarge: Schema.optional(Schema.Boolean),
  force: Schema.optional(Schema.Boolean),
});
export type AssemblyPart = typeof AssemblyPart.Type;
export type AssemblyClearance = typeof AssemblyClearance.Type;
export type ModelAssembly = typeof ModelAssembly.Type;
export type AssemblyOperation = typeof AssemblyOperation.Type;
export type AssemblyPartInfo = typeof AssemblyPartInfo.Type;
export type AssemblyReadResult = typeof AssemblyReadResult.Type;
export type AssemblyRegion = typeof AssemblyRegion.Type;
export type AssemblyPairResult = typeof AssemblyPairResult.Type;
export type AssemblyCheckReport = typeof AssemblyCheckReport.Type;
export type AssemblyCheckResult = typeof AssemblyCheckResult.Type;
export type AssemblyCheckOptions = typeof AssemblyCheckOptions.Type;
export type AssemblyBounds = { readonly min: ModelPoint; readonly max: ModelPoint };

export const isAssemblyPath = (path: string) => path.toLowerCase().endsWith(ASSEMBLY_SUFFIX);
const pathParts = (path: string) => path.split("/").filter((part) => part && part !== ".");
/** Assembly paths are portable POSIX relative paths. Host realpath checks enforce symlink containment. */
export function resolvePartPath(assemblyPath: string, partPath: string): string | null {
  if (
    !partPath ||
    partPath.startsWith("/") ||
    /[\\\0]/.test(partPath) ||
    /^[a-z][a-z0-9+.-]*:/i.test(partPath)
  )
    return null;
  const parts = pathParts(assemblyPath).slice(0, -1);
  for (const part of pathParts(partPath)) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}
export function relativePartPath(assemblyPath: string, workspacePath: string) {
  const from = pathParts(assemblyPath).slice(0, -1),
    to = pathParts(workspacePath);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}
export function validateAssembly(
  doc: ModelAssembly,
  assemblyPath?: string,
): { path: string; message: string } | null {
  const ids = new Set<string>(),
    clearanceIds = new Set<string>(),
    pairs = new Set<string>();
  for (const [index, part] of doc.parts.entries()) {
    const at = `parts[${index}]`;
    if (ids.has(part.id)) return { path: `${at}.id`, message: "Part ids must be unique." };
    ids.add(part.id);
    if (
      part.path.startsWith("/") ||
      /[\\\0]/.test(part.path) ||
      /^[a-z][a-z0-9+.-]*:/i.test(part.path) ||
      (assemblyPath && !resolvePartPath(assemblyPath, part.path))
    )
      return { path: `${at}.path`, message: "Part paths must remain inside the workspace." };
    if (isAssemblyPath(part.path))
      return { path: `${at}.path`, message: "Assemblies cannot contain other assemblies." };
    if (
      !/\.(scad|py)$/i.test(part.path) &&
      (Object.keys(part.parameters).length || part.parameterSet)
    )
      return { path: `${at}.parameters`, message: "Parameters require a source CAD file." };
  }
  for (const [index, clearance] of doc.clearances.entries()) {
    const at = `clearances[${index}]`;
    if (clearanceIds.has(clearance.id))
      return { path: `${at}.id`, message: "Clearance ids must be unique." };
    clearanceIds.add(clearance.id);
    if (!ids.has(clearance.a) || !ids.has(clearance.b))
      return { path: at, message: "Clearances must name existing parts." };
    if (clearance.a === clearance.b) return { path: at, message: "Choose two different parts." };
    const pair = [clearance.a, clearance.b].sort().join("\0");
    if (pairs.has(pair)) return { path: at, message: "Keep one clearance per part pair." };
    pairs.add(pair);
  }
  if (doc.enclosure) {
    const board = doc.parts.find((p) => p.id === doc.enclosure!.board);
    if (!board || !/\.glb$/i.test(board.path))
      return { path: "enclosure.board", message: "Choose an existing GLB board part." };
    if (
      new Set(doc.enclosure.parts).size !== doc.enclosure.parts.length ||
      doc.enclosure.parts.some((id) => id === board.id || !ids.has(id))
    )
      return { path: "enclosure.parts", message: "Choose unique case parts other than the board." };
  }
  return null;
}
/** Column-major T(position) · Rx(x) · Ry(y) · Rz(z), matching three Euler XYZ. */
export function partMatrix(position: ModelPoint, rotation: ModelPoint): readonly number[] {
  const [x, y, z] = rotation.map((angle) => (angle * Math.PI) / 180),
    a = Math.cos(x!),
    b = Math.sin(x!),
    c = Math.cos(y!),
    d = Math.sin(y!),
    e = Math.cos(z!),
    f = Math.sin(z!);
  return [
    c * e,
    a * f + b * e * d,
    b * f - a * e * d,
    0,
    -c * f,
    a * e - b * f * d,
    b * e + a * f * d,
    0,
    d,
    -b * c,
    a * c,
    0,
    ...position,
    1,
  ];
}
export function composeRotation(rotation: ModelPoint, rotateBy: ModelPoint): ModelPoint {
  const old = partMatrix([0, 0, 0], rotation),
    added = partMatrix([0, 0, 0], rotateBy);
  const m = Array<number>(9).fill(0);
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++)
      for (let inner = 0; inner < 3; inner++)
        m[column * 3 + row]! += added[inner * 4 + row]! * old[column * 4 + inner]!;
  const y = Math.asin(Math.max(-1, Math.min(1, m[6]!))),
    x = Math.abs(m[6]!) < 0.9999999 ? Math.atan2(-m[7]!, m[8]!) : Math.atan2(m[5]!, m[4]!),
    z = Math.abs(m[6]!) < 0.9999999 ? Math.atan2(-m[3]!, m[0]!) : 0;
  return [x, y, z].map((value) => {
    const rounded = Math.round(((value * 180) / Math.PI) * 1e6) / 1e6;
    return rounded <= -180 ? 180 : rounded;
  }) as [number, number, number];
}
export function alignPosition(input: {
  position: ModelPoint;
  bounds: AssemblyBounds;
  target: AssemblyBounds;
  axis: "x" | "y" | "z";
  mode: "min" | "center" | "max" | "after" | "before";
  offsetMm?: number;
}): ModelPoint {
  const axis = { x: 0, y: 1, z: 2 }[input.axis],
    offset = input.offsetMm ?? 0,
    partMin = input.bounds.min[axis]!,
    partMax = input.bounds.max[axis]!,
    targetMin = input.target.min[axis]!,
    targetMax = input.target.max[axis]!;
  const delta =
    input.mode === "center"
      ? (targetMin + targetMax - partMin - partMax) / 2 + offset
      : input.mode === "max"
        ? targetMax - partMax + offset
        : input.mode === "after"
          ? targetMax - partMin + offset
          : input.mode === "before"
            ? targetMin - partMax - offset
            : targetMin - partMin + offset;
  return input.position.map((value, index) => value + (axis === index ? delta : 0)) as [
    number,
    number,
    number,
  ];
}
export function slugId(name: string, taken: ReadonlySet<string> | readonly string[]) {
  const ids = taken instanceof Set ? taken : new Set(taken),
    stem =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)
        .replace(/-$/g, "") || "part";
  if (!ids.has(stem)) return stem;
  for (let index = 2; ; index++) {
    const suffix = `-${index}`,
      id = stem.slice(0, 48 - suffix.length) + suffix;
    if (!ids.has(id)) return id;
  }
}
