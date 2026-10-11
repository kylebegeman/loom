# L46 technical

## Overview

```text
panel (Part, Markup, pins)          agent
  checkPrint RPC                      loom_model_preview_3d_check
        \                              /
         ModelPreviewService.checkPrint            (one service method, both callers)
           resolve file | render SCAD (variantId "loom-print-check")
           read bytes (3MF unzipped, glTF buffers resolved) on the main thread
           orientation (L35), nozzle (L51 or setting), cache key
           shared job by key -> check slot (1) -> worker thread (60 s, terminate on interrupt)
              parse -> weld -> topology -> contact -> overhangs -> islands -> grid -> rays
           bed fit (L32) and verdict on the main thread, LRU cache (64 reports)
```

All geometry work runs in a Node worker thread that imports nothing but `node:worker_threads`
and its own pure modules. The main thread does file IO, validation, caching and the bed. The
report is a small typed object; mesh bytes never leave the host.

Every number in the report is in millimetres. Locations are in model space: the frame the
viewer loads before any L35 orientation (STL and OBJ as written, 3MF after its unit and build
transforms, glTF converted to millimetres and Z up exactly as `viewer/load.ts:156-158` does).
The checks themselves run in the oriented frame and map locations back with the inverse rotation,
so pins sit on the part whatever orientation is applied.

## Contracts

### New file `packages/contracts/src/fork/model-print-check.ts`

Imports only `effect` (no `./model-preview-3d.ts`, which would make a cycle once
`model-preview-3d.ts` imports this file). Add `export * from "./model-print-check.ts";` to
`packages/contracts/src/fork/index.ts`.

```ts
const Vec3 = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]);

/** Bump when a rule or threshold changes; part of the cache key. */
export const PRINT_CHECK_VERSION = 1;
export const PRINT_CHECK_MAX_TRIANGLES = 3_000_000;
export const PRINT_CHECK_MAX_FINDINGS = 200;

export const PrintCheckId = Schema.Literals([
  "mesh",
  "shells",
  "bed-fit",
  "first-layer",
  "overhangs",
  "islands",
  "walls",
  "small-features",
]);
export const PrintSeverity = Schema.Literals(["info", "warn", "fail"]);
export const PrintCheckStatus = Schema.Literals(["pass", "info", "warn", "fail", "skipped"]);
export const PrintFindingCode = Schema.Literals([
  "EMPTY_GEOMETRY", // fail   mesh
  "OPEN_EDGES", // warn   mesh
  "NON_MANIFOLD_EDGES", // warn   mesh
  "FLIPPED_FACES", // warn   mesh
  "INVERTED_SHELL", // warn   mesh
  "DEGENERATE_TRIANGLES", // info   mesh
  "MULTIPLE_SHELLS", // info   shells
  "INTERNAL_SHELL", // warn   shells
  "EXCEEDS_BUILD_VOLUME", // fail   bed-fit
  "FITS_ROTATED", // info   bed-fit
  "SMALL_BED_CONTACT", // fail   first-layer
  "TALL_THIN", // warn   first-layer
  "OVERHANG_AREA", // warn   overhangs
  "UNSUPPORTED_ISLAND", // warn   islands
  "THIN_WALL", // warn   walls
  "FEATURE_BELOW_NOZZLE", // fail   small-features
]);

export const PrintFinding = Schema.Struct({
  /** Stable within one report: `${code}-${n}`, n from 1 in report order. */
  id: Schema.String,
  check: PrintCheckId,
  code: PrintFindingCode,
  severity: PrintSeverity,
  /** One sentence, ready to show, millimetres with one decimal ("Wall 0.6 mm thick"). */
  message: Schema.String,
  value: Schema.NullOr(Schema.Number),
  limit: Schema.NullOr(Schema.Number),
  unit: Schema.NullOr(Schema.Literals(["mm", "mm2", "mm3", "ratio", "count"])),
  /** Model space. Null only for findings about the whole part (empty file, shell count). */
  location: Schema.NullOr(
    Schema.Struct({ point: Vec3, normal: Schema.NullOr(Vec3), radiusMm: Schema.Number }),
  ),
});

export const PrintCheckReport = Schema.Struct({
  version: Schema.Int,
  /** "incomplete" when a stage hit its time budget; its check row says which. */
  status: Schema.Literals(["complete", "incomplete"]),
  verdict: Schema.Literals(["ready", "review", "blocked"]),
  geometryRevision: Schema.String,
  checkedAt: Schema.String,
  durationMs: Schema.Number,
  cached: Schema.Boolean,
  orientation: Schema.NullOr(
    Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]),
  ),
  summary: Schema.Struct({
    triangles: Schema.Int,
    vertices: Schema.Int,
    shells: Schema.Int,
    watertight: Schema.Boolean,
    volumeMm3: Schema.NullOr(Schema.Number), // null unless watertight
    surfaceAreaMm2: Schema.Number,
    sizeMm: Vec3, // oriented, axis aligned
    contactAreaMm2: Schema.Number,
    overhangAreaMm2: Schema.Number,
    /** 1st percentile of measured thickness; null when no ray found a wall within range. */
    minThicknessMm: Schema.NullOr(Schema.Number),
    thicknessSamples: Schema.Int,
  }),
  settings: Schema.Struct({
    nozzleMm: Schema.Number,
    nozzleSource: Schema.Literals(["printer", "setting"]),
    overhangAngleDegrees: Schema.Number,
    firstLayerMm: Schema.Number,
    minWallMm: Schema.Number, // 2 x nozzle
  }),
  bed: Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    fit: Schema.Literals(["fits", "fits-rotated", "too-big"]),
    overMm: Schema.NullOr(Vec3),
  }),
  checks: Schema.Array(
    Schema.Struct({
      check: PrintCheckId,
      status: PrintCheckStatus,
      summary: Schema.String, // "Thinnest wall 0.6 mm (needs 0.8 mm)"
      findings: Schema.Int, // located findings for this check, before truncation
    }),
  ),
  findings: Schema.Array(PrintFinding),
  truncated: Schema.Boolean,
  /** Worker stage timings, for diagnosing slow checks: parse, weld, topology, grid, ... */
  stages: Schema.Array(Schema.Struct({ name: Schema.String, ms: Schema.Number })),
});

export const PrintCheckResult = Schema.Struct({
  status: Schema.Literals(["ok", "cancelled"]),
  report: Schema.NullOr(PrintCheckReport),
});

/** Options shared by the RPC and the MCP tool. */
export const PrintCheckOptions = Schema.Struct({
  /** SCAD only: name -> OpenSCAD literal, as for renderScad. */
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  parameterSet: Schema.optional(Schema.NullOr(Schema.String)),
  /** Check files over maxFileMegabytes, like fileUrl's allowLarge. */
  allowLarge: Schema.optional(Schema.Boolean),
  /** Skip the cache. */
  force: Schema.optional(Schema.Boolean),
});

export type PrintFinding = typeof PrintFinding.Type;
export type PrintCheckReport = typeof PrintCheckReport.Type;
export type PrintCheckResult = typeof PrintCheckResult.Type;
export type PrintCheckOptions = typeof PrintCheckOptions.Type;
```

Reports are never persisted, so they need no decoding defaults. `checks` always has the eight
rows in the order of `PrintCheckId`. `findings` is sorted by severity (fail, warn, info), then by
check order, then by size (area, or how far the value is from its limit), and cut at
`PRINT_CHECK_MAX_FINDINGS` with `truncated: true`. Per-code caps apply first: 10 overhang
regions, 20 islands, 20 thin regions, 20 below-nozzle regions, 5 groups each for open,
non-manifold and flipped edges, 10 internal shells.

Verdict: `blocked` when any finding is `fail`; `review` when any is `warn` or the report is
incomplete; otherwise `ready`. Copy: "Will not print as is", "Check before printing", "Ready to
print".

### `packages/contracts/src/fork/model-preview-3d.ts`

- `MODEL_PREVIEW_3D_WS_METHODS` (`:10-28`) gains
  `checkPrint: "loom.model-preview-3d.checkPrint"` and
  `cancelPrintCheck: "loom.model-preview-3d.cancelPrintCheck"`.
- The RPC group (`:317-392`) gains, using the local `rpc` helper (`:307-316`):

  ```ts
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.checkPrint,
    Schema.Struct({
      file: ModelFileRef,
      /** Client-chosen id so the panel can cancel its own request. */
      requestId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
      ...PrintCheckOptions.fields,
    }),
    PrintCheckResult,
  ),
  rpc(
    MODEL_PREVIEW_3D_WS_METHODS.cancelPrintCheck,
    Schema.Struct({ file: ModelFileRef, requestId: Schema.String }),
    Schema.Void,
  ),
  ```

- `ModelPreviewError.reason` (`:267-276`) gains `"unavailable"` (the worker script is missing,
  as in the single-file executable).
- `ModelPreviewSettings` (`:240-262`) gains three fields, following `BuildPlateSetting.pattern`
  (`:237`):

  ```ts
  /** Fallback when the active printer has no nozzle (L51). */
  nozzleDiameterMm: Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 2 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(0.4)),
  ),
  /** Overhang threshold, degrees from vertical. Shared with L36; whichever lands first adds it. */
  overhangAngleDegrees: Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 70 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(45)),
  ),
  firstLayerHeightMm: Schema.Number.check(Schema.isBetween({ minimum: 0.04, maximum: 1 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(0.2)),
  ),
  ```

  `DEFAULT_MODEL_PREVIEW_SETTINGS` (`:297-306`) gains `nozzleDiameterMm: 0.4`,
  `overhangAngleDegrees: 45` and `firstLayerHeightMm: 0.2`. `overhangAngleDegrees` is exactly
  L36's definition (`docs/fork/packets/L36-model-overhangs/TECHNICAL.md`, "Contracts"). Settings
  saved before this packet, and settings sent by an older client, decode with the defaults.

### `packages/contracts/src/fork/model-editor.ts`

`ModelEditorAction` fields (`:35-52`) gain `findings: Schema.optional(Schema.Boolean)`, read by
the `display` action, so an agent can show or hide check pins before a capture.

### `packages/contracts/src/fork/clientRpcPermissions.ts` and server scopes

`checkPrint` and `cancelPrintCheck` use `AuthOrchestrationOperateScope` in both
`FORK_CLIENT_GUARDED_RPC_SCOPES` (beside `[M.renderScad]`, `clientRpcPermissions.ts:28`) and
`FORK_RPC_REQUIRED_SCOPES` (beside `[M.renderScad]`, `apps/server/src/fork/rpcAuthorization.ts:61`).
A check spends host CPU for up to a minute, like a render.

## Server

### Files

New folder `apps/server/src/fork/model-preview-3d/check/`. Everything except `printChecker.ts`
and `workerHost.ts` is pure, synchronous and runs inside the worker. Worker modules import only
`node:worker_threads` (the entry) and sibling worker modules, with `.ts` extensions and erasable
syntax (`tsconfig.base.json:9`), so Node can load them from source and the bundle stays
self-contained.

| File                    | Runs in | Purpose                                                                                                                                                                |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mesh.ts`               | worker  | `TriangleSoup` (Float32Array, 9 numbers per triangle), `IndexedMesh` (Float64Array vertices, Uint32Array triangles), `weld`, per-triangle normals and areas, `rotate`. |
| `readStl.ts`            | worker  | Binary and ASCII STL.                                                                                                                                                  |
| `readObj.ts`            | worker  | `v` and `f` records.                                                                                                                                                   |
| `read3mf.ts`            | worker  | Core 3MF XML from already unzipped parts.                                                                                                                              |
| `readGltf.ts`           | worker  | glTF 2.0 JSON and GLB.                                                                                                                                                 |
| `topology.ts`           | worker  | Edge table, edge classes, shells, signed volume.                                                                                                                       |
| `grid.ts`               | worker  | Uniform grid, ray traversal, ray-triangle test.                                                                                                                        |
| `printChecks.ts`        | worker  | `runPrintChecks(mesh, params): PrintCheckCore`, every check.                                                                                                           |
| `protocol.ts`           | both    | Message types only (`import type` from the main thread).                                                                                                               |
| `model-check-worker.ts` | worker  | Entry: reads one request from `parentPort`, replies, exits.                                                                                                            |
| `workerHost.ts`         | main    | Starts the worker, timeout, interruption, error mapping.                                                                                                               |
| `report.ts`             | main    | `finalizeReport(core, bed, settings)`: bed finding, row statuses, sort, caps, verdict. Pure.                                                                           |
| `printChecker.ts`       | main    | `makePrintChecker(deps)`: IO, cache, shared jobs, slot.                                                                                                                |

Main-thread files may import worker modules with `import type` only. A test enforces it
(TESTING.md): a runtime import would make the bundler put shared code in a chunk the worker
cannot load from a `data:` URL.

### Reading meshes

The main thread reads bytes with the service's `FileSystem` and passes them to the worker as
transferred `ArrayBuffer`s. A `Uint8Array` that does not own its whole buffer is copied first.

- STL (`readStl.ts`): binary when `byteLength === 84 + 50 * count` with `count` the `uint32` at
  offset 80; otherwise ASCII when the first non-space bytes are `solid`; otherwise
  "This STL file is damaged." Binary reads three `float32` vertices per record and ignores the
  stored normal. ASCII scans `vertex` lines; any facet without three vertices is an error with
  its line number. The count is checked against the cap before allocating.
- OBJ (`readObj.ts`): `v x y z [w]` and `f a b c ...` with `a`, `a/b`, `a//c` or `a/b/c`
  references, negative indices relative to the current vertex count, and fan triangulation of
  polygons. Lines, points, materials, groups and texture data are ignored. An index outside the
  vertex list is an error with the line number.
- 3MF (`read3mf.ts`): the main thread opens the zip with `yauzl` (already a server dependency,
  used by `threeMfUnits.ts:3`), reads `_rels/.rels` for the start part (default
  `/3D/3dmodel.model`), and collects every `.model` part, each capped at the file limit. The
  worker scans the XML with a small tag scanner (no DOM): per model part, the `unit` attribute
  on `<model>` (micron, millimeter, centimeter, inch, foot, meter; default millimeter), each
  `<object id>` with either `<mesh>` (`<vertex x y z>`, `<triangle v1 v2 v3>`) or `<components>`
  (`<component objectid transform p:path>`), and `<build><item objectid transform>`. Transforms
  are the 12 row-major numbers of the 3MF core specification, applied as
  `[x y z 1] * M`. The production extension's `p:path` (an absolute part name, on a root
  model's `<item>` or `<component>`) makes `objectid` refer to an object in that part; a
  `p:path` inside a non-root part is an error, as the extension requires. Component recursion
  stops at depth 8 ("This 3MF nests components too deeply."). Each part's vertices and translations are scaled to
  millimetres by that part's unit, exactly as the viewer normalizes them
  (`apps/web/src/fork/model-preview-3d/viewer/load.ts` 3MF branch, using `THREE_MF_UNIT_MM`,
  `model-preview-3d.ts:31`). Objects of `type="support"` or `type="other"` are skipped, as
  slicers do.
- glTF and GLB (`readGltf.ts`): GLB header and chunks (JSON, then optional BIN). Buffers are
  the GLB BIN chunk, `data:` URIs (base64) decoded in the worker, or relative URIs that the main
  thread reads first, with the rule the viewer's signed URLs already enforce: a relative path
  without `..`, resolved inside the glTF file's own directory and the workspace
  (`ModelPreviewService.ts:191-195` mints tokens for that directory). Absolute and `http(s)`
  URIs are an error. Accessors handle `byteOffset`, `byteStride`, `sparse`, `normalized` and the
  component types 5120 to 5126 for positions and indices. Primitive modes 4 (triangles),
  5 (strip) and 6 (fan); other modes are ignored. The default scene (or scene 0) is walked with
  node `matrix` or `translation`, `rotation`, `scale`; meshes under several nodes are
  instanced. `KHR_draco_mesh_compression` and `EXT_meshopt_compression` in
  `extensionsRequired` fail with the viewer's wording ("This glTF uses Draco compression. Export
  an uncompressed model."). Positions are converted to the viewer's frame:
  `(x, y, z) -> 1000 * (x, -z, y)`, the rotation and scale in `viewer/load.ts:156-158`.
- SCAD: the service renders with `renderScad({ variantId: "loom-print-check", file, overrides,
parameterSet })` (`ModelPreviewService.ts:587-622`). The variant id gives the check its own job
  key, so it never interrupts the panel's render, and skips saving last-used parameters
  (`ModelPreviewService.ts:567`). The render cache key does not include the variant id, so a
  geometry the panel already rendered is a cache hit. The output is `<cacheDir>/<revision>.stl`
  or `.3mf` (`ModelPreviewService.ts:447-448`, `:578-579`); the checker holds
  `protectStem(stem)` (`:135-139`) while it reads, so pruning cannot delete it mid-read.
  `geometryRevision` is the render's `mesh.revision`, the same value the panel uses.
- STEP: `unsupported-format`, "Print checks need a mesh. STEP files belong in the Fabrication
  app."

For mesh files `geometryRevision` is `metadata(info).revision` (`ModelPreviewService.ts:88-102`),
the same revision `fileUrl` hands the viewer. The checker stats the file before and after reading
and retries once when the revision changed during the read.

Files larger than `maxFileMegabytes` fail with the same `too-large` message as `sign`
(`ModelPreviewService.ts:186-190`) unless `allowLarge` is set. Triangle count above
`PRINT_CHECK_MAX_TRIANGLES` fails with `too-large`: "Too many triangles to check (4,812,330). The
limit is 3,000,000." Readers count before allocating where the format allows (binary STL) and
stop as soon as the count passes the cap otherwise.

### Mesh preparation (`mesh.ts`, `topology.ts`)

1. Orientation. When L35's `orientation` entity exists in `getWorkspace(file)`
   (`ModelPreviewService.ts:793-804`), rotate every vertex by its quaternion. Without L35 the
   field does not exist and the rotation is the identity. Keep `R` to map locations back.
2. Weld. Tolerance `eps = max(1e-5, 1e-6 * diagonal)` mm. Quantize each vertex to
   `round(v / eps)` per axis, hash the three integers into an open-addressing table sized to the
   next power of two above twice the soup vertex count, and keep the first vertex per key.
   Exported STL corners are bit-identical in practice; vertices that straddle a quantization
   boundary stay separate and show up as open edges, which is the honest answer for a mesh that
   does not share them.
3. Degenerate triangles (two equal indices after welding, or area below `1e-12` mm²) are dropped
   and counted for `DEGENERATE_TRIANGLES` (info, no location).
4. Edge table. Key `min(a, b) * vertexCount + max(a, b)` (below 2^53 at the cap), open
   addressing over a `Float64Array`, storing use count, first triangle, and whether a second use
   ran in the same direction. Classes: one use is open (boundary); two uses in opposite
   directions is manifold; two uses in the same direction is flipped; three or more is
   non-manifold.
5. Shells. Union-find over triangles that share any edge. Per shell: triangle count, bounding
   box, area, signed volume `sum(v0 . (v1 x v2)) / 6`, and whether it is closed (only manifold
   edges).
6. `watertight` is true when no edge is open, flipped or non-manifold. `volumeMm3` is the sum of
   shell volumes when watertight, otherwise null.

### Checks (`printChecks.ts`)

`z0` is the minimum oriented Z, `H` the oriented height, `n` a unit triangle normal from the
winding (`(v1 - v0) x (v2 - v0)`), `layer` the first-layer height.

**Mesh.** Open, flipped and non-manifold edges each group into connected clusters (union-find on
shared vertices). The five longest clusters per class become findings at the midpoint of the
cluster's edge nearest its centroid, radius half the cluster's box diagonal, value the cluster's
edge count. A closed shell with negative volume is `INVERTED_SHELL` ("Faces point inward") at the
shell's lowest vertex. Row summary: "Watertight" or "Not watertight: 14 open edges".

**Shells.** More than one shell is `MULTIPLE_SHELLS` (info, no location; "3 separate bodies").
For each shell (at most 200) one ray from its highest vertex along +X through the grid counts
crossings with other closed shells; an odd count means it sits inside another body:
`INTERNAL_SHELL` (warn, "A body sits inside another; slicers merge or drop it"). Shells smaller
than the nozzle are reported by small features, below.

**First layer.** Contact triangles face down within 5 degrees (`n.z < -cos 5deg`) and have all
three vertices within `z0 + 0.05` mm. `contactAreaMm2` is their area. The footprint is the convex
hull of their vertices in XY (monotone chain), and its minimum width comes from rotating
calipers. Findings:

- `SMALL_BED_CONTACT` (fail) when contact area is under 1 mm²: "Rests on a point or edge
  (0.2 mm² on the bed)". Location: the lowest vertex, normal down.
- `TALL_THIN` (warn) when `H / minWidth > 8` and contact did not already fail: "Tall and narrow
  on the bed (62 mm tall on a 6.8 mm footprint); it may tip or wobble". Location: the footprint
  centroid at `z0`. The ratio 8 follows the Fabrication printability plan
  (`~/Developer/docs/apps/fabrication/SPEC.md:66`), a rule of thumb, not a slicer constant.

**Overhangs.** A triangle overhangs when `n.z < -sin(angle)` (angle from vertical; a wall is 0
degrees, a flat ceiling 90) and its centroid is above `z0 + layer` (faces on the bed are
supported by it). Overhanging triangles that share an edge form regions. `overhangAreaMm2` is the
total. Regions of at least 5 mm² become `OVERHANG_AREA` (warn), largest first, at the region
triangle nearest its area-weighted centroid, with that triangle's normal and radius
`max(2, sqrt(area / pi))`. Under 5 mm² in total the row is `info` ("Small overhangs, 3.2 mm²");
none is `pass`. Bridges are not distinguished (README, Out).

**Islands.** A print starts in mid-air at a local minimum that faces down. Group vertices joined
by edges with `|dz| <= 1e-4` mm into plateaus (union-find). A plateau is an island when every
edge leaving it rises, the area-weighted mean normal of its incident triangles has `z < 0`, and
its height is above `z0 + layer`. A shelf's underside is not an island because its edge to the
wall continues down; the floor of an internal cavity faces up and is skipped. A floating shell is
caught here by its lowest plateau. Islands within 1 mm merge (hash grid); the 20 lowest above the
bed become `UNSUPPORTED_ISLAND` (warn): "Starts in mid-air 12.4 mm above the bed".

**Walls and small features.** Thickness is measured by sampling:

1. `N = clamp(round(surfaceArea / nozzle^2), 2000, 20000)` samples, area-weighted (cumulative
   area table and binary search), uniform inside each triangle (square-root barycentric method),
   from an sfc32 generator seeded with the first 128 bits of the cache key, so the same input
   always gives the same report. (mulberry32 is smaller but its author no longer recommends it
   beyond about 65,536 draws; a check makes up to 60,000.)
2. Each sample casts one ray from `p - n * 1e-4` along `-n` (into the material), up to
   `L = 2 * minWall` (1.6 mm for a 0.4 mm nozzle), skipping its own triangle.
3. The first hit counts when `dot(n_hit, -n) >= 0.5` (an opposite wall within 60 degrees).
   Otherwise, or with no hit, the sample is discarded (a corner, an open mesh, or a wall thicker
   than `L`). Thickness is the hit distance plus `1e-4`.
4. Samples thinner than `minWall` are flagged; thinner than the nozzle, flagged as below nozzle.
   Flagged samples are clustered on a 2 mm hash grid (26 neighbours). A cluster is kept when it
   has 3 or more samples or an estimated area (`count / N * surfaceArea`) of at least 1 mm².
5. A kept cluster with 3 or more below-nozzle samples is `FEATURE_BELOW_NOZZLE` (fail, "Thinner
   than the 0.4 mm nozzle (0.25 mm); the slicer will drop it"); otherwise `THIN_WALL` (warn,
   "Wall 0.6 mm thick (needs 0.8 mm)"). Value is the cluster's 10th percentile thickness;
   location is its thinnest sample, normal the sample's normal, radius half the cluster extent
   (at least 1 mm).
6. Any shell whose largest box extent is under the nozzle is also `FEATURE_BELOW_NOZZLE` at its
   centroid ("A 0.3 mm fragment is smaller than the nozzle"), since rays can miss it.
7. `minThicknessMm` is the 1st percentile of accepted thicknesses, or null.

When the mesh is not watertight the walls row adds "(approximate: the mesh is open)". The
sampler has a soft budget of 15 seconds; when it runs out, the walls and small features rows
say "Partly checked (12,400 of 20,000 samples)" and the report is `incomplete`.

### Grid (`grid.ts`)

- Bounds: the oriented box padded by `1e-3` mm. Cell size
  `h = max(cbrt(boxVolume / min(2 * T, 2^22)), maxExtent / 512, 1e-3)`, so no axis exceeds 512
  cells and the total stays near `2 * T` cells, capped at about four million.
- Fill: pass one counts, per triangle, the cells its bounding box covers; pass two takes prefix
  sums into `cellStart: Uint32Array`; pass three writes triangle ids into `cellTris: Uint32Array`.
  If the reference count would exceed 2^25 (128 MB of ids), double `h` and retry, at most three
  times, then fail "This mesh is too dense to check."
- Rays: Amanatides and Woo voxel traversal from the origin cell, Moller and Trumbore
  ray-triangle intersection, and a per-triangle mailbox (`Int32Array` of the last ray id) so a
  triangle that spans cells is tested once per ray. A ray stops when its nearest hit is closer
  than the next cell boundary or its length runs out.
- The grid is built once per check and reused by the shell parity rays. L48 reuses `grid.ts`
  for interference tests.

No BVH and no dependency: a uniform grid over a surface mesh is simple, has predictable memory,
and the rays here are short (at most 1.6 mm by default), so each visits a handful of cells.

### Worker (`model-check-worker.ts`, `workerHost.ts`, `protocol.ts`)

```ts
// protocol.ts
export type CheckFile = { readonly name: string; readonly bytes: Uint8Array };
export type CheckRequest = {
  readonly format: "stl" | "obj" | "3mf" | "gltf" | "glb";
  readonly files: readonly CheckFile[]; // [main, ...3MF parts or glTF buffers by uri]
  readonly orientation: readonly [number, number, number, number] | null;
  readonly params: { nozzleMm: number; overhangAngleDegrees: number; firstLayerMm: number };
  readonly seed: number;
  readonly limits: { maxTriangles: number; thicknessBudgetMs: number };
};
export type CheckReply =
  | { readonly ok: true; readonly core: PrintCheckCore }
  | {
      readonly ok: false;
      readonly reason: "unsupported-format" | "too-large" | "command-failed";
      readonly message: string;
    };
```

`PrintCheckCore` is the report without `bed`, `verdict`, `cached`, `checkedAt` and settings
labels; `report.ts` completes it on the main thread.

The worker entry posts exactly one reply and returns; it catches every exception and replies
`command-failed` with the message. One worker per check: start-up is tens of milliseconds next to
the parse, and a fresh isolate returns all memory when it exits.

`workerHost.ts` exports
`runCheckWorker(request, options?: { timeoutMs?: number; workerUrl?: URL }):
Effect<CheckReply, ModelPreviewError>` (the options exist for tests):

- Worker source, resolved once and memoized:
  - From source (dev runs `node --watch src/bin.ts`, `apps/server/package.json:18`; tests run
    the `.ts` files): `import.meta.url` ends in `.ts`, so the worker is
    `new URL("./model-check-worker.ts", import.meta.url)`. Node strips the types.
  - Bundled (`dist/bin.mjs`, npm and desktop): read
    `new URL("./fork/model-preview-3d/check/model-check-worker.mjs", import.meta.url)` as text
    and start the worker from `new URL("data:text/javascript;base64," + base64)`. tsdown keeps
    array entries' paths relative to their common ancestor (`src`), so the file lands there
    (vite-plus-core 1.0.0, `dist/tsdown/build-*.js`, the `arrayEntryMap` built from
    `lowestCommonAncestor`). A `data:` module can import only builtins, which is all the
    bundle imports. Reading through `fs` works inside the desktop app's asar archive, where
    loading an ES module worker by file path is reported not to.
  - The read fails in the single-file executable, which embeds only `src/bin.ts`
    (`apps/server/vite.config.ts:81`): `ModelPreviewError({ reason: "unavailable", message:
"Print checks are not available in this build." })`.
- `new Worker(source, { resourceLimits: { maxOldGenerationSizeMb: 512 } })`. The limit covers
  the JS heap only, not the typed arrays that hold the mesh, so the triangle cap is the real
  memory guard (Performance).
- `postMessage(request, transferList)` with every file buffer.
- `Effect.callback` resolves on `message`, fails on `error` and on `exit` before a reply
  ("The print check stopped unexpectedly (exit code 1)."), and its finalizer calls
  `worker.terminate()`. Interruption and the timeout both run the finalizer.
- `Effect.timeoutOrElse({ duration, orElse })` at 60 seconds fails with `timeout`: "The print check took longer than
  60 seconds and was stopped."

### `printChecker.ts` and the service method

`makePrintChecker(deps)` is created inside `make` in `ModelPreviewService.ts` and its methods are
spread into the returned service, the same way L51 adds `makePrinterLibrary`
(`docs/fork/packets/L51-printer-library/TECHNICAL.md`, "Server"). Deps are closures the service
already has: `resolveFile`, `renderScad`, `protectStem`, `getWorkspace`, the current
`settings`, `fs`, `path`, and (with L51) `library()`.

```ts
checkPrint(input: { file: ModelFileRef; requestId?: string } & PrintCheckOptions):
  Effect<PrintCheckResult, ModelPreviewError>
cancelPrintCheck(input: { file: ModelFileRef; requestId: string }): Effect<void>
```

1. Resolve the format from the extension with the service's `formats` map
   (`ModelPreviewService.ts:71-80`). STEP fails as above.
2. Get bytes and `geometryRevision` (Reading meshes).
3. Orientation: `getWorkspace(file)` and its `orientation` (L35), else null.
4. Nozzle: with L51, `activeBed(settings.buildPlate, { library }).nozzlesMm[0]` when the list is
   not empty (`nozzleSource: "printer"`); otherwise `settings.nozzleDiameterMm` ("setting").
5. Key: sha256 of the JSON array `[PRINT_CHECK_VERSION, geometryRevision, format, orientation,
nozzle, overhangAngleDegrees, firstLayerHeightMm, bufferRevisions]`. For glTF and GLB, a bounded
   manifest cache supplies contained external-buffer revisions, so a changed `.bin` invalidates
   the cache while `geometryRevision` remains the viewer's main-file revision. The bed is not in the key: fit is
   recomputed on every call, so changing the bed never reruns geometry.
6. Cache: an in-memory LRU of 64 `PrintCheckCore` values keyed by the key. A hit returns at once
   with `cached: true` unless `force`.
7. Miss: `jobs.run(key, slot.withPermit(runCheckWorker(request)))`, where `jobs` comes from
   `makeSharedJobs` (`apps/server/src/fork/sharedJobs.ts:6-36`, already used by
   `PcbPreviewService.ts:225-226`) and `slot` is `Semaphore.make(1)`. The panel and an agent
   asking for the same key share one worker; the worker stops only when the last caller leaves.
   One check runs at a time per environment, which bounds peak memory.
8. Bed: `fitOnBed(core.summary.sizeMm, activeBed(settings.buildPlate).volumeMm)` from L32's
   `model-beds.ts`. Without L32, this packet first does L32's "Bed list in contracts" move exactly
   as written there. `too-big` becomes `EXCEEDS_BUILD_VOLUME` (fail, "12.0 mm too wide for the
   Bambu Lab H2D") located at the part's box centre with radius half its diagonal;
   `fits-rotated` becomes `FITS_ROTATED` (info, "Fits when turned 90 degrees on the bed").
9. `finalizeReport` and return `{ status: "ok", report }`.

Cancellation: when `requestId` is set, step 7 runs in a forked fiber registered in a
`Map<string, Fiber>` keyed by `file.threadId + "\0" + requestId`; `cancelPrintCheck` interrupts
it, which releases that caller's lease. The interrupted call returns
`{ status: "cancelled", report: null }`, as `renderScad` does (`ModelPreviewService.ts:609-619`).
The panel cancels its previous request when the revision changes, on "Cancel" and on unmount.
An agent call has no request id; interrupting its handler fiber releases its lease the same way.

### Transports

- `rpc.ts` (`apps/server/src/fork/model-preview-3d/rpc.ts:39-40` pattern):
  `[M.checkPrint]: (i) => auth.effect(M.checkPrint, service.checkPrint(i))` and the same for
  `cancelPrintCheck`.
- `mcp.ts`: the tool below.

## Storage

No new tables or files. Settings gain three fields in the existing settings store (decoding
defaults above). Reports live in the in-memory LRU and disappear on restart; a rerun is cheap.
SCAD renders made for checks live in the existing render cache and are pruned with it.

## Clients

Mobile has no 3D panel. Web and desktop share these changes under
`apps/web/src/fork/model-preview-3d/`.

### Runtime

`packages/client-runtime/src/fork/model-preview-3d.ts` gains two commands next to `render`:
`checkPrint` (label `"loom:model-print-check"`) and `cancelPrintCheck`
(`"loom:model-print-check-cancel"`), both `createEnvironmentRpcCommand`. The web calls them
with `runModelCommand` (`apps/web/src/fork/model-preview-3d/state.ts:9-16`).

### `usePrintCheck.ts` (new)

`usePrintCheck({ environmentId, threadId, path, format, geometryRevision, session, settings,
orientation, active })` returns `{ report, running, startedAt, error, stale, run, cancel }`.

- `active` is true while the Part tab is visible. When active and the request key (revision,
  SCAD overrides and parameter set, orientation, check settings) differs from the last report,
  it runs after an 800 ms debounce, so a slider drag in Customize does not start a check per
  step.
- Each run has a `requestId` (`crypto.randomUUID()`); starting a new one cancels the previous.
- `stale` is true when `report.geometryRevision !== geometryRevision` or the orientation or
  settings differ from `report.orientation` and `report.settings`.
- State lives in the `ModelFile` component (keyed per environment, thread and file,
  `ModelPanel.tsx:1165-1187`), so switching files never shows another file's report.

### `PrintCheckSection.tsx` (new), in Part

Rendered by `PartSection` (`ModelInspector.tsx:336-490`) after the facts list. Header "Print
check" with the verdict chip (`Chip` tones `success`, `warning`, and `warning` for blocked:
`controls.tsx:58-66` has no error tone), "Checking..." with elapsed seconds, "Cached", "Check
again" and "Cancel". Then eight rows in `checks` order, each a status icon, label and `summary`;
rows with findings expand to list them. Clicking a finding calls `onSelectFinding(id)`.

The existing "Mesh: Watertight" fact (`ModelInspector.tsx:427-436`) reads the report's
`summary.watertight` when a fresh report exists, so it works for every format, not only SCAD.

### Markup

`MarkupSection.tsx` gains a "Print check" group after "Measurements" (`:641`): one row per
located finding with a square pin and the message, a "Hide pins" or "Show pins" toggle, and
"Out of date" with "Check again" when stale. Findings are not workspace entities: they are not
editable, renamed or saved.

### Viewer

New `viewer/printCheck.ts`, with two additive methods on `createViewer.ts`:

- `setFindings(findings, selectedId)`: stores the list and redraws marks. `drawOverlay`
  (`createViewer.ts:240-276`) clears every mark first, so one line at its end calls
  `drawFindingMarks` from `printCheck.ts` with the stored list. Each pin is `addMark("pin", ...)`
  (`:196-212`) with `data-status` `check-warn`, `check-fail` or `check-info` and the finding's
  number in the report; points are converted with the model root's `localToWorld`, which is the
  identity today and includes L35's orientation group when it exists. Selection adds
  `data-selected`.
- `frame(point, normal, radiusMm)`: sets the orbit target to the point and places the camera
  along the normal (or the current view direction when the normal is null or faces away from
  the camera by more than 90 degrees) at `fitDistance` (`viewer/views.ts:13-20`) of a box of
  that radius. One `requestRender`; no tween. The arithmetic is a pure
  `frameFor(point, normal, radius, camera)` in `printCheck.ts`, so it is testable without WebGL.

`workspace.module.css` gains the square pin look for the three `check-*` statuses next to
`.model-mark-pin > span[data-status="open"]` (`:145`). Pins follow the panel's theme tokens;
no edge stripes.

Captures already paint marks (`createViewer.ts:278`, `:572-599`), so check pins appear in
captures while they are shown.

### Panel wiring (`ModelPanel.tsx`)

- `display` state (`:134`) gains `findings: true`; `DisplayTools` (`WorkspaceTools.tsx:147-195`)
  gains a "Print check pins" checkbox item after "Axes", with no shortcut.
- The editor `display` branch (`ModelPanel.tsx:216-224`) applies `c.findings`.
- Badges (`:700-704`): `badges.part` is also set when a fresh report's verdict is `review` or
  `blocked`, with `count` the number of fail and warn findings.
- Escape clears the selected finding through the existing key handler (`:715-768`); no new key.

### Settings

`SettingsSection.tsx` gains three `SettingsRow`s after "Max file size" (`:169-183`): "Nozzle
diameter" (mm, with "Used when the printer does not set one" once L51 exists), "Overhang angle"
(degrees from vertical, shared with L36's row if it landed first) and "First layer height" (mm).
`validateSettings` covers the ranges.

## Agent-facing tools

New tool in `ModelPreview3dToolkit` (`apps/server/src/fork/model-preview-3d/mcp.ts:13-202`):

```ts
Tool.make("loom_model_preview_3d_check", {
  description:
    "Check a workspace model for printability: watertight mesh, separate bodies, bed fit, " +
    "first-layer contact, overhangs beyond the overhang angle, unsupported islands, walls " +
    "thinner than two nozzle widths and features thinner than the nozzle. Works for STL, " +
    "3MF, OBJ, glTF, GLB and SCAD (rendered with overrides). Locations are model-space mm.",
  parameters: Schema.Struct({
    path: Schema.String,
    ...PrintCheckOptions.fields,
  }),
  success: PrintCheckReport,
  failure: Schema.Union([ModelPreviewError, OrchestratorMcpFailure]),
  dependencies: [McpInvocationContext],
})
  .annotate(Tool.Title, "Check 3D print readiness")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false),
```

The handler uses `McpToolAccess.actsAsCaller`, resolves the thread with `modelThread`
(`mcp.ts:203-211`), checks `agentToolEnabled` with the same message as its siblings
(`mcp.ts:271-276`), and calls `service.checkPrint({ file: { threadId, path }, ...options })`.
The report is the success value, so an agent reads `findings[].location.point` and can follow up
with `loom_model_preview_3d_editor` (`{ action: "display", findings: true }`, then a capture).

The editor command needs no new action: `inspector` opens Part, which runs the check.

## Performance

Measured on 2026-10-10 with `node apps/server/src/fork/model-preview-3d/check/bench.ts`,
an Apple M5 Pro, 64 GiB memory and Node v24.21.0. Each size checks a subdivided sphere and a
10-plate grid. Triangle counts are slightly below the targets because subdivisions are whole
numbers. Times cover worker parsing and all checks; worker startup and file IO are additional.

| Target triangles | Sphere actual | Sphere total | Plate actual | Plate total |
| ---------------- | ------------- | ------------ | ------------ | ----------- |
| 100,000          | 99,852        | 187 ms       | 94,080       | 226 ms      |
| 1,000,000        | 999,996       | 1.41 s       | 993,720      | 1.62 s      |
| 3,000,000        | 2,999,820     | 4.14 s       | 2,995,680    | 4.75 s      |

- Memory: the benchmark process used 182 to 211 MiB at about 100k triangles, 668 to 843 MiB
  at about 1M and 2,039 to 2,136 MiB at about 3M when receiving the result. These readings
  include generated fixture arrays, file bytes and the worker, and are not an isolated worker
  heap measurement. The original 450 MB estimate at the cap was too low. One check and its
  file IO run at a time; shared callers retain leases rather than duplicate buffers. Typed
  arrays are outside `resourceLimits`, so the 3M triangle cap and bounded grid references
  provide the memory guard. Findings are capped inside the worker before caching.
- The event loop never runs geometry; the main thread only reads files and hashes a short key.
- Network: the report is typically under 10 KB and at most about 80 KB (200 findings). Nothing
  streams. Mesh bytes stay on the host, which matters for remote clients over T3 Connect.
- Rendering: pins are DOM marks positioned in the existing `placeMarks` pass after each frame
  (`createViewer.ts:186-195`). Setting findings or framing calls `requestRender` once. No
  animation loop, no tween, no per-frame work when idle.
- Auto-runs only while Part is visible, debounced, deduplicated by key, and served from the LRU
  when nothing changed.

## Alternatives considered

- Checking in the browser with the viewer's loaded geometry: no agent access without a panel,
  repeated work per client, and a remote phone would analyse a 150 MB mesh. Rejected.
- `three-mesh-bvh` on the server: a new dependency for one ray query type; the uniform grid is
  a few hundred lines and fits short rays well. The brief rules out a BVH dependency.
- `manifold-3d` (WASM) for topology and volume: accurate, but a large dependency, and it does not
  measure walls or overhangs. Rejected for v1.
- A child process through a hidden CLI subcommand, as the Claude history worker does
  (`apps/server/src/cli/claudeHistory.ts:6-12`): would also work in the single-file executable,
  but adds process spawn, stdio framing and argument plumbing, and Kyle asked for a worker
  thread. Keep as the fallback if the executable needs checks later.
- Loading the bundled worker by file path: simplest, but ES module workers inside the desktop
  asar archive are reported to fail; the `data:` URL avoids the question.
- Exhaustive thickness (a ray per vertex or a voxel distance field): cost grows with triangles
  or volume, and sampling with a fixed seed already finds every region larger than a millimetre
  or so. Rejected.
- Storing findings as workspace annotations: they would go stale on every edit and clutter
  change requests. Findings stay derived.
