# L67 technical

## Overview

Three pieces, each in the folder that already owns its kind of work:

1. **Board features (PCB, pure).** The board reference that `exportReference` writes
   (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2392-2463`) becomes version 2: it
   gains the design kind and the board outline. `boardFeatures(glbJson, metadata)` turns a
   reference GLB's JSON chunk and its metadata into what the checks and the generator need, all
   in the board part's own frame: board faces, outline, mounting holes, part boxes and edge
   connectors. It reads only the glTF JSON (accessor `min`/`max` and node transforms), never
   vertex data.
2. **Case starter (PCB service).** `enclosure(input)` plans a tray, lid and standoffs from the
   features, writes `case.scad` (and `case.b3d.py` with L50), and creates the board's L48
   assembly. One new tool, `loom_pcb_enclosure`.
3. **Fit checks (L48, extended).** An assembly may carry an `enclosure` section naming the
   board part and the case parts. L48's `checkAssembly` then adds an `enclosure` report, made by
   casting rays from the board's features against the case parts' triangles in L48's worker.
   Two new assembly operations place the board over a case and swap in a newer board revision.

```
PCB panel "Enclosure" tab                 Model panel (L48 assembly)
  | Generate case                           | Fit tab: EnclosureFitSection
  v                                         v
loom.pcb-preview.enclosure            loom.model-preview-3d.checkAssembly
  exportReference (v2 metadata)         read board GLB JSON + <stem>.json
  boardFeatures -> planEnclosure        boardFeatures -> worker { kind: "assembly",
  writeScad / writeBuild123d                                     enclosure: {...} }
  write <stem>.loom-assembly.json       AssemblyCheckReport.enclosure -> rows and pins
```

### Frames

All starter geometry and all enclosure points are in millimetres with +Z up.

- **Drawing frame** (inspection): KiCad board coordinates, Y down. tscircuit inspection negates
  circuit Y (`apps/server/src/fork/pcb-preview/semantics.ts:418-440`), so it is Y down too.
- **Board part frame**: what the model viewer shows for the reference GLB. glTF is metres and
  +Y up; the loader turns it with `rotation.x = π/2` and scales by 1000
  (`apps/web/src/fork/model-preview-3d/viewer/load.ts:156-158`), so a glTF node-space point
  `(x, y, z)` is `(1000x, -1000z, 1000y)` in the board part frame. The worker's glTF reader
  (L46 `readGltf.ts`) normalizes the same way.
- **Drawing to board part**: `X = sx·u + ox`, `Y = sy·v + oy` with `(sx, sy)` in `{±1}²`, fitted
  exactly as L61's `boardFrame` (`docs/fork/packets/L61-pcb-3d-tools/TECHNICAL.md`, "Heights
  and board frame"): per sign pair, the offset is the median of `part centre - (sx·u, sy·v)`
  over components matched by reference, and the smallest median residual wins. With fewer than
  three matches, use KiCad `(1, -1)` and tscircuit `(-1, 1)` and centre the drawing bounds on
  the board body box. `sx === sy` is a mirror; it sets `frame.mirrored` and a warning, and the
  3D board stays the truth.

The case is generated in the board part frame, so in the generated assembly the board and the
case both sit at position `[0, 0, 0]` with no rotation. Changing `standoff_height` in the
customizer moves the floor down, never the board, so the assembly stays consistent.

## Contracts

### New file `packages/contracts/src/fork/pcb-enclosure.ts`

Shared by the PCB contracts and L48's `model-assembly.ts`, so neither imports the other's file.
Exported from `packages/contracts/src/fork/index.ts`.

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const PCB_REFERENCE_FORMAT = "loom-pcb-reference";
export const PCB_REFERENCE_VERSION = 2;
export const ENCLOSURE_MAX_FINDINGS = 200;
export const ENCLOSURE_MAX_HOLES = 32;
export const ENCLOSURE_MAX_CONNECTORS = 16;
export const ASSUMED_PART_HEIGHT_MM = 10;

const finite = Schema.Number.check(Schema.isFinite());
const mm = finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 }));
const gap = (maximum: number) => finite.check(Schema.isBetween({ minimum: 0, maximum }));
const name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const xy = Schema.Struct({ x: mm, y: mm });
const withDefault = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

/** The JSON beside each board reference GLB. Version 1 files (no format) still decode. */
export const PcbReferenceMetadata = Schema.Struct({
  format: withDefault(Schema.Literal(PCB_REFERENCE_FORMAT), PCB_REFERENCE_FORMAT),
  version: withDefault(Schema.Int, 1),
  designId: Schema.String,
  sourceHash: Schema.String,
  /** null in version 1; inferred from designId and the GLB. */
  kind: withDefault(Schema.NullOr(Schema.Literals(["kicad", "tscircuit"])), null),
  units: Schema.Literal("mm"),
  glbUnits: Schema.Literal("metres"),
  bounds: Schema.NullOr(Schema.Struct({ x: mm, y: mm, width: mm, height: mm })),
  thickness: finite,
  /** Drawing frame. null in version 1: the bounds rectangle stands in. */
  outline: withDefault(
    Schema.NullOr(
      Schema.Struct({
        source: Schema.Literals(["edge-cuts", "circuit-outline", "bounds"]),
        loops: Schema.Array(Schema.Array(xy).check(Schema.isMaxLength(4000))).check(
          Schema.isMaxLength(64),
        ),
        outer: Schema.Int,
      }),
    ),
    null,
  ),
  mountingHoles: Schema.Array(
    Schema.Struct({
      x: mm,
      y: mm,
      diameter: finite,
      slotLength: finite,
      plated: withDefault(Schema.Boolean, false),
      footprint: withDefault(Schema.String, ""),
    }),
  ),
  components: Schema.Array(
    Schema.Struct({
      reference: Schema.String,
      value: Schema.String,
      footprint: Schema.String,
      position: Schema.NullOr(xy),
    }),
  ),
  note: Schema.String,
});

export const EnclosureRequirements = Schema.Struct({
  wallGapMm: withDefault(gap(20), 0.5),
  lidGapMm: withDefault(gap(50), 1),
  floorGapMm: withDefault(gap(50), 1),
  connectorMarginMm: withDefault(gap(10), 0.5),
  standoffToleranceMm: withDefault(gap(5), 0.2),
  /** A connector box this close to the outer outline, or past it, faces an edge. */
  edgeMarginMm: withDefault(gap(10), 1),
  connectors: withDefault(
    Schema.Struct({
      include: Schema.Array(name).check(Schema.isMaxLength(ENCLOSURE_MAX_CONNECTORS)),
      exclude: Schema.Array(name).check(Schema.isMaxLength(64)),
    }),
    { include: [], exclude: [] },
  ),
});
export const EnclosureRequirementsPatch = Schema.Struct({
  wallGapMm: Schema.optional(gap(20)),
  lidGapMm: Schema.optional(gap(50)),
  floorGapMm: Schema.optional(gap(50)),
  connectorMarginMm: Schema.optional(gap(10)),
  standoffToleranceMm: Schema.optional(gap(5)),
  edgeMarginMm: Schema.optional(gap(10)),
  connectors: Schema.optional(EnclosureRequirements.fields.connectors),
});

export const EnclosureFinding = Schema.Struct({
  /** Stable within a report: "wall:+x", "above:U3", "connector:J1", "hole:2", "pair:case". */
  id: Schema.String.check(Schema.isMaxLength(120)),
  kind: Schema.Literals(["wall", "above", "below", "connector", "hole", "interference"]),
  status: Schema.Literals(["ok", "tight", "interferes", "unchecked"]),
  label: Schema.String.check(Schema.isMaxLength(120)), // "J1 opening", "Wall, +X side"
  detail: Schema.String.check(Schema.isMaxLength(300)), // one sentence
  measuredMm: Schema.NullOr(finite), // the gap; null when it cannot be measured
  requiredMm: Schema.NullOr(finite),
  point: Schema.Tuple([finite, finite, finite]), // assembly millimetres, for pins and framing
  connector: Schema.optional(
    Schema.Struct({
      openFraction: gap(1),
      setbackMm: Schema.NullOr(finite),
      facing: Schema.Literals(["+x", "-x", "+y", "-y"]), // board part frame
    }),
  ),
  hole: Schema.optional(
    Schema.Struct({
      state: Schema.Literals(["seated", "gap", "off-centre", "missing", "inside", "solid"]),
      offsetMm: Schema.NullOr(Schema.Tuple([finite, finite])),
    }),
  ),
});
export const EnclosureReport = Schema.Struct({
  board: Schema.String, // assembly part id
  boardRevision: Schema.String, // metadata sourceHash
  status: Schema.Literals(["fits", "tight", "interferes", "incomplete"]),
  frame: Schema.Struct({ mirrored: Schema.Boolean, matchedParts: Schema.Int }),
  findings: Schema.Array(EnclosureFinding).check(Schema.isMaxLength(ENCLOSURE_MAX_FINDINGS)),
  /** Move for the board part, in assembly mm, when the holes agree on one. */
  suggestedMove: Schema.NullOr(Schema.Tuple([finite, finite, finite])),
  warnings: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
  complete: Schema.Boolean,
});

export const EnclosureStarterParams = Schema.Struct({
  wallMm: withDefault(gap(10).check(Schema.isGreaterThan(0.4)), 2),
  floorMm: withDefault(gap(10).check(Schema.isGreaterThan(0.4)), 2),
  lidMm: withDefault(gap(10).check(Schema.isGreaterThan(0.4)), 2),
  sideGapMm: withDefault(gap(10), 0.5),
  topGapMm: withDefault(gap(30), 1),
  /** null: max(3, deepest part below the board + floor gap). */
  standoffHeightMm: withDefault(Schema.NullOr(gap(50)), null),
  /** null: hole diameter + 3 per hole. */
  standoffDiameterMm: withDefault(Schema.NullOr(gap(20)), null),
  /** null: max(1, hole diameter - 0.6) per hole; 0 makes solid standoffs. */
  pilotDiameterMm: withDefault(Schema.NullOr(gap(10)), null),
  cornerRadiusMm: withDefault(gap(20), 1),
  cutoutMarginMm: withDefault(gap(5), 0.5),
  lidLipMm: withDefault(gap(10), 1.5),
  lidLipGapMm: withDefault(gap(2), 0.2),
  /** Height used for parts with no 3D model. 0 ignores them. */
  assumedHeightMm: withDefault(gap(100), ASSUMED_PART_HEIGHT_MM),
  connectors: EnclosureRequirements.fields.connectors,
});

/** Loom's reference names end in "-<first 16 hex of sourceHash>.glb" (PcbPreviewService.ts). */
export const referenceHashPrefix = (path: string): string | null =>
  /-([0-9a-f]{16})\.glb$/i.exec(path)?.[1]?.toLowerCase() ?? null;
```

`withDefault` keeps the file readable; if the contracts package already has an equivalent
helper by the time this lands, use that one.

### `packages/contracts/src/fork/pcb-workspace.ts`

- `PcbInspection.mountingHoles` items (`:49-52`) gain `plated` and `footprint`, both with
  decoding defaults (`false`, `""`), so cached inspections and older servers still decode.
- `PcbReferenceResult` (`:293-298`) gains `relativePath: Schema.optional(text(4096))`, the
  workspace-relative GLB path. `path` stays absolute for existing callers. Agents pass
  `relativePath` to L48's `add-part`, which takes workspace paths.
- New input and result:

```ts
export const PcbEnclosureInput = Schema.Struct({
  threadId: ThreadId,
  designId: text(1024),
  /** Workspace-relative. Default: "<design dir>/<stem>-enclosure". */
  outputDir: Schema.optional(text(1024)),
  params: Schema.optional(EnclosureStarterParamsInput), // every field optional
  build123d: Schema.optional(Schema.Boolean),
  overwrite: Schema.optional(Schema.Boolean),
  preview: Schema.optional(Schema.Boolean),
});
export const PcbEnclosureResult = Schema.Struct({
  reference: Schema.NullOr(PcbReferenceResult), // null for preview
  assembly: Schema.NullOr(Schema.Struct({ path: text(4096), created: Schema.Boolean })),
  files: Schema.Array(
    Schema.Struct({
      path: text(4096), // workspace-relative
      language: Schema.Literals(["openscad", "build123d"]),
      written: Schema.Boolean,
      source: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000_000))), // preview only
    }),
  ),
  plan: Schema.Struct({
    outerMm: Schema.Tuple([finite, finite, finite]),
    innerMm: Schema.Tuple([finite, finite, finite]),
    standoffs: Schema.Int,
    cutouts: Schema.Array(text(100)), // connector references
    partsAboveMm: finite,
    partsBelowMm: finite,
  }),
  warnings: Schema.Array(Schema.String),
});
```

`EnclosureStarterParamsInput` is `EnclosureStarterParams` with every field `Schema.optional`;
the service decodes it through `EnclosureStarterParams` to apply the defaults.

### `packages/contracts/src/fork/pcb-preview.ts`

- `PCB_PREVIEW_WS_METHODS` (`:15-43`) gains `enclosure: "loom.pcb-preview.enclosure"`.
- `Rpc.make(PCB_PREVIEW_WS_METHODS.enclosure, { payload: W.PcbEnclosureInput, success:
W.PcbEnclosureResult, error: errors })` after `exportReference` (`:249-253`).
- No new error reason: `conflict` for an edited generated file, `invalid-parameters` for a
  build123d request without L50 or an output folder outside the workspace, `unsupported-view`
  for a design without a board, `tool-too-old` from the GLB export.

### `packages/contracts/src/fork/clientRpcPermissions.ts`

`[P.enclosure]: AuthOrchestrationOperateScope`, beside `exportReference` (`:19`), because it
runs the board export and writes workspace files.

### L48's `packages/contracts/src/fork/model-assembly.ts` (fork-owned, phase B)

```ts
export const ASSEMBLY_FILE_VERSION = 2; // was 1
export const ASSEMBLY_CHECK_VERSION = 2; // was 1; enclosure results change cached reports

export const AssemblyEnclosure = Schema.Struct({
  board: AssemblyId,
  /** Case parts. Empty: every visible part except the board. */
  parts: Schema.Array(AssemblyId)
    .check(Schema.isMaxLength(ASSEMBLY_MAX_PARTS))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  requirements: EnclosureRequirements.pipe(
    Schema.withDecodingDefault(Effect.succeed(Schema.decodeSync(EnclosureRequirements)({}))),
  ),
});
// ModelAssembly gains
enclosure: Schema.NullOr(AssemblyEnclosure).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
```

- The writer sets `version: doc.enclosure ? 2 : 1`, so files without an enclosure stay readable
  by every Loom, and an older Loom opens an enclosure assembly read-only (L48's rule for a newer
  `version`) instead of silently dropping the section on its next write.
- `validateAssembly` adds: `enclosure.board` and every `enclosure.parts` id name existing parts;
  the board is not in `parts`; the board part path ends in `.glb`.
- `AssemblyOperation` gains four members:

```ts
Schema.Struct({
  op: Schema.Literal("set-enclosure"),
  board: AssemblyId,
  parts: Schema.optional(Schema.Array(AssemblyId)),
  requirements: Schema.optional(EnclosureRequirementsPatch), // merges into the current values
}),
Schema.Struct({ op: Schema.Literal("clear-enclosure") }),
Schema.Struct({
  op: Schema.Literal("place-board"),
  id: AssemblyId,
  quarterTurns: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
  zMm: Schema.optional(mm),
}),
Schema.Struct({ op: Schema.Literal("swap-board"), id: AssemblyId, path: Schema.String }),
```

- `remove-part` of the enclosure board clears `enclosure`; removing a case part removes it
  from `enclosure.parts`.
- `AssemblyCheckReport` (L48) gains `enclosure: Schema.optional(EnclosureReport)`.

## Server

### Files

| File                                                                     | Phase | Purpose                                                      |
| ------------------------------------------------------------------------ | ----- | ------------------------------------------------------------ |
| `apps/server/src/fork/pcb-preview/outline.ts` (new)                      | A     | Edge.Cuts and circuit outline loops.                         |
| `apps/server/src/fork/pcb-preview/glb.ts`                                | A     | `readGlbJson`, `readGlbBounds` (L55's spec plus node names). |
| `apps/server/src/fork/pcb-preview/enclosure/reference.ts` (new)          | A     | `referenceData`: GLB file and v2 metadata without writing.   |
| `apps/server/src/fork/pcb-preview/enclosure/features.ts` (new)           | A     | `boardFeatures`.                                             |
| `apps/server/src/fork/pcb-preview/enclosure/plan.ts` (new)               | A     | `planEnclosure`.                                             |
| `apps/server/src/fork/pcb-preview/enclosure/scad.ts` (new)               | A     | `writeScad`.                                                 |
| `apps/server/src/fork/pcb-preview/enclosure/build123d.ts` (new)          | A     | `writeBuild123d`.                                            |
| `apps/server/src/fork/pcb-preview/enclosure/service.ts` (new)            | A     | `makeEnclosure(deps)`: the `enclosure` method.               |
| `apps/server/src/fork/pcb-preview/semantics.ts`                          | A     | Plated mounting holes, hole footprint.                       |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.ts`                  | A     | Call sites only (below).                                     |
| `apps/server/src/fork/model-preview-3d/assemblyOps.ts` (L48)             | B     | The four operations.                                         |
| `apps/server/src/fork/model-preview-3d/assembly.ts` (L48)                | B     | Features for the check, key, report.                         |
| `apps/server/src/fork/model-preview-3d/check/enclosure.ts` (new, worker) | B     | The ray checks.                                              |
| `apps/server/src/fork/model-preview-3d/check/protocol.ts` (L46/L48)      | B     | `AssemblyRequest.enclosure`.                                 |

`PcbPreviewService.ts` is about 2,600 lines, so per PCB-FOLLOW-UPS.md new work goes in new
files with call sites only: `exportReference` (`:2392`) calls `referenceData` and writes its
result; `make` creates `makeEnclosure({ asset, inspect, resolveDesign, workspace,
ensureWorkspaceDirectory, safePath, fs, path, entries })` and the service object (`:2568-2606`)
gains `enclosure: (input) => checked(enclosure(input))` next to `exportReference` (`:2575`).

The model folder imports two pure PCB modules (`enclosure/features.ts`, `glb.ts`). That is a
plain module import with no service dependency, the same direction PCB already uses the other
way for `signedFiles.ts` (`PcbPreviewService.ts:31`). `ForkLayer.ts` keeps the two services as
siblings (`apps/server/src/fork/ForkLayer.ts:24-25`).

### Inspection fixes (`semantics.ts`)

- Mounting holes (`:145-158`) take only `np_thru_hole` pads today (`:147`). KiCad's standard
  `MountingHole_*_Pad*` footprints use plated `thru_hole` pads, so most real boards report no
  holes. New rule: `np_thru_hole` pads, plus `thru_hole` pads in a footprint whose name
  (`atom(f)`) matches `/MountingHole/i`. Each hole carries `plated` and `footprint`. A plated
  mounting footprint with several pads (the via-ring variants) yields one hole: the pad with the
  largest drill.
- tscircuit holes (`:426-440`) get `plated: false`, `footprint: ""`. `pcb_plated_hole` belongs
  to component pins and stays out.

### Outline (`outline.ts`)

```ts
export type OutlineLoops = {
  source: "edge-cuts" | "circuit-outline" | "bounds";
  loops: { x: number; y: number }[][]; // drawing frame, closed (last point not repeated)
  outer: number;
};
export function kicadOutline(board: Sexp[]): OutlineLoops | null;
export function circuitOutline(json: unknown): OutlineLoops | null;
```

- KiCad: the same Edge.Cuts items L55 chains for area (`L55-pcb-board-stats/TECHNICAL.md`,
  "Area"): top-level `gr_line`, `gr_arc`, `gr_rect`, `gr_circle`, `gr_poly` and the `fp_*`
  items inside footprints, transformed with `localPosition` (`semantics.ts:49-55`). Today's
  bounds read only top-level items (`semantics.ts:92-94`); the loops include footprint edge cuts.
  Arcs and circles flatten to 0.05 mm chord error. Endpoints join within 0.001 mm. The loop with
  the largest absolute area is `outer`, made counter-clockwise in the drawing frame; holes are
  the others. Any open chain, or no closed loop, returns null, so L55 falls back to bounds
  and the generator does not mistake a closed cutout for an incomplete outer wall.
- tscircuit: `pcb_board.outline` when present (a point list, circuit-json), else the rectangle
  from `center`, `width`, `height`, both with Y negated like `semantics.ts:418-424`.
- L55 computes its area by shoelacing these loops. Whichever of L55 and L67 lands first writes
  `outline.ts`; the other imports it.

### GLB JSON (`glb.ts`)

```ts
/** The JSON chunk of a GLB, or the whole file for .gltf. Throws on a malformed header. */
export function readGlbJson(bytes: Uint8Array): unknown;
export type GlbMesh = {
  name: string | null;
  nodes: readonly string[]; // ancestor node names, root first
  materials: readonly string[];
  min: Vec3;
  max: Vec3; // world-space bounds after node transforms, metres, +Y up
};
export type GlbBounds = { meshes: GlbMesh[] };
export function readGlbBounds(json: unknown): GlbBounds;
```

`readGlbBounds` uses the shared L55 signature (`L55-pcb-board-stats/TECHNICAL.md`, "Heights
from a cached GLB"), including `nodes` and `materials` for L61's classification rules.
Whichever of L55 and L67 lands first creates the full signature; the other reuses it. The
service reads only the first 20 bytes and the JSON chunk of the file (cap 16 MiB of JSON), not the binary chunk.

### Board features (`enclosure/features.ts`)

```ts
export type Box = { min: [number, number, number]; max: [number, number, number] };
export type BoardFeatures = {
  kind: "kicad" | "tscircuit" | "unknown";
  frame: { sx: 1 | -1; sy: 1 | -1; ox: number; oy: number; mirrored: boolean; matched: number };
  body: { top: number; bottom: number; box: Box }; // board part frame, mm
  outline: { loops: [number, number][][]; outer: number; source: OutlineLoops["source"] };
  holes: { x: number; y: number; diameter: number; footprint: string }[];
  parts: {
    reference: string | null;
    side: "front" | "back";
    box: Box;
    assumed: boolean;
  }[];
  connectors: { reference: string; box: Box; facing: "+x" | "-x" | "+y" | "-y"; edgeMm: number }[];
  warnings: string[];
};
export function boardFeatures(
  glbJson: unknown,
  metadata: PcbReferenceMetadata,
  options: {
    connectors: { include: readonly string[]; exclude: readonly string[] };
    edgeMarginMm: number;
    assumedHeightMm: number;
  },
): BoardFeatures;
```

Rules, in order. Steps 1 to 5 are L61's classification rules (`L61-pcb-3d-tools/TECHNICAL.md`,
"Part classification") applied to `readGlbBounds` output instead of three.js objects, so the
server and the 3D board view agree.

1. Kind: `metadata.kind`; else a material named `board` means KiCad, a node named
   `Loom millimetres to metres` (`glb.ts:53`, unmangled in raw JSON) means tscircuit.
2. Mesh boxes to board part frame: `(x, y, z) -> (1000x, -1000z, 1000y)`, then min and max
   again, since the swap reverses one axis.
3. Body: union of meshes with material `board` (KiCad), else the mesh with the largest XY box
   area. No body: features fail with "The 3D board has no board body."
4. Components: every other mesh, grouped by the first ancestor whose name, or the name without a
   trailing `_<digits>`, is a metadata reference; else by the child of the assembly root. Board
   side meshes (materials `soldermask`, `silkscreen`, `copper`, `pad`) are skipped. Side from
   the box centre against the body mid-plane.
5. Frame: the fit in Frames above, using component box centres and metadata `position`s.
6. Outline: `metadata.outline` (or the bounds rectangle for version 1) mapped into the board
   part frame and re-oriented counter-clockwise when the frame is mirrored.
7. Holes: metadata holes mapped into the frame. A hole counts as a mounting hole when its
   footprint matches `/MountingHole/i`, or it is at least 2.0 mm across and lies outside every
   component box (connector pegs and locating pins sit inside their part). At most
   `ENCLOSURE_MAX_HOLES`; more is a warning and the largest are kept.
8. Assumed parts: metadata references with no mesh, except references starting `H`, `MH`, `FID`,
   `TP`, `G`, `LOGO`, `NT` or `#` (holes, fiducials, test points, graphics), get a 5 by 5 mm box
   at their position, `assumedHeightMm` tall on the front, `assumed: true`. A warning names the
   count. With `assumedHeightMm: 0` they are dropped.
9. Connectors: a part whose reference matches `/^(J|P|CN|USB|X)\d/i`, or whose metadata
   footprint matches `/connector|usb|jack|header|terminal|barrel|rj45|sma|jst|molex/i`, or that
   is in `include`; minus `exclude`; with its XY box crossing the outer outline or within
   `edgeMarginMm` of it. `facing` is the axis direction closest to the outward normal of the
   nearest outline segment. At most `ENCLOSURE_MAX_CONNECTORS`, nearest the edge first.
   Assumed parts are never connectors.

Boxes come from accessor bounds through node transforms, so a part rotated off-axis reads
larger than it is. That is conservative for every check (a box can only reach further) and the
tab says so once.

DNP parts are in the KiCad GLB because L24 does not pass `--no-dnp` (`:1650-1662`); they count.
That matches what L24's 3D view shows. A per-part exclusion would be a later addition.

### Plan (`enclosure/plan.ts`)

```ts
export type EnclosurePlan = {
  params: EnclosureStarterParams; // resolved, no nulls
  outline: [number, number][]; // outer loop, board part frame
  boardTop: number;
  boardBottom: number;
  thickness: number;
  partsAbove: number;
  partsBelow: number; // tallest above the top face, deepest below the bottom
  standoffs: { x: number; y: number; diameter: number; pilot: number }[];
  cutouts: { reference: string; box: Box; facing: "+x" | "-x" | "+y" | "-y" }[];
  proxies: Box[]; // part boxes for the board proxy in part = "fit"
  outerMm: [number, number, number];
  innerMm: [number, number, number];
};
export function planEnclosure(f: BoardFeatures, p: EnclosureStarterParams): EnclosurePlan;
```

- `standoffHeightMm` null: `max(3, partsBelow + floorGap)` where floor gap is 1 mm.
- Standoff diameter null: hole diameter + 3. Pilot null: `max(1, diameter - 0.6)`. These are
  starting values for self-tapping screws into plastic, not a fastener standard (REFERENCES.md).
- Cut-out boxes: the connector box grown by `cutoutMarginMm`. The SCAD and Python hull it with a
  copy moved 25 mm along `facing`, so it cuts through whatever wall is in front.
- Proxies: the 300 tallest part boxes (assumed ones included), so a dense board stays cheap.
- `outerMm` and `innerMm` are the axis-aligned sizes for the result summary.

### OpenSCAD writer (`enclosure/scad.ts`)

`writeScad(plan, header)` returns one string. Everything is in the board part frame, with the
board's bottom face at `board_bottom`. Layout:

```scad
// Case for boards/sensor/sensor.kicad_pro, board revision 3f0a9c1d2e4b5a6f.
// Generated by Loom. Edit freely; Loom will ask before replacing an edited file.
// loom-generated: sha256=<hex of every line after this one>

/* [Show] */
part = "fit"; // [fit, base, lid]

/* [Case] */
wall = 2; // [0.8:0.1:6]
floor_thickness = 2; // [0.8:0.1:6]
lid_thickness = 2; // [0.8:0.1:6]
corner_radius = 1; // [0:0.5:10]

/* [Fit] */
side_gap = 0.5; // [0:0.1:5]
top_gap = 1; // [0:0.1:10]
standoff_height = 4; // [1:0.5:30]
standoff_diameter = 6.2; // [3:0.1:12]
pilot_diameter = 2.6; // [0:0.1:6]
cutout_margin = 0.5; // [0:0.1:3]
lid_lip = 1.5; // [0:0.1:5]
lid_lip_gap = 0.2; // [0:0.05:1]

/* [Hidden] */
board_outline = [[...], ...]; // board part frame, mm
board_bottom = -1.6;
board_thickness = 1.6;
parts_above = 11.2;
holes = [[x, y], ...];
cutouts = [[x0, y0, z0, x1, y1, z1, dx, dy], ...]; // connector boxes and facing
proxies = [[x0, y0, z0, x1, y1, z1], ...];
$fn = 48;

floor_top = board_bottom - standoff_height;
case_bottom = floor_top - floor_thickness;
lid_bottom = board_bottom + board_thickness + parts_above + top_gap;

module shape(grow) { offset(r = corner_radius) offset(delta = grow - corner_radius)
  polygon(board_outline); }
module base() { ... }   // tray minus cavity minus hulled cut-outs, plus standoffs
module lid() { ... }    // plate plus lip ring
module board_proxy() { ... } // green board slab and grey part boxes
if (part == "base") base();
else if (part == "lid") lid();
else { base(); translate([0, 0, 10]) lid(); board_proxy(); }
```

Notes for the writer:

- Customizer values are plain literals with `// [min:step:max]` hints, which L23's parser reads
  (`apps/server/src/fork/model-preview-3d/customizer.ts:101-114`). Board data sits after
  `/* [Hidden] */`, which the parser skips (`:50`, `:90`), and the first `module` ends parsing
  (`:83`). Nested arrays are therefore never offered as parameters.
- Per-hole standoff sizes from the plan become the defaults of `standoff_diameter` and
  `pilot_diameter` when all holes share a size; otherwise the parameters scale a per-hole value
  stored in `holes` (`[x, y, d, p]`) and the customizer value is a multiplier. Keep the common
  case simple: one size.
- `offset(delta = ...)` keeps outline corners square before the rounding pass, and a negative
  delta insets (REFERENCES.md, OpenSCAD offset). Board cut-outs (inner loops) are not
  reproduced; a case does not need them.
- Numbers are written with at most 4 decimals. The file is deterministic for one plan, so the
  hash in the header is stable and a regenerate with no change writes identical bytes.
- `color()` on the proxy only; L23 shows colours when `renderColors` is on.

### build123d writer (`enclosure/build123d.ts`)

Only when the server's `LOOM_SERVER_FEATURES` contains `model-python-cad` (L50 adds it);
otherwise `build123d: true` fails with `invalid-parameters`, "Python CAD files need a Loom server
with build123d support." The file follows L50's format (`L50-model-python-cad/TECHNICAL.md`):
a `*.b3d.py` file with `def model(...)` whose keyword arguments are the same parameters, typed
with `Annotated[float, {"min", "max", "step", "group"}]` and `Literal["fit", "base", "lid"]`.
Board data are module-level constants. Algebra mode only (no builders), so the source reads top
to bottom:

```python
# loom-generated: sha256=<hex>
from typing import Annotated, Literal
from build123d import *

BOARD_OUTLINE = [(12.0, -3.5), ...]
BOARD_BOTTOM = -1.6
...

def shape(grow: float, radius: float) -> Sketch:
    base = offset(Polygon(BOARD_OUTLINE, align=(Align.NONE, Align.NONE)),
                  amount=grow - radius, kind=Kind.INTERSECTION)
    return offset(base, amount=radius, kind=Kind.ARC)

def model(
    part: Literal["fit", "base", "lid"] = "fit",
    wall: Annotated[float, {"min": 0.8, "max": 6, "step": 0.1, "group": "Case"}] = 2.0,
    ...
):
    floor_top = BOARD_BOTTOM - standoff_height
    tray = Pos(0, 0, floor_top - floor_thickness) * extrude(shape(side_gap + wall, corner_radius),
                                                            amount=...)
    ...
```

`kind=Kind.INTERSECTION` gives sharp corners like OpenSCAD's `delta`; `Kind.ARC` rounds. The
exact `Polygon` call form and `offset` keyword names are checked by the opt-in Python test
(TESTING.md) against L50's pinned build123d 0.13.0.

### Generated-file guard

Each generated file has a `loom-generated: sha256=<hex>` line whose hash covers every line
after it. On generate, for each target file that exists:

- No such line, or the hash does not match the content: it was edited. Without `overwrite`,
  fail `conflict`: "case.scad was edited after Loom wrote it. Pass overwrite to replace it." The
  panel turns that into the "Overwrite it?" question.
- Hash matches: safe to replace.

Writes use `writeFileStringAtomically` (`@t3tools/shared/atomicWrite`, as
`PcbPreviewService.ts:66`).

### The `enclosure` method (`enclosure/service.ts`)

1. `resolveDesign`; no `boardPath` for KiCad: `unsupported-view`, "Add a board file to check an
   enclosure."
2. `preview`: `referenceData(input)` only (cached GLB from `asset`, inspection, v2 metadata in
   memory). Otherwise `exportReference({ threadId, designId })`, the existing method, which now
   writes v2 metadata.
3. `readGlbJson` on the GLB, decode the metadata, `boardFeatures`, `planEnclosure`.
4. Output folder: `outputDir` or `<dirname(designId)>/<stem>-enclosure`, where `stem` is the
   design file name up to its first `.`, sanitized as `exportReference` does (`:2408-2411`).
   Resolve with `safePath`; outside the workspace is `invalid-parameters`. Create with
   `ensureWorkspaceDirectory` (`:258`).
5. Write `case.scad`, and `case.b3d.py` when asked, through the guard.
6. Phase B only (L48 landed): the assembly at `<dirname(designId)>/<stem>.loom-assembly.json`.
   Missing: write a new one (below). Present: leave it, `created: false`, and if it has no part
   whose path is the new `case.scad`, add the warning "The board's assembly already exists, so
   the new case was not added. Add it from the 3D panel's Parts tab."
7. Return the result. The panel opens the assembly (or `case.scad` without L48).

New assembly document (encoded with `ModelAssembly`, version 2):

| Part id | Path                               | Notes                                                    |
| ------- | ---------------------------------- | -------------------------------------------------------- |
| `board` | relative path to the reference GLB | position and rotation zero                               |
| `case`  | `<stem>-enclosure/case.scad`       | `parameters: { part: "\"base\"" }`                       |
| `lid`   | `<stem>-enclosure/case.scad`       | `parameters: { part: "\"lid\"" }`, `explode: [0, 0, 30]` |

`enclosure: { board: "board", parts: ["case", "lid"], requirements }` with `wallGapMm` set to
the generator's `sideGapMm`, `lidGapMm` to `topGapMm`, and the connector lists copied. No
clearance pairs: L48 tests every visible pair for interference by default, and the enclosure
report covers the gaps. Part paths use L48's `relativePartPath`.

This create-only write bypasses L48's per-path semaphore. A concurrent create of the same new
file is the only race, and the loser's write is identical content for the same inputs.

### tscircuit revision scan

The tscircuit source scan counts any `.json`, `.stl`, `.glb` and similar under the package root
(`PcbPreviewService.ts:557-561`). The board's assembly JSON would then change the board's source
hash on every assembly edit, and every check would see a "new" board. Skip names ending in
`.loom-assembly.json` there. SCAD and Python files already do not match. A case STL that the
user exports into the case folder would still count; the tab notes it if it happens (stale on
every export), and moving exports elsewhere avoids it.

### Fit check (phase B, `assembly.ts` and `check/enclosure.ts`)

In L48's `checkAssembly`, when `doc.enclosure` is set:

1. The board part must be a `.glb` with a sibling `<stem>.json` that decodes as
   `PcbReferenceMetadata`. Otherwise the enclosure report is skipped with the warning "This board
   has no reference data. Export it from the PCB panel." and the pair checks still run.
2. `boardFeatures(readGlbJson(head of file), metadata, requirements)` on the main thread. Cached
   with the part's geometry revision.
3. Case parts: `enclosure.parts`, or every visible part except the board. Their geometry is the
   same per-part triangle soup L48 already prepares; no extra render.
4. Key: L48's key plus `features revision` and `requirements`.
5. Request: `AssemblyRequest` gains `enclosure?: { board: string; caseParts: string[];
features: BoardFeatures; requirements: EnclosureRequirements }`. The worker transforms the
   features by the board part's matrix and builds one grid over the case parts' triangles with
   L46's `grid.ts`. Rays use a nearest-hit query returning `t` and the triangle; if `grid.ts`
   does not export one, add `nearestHit(grid, origin, dir, maxT)` there.

Inside-solid test: a nearest hit whose triangle normal points along the ray means the ray
started inside a solid. This needs consistent winding, which L46 checks; parts that L46 flags as
open get `unchecked` findings instead of `interferes`.

Checks (board part frame directions transformed by the board's matrix):

- **Walls.** Sample the outer loop every `max(1, perimeter / 2000)` mm at three heights
  (bottom face, mid-plane, top face). From each sample, cast along the outward 2D normal up to
  50 mm. Hit facing back: gap `t`. Inside: interferes. No hit: an opening, ignored. Group by
  `facing` side; one finding per side with the smallest gap, `ok` at or above `wallGapMm`,
  `tight` below, `interferes` if any sample is inside, `unchecked` when no sample hit ("No wall
  found within 50 mm").
- **Above and below.** For each non-assumed part, five points on its top face (front parts) or
  bottom face (back parts): the centre and the corners inset 10 percent. Cast +Z or -Z up to
  200 mm. Gap is the smallest `t`. One finding per part that is not `ok` against `lidGapMm` or
  `floorGapMm`, plus one summary finding per side for the smallest gap ("Lid clearance", "Floor
  clearance"). No hit on a side: one `unchecked` finding ("No lid found above the board").
- **Connectors.** On the box face toward `facing`, a 7 by 5 grid over the face grown by
  `connectorMarginMm`, cast along `facing` up to 30 mm. Core rays (inside the real face) blocked:
  `interferes` ("J1 opening is blocked by the case"). Only margin rays blocked: `tight` ("J1
  opening is narrower than the margin"). All clear: `ok`. `openFraction` is the share of clear
  rays. `setbackMm`: eight rays from points 1 mm outside the grown face, smallest hit, which is
  how far the wall's inner face sits in front of the connector face; null without a hit.
- **Holes.** From the board bottom face at each hole, a centre ray and 12 rays on a circle of
  `diameter / 2 + 0.6` mm, all -Z up to 20 mm. States:
  - `inside`: the rays start inside a solid. Cast +Z from 5 mm below to find the solid's top;
    the depth is how far the standoff pokes up. `interferes`.
  - `missing`: no ring ray hits within 20 mm. `tight` with "No standoff under hole 2".
  - `gap`: ring hits agree within 0.3 mm and the gap exceeds `standoffToleranceMm`. `tight`.
  - `off-centre`: ring hits disagree by more than 0.3 mm. A grid of -Z rays at 0.25 mm
    spacing within 6 mm of the hole finds the points at the standoff's top (within 0.3 mm of the
    nearest hit); `offsetMm` is their centroid minus the hole centre. `tight`.
  - `seated`, or `solid` when the centre ray hits the same top (no pilot hole): `ok`.
- **Interference.** L48's pair results between the board and each case part. `intersects` or
  `inside` becomes an `interferes` finding at the pair's first region.

`suggestedMove`: XY is minus the median `offsetMm` when at least half the off-centre holes agree
within 0.3 mm of it and no hole is `missing`; Z is minus the median gap when every hole is `gap`,
or plus the median depth when every hole is `inside`. Null otherwise. The move is in assembly
millimetres for `move-part`.

`status`: `interferes` if any finding interferes, else `tight` if any is tight, else
`incomplete` when the worker hit a limit, else `fits`. `unchecked` findings do not change it but
are listed first in the panel.

Limits: 2,000 wall samples by 3 heights, 300 parts by 5 rays, 16 connectors by 43 rays, 32 holes
by 13 rays plus up to about 1,800 search rays each: under 70,000 rays, a few milliseconds per
thousand on a grid. They run inside L48's 60 second timeout and permit. Findings are capped at
`ENCLOSURE_MAX_FINDINGS`, worst first.

### Assembly operations (phase B, `assemblyOps.ts`)

`ctx` gains `boardFeatures(partId): Effect<BoardFeatures>` (cached as in the check).

- `set-enclosure`: validates ids, merges `requirements`, sets `parts` when given.
- `clear-enclosure`: sets `enclosure` to null.
- `place-board`: rotation becomes `[0, 0, 90 * quarterTurns]` when given, else unchanged. XY:
  the centre of the outline's bounding box, rotated, lands on the centre of the union of the
  case parts' world bounds (`ctx.bounds`, L48's exact bounds). Z: `zMm` when given, else
  unchanged. The first check then gives `suggestedMove` for the standoffs.
- `swap-board`: `path` is workspace-relative like `add-part`. Keeps the board where the drawing
  says it is: with `p0` the drawing-frame centre of the outline, the new position is the old
  position plus `R · (F_old(p0) - F_new(p0))` in XY and `R · (bottom_old - bottom_new)` in Z,
  where `F` maps drawing to board part frame. A changed sign pair adds 180 degrees about Z.

## Storage

- Board references: `.loom/pcb-references/<name>-<hash16>.glb` and `.json` in the target
  workspace, unchanged location (`PcbPreviewService.ts:2404-2413`). The JSON gains `format`,
  `version: 2`, `kind`, `outline` and per-hole `plated` and `footprint`. Existing version 1 files
  still decode and still check.
- Generated case: `<design dir>/<stem>-enclosure/case.scad` and optional `case.b3d.py`.
- Assembly: `<design dir>/<stem>.loom-assembly.json`, the L48 format with `enclosure`.
- Nothing in `PcbWorkspace`, settings or the database. The tab finds the assembly by its path.

## Clients

### Runtime (`packages/client-runtime/src/fork/pcb-preview.ts`)

An `enclosure` command beside `exportReference` (`:63-65`), label `loom:pcb-enclosure`. Phase B
uses L48's `assembly`, `updateAssembly` and `checkAssembly` commands from the model runtime.

### PCB panel

- `Inspector.tsx`: append `"Enclosure"` to `INSPECTOR_TABS` (`:40-50`) after the last tab, add
  its `TAB_META` entry (`:51-110`), add it to `NEEDS_EXECUTION` (`:111`) so tscircuit waits for
  execution like Inspect, and show it in `inspectorTabs` only when the design has a board
  (`design.boardPath` for KiCad, always for tscircuit) and the server lists `pcb-enclosure-fit`.
  The tab name is also the agent `open-tools` name (`:39`). A `case "Enclosure"` in the tool
  switch renders `EnclosureTab`.
- `EnclosureTab.tsx` (new): reads the assembly with L48's `assembly` command (not found is the
  empty state). Sections:
  - "Board reference": the reference hash prefix from the board part path
    (`referenceHashPrefix`) against the design's current `sourceHash`; "Update board" runs
    `exportReference`, then `updateAssembly` with `swap-board`, `expectedRevision` set.
  - "Generate case": number fields bound to `EnclosureStarterParams` with the plan's resolved
    defaults (from a `preview: true` call, debounced; preview returns no reference write),
    "Also write build123d (Python)" when `model-python-cad` is listed, and "Generate case". The
    `conflict` error becomes the "Overwrite it?" confirm.
  - "Use an existing case" (phase B): the existing model picker filtered to meshes and SCAD;
    then `exportReference` and one `updateAssembly` with `add-part` for each case file and the
    board (`relativePath`), `set-enclosure` and `place-board`.
  - "Check fit" with "Cancel" (L48's cancellation), the summary ("Fits", "Tight: 3 findings",
    "Interferes: 1 finding"), the findings as rows with measured against required, and "Show in
    3D", which opens `forkPanelSurface("model-preview-3d", assemblyPath)`
    (`HardwareLibrary.tsx:208` pattern) and sends the model editor `inspector` `fit` action.
  - Stale results use L48's key comparison.
- Without L48: the tab shows "Board reference" and "Generate case" only, and opens `case.scad`.

### Model panel (phase B)

- `EnclosureFitSection.tsx` (new), rendered at the end of L48's `AssemblyFitSection.tsx` when
  the assembly has `enclosure`: requirement fields (committing `set-enclosure` with a patch),
  connector include and exclude chips, the findings grouped by kind, "Apply suggested move"
  (`move-part` with `by`, and a toast with "Undo" that applies the negated move), and "Stop
  checking as an enclosure" (`clear-enclosure`). Without `enclosure`, a "Check as an enclosure…"
  button picks the board among GLB parts and sends `set-enclosure`.
- Pins: findings map onto L48's `setPins`: `interferes` to `check-fail`, `tight` to
  `check-warn`, `unchecked` to `check-info`. Clicking a row frames `point` with L46's `frame`.
- Units: L40's `formatLength` when present, else millimetres with one decimal.

No viewer change beyond pins: the board, case and lid are ordinary L48 parts.

## Agent-facing tools

New tool in `PcbToolkit` (`apps/server/src/fork/pcb-preview/mcp.ts`), beside
`loom_pcb_export_reference` (`:36-49`):

```ts
Tool.make("loom_pcb_enclosure", {
  description:
    "Generate a parametric case starter for a saved board: an OpenSCAD tray, lid and " +
    "standoffs that follow the board outline, mounting holes, part heights and edge " +
    "connectors, plus a build123d file when the server supports Python CAD. Writes " +
    "<design>-enclosure/ and the board's .loom-assembly.json (with 3D assemblies). " +
    "preview=true returns sources without writing. Edited files are kept unless " +
    "overwrite=true. Never orders, prints or uploads anything.",
  parameters: Schema.Struct({
    ...design, // designId, as the sibling tools spread it
    outputDir: Schema.optional(Schema.String),
    params: Schema.optional(EnclosureStarterParamsInput),
    build123d: Schema.optional(Schema.Boolean),
    overwrite: Schema.optional(Schema.Boolean),
    preview: Schema.optional(Schema.Boolean),
  }),
  success: W.PcbEnclosureResult,
  failure, // the toolkit's shared failure union
  dependencies: [McpInvocationContext, ThreadManagementService],
})
  .annotate(Tool.Title, "Generate a board case")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false),
```

Handler: `McpToolAccess.actsAsCaller` (it writes only the caller's workspace), with the body of
the export reference handler (`mcp.ts:296-303`): resolve `thread`, then `withForkRuntime(
Effect.flatMap(PcbPreviewService, (service) => service.enclosure({ ...input, threadId })))`.
`t3 pcb enclosure '<json>'` works through the generic mapper
(`apps/server/src/fork/pcb-preview/cli.ts:14`).

Also:

- `loom_pcb_export_reference` returns `relativePath`, and its description gains "Use
  relativePath with loom_model_preview_3d_assembly_update add-part."
- L48's `assembly_update` description gains the four operations; `assembly_check` returns
  `enclosure` with no parameter change.
- `loom_pcb_editor` `open-tools` with `name: "Enclosure"` opens the tab.

Agent loops:

```
t3 pcb enclosure '{"designId":"boards/sensor/sensor.kicad_pro"}'
t3 model assembly_check '{"path":"boards/sensor/sensor.loom-assembly.json"}'
t3 model assembly_update '{"path":"boards/sensor/sensor.loom-assembly.json",
  "operations":[{"op":"update-part","id":"case","parameters":{"part":"\"base\"","wall":"2.4"}}]}'
```

Existing case: `export_reference`, then `assembly_update` with `add-part` (case), `add-part`
(`relativePath`), `set-enclosure`, `place-board`, then `assembly_check` and a `move-part` by
`enclosure.suggestedMove`.

## Performance

- Nothing animates or repaints while idle. The tab is a form and a list.
- Generate: the GLB export is L24's cached asset (`runAsset`, `:1560-1774`), so a second
  generate or preview for the same revision costs a JSON chunk read (well under 1 MB for typical
  boards) and string building. Preview responses carry the SCAD source, typically 10 to 60 KB;
  the panel requests preview only on field change, debounced 400 ms.
- Check: the feature pass reads only the GLB JSON chunk. Ray work is bounded above and shares
  L48's one-permit worker, so it never competes with print or assembly checks.
- Wire: `EnclosureReport` is capped at 200 findings, about 60 KB worst case. Meshes go through
  the existing signed routes; nothing new crosses the WebSocket as bytes.
- Remote: no new route, no origin assumptions.

## Alternatives considered

- **A new "board in case" scene.** Rejected: L48 already loads, places, explodes and checks
  parts. A second scene type would duplicate all of it.
- **Exact mesh distance for every clearance.** L48 does exact triangle distance for clearance
  pairs, but one board-to-case distance cannot tell a lid gap from a wall gap or a blocked
  connector. Targeted rays from known features name the place and are cheaper.
- **Heights from L61 in the client.** L61 runs in the browser on a loaded scene; checks and the
  generator run on the host and for agents without a panel. Same rules, server implementation.
- **Reading the live design during checks.** Would fail for references copied to another
  thread or branch, which is the reason export reference exists.
- **Generating STL.** SCAD keeps the case parametric and diffable; the model panel renders it.
- **A sidecar file for requirements.** Two files that must move together; the assembly already
  travels with the case.
- **Mirroring sx/sy into an error.** A mirrored export is rare and the 3D board is what the
  checks see; a warning keeps the checks useful.
