# L48 technical

## Overview

An assembly is a JSON file whose name ends in `.loom-assembly.json`. The server owns reading,
validating and writing it, so the panel, the agent tools and a hand edit all go through one set
of rules. The panel opens the file in the existing `ModelFile` component with a second kind of
model source: instead of one signed mesh it builds a `Group` of parts, each loaded from its own
signed URL or SCAD render and placed by the file's transform. Explode, isolate and selection are
client view state. The fit check runs on the host in L46's worker with two new request kinds:
`bounds` (exact bounds of a rotated part, used by `align`) and `assembly` (interference and
clearance between parts).

```
*.loom-assembly.json --read/validate--> AssemblyReadResult --> useAssembly (web)
        ^                                                       |  fileUrl / renderScad per part
        | atomic write, expectedRevision                        v
updateAssembly(ops) <-- panel fields, MCP tool          viewer/assembly.ts Group in createViewer
checkAssembly --> worker { kind: "assembly" } --> AssemblyCheckReport --> Fit tab, pins
```

Coordinates: millimetres, +Z up, the viewer's frame. Each part's local frame is whatever its
loader produces today (`apps/web/src/fork/model-preview-3d/viewer/load.ts`: 3MF units to mm,
glTF metres and +Y up to mm and +Z up at `:156-158`). World = T(position) · R(rotation) · local,
where R is the intrinsic Euler rotation in three.js "XYZ" order:
`R = Rx(a) · Ry(b) · Rz(c)` with angles in degrees. A part's saved L35 `orientation` entity is
ignored: in an assembly, rotation is explicit in the file.

## Contracts

### New file `packages/contracts/src/fork/model-assembly.ts`

```ts
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
export const ASSEMBLY_MAX_REGIONS = 10;

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
  /** SCAD or build123d: name -> compatible literal, as ScadRenderInput.overrides. */
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

export const ModelAssembly = Schema.Struct({
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
```

Cross-field rules that a schema cannot express are checked by `validateAssembly(doc)` in the
same file, a pure function returning the first problem as `{ path: "parts[2].id", message }` or
null: part ids unique; clearance ids unique; clearance `a` and `b` name existing parts and
differ; at most one clearance per unordered pair; `parameters` and `parameterSet` empty unless
the part path ends in `.scad`; part path not absolute, no `\` or NUL, and its resolution stays
inside the workspace (below). `version` greater than `ASSEMBLY_FILE_VERSION` decodes but is
read-only: "This assembly was saved by a newer Loom. It opens read-only."

Unknown top-level and part fields are dropped when Loom writes the file. That is safe because
newer versions are read-only.

L67 (PCB enclosure fit) extends this format: version 2 adds an optional top-level `enclosure`
section, the operations `set-enclosure`, `clear-enclosure`, `place-board` and `swap-board`, and
`ASSEMBLY_CHECK_VERSION = 2` for its four board-in-case checks. The writer uses version 2 when enclosure requirements are present and version 1 otherwise; see [L67 TECHNICAL.md](../L67-pcb-enclosure-fit/TECHNICAL.md).

Example, as written by Loom (two-space indent, keys in schema order, trailing newline):

```json
{
  "format": "loom-assembly",
  "version": 1,
  "units": "mm",
  "name": "Sensor node",
  "parts": [
    {
      "id": "case",
      "name": "Case",
      "path": "case.scad",
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "color": null,
      "visible": true,
      "parameters": { "wall": "2" },
      "parameterSet": null,
      "explode": null
    },
    {
      "id": "board",
      "name": "Board",
      "path": "../.loom/pcb-references/sensor-3f0a.glb",
      "position": [2.5, 2.5, 3],
      "rotation": [0, 0, 0],
      "color": null,
      "visible": true,
      "parameters": {},
      "parameterSet": null,
      "explode": [0, 0, 25]
    }
  ],
  "clearances": [
    { "id": "board-case", "a": "board", "b": "case", "requiredMm": 0.3, "label": null }
  ]
}
```

(The writer puts each part on several lines; the example is folded for width.)

Pure helpers in the same file, shared by server and web:

- `isAssemblyPath(path)`: `path.toLowerCase().endsWith(ASSEMBLY_SUFFIX)`.
- `resolvePartPath(assemblyPath, partPath)`: `posix.normalize(posix.join(dirname, partPath))`;
  null when the result starts with `../` or is `..`. Implemented with string operations, not
  `node:path`, since contracts run in the browser.
- `relativePartPath(assemblyPath, workspacePath)`: the inverse, for `add-part`.
- `partMatrix(position, rotation)`: column-major 16 numbers, three.js `Matrix4` layout.
- `composeRotation(rotation, rotateBy)`: Euler of `R(rotateBy) · R(rotation)` (the extra turn is
  about world axes), each angle rounded to 1e-6 and normalized to (-180, 180].
- `alignPosition({ position, bounds, target, axis, mode, offsetMm })`: the new position after
  moving only along `axis` so that the part's world bounds meet the target bounds. Modes: `min`
  (minimums equal), `center`, `max`, `after` (part min = target max + offset; "on top of" on Z,
  "right of" on X, "behind" on Y) and `before` (part max = target min - offset). The target
  `origin` is the zero-size box at `[0, 0, 0]`, so "Drop to bed" is `{ axis: "z", mode: "min",
target: origin }`: the assembly's floor is `z = 0`, and the viewer's bed sits under the lowest
  part as it does for single models (`viewer/createViewer.ts:431-440`).
- `slugId(name, taken)`: lowercase, non-alphanumerics to `-`, trimmed to 48, `-2`, `-3` on
  collision.

### Operations

```ts
const Axis = Schema.Literals(["x", "y", "z"]);
export const AssemblyOperation = Schema.Union([
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
```

The discriminator is `op`, as `ModelWorkspaceOperation` uses `kind` (`model-workspace.ts:69-80`).
An agent sends `{ "op": "move-part", "id": "board", "by": [0, 0, 2] }`. Rules: operations apply
in order to a copy and the write happens only if every one succeeds; `remove-part` also removes
its clearances; `set-clearance` upserts by unordered pair, default id `<a>-<b>`; `move-part` rotates
about the part's origin, not its centre (the same thing the file stores); `align` needs the bounds
of both parts after any earlier operation in the same call, which the server computes (Server).

### Results and reports

```ts
export const AssemblyPartInfo = Schema.Struct({
  id: AssemblyId,
  path: Schema.NullOr(Schema.String), // workspace-relative; null when it escapes the workspace
  format: Schema.NullOr(ModelFormat),
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
```

Points are world (assembly) millimetres. `regions` are clusters of crossing triangle pairs;
"touching" pairs carry one region at the contact so the panel can show where.

### `packages/contracts/src/fork/model-preview-3d.ts`

- `MODEL_PREVIEW_3D_WS_METHODS` (`:10-28`) gains `assembly`, `updateAssembly` and
  `checkAssembly` (`"loom.model-preview-3d.assembly"` and so on).
- RPCs, after `listModels` (`:353-357`):

```ts
rpc(M.assembly, ModelFileRef, AssemblyReadResult),
rpc(
  M.updateAssembly,
  Schema.Struct({
    file: ModelFileRef,
    operations: Schema.Array(AssemblyOperation).check(
      Schema.isMinLength(1), Schema.isMaxLength(ASSEMBLY_MAX_OPERATIONS),
    ),
    expectedRevision: Schema.optional(Schema.String),
  }),
  AssemblyReadResult,
),
rpc(
  M.checkAssembly,
  Schema.Struct({
    file: ModelFileRef,
    requestId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))),
    ...AssemblyCheckOptions.fields,
  }),
  AssemblyCheckResult,
),
```

Cancellation reuses L46's `cancelPrintCheck` (same `{ file, requestId }` payload): the server
keeps one map of running checks keyed by thread and request id for both kinds.

- `listModels` success gains `assemblies`, with a decoding default so a newer client reading an
  older server still decodes:

```ts
export const AssemblyEntry = Schema.Struct({
  path: Schema.String, sizeBytes: Schema.Number, modifiedAt: Schema.String,
});
// in the listModels success struct
assemblies: Schema.Array(AssemblyEntry).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
```

An assembly is deliberately not a `ModelFormat` literal (`:40`): older clients decode the
`models` array with that literal union, and one unknown value would fail the whole listing.

- `ModelPreviewError.reason` (`:267-276`) gains `"conflict"` (shared with L51, which adds the
  same literal; whichever lands first adds it) and L46's `"unavailable"` if L46 has not landed.

### `packages/contracts/src/fork/model-editor.ts`

- `ModelEditorAction.action` (`:5-34`) gains `"explode"`, `"isolate"` and `"select-part"`.
- New optional field `explode: Schema.optional(finite.check(Schema.isBetween({ minimum: 0,
maximum: 1 })))`. `isolate` and `select-part` use the existing `name` (a part id; omitted
  clears).
- `ModelEditorState` (`:65-82`) gains

```ts
assembly: Schema.optional(Schema.Struct({
  revision: Schema.String,
  explode: Schema.Number,
  isolated: Schema.NullOr(Schema.String),
  selected: Schema.NullOr(Schema.String),
  parts: Schema.Array(Schema.Struct({
    id: Schema.String, name: Schema.String, visible: Schema.Boolean,
    loaded: Schema.Boolean, triangles: Schema.NullOr(Schema.Int),
    error: Schema.NullOr(Schema.String),
  })),
})),
```

`completeEditor` copies `state` as a whole (`ModelPreviewService.ts:894`), so no server
change is needed for it.

### Permissions and capability

- `updateAssembly` uses `AuthOrchestrationOperateScope`; operations that need rendered bounds
  additionally require terminal access. `checkAssembly` uses `AuthTerminalOperateScope` because
  assemblies can contain Python source parts. `assembly` is a read like `listModels`.
- `apps/server/src/fork/features.ts`: add `"model-assemblies"` to `LOOM_SERVER_FEATURES`. The
  web shows "New assembly" and the Assemblies filter only when the server lists it.

## Server

### Files

All under `apps/server/src/fork/model-preview-3d/`.

| File                          | Purpose                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `assembly/service.ts`         | Assembly persistence, listing and atomic update operations.                                              |
| `assembly/operations.ts`      | Ordered placement and clearance operations, with bounds supplied by the checker.                         |
| `assembly/geometry.ts`        | Resolve meshes, render source parts and probe geometry revisions without rereading mesh bytes.           |
| `assembly/checker.ts`         | Bounds and fit requests, revision caches and report assembly.                                            |
| `check/assemblyChecks.ts`     | Broad phase, triangle distance, contact classification, containment and connected regions in the worker. |
| `check/coordinator.ts`        | Shared print/assembly worker permit and request cancellation.                                            |
| `check/protocol.ts`           | `BoundsRequest`, `AssemblyWorkerRequest` and typed replies.                                              |
| `check/model-check-worker.ts` | Dispatch bounds, assembly and print requests.                                                            |

### Service factory

`ModelPreviewService.make` creates the shared check coordinator, geometry resolver, checker
and persistence service. The geometry resolver uses the existing file resolution, rendering,
metadata and cache protection helpers. The checker receives geometry and revision callbacks;
the persistence service receives bounds callbacks for placement. Print checks use the same
coordinator, so assembly checks share its worker limit and cancellation path.

### Reading

`assembly(file)`:

1. Not `isAssemblyPath(file.path)`: `unsupported-format`, "Choose a .loom-assembly.json file."
2. `resolveFile(file)`; size above `ASSEMBLY_MAX_BYTES`: `too-large`, "This assembly file is
   larger than 256 KB."
3. Read bytes, `revision = sha256(bytes).slice(0, 24)`. Content, not `metadata`, because a
   writer that preserves size and mtime must still conflict.
4. Decode `Schema.fromJsonString(ModelAssembly)`. A failure is `invalid-parameter` with the
   first issue's path and message ("parts[2].rotation: Expected a number between -360 and
   360"). Then `validateAssembly`.
5. Part infos, `concurrency: 8`: `resolvePartPath`, then `resolveFile` for existence, size and
   revision; the format comes from the service's `formats` map (`:71-80`). Errors are per part
   and never fail the read. STEP and build123d parts use L50's renderer;
   assembly files as parts get "Assemblies cannot contain other assemblies."

### Writing

`updateAssembly({ file, operations, expectedRevision })`:

1. Serialize writers per absolute path with a `Map<string, Semaphore>` (one permit). Two
   clients saving at once queue; the second sees the first's revision.
2. Read as above, or start from `{ format, version: 1, units: "mm", name: <file stem>, parts:
[], clearances: [] }` when the file does not exist and `expectedRevision` is absent. A
   missing file with an `expectedRevision` is `not-found`.
3. `expectedRevision` set and different from the current revision: `conflict`, "The assembly
   changed since you read it. Read it again and retry." Read-only (newer version): `conflict`
   with the read-only message.
4. `applyOperations`; the first failure is `invalid-parameter`, "operations[2]: No part with id
   \"lid\"." `add-part` paths are workspace-relative and checked with `resolveFile`; the stored
   path is `relativePartPath`. `align` calls `ctx.bounds`, which needs the part's geometry
   (Bounds). Limits are checked on the result (32 parts, 32 clearances, 256 KB serialized).
5. Write `JSON.stringify(encoded, null, 2) + "\n"` to `<dir>/.<name>.<random>.tmp` and
   `fs.rename` it over the file, so a reader or the watcher never sees half a file. The parent
   directory must exist; Loom does not create directories for assemblies.
6. Return the new `AssemblyReadResult`.

No write ever touches a part file or its sidecar. Operations from the panel and an agent are
the same code.

### Bounds

`align` needs exact world bounds of a part under its rotation. `boundsOf(part)`:

- Mesh parts: read bytes as L46's checker does (format, size limit, `allowLarge` false, revision
  retry) and run the worker with `{ kind: "bounds", format, files, rotation: 9 numbers }`. The
  worker parses, transforms every vertex by the rotation and returns `{ min, max, triangles }`.
- SCAD and build123d parts: `renderModel({ variantId: asmCheckVariant(file, part), file: partFile, overrides:
part.parameters, parameterSet: part.parameterSet })`, then the same worker request on the
  render output under `protectStem`. With no rotation, `summary.boundingBox` from the render
  result is exact and the worker is skipped.
- Translation is added on the main thread. Results are cached in an LRU of 128 keyed by
  `sha256([geometryRevision, rotation])`.

The worker is used even for bounds because a rotated box of the unrotated box is larger than the
part: "on top of" would leave a gap. When the worker is unavailable (single-file executable),
`align` fails with L46's "unavailable" reason; every other operation still works.

### Fit check

`checkAssembly({ file, requestId?, pairs?, allowLarge?, force? })`:

1. Read the assembly. Involved parts: both sides of every clearance and, when `pairs` is absent,
   every visible part; else the parts named in `pairs`. Missing and failing parts are
   listed in `skipped` and their pairs omitted. STEP parts are tessellated through L50.
2. Geometry per involved part as in Bounds (source files through their own check variant). The total
   triangle count is capped at L46's `PRINT_CHECK_MAX_TRIANGLES` (3,000,000): "These parts have
   too many triangles to check together (4,100,000). The limit is 3,000,000. Check fewer pairs."
3. Key: `sha256([ASSEMBLY_CHECK_VERSION, parts.map(id, geometryRevision, position, rotation),
pairs, clearances])`. LRU of 16 reports. Visibility is not in the key when `pairs` or
   clearances name the parts explicitly.
4. Miss: `jobs.run(key, slot.withPermit(runCheckWorker(request, { timeoutMs: 60_000 })))`, the
   same jobs, permit and cancellation map as `checkPrint`, so an assembly check and a print check
   never run at the same time on one environment.
5. Request: `{ kind: "assembly", parts: [{ id, format, files, matrix }], pairs: [{ a, b,
requiredMm }], limits }`. Each part's files are transferred, as in L46.

`asmCheckVariant(file, part)` is `"asmchk-" + sha256(file.path).slice(0, 8) + "-" + part.id`.
The panel's renders use `"asm-..."` instead. The prefixes keep three callers apart:
`renderScad` interrupts an earlier job with the same key (`ModelPreviewService.ts:591`), and
neither prefix saves last-used parameters (`:567`).

### Worker algorithms

Each part is parsed with L46's readers into a triangle soup (no weld needed for these tests;
containment uses L46's weld and topology when it needs a watertight test), transformed by its
matrix, and given a world AABB.

Interference, per pair (A, B), where A is the part with fewer triangles:

1. Broad phase: the two AABBs, expanded by `eps = max(1e-4, 1e-6 * sceneDiagonal)` mm. No
   overlap: `clear`.
2. Overlap box `O`. Only B's triangles whose boxes meet `O` go into a uniform grid over `O`
   (L46's `grid.ts`, same cell size rule and caps). A's triangles whose boxes meet `O` are tested
   against the triangles in the cells they cover, with a per-A-triangle stamp so each B triangle
   is tested once.
3. Triangle-triangle test: Guigue and Devillers' robust orientation-predicate test (an improved
   form of Moller's interval test), with `eps` applied to the orientation determinants.
   Classification of an intersecting pair: if all three vertices of one triangle are within
   `eps` of the other's plane (coplanar) or one triangle's vertices are all on one side within
   `eps` (grazing at an edge or vertex), it is a contact; otherwise a crossing.
4. Status: any crossing is `intersects`; only contacts is `touching`; none goes to containment.
5. Containment: when no triangles intersect and A's AABB is inside B's, cast rays from A's first
   vertex along +X, +Y and +Z through B's grid (Moller and Trumbore, as L46's `grid.ts`) and
   count crossings; two or three odd counts is `inside`. Only meaningful when B is closed, so B
   is welded and checked with L46's topology first; an open B skips containment and the pair
   stays `clear` with `complete: false`.
6. Regions: crossing (or contact) segment midpoints are clustered on a 2 mm grid with
   union-find over neighbouring cells, as L46 clusters wall samples. Up to
   `ASSEMBLY_MAX_REGIONS` largest clusters, each with centroid, radius and triangle count.

Clearance, for clearance pairs that are not `intersects`:

1. Search radius `r = max(2 * requiredMm, 0.5)` mm. Expanded AABB gap greater than `r`:
   `minDistanceMm` null, `atLeastMm` the AABB gap (a sound lower bound), `clearance: "ok"` when
   it is at least `requiredMm`.
2. Otherwise B's triangles within `r` of `O` go into a grid; for each A triangle, the cells
   within `r` of its box give candidates. Candidates are sorted by box distance; a pair whose box
   distance is not below the best so far is skipped (branch and bound).
3. Exact triangle-triangle distance as in Ericson, section 5.1.11: zero when they intersect,
   otherwise the minimum of the six point-to-triangle and nine segment-to-segment distances,
   with the closest points kept.
4. Found: `minDistanceMm` and `closest`; none within `r`: `atLeastMm: r`. `clearance` is `ok`
   when the distance (or bound) is at least `requiredMm`, else `tight`. A touching pair has
   distance 0 and is `tight` unless `requiredMm` is 0.

Limits: 50,000,000 triangle-triangle tests and 20,000,000 distance evaluations per check. Hitting
one stops that pair with `complete: false`, and the report with `complete: false`; pairs already
done keep their results. The 60 second timeout still applies.

### Listing

`listModels` (`ModelPreviewService.ts:984-1010`) gains a second filter over the same listing for
`isAssemblyPath`, returning `assemblies` sorted by path (cap 500). It also lists
`.loom/pcb-references` with `entries.list({ cwd: root, directoryPath: ".loom/pcb-references" })`
when that directory exists, and merges its `.glb` files into `models` (deduplicated by path),
because the workspace index may skip dot directories. These are the files
`loom_pcb_export_reference` writes (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:
2392-2468`). Their `.json` metadata is not listed.

### Transports

- `rpc.ts`: `[M.assembly]`, `[M.updateAssembly]`, `[M.checkAssembly]`, each
  `auth.effect(M.x, service.x(input))` as the existing handlers do (`rpc.ts:19-35`).
- `mcp.ts`: two tools (Agent-facing tools).

## Storage

The assembly file is the only persistent state this packet adds, and it lives in the
repository. Nothing new goes into T3 home.

- Saved views, measurements and annotations for an assembly are ordinary workspace entities
  keyed by the assembly path; `resolveWorkspace` does not check the extension, so they work
  unchanged.
- Part renders reuse the SCAD render cache; bounds and check reports are in-memory LRUs.
- PCB reference GLBs live in `.loom/pcb-references/`. Whether that folder is committed is the
  repository's choice; an assembly that points at an uncommitted reference shows the part as
  missing on another machine until the board is exported there. The Parts row says so: "Export
  the board from the PCB view to restore this part."

## Clients

### Runtime

`packages/client-runtime/src/fork/model-preview-3d.ts` gains `assembly`
(`"loom:model-assembly"`), `updateAssembly` (`"loom:model-assembly-update"`) and
`checkAssembly` (`"loom:model-assembly-check"`), all `createEnvironmentRpcCommand`, beside the
existing commands (`:34-91`). `assembly` is a command, not an atom: the panel re-reads it on each
watch event of the assembly file.

### Panel routing

`ModelPanel` (`ModelPanel.tsx:1165-1187`) is unchanged; `ModelFile` (`:90`) decides the kind
before its format detection (`:102-104`), which would otherwise read the `.json` extension:
`const kind = isAssemblyPath(path) ? "assembly" : format === "scad" ? "scad" : "mesh"`. For
`"assembly"`:

- The mesh, render and SCAD session state is not used; `useAssembly` replaces it.
- `geometryRevision` (used for `sourceRevision` of markup) is `sha256` of the assembly revision
  and every loaded part's revision, so annotations become stale after a part change exactly as
  they do for single models.
- The editor actions for parameters (`parameters`, `parameter-set`, `parameter-preview`,
  `parameter-history`) answer "Open the part's own file to change its parameters."

### `useAssembly.ts` (new)

`useAssembly(threadRef, path, viewer)` returns `{ read, parts, scene, source, status, update,
undo, explode, setExplode, isolated, setIsolated, selected, setSelected }`.

- Reads with `assembly`, and again on every event from the existing `watch` RPC on the assembly
  path. The new document is diffed by part id: transform, colour, visibility and explode apply
  in place; a changed `path`, `parameters` or `parameterSet` reloads that part; added parts load;
  removed parts are disposed.
- Each part has its own `watch` subscription on its resolved path (at most 32 streams). An event
  reloads that part only: `fileUrl` (or `renderScad` with `"asm-" + sha256(path).slice(0, 8) +
"-" + part.id`) then `loadModel` into a fresh object, swapped into the part's group, the old one
  passed to `disposeModel` (`viewer/load.ts:20-45`).
- Loading: a queue with concurrency 4, in document order. A running triangle total enforces a
  5,000,000 triangle display budget; parts past it wait with "Not loaded: over the display
  budget" until "Load anyway". Files over `maxFileMegabytes` use the existing `allowLarge` path
  per part.
- `update(operations)`: sends `updateAssembly` with `expectedRevision`; on success applies the
  returned document (the file watch event that follows is then a no-op, since the revision
  matches). On `conflict` it re-reads and shows "The assembly changed on another client. Reload
  to see the latest." The last change keeps its inverse operations for one "Undo" in the toast.
- While a numeric field is being edited, the part moves locally on each valid value; the write
  happens on commit (Enter, blur, stepper release, quarter-turn click).

### Viewer

New `viewer/assembly.ts` (the follow-ups file naming, MODEL-3D-FOLLOW-UPS.md "Shared touch
points"):

```ts
export function createAssemblyScene(): {
  root: Group;
  setPart(id: string, object: Object3D | null, part: AssemblyPart): void;
  removePart(id: string): void;
  assembledBox(): Box3; // visible parts at explode 0, cached until a part changes
  setExplode(factor: number): void;
  setIsolated(id: string | null): void;
  setSelected(id: string | null): void;
  partAt(object: Object3D): string | null; // walks parents to userData.loomPartId
  dispose(): void;
};
export function explodeOffset(
  center: Vector3,
  partCenter: Vector3,
  diagonal: number,
  explode: readonly [number, number, number] | null,
  factor: number,
): Vector3;
```

- Each part is `Group(userData.loomPartId)` with `matrix = partMatrix(...)` holding an inner
  group for the explode offset and the loaded object.
- Colour override: every mesh gets one shared `MeshStandardMaterial` per colour (lit, same
  roughness as the viewer's default material); originals are kept in `userData` and restored for
  "File colour". The override materials are disposed with the part.
- Explode offset: with `c` the assembled box centre, `v = partCentre - c` and `d` the assembled
  diagonal, `offset = factor * (v + unit(v) * 0.15 * d)`, or `factor * explode` when the part sets
  `explode`. A part at the centre (`|v| < 1e-6`) moves along +Z. Pure and tested.
- Selection: a `Box3Helper` around the selected part, in the theme's muted foreground colour, in
  the viewer's helper group so it is not pickable; hidden during captures.

`createViewer.ts` gains three additive methods:

- `refreshModel(box?: Box3)`: after parts change in place, recompute stats from the current
  model (or use `box`), `placeBed()` (`:433-440`), reapply wireframe and section, and
  `requestRender()` once. An empty box (all parts hidden) keeps the previous box and returns
  null. The assembly passes `assembledBox()` so explode never moves the bed or the fit size.
- `objectAt(clientX, clientY)`: the same raycast as `pick` (`:111-128`, respecting the section)
  returning the hit object or null; the panel maps it with `partAt` on a click without drag
  when no pick tool is active.
- With L31: both use `activeCamera()`.

`ViewerCanvas.tsx` replaces `url` and `format` with one `source` prop:

```ts
type ViewerSource =
  | { kind: "file"; url: string; format: ModelFormat }
  | {
      kind: "object";
      key: string;
      load: (signal: AbortSignal, onProgress: (text: string) => void) => Promise<Object3D>;
    };
```

The load effect (`ViewerCanvas.tsx:105-135`) calls `loadModel` for `"file"` (unchanged
behaviour) and `load` for `"object"`, keyed by `key`. The assembly's `load` resolves with
`scene.root` once the first round of visible parts has settled (or rejects with the first
error when no part could load). `ModelFile` is the only caller.

Markup while exploded: measurements and annotations are in assembled coordinates, so the panel
passes empty overlay lists while `explode > 0`, shows "Exploded view. Markup is hidden.", and
disables the Measure and Annotate tools with "Collapse the exploded view to measure". Fit pins
are hidden too.

### Inspector

`ModelInspector.tsx` (`:49-71`): the `scad: boolean` flag on `TABS` becomes `kinds: readonly
("mesh" | "scad" | "assembly")[]`; `inspectorTabs(kind)`, `defaultInspectorTab(kind)` and
`resolveInspectorTab(name, kind)` take the kind, and existing callers pass `scad ? "scad" :
"mesh"`. New tabs `parts` (default for assemblies) and `fit`; Markup and Views keep all three
kinds; Customize, Variants and Part are not shown for assemblies. Alias `part` to `parts` for
assemblies so `{ action: "inspector", name: "part" }` from an agent still lands somewhere.

- `AssemblyPartsSection.tsx` (new): rows with name, file, triangles and state; eye
  (`aria-pressed`), swatch menu (eight theme-safe colours, "Custom...", "File colour"), isolate,
  and a menu with "Rename", "Open part" (opens the part's own file in a new panel tab) and
  "Remove from assembly". The selected part shows Position and Rotation as three number fields
  each, using the existing scrub field behaviour (`scrub.ts`) with steps of 1, Shift 10 and Alt
  0.1 mm and 15 degrees for rotation; buttons for a quarter turn about X, Y and Z (`move-part`
  `rotateBy`), "Drop to bed" and "Align to part..." (a small form: part, axis, mode, offset). A
  SCAD or build123d part shows its parameters with the shared customizer controls bound to the part's
  `parameters`, committing on release. "Add part" opens the model list filtered to meshes and
  source CAD files.
- `AssemblyFitSection.tsx` (new): the assembly's overall size and bed fit (L32's `fitOnBed`
  when present), clearance rows with "Add clearance" (two part selects, a millimetre field,
  optional label) and "Remove", "Check fit" with "Cancel", and the results: one row per reported
  pair with status, measured gap against the requirement, and regions. Clicking a row frames its
  first region or the closest points. Results are stale when the request key the panel would
  send now differs from `report.key` (assembly revision, part revisions, transforms, pairs).
- Pins: the fit results use L46's pin drawing. L46's `setFindings` takes report findings; L48
  generalizes the viewer side to `setPins(pins: readonly { id: string; point: ModelPoint;
status: "check-fail" | "check-warn" | "check-info"; label: string }[], selectedId)` in
  `viewer/printCheck.ts` and maps both reports to it. Intersections are `check-fail`, tight
  clearances `check-warn`, touching `check-info`; closest points draw two pins joined by L23's
  measurement line style. `frame(point, normal, radius)` from L46 frames them.

### Keys and editor

- `E` in the key handler (`ModelPanel.tsx:748-768`): toggles `explode` between 0 and the last
  non-zero value (default 0.6). Only for assemblies. Listed in `WorkspaceTools.tsx` `HELP`.
- Escape order for assemblies: picked fit result, then isolate, then selection, then the
  existing behaviour.
- Editor actions: `explode` sets the factor (instant, no tween); `isolate` and `select-part` take
  a part id in `name`. `snapshot` and every action result include `state.assembly`. A capture
  after `explode` shows the exploded view; `fit` frames the exploded box when exploded.

### Picker and palette

- `ModelPicker.tsx` (`:18`) gains an "Assemblies" filter chip that lists `assemblies`, and a
  "New assembly" button (only when the server lists `model-assemblies`): a name field and a
  folder select (workspace root or the folder of any listed model), then `updateAssembly` with
  `set-name` on `<folder>/<slug>.loom-assembly.json`, then opens it.
- `commandPalette/registry.ts` (`:80-97`) passes assembly paths along with `modelFiles`, so
  "3D model: Open ..." lists them.

Mobile: nothing. It has no 3D panel.

## Agent-facing tools

Two tools join `ModelPreview3dToolkit` (`mcp.ts:13-202`). Both resolve the thread with
`modelThread` (`:203-211`) and refuse with the siblings' message when `agentToolEnabled` is false
(`:271-276`).

```ts
Tool.make("loom_model_preview_3d_assembly_update", {
  description:
    "Create or edit a Loom assembly (*.loom-assembly.json): several workspace models in one " +
    "scene. Operations apply in order and atomically: add-part (workspace path), update-part, " +
    "move-part (by mm, rotateBy degrees about world X, Y, Z), align (to another part or the " +
    "origin; modes min, center, max, after = on top of, before = below), remove-part, " +
    "set-clearance (required gap between two parts), remove-clearance, set-name. Creates the " +
    "file when missing. Pass expectedRevision from the last result to avoid overwriting edits.",
  parameters: Schema.Struct({
    path: Schema.String,
    operations: Schema.Array(AssemblyOperation),
    expectedRevision: Schema.optional(Schema.String),
  }),
  success: AssemblyReadResult,
  failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
  dependencies: [McpInvocationContext],
})
  .annotate(Tool.Title, "Edit a 3D assembly")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false),

Tool.make("loom_model_preview_3d_assembly_check", {
  description:
    "Check how the parts of a Loom assembly fit: which pairs intersect, touch or sit inside " +
    "each other, and the measured gap for each clearance pair against its required " +
    "millimetres. Points are assembly millimetres. Runs on the host; may take seconds.",
  parameters: Schema.Struct({ path: Schema.String, ...AssemblyCheckOptions.fields }),
  success: AssemblyCheckReport,
  failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
  dependencies: [McpInvocationContext],
})
  .annotate(Tool.Title, "Check assembly fit")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false),
```

- `assembly_update` uses `McpToolAccess.actsAsCaller` (it writes a workspace file, like
  `save_workspace` at `mcp.ts:339`); `assembly_check` uses `readsAsCaller`.
- `loom_model_preview_3d_list` already returns `listModels`, so agents see `assemblies`.
- Agents read the file with their own file tools or from the update result; there is no
  separate read tool.
- Seeing the result: `loom_model_preview_3d_editor` with `open` on the assembly path, then
  `explode`, `isolate`, `inspector` (`fit`) and `capture`. The `render` tool stays single-file:
  OpenSCAD cannot import GLB, and a second offscreen renderer is out of scope.

A typical agent loop: export the board reference, `assembly_update` with `add-part` for the case
and the board and `align` (`board`, to `case`, `z`, `min`, offset 3), `set-clearance` 0.3 mm,
`assembly_check`, adjust the SCAD wall or the board position, check again, then open and capture.

## Performance

Estimates; IMPLEMENTATION.md step 6 replaces them with measured numbers in the PR.

| Case                                                        | Parse       | Tests                  | Total       |
| ----------------------------------------------------------- | ----------- | ---------------------- | ----------- |
| Case 300k and board 500k triangles, one clearance at 0.3 mm | about 0.8 s | about 0.3 s            | about 1.2 s |
| Six parts, 1.5M triangles total, all pairs                  | about 1.5 s | about 0.8 s            | about 2.5 s |
| Two 1.5M triangle parts deeply intersecting                 | about 2 s   | up to the 50M test cap | under 10 s  |

- Worker memory: soup 36 bytes per triangle plus grid ids, about 200 MB at the 3,000,000 cap.
  One heavy check at a time per environment (L46's permit).
- Display: one draw call per mesh in each part; a PCB reference with many components can be a
  few hundred meshes, which is fine. The 5,000,000 triangle display budget keeps a laptop GPU
  responsive. Part loads run four at a time.
- Network: one signed download per part, refetched only when that part changes. Remote clients
  never download parts for the check; the report is a few KB.
- Rendering: no animation loop. Explode, isolate, colour and transform changes each call
  `requestRender` once. Scrubbing a field renders per value, as the camera does while dragging.
- The server never parses meshes on the event loop; reading an assembly is a JSON parse of at
  most 256 KB plus one `stat` per part.

## Alternatives considered

- Workspace entity instead of a file: rejected (PRODUCT.md, decision 1). Entities are keyed by
  workspace root and model path (`ModelPreviewService.ts:794-799`), do not move with branches
  or worktrees, and cannot be reviewed or edited outside Loom.
- 3MF build plate as the assembly format: standard and slicer-readable, but a zip, cannot
  reference a GLB or a SCAD file with parameters, and is awkward for an agent to edit. A future
  "Export as 3MF" can write one from the assembly.
- OpenSCAD `import()` scenes: cannot import GLB, renders everything as one mesh (no per-part
  reload, colour or isolate) and is slow for a PCB with components.
- Euler angles versus a quaternion in the file: people and agents type degrees; a quaternion is
  unreadable in a diff. Gimbal lock does not matter for placement typed as numbers.
- Free gizmo (`TransformControls` from `three/examples/jsm/controls/TransformControls.js`, MIT,
  already installed with `three`): left for later (PRODUCT.md, decision 2).
- `three-mesh-bvh` for interference and distance: a new dependency; L46's grid is enough for
  pairwise queries over a bounded overlap box.
- Checking in the browser: the panel already has the meshes, but agents need the check without
  a panel and remote clients should not do the work.
