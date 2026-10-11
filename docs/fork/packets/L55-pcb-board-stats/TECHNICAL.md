# L55 technical design

Cited lines are from `docs/model-preview-follow-ups` at `8676e099e5`.

## Overview

`boardStats(design)` is a pure function over already built board data: the board source and
project file for KiCad, or Circuit JSON for tscircuit, plus the cached GLB header when one
exists. It does no I/O, takes no design id and never builds anything. The service method that
loads a design (`inspect`) reads the files and calls it once per inspection, attaching the
result as `inspection.stats`. The web card renders it; `loom_pcb_inspect` returns it unchanged.
Nothing new is exported or run during inspection.

Because the function only needs built data, L70 (variant sweeps) calls it directly on the
Circuit JSON each variant build already produced, including variants that are not the saved
design, and fills its comparison columns without a second build or a call back into
`inspect`.

## Contracts

In `packages/contracts/src/fork/pcb-workspace.ts`, before `PcbInspection` (`:35`):

```ts
const mm = Schema.NullOr(finite);
export const PcbBoardStats = Schema.Struct({
  /** Outline bounds, as inspection.bounds, in mm. */
  size: Schema.NullOr(Schema.Struct({ width: finite, height: finite })),
  areaMm2: mm,
  /** "outline": closed Edge.Cuts loops minus cutouts; "bounds": bounding box fallback. */
  areaSource: Schema.Literals(["outline", "bounds", "none"]),
  copperLayers: Schema.Int,
  components: Schema.Struct({ front: Schema.Int, back: Schema.Int }),
  holes: Schema.Struct({ plated: Schema.Int, nonPlated: Schema.Int }),
  vias: Schema.Struct({ through: Schema.Int, blindOrMicro: Schema.Int }),
  /** Smallest values measured on the board. */
  measured: Schema.Struct({ drill: mm, track: mm, annularRing: mm, viaDiameter: mm }),
  /** Board-wide rule minimums from the design rules, when the design has them. */
  rules: Schema.NullOr(
    Schema.Struct({
      clearance: mm,
      track: mm,
      drill: mm,
      viaDiameter: mm,
      annularRing: mm,
      holeClearance: mm,
      edgeClearance: mm,
    }),
  ),
  tallest: Schema.NullOr(
    Schema.Struct({
      heightMm: finite,
      side: Schema.Literals(["front", "back"]),
      reference: Schema.NullOr(text()),
      source: Schema.Literals(["glb", "circuit-json"]),
    }),
  ),
  /** Why tallest is null. */
  heights: Schema.Literals(["measured", "needs-3d", "no-models", "unsupported"]),
});
export type PcbBoardStats = typeof PcbBoardStats.Type;
```

and in `PcbInspection` (`:35-54`):

```ts
/** Board statistics; absent from older servers and for schematic-only designs. */
stats: Schema.optional(PcbBoardStats),
```

Optional, so old clients ignore it (Effect structs drop unknown keys on decode) and new clients
treat its absence as "not available". `PcbInspection` is not persisted, so there is no stored
data to migrate.

## Server

### `apps/server/src/fork/pcb-preview/boardStats.ts` (new)

```ts
export type BoardStatsDesign =
  | {
      readonly kind: "kicad";
      readonly board: string; // .kicad_pcb source
      readonly project: string | null; // .kicad_pro JSON source
      readonly inspection: PcbInspection; // for layers, bounds, references
      readonly glb: GlbBounds | null; // from readGlbBounds, when cached
    }
  | {
      readonly kind: "circuit-json";
      readonly elements: readonly unknown[]; // built Circuit JSON, saved design or variant
      readonly inspection?: PcbInspection; // derived with inspectCircuitJson when absent
      readonly glb: GlbBounds | null;
    };
export function boardStats(design: BoardStatsDesign): PcbBoardStats;
```

For `circuit-json`, `inspection` is optional. When it is absent, `boardStats` derives it with
`inspectCircuitJson(elements, "")` (`semantics.ts:309`), which is also pure. The service passes
the inspection it already has; L70 passes only `elements` and `glb: null`, and gets heights
from `cad_component` sizes as usual.

KiCad, reusing `parseSexp`, `children`, `child`, `atom` and `number` from `semantics.ts:9-47`
(export them if not already exported):

| Stat          | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size          | `inspection.bounds` (computed from Edge.Cuts, `semantics.ts:92-166`; top-level items only today, so a footprint's Edge.Cuts are missed). With `outline.ts`, take the bounds of its loops instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Area          | Collect Edge.Cuts `gr_line`, `gr_arc`, `gr_rect`, `gr_circle`, `gr_poly` at top level and the same `fp_*` items inside footprints (with the footprint transform from `localPosition`, `semantics.ts:49`). `gr_rect` and `gr_circle` are closed shapes. Chain lines and arcs into loops by joining endpoints within 0.001 mm; flatten arcs to 0.05 mm chord error. Shoelace each loop. The largest loop is the outline; loops inside it are cutouts and subtract. Any open chain or zero loops: bounding box area and `areaSource: "bounds"`. Chain the loops in the shared `outline.ts` (PCB-FOLLOW-UPS.md, "Outline loops and GLB bounds"), not inside `boardStats`. |
| Copper layers | Names in `inspection.layers` ending `.Cu`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Components    | Each `footprint`'s `(layer "F.Cu")` or `(layer "B.Cu")`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Holes         | Pads of type `thru_hole` count as plated, `np_thru_hole` as non-plated (`semantics.ts:145-158` reads only the latter today).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Vias          | Top-level `via` nodes; a `blind` or `micro` atom after `via` counts as blind or micro.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Drill         | Minimum over via `(drill d)` and pad `(drill d)` or `(drill oval w h)` (smaller dimension).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Track         | Minimum `(width w)` over `segment` and `arc` on copper layers. Zones are not tracks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Annular ring  | Vias: (size minus drill) / 2. Round-drill `thru_hole` pads without `(offset)` in their drill: (smaller of size x, y minus drill) / 2. Oval drill pads: (smaller pad side minus smaller drill side) / 2. Custom shapes skipped. With KiCad 9 padstacks, the pad's top-level `size` is used.                                                                                                                                                                                                                                                                                                                                                                            |
| Via diameter  | Minimum via `(size s)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Rules         | `project` JSON `board.design_settings.rules`: `min_clearance`, `min_track_width`, `min_through_hole_diameter`, `min_via_diameter`, `min_via_annular_width`, `min_hole_clearance`, `min_copper_edge_clearance`, all millimetres. Zero means "not set" and becomes null. Missing file or keys: `rules: null`.                                                                                                                                                                                                                                                                                                                                                           |
| Tallest       | See "Heights".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Circuit JSON (field names from the circuit-json README; see REFERENCES.md for what was and was
not verified):

| Stat          | How                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size, area    | `pcb_board.width`, `height`; `outline` polygon area when present, else width × height (`areaSource: "outline"` for a polygon or a rectangular board without outline, since the board is that rectangle). |
| Copper layers | `pcb_board.num_layers`. This also fixes today's Inspect copper count, which is 0 for tscircuit because layers are `["top", "bottom"]` (`semantics.ts:417`).                                              |
| Components    | `pcb_component.layer` `"top"` or `"bottom"`; absent counts as front.                                                                                                                                     |
| Holes         | `pcb_plated_hole` (plated), `pcb_hole` (non-plated).                                                                                                                                                     |
| Vias          | `pcb_via` elements plus `pcb_trace` route points with `route_type: "via"`.                                                                                                                               |
| Drill         | Minimum `hole_diameter` (or smaller of `hole_width`, `hole_height`) over plated holes, holes and vias.                                                                                                   |
| Track         | Minimum `width` over `pcb_trace` route points with `route_type: "wire"`.                                                                                                                                 |
| Annular ring  | (`outer_diameter` minus `hole_diameter`) / 2 for circular plated holes and vias; rect-pad shapes use the smaller rect side.                                                                              |
| Rules         | `null` (Circuit JSON has no rule set we read).                                                                                                                                                           |
| Tallest       | `cad_component.size.z` when present, with `layer` for the side and `source_component_id` for the reference; otherwise the GLB path.                                                                      |

### Heights from a cached GLB

New in `apps/server/src/fork/pcb-preview/glb.ts`, beside `normalizeCircuitGlb`:

```ts
export type GlbMesh = {
  name: string | null;
  nodes: readonly string[]; // ancestor node names, root first
  materials: readonly string[];
  min: Vec3;
  max: Vec3; // world-space bounds after node transforms, metres, +Y up
};
export type GlbBounds = { meshes: GlbMesh[] };
/** World-space boxes of every mesh, from POSITION accessor min/max and node transforms. */
export function readGlbBounds(json: unknown): GlbBounds;
```

This is the shared signature used by L67. Whichever packet lands first creates it, including
ancestor names and material names; the other imports it. L55 uses the ancestor names to name
the tallest part, and L67 uses the materials to classify board surfaces.

glTF requires `min` and `max` on every POSITION accessor, so no vertex data is read. The
function walks each scene's node tree, composes `matrix` or TRS transforms, and transforms the
eight corners of each primitive's box. Both cached GLB kinds are metres and Y-up (KiCad export,
and tscircuit after `normalizeCircuitGlb`, `glb.ts:6-9`).

`boardStats` turns the boxes into a height: the board body is the mesh with the largest XZ
extent; its max Y is the top surface and its min Y the bottom. The tallest front part is the
largest `max.y - top` among the other meshes, the deepest back part the largest
`bottom - min.y`; the larger of the two wins and becomes `heightMm` (× 1000) with its side. The
reference is the mesh or ancestor node name when it equals a component reference in the
inspection, else null. KiCad 10 names each component's node with its reference designator
(`step_pcb_model.cpp:1855` in the KiCad 10.0 source), and the OCCT glTF writer KiCad uses for
GLB export keeps node names by default, so KiCad boards should normally name the tallest part.
That was read in source, not run, because `kicad-cli` is not installed here; tscircuit GLBs and
unexpected names still fall back to null and the card shows only the height. Silkscreen, mask
and copper meshes are thin and never win; a board with no component models yields
`heights: "no-models"`.

The service reads only the GLB header and JSON chunk: `fs.open` the cached `board.glb`, read
20 bytes, then `readAlloc(jsonLength)` (the same API `apps/server/src/http.ts:540` uses). It
never loads the up to 128 MiB binary chunk (`MAX_MODEL_BYTES`, `PcbPreviewService.ts:1517`).

### Service (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts`)

- Extract the GLB cache lookup in `runAsset` (`:1569-1600`) into
  `cachedModel(resolved, snapshot, tool, "glb")`, returning the cached path or null with the
  same manifest and size checks. `runAsset` calls it; stats call it too. This is the only
  refactor.
- In `inspect` (`:1818-1859`), after the inspection is built and before `decodeInspection`:
  - KiCad with a board: read the board with `smallSource` (as `sourceInspection` does,
    `:1401-1412`), read `<stem>.kicad_pro` when it exists next to the board (discovery pairs
    them by stem, `discovery.ts:45-58`), read GLB bounds when `cachedModel` finds one, and call
    `boardStats`. tscircuit: pass the parsed Circuit JSON already in hand (`:1824-1832`).
  - Wrap the call in `Effect.try`; on failure append "Board stats are incomplete: <reason>" to
    `warnings` and omit `stats`, so a stats bug never breaks Inspect.
- Inspection cache: a `Map` keyed by `hashKey(workspaceKey, designId, sourceHash, toolVersion,
glbSizeAndMtime)` holding the last 16 decoded inspections. The GLB size and modification time invalidate
  cached heights after a forced export even when the source revision is unchanged. `inspect` returns a hit directly.
  Today every `inspect` call for a KiCad design runs `kicad-cli sch export netlist` again
  (`:1837-1851`, through `schematicConnectivity`, `:1788-1817`), and the panel calls it per
  revision key (`usePcbWorkbench.ts`), so the cache removes repeated tool runs as well as the
  new parsing.

### MCP (`apps/server/src/fork/pcb-preview/mcp.ts`)

`loom_pcb_inspect` (`mcp.ts:70-80`) already returns `W.PcbInspection`, so `stats` appears
automatically. Its description becomes: "Inspect components, pins, nets, layers, board stats
(size, area, layer count, holes, vias, smallest drill, track and annular ring, rule minimums,
tallest part when a 3D board exists) and physical board coordinates. Lengths are in
millimetres. Runs CAD exporters when needed."

## Storage

None new. Stats are derived on demand; the GLB they read is the existing asset cache
(`cacheDir/<key>/board.glb`, `PcbPreviewService.ts:1569-1576`). The inspection cache is memory
only.

The packet adds no field to `PcbWorkspace` (`packages/contracts/src/fork/pcb-workspace.ts`;
see PCB-FOLLOW-UPS.md for its decoding defaults). `stats` lives on `PcbInspection`, which is
never persisted.

## Clients

### `apps/web/src/fork/pcb-preview/BoardStatsCard.tsx` (new)

Props: `inspection`, `design`, `canMeasure` (terminal grant, tool available, KiCad 10 or
tscircuit), `onMeasure`, `onOpenChecks`, `onDraft`. Renders a `Section` titled "Board stats"
with `Stats` and `Stat` from `InspectorKit.tsx:122-150`. Each `Stat` value uses L54's
`formatLength` (or a local `mm()` helper before L54) and a `small` source label ("rule",
"bounding box"). A null value renders "Not available" with the reason listed in PRODUCT.md,
States. Without `inspection.stats` (older server, schematic-only) it falls back to today's figures
(parts, nets, size, thickness) so nothing regresses.

- "Measure heights": calls `pcb.asset` for `glb` with URL transport through the existing
  command (as `Board3D.tsx` does), then refreshes the inspect atom for the same revision. It
  shows "Measuring" while the shared asset job runs; if the 3D surface is already loading the
  same job is reused (`assetJobs`, `PcbPreviewService.ts:1786`).
- "Run DRC to measure" on the Clearance row: `openTab("Checks")`.
- "Add to draft": plain text block, millimetres, built by `boardStatsText(stats)` in
  the pure `boardStatsText.ts` leaf module, imported directly by the card, and appended with
  `appendSummary`, like `ChecksView.tsx:150-157`.

### `InspectTab.tsx`

Replace the "Board" section (`InspectTab.tsx:236-269`) with `<BoardStatsCard .../>` under the
same condition (no component, no net, no search), and keep "Parts" and "Nets" counts in it.
`InspectTab` gets the extra callbacks through `Inspector.tsx`'s `ToolPanel` props
(`Inspector.tsx:279-364`) from `PcbPreviewPanel.tsx:1236-1308`.

## Agent-facing tools

- `loom_pcb_inspect` and `t3 pcb inspect` return `stats`.
- Heights for an agent: call `loom_pcb_asset` with `format: "glb"` first, then
  `loom_pcb_inspect`. The description says so in one clause.
- No new tool and no editor command: the card is read-only and the data is in inspect.

## Performance

- Board parse: the source is parsed a second time for stats (the first parse is in
  `inspectBoard`); boards are capped at 16 MiB (`smallSource`, `PcbPreviewService.ts:1384`).
  The inspection cache makes this once per revision.
- GLB: header and JSON chunk only, typically tens of kilobytes.
- Payload: `stats` adds well under 1 KB to the inspect result.
- No render loop; "Measure heights" is one request.

## Alternatives considered

- Measured clearance with a simple pairwise segment distance. Rejected: misses pads, zones and
  arcs, and would contradict DRC.
- Exporting the 3D board during inspect. Rejected: up to 180 seconds and KiCad 10 only.
- Reading heights from footprint 3D model files (STEP or WRL). Rejected: needs a STEP parser
  (new dependency) and model path resolution; the GLB already has the placed geometry.
- Computing stats in the client from the inspection. Rejected: tracks, vias, pads and rules are
  not in the inspection, and agents need the same numbers.
