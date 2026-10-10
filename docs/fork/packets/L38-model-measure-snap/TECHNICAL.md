# L38 technical

## Overview

Three pieces, all in the web viewer:

1. A topology index per mesh (`viewer/snap.ts`, built in `viewer/snapTopology.worker.ts`):
   welded vertices, vertex-to-triangle lists, the triangle across each edge, a sharp flag per
   edge and a smooth-region id per triangle. Built once per loaded model, the first time Measure
   is turned on, and dropped when the model is replaced.
2. Snap queries on that index, seeded from the raycast hit triangle. No BVH: the raycast stays
   exactly what `pick()` does today (`apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:112`);
   snapping only walks triangle adjacency outward from the hit.
3. A hole fit: find the closed loop of sharp edges at the click, fit a circle in the loop's
   best-fit plane, save it as a measurement with `kind: "circle"`.

Hover feedback is a DOM and SVG layer over the canvas, so moving the mouse never triggers a
WebGL frame. Picking tools already disable orbit controls
(`createViewer.ts:454`, `controls.enabled = mode === null`), so the camera cannot move under a
hover marker except through keyboard zoom, which hides it.

## Contracts

`packages/contracts/src/fork/model-workspace.ts` (measurement entity at line 31). Add
`import * as Effect from "effect/Effect"` and:

```ts
const positive = finite.check(Schema.isGreaterThan(0));
export const ModelCircle = Schema.Struct({
  center: ModelPoint,
  /** Unit normal of the fitted plane. */
  normal: ModelPoint,
  diameter: positive,
  /** Polygon side count after merging collinear vertices; null when smooth (over 128). */
  sides: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 3, maximum: 128 }))),
});
export const ModelMeasurement = Schema.Struct({
  ...identity,
  kind: Schema.Literals(["distance", "circle"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("distance" as const)),
  ),
  start: ModelPoint,
  end: ModelPoint,
  visible: Schema.Boolean,
  circle: Schema.optional(ModelCircle),
});
export type ModelCircle = typeof ModelCircle.Type;
```

A circle measurement stores `start` and `end` at opposite ends of the diameter (along the
in-plane direction closest to world X, or Y when the normal is X). `distance(start, end)` equals
`circle.diameter`, which is what keeps older clients honest.

`packages/contracts/src/fork/model-editor.ts`:

- `ModelEditorAction` (line 5) gains:
  - `snap: Schema.optional(Schema.Boolean)`: snap `pick` points to the nearest feature.
  - `snapRadius: Schema.optional(finite.check(Schema.isBetween({ minimum: 0.01, maximum: 50 })))`:
    model-space search radius in mm for agent picks; default 1.
  - `measure: Schema.optional(Schema.Literals(["distance", "hole"]))`: with `tool` and
    `name: "measure"`, selects the measure mode; default `"distance"`.
- `ModelEditorState` (line 65) gains
  `measureMode: Schema.optional(Schema.Literals(["distance", "hole"]))`. The `tool` literal at
  line 67 is not extended, so old servers and clients keep decoding states.
- `ModelEditorResult` (line 83) and `ModelEditorComplete` (line 90) gain
  `measurement: Schema.optional(ModelMeasurement)`, the item a `pick` just saved.

### Version skew

- Old client, new data: the old schema drops `kind` and `circle` and shows a distance line
  across the diameter labelled with the diameter. If that old client renames or hides the row,
  `MeasurementRow.save` (`MarkupSection.tsx:434`) writes it back without `circle`, turning it
  into a plain distance. Acceptable: the value stays true.
- Old server, new client: the server decodes the operation with its own schema
  (`apps/server/src/fork/model-preview-3d/workspace.ts`, `applyWorkspaceOperation`) and stores a
  distance. Desktop ships server and web together; this only affects app.t3.codes against an
  older fork server.
- New client, old data: `kind` decodes to `"distance"`.

## Server

`apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:889-895`: `completeEditor` builds
the result field by field. Add `...(input.measurement ? { measurement: input.measurement } : {})`.

`apps/server/src/fork/model-preview-3d/mcp.ts:16`: extend the editor tool description with one
sentence: "Measure picks can snap to corners and edges (`snap`), and `tool` with
`measure: "hole"` then one `pick` near a rim saves a hole diameter, returned as `measurement`."

No storage or migration change: the workspace is a JSON blob decoded with `ModelWorkspace`
(`store.ts`, `Schema.fromJsonString`), and the decoding default covers old rows.

## Storage

The workspace limit of 100 measurements (`model-workspace.ts:64`) covers both kinds.

## Clients

### Topology (`viewer/snap.ts`, pure, no three.js scene objects)

```ts
export const SNAP_TRIANGLE_LIMIT = 1_000_000;
export const SHARP_ANGLE_DEGREES = 20;
export type Topology = {
  positions: Float32Array; // welded vertex positions, world space, xyz
  corners: Uint32Array; // 3 per triangle, welded vertex ids
  vertexStart: Uint32Array; // CSR offsets, length vertexCount + 1
  vertexTriangles: Uint32Array; // CSR triangle ids
  across: Int32Array; // 3 per triangle: triangle across edge (c, c+1), or -1
  sharp: Uint8Array; // 3 per triangle: 1 when the edge is a feature edge
  region: Uint32Array; // smooth-region id per triangle
};
export function buildTopology(positions: Float32Array, index: Uint32Array | null): Topology;
```

- Weld (the shared `weld()` in `viewer/weld.ts` ([MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md), "Mesh welding"), created here if no other packet has): quantize each position to a grid of
  `1e-5 × bounding diagonal` (at least 1e-6 mm), hash
  the three integers into an open-addressing `Int32Array` table sized to a power of two at least
  twice the corner count. STL from `STLLoader` is non-indexed (three corners per triangle), so
  welding is what makes adjacency possible.
- Vertex lists: count, prefix sum, fill (CSR). No `Map`, no per-vertex arrays.
- Across: for edge (a, b) of triangle t, scan triangles of `a` for the one other than t that
  contains `b`. More than one match means a non-manifold edge: mark sharp, `across = -1`.
- Sharp: boundary edges, non-manifold edges, and edges whose face normals differ by more than
  `SHARP_ANGLE_DEGREES` (three.js `EdgesGeometry` uses the same test with a 1 degree default).
- Region: union-find over non-sharp edges, compressed to dense ids.

The worker (`viewer/snapTopology.worker.ts`, imported with Vite's `?worker` suffix) receives one
message per mesh `{ positions, index }`, with positions already transformed by
`mesh.matrixWorld` and copied, and posts the `Topology` back with every array transferred. If
`Worker` is unavailable (tests, old WebViews) the viewer calls `buildTopology` directly.

### Queries (`viewer/snap.ts`)

```ts
export type SnapKind = "vertex" | "midpoint" | "edge" | "face";
export type Snap = { kind: SnapKind; point: Vector3Tuple; edge: [number, number] | null };
export function snapNear(
  topology: Topology,
  triangle: number,
  hit: Vector3Tuple,
  ray: { origin: Vector3Tuple; direction: Vector3Tuple },
  toScreen: (point: Vector3Tuple) => [number, number],
  radiusPx: number,
  keep: (point: Vector3Tuple) => boolean, // section plane filter
): Snap;
export function snapNearPoint(topology: Topology, point: Vector3Tuple, radiusMm: number): Snap;
export function circleAt(
  topology: Topology,
  triangle: number,
  hit: Vector3Tuple,
  edge: [number, number] | null,
): CircleFit | null;
export function fitCircle(loop: readonly Vector3Tuple[]): CircleFit | null;
export type CircleFit = {
  center: Vector3Tuple;
  normal: Vector3Tuple;
  diameter: number;
  sides: number | null;
  loop: Vector3Tuple[];
  rms: number;
};
```

- `snapNear`: breadth-first over triangles sharing a vertex with the hit triangle, keeping a
  triangle only while one of its vertices projects within `2 × radiusPx` of the cursor; stop at
  2,000 triangles. Candidates: every visited vertex, the midpoint of every sharp edge, and the
  closest point on every sharp edge to the view ray (closest points between two 3D lines, so it
  is correct under perspective). Reject candidates failing `keep` and candidates more than
  `max(0.5 mm, 1% of hit distance)` behind the hit along the ray (a cheap occlusion guard; a
  true occlusion raycast per candidate is too expensive without a BVH). Choose by priority
  vertex, midpoint, edge, then face (the hit itself), nearest in screen space within a class.
- `snapNearPoint`: model-space version for agent points: nearest welded vertex within
  `radiusMm` (linear scan of `positions`), else nearest point on a sharp edge (scan of edges with
  `sharp = 1`), else the point unchanged with `kind: "face"`.
- `circleAt`: with an edge (rim click), walk the boundary loop of each adjacent region that
  contains the edge (at each vertex, follow the next edge whose `across` triangle is in another
  region; fail on a branch or after 100,000 steps), fit both, keep the better passing fit.
  Without an edge (wall click), collect the boundary edges of the hit triangle's region (one
  pass over `region`), chain them into loops, fit each, and keep the passing loop nearest the
  hit.
- `fitCircle`: drop vertices with a turning angle under 1 degree, require at least 5 (OpenSCAD
  never makes fewer than 5 fragments), take the Newell normal, project onto the plane, solve the
  Kåsa algebraic fit (a 3 × 3 linear system), and accept only when the maximum distance from the
  plane is at most `max(0.02 r, 0.01 mm)` and the RMS radial residual is at most `0.05 r`.
  Polygon vertices from OpenSCAD lie exactly on the circle, so the fit is exact for them; Kåsa's
  known bias on short arcs does not apply to closed loops.

### Viewer (`viewer/createViewer.ts`)

Additive only; the factory keeps its shape.

- `pick()` (line 112) returns `{ point, mesh, faceIndex }` instead of a tuple; annotate keeps
  using `point`. `faceIndex` from three's intersection is the triangle index in the mesh's
  geometry (index order for indexed geometry), which matches `Topology` triangle ids.
- New state: `measureMode: "distance" | "hole"`, `topologies: Map<Mesh, Topology>`,
  `snapState: "idle" | "building" | "ready" | "off" | "failed"`.
- `setPickMode("measure", ...)` starts the build if `snapState === "idle"` and the model's
  triangle count (`meshStats(model).triangles`, `viewer/load.ts:46`) is at most
  `SNAP_TRIANGLE_LIMIT`; above it, `snapState = "off"`. `setModel` (line 513) clears topologies
  and resets to `"idle"`. The thumbnail viewer (`VariantsInspector.tsx:719`) never enters Measure, so it never
  builds. The PCB board viewer (`apps/web/src/fork/pcb-preview/Board3D.tsx:89`) does once
  [L61](../L61-pcb-3d-tools/) lands, under the same limit.
- `pointerMove` (line 137): in measure mode, store the latest event and, if none is queued,
  schedule one `requestAnimationFrame` that raycasts, calls `snapNear` (or `circleAt` in hole
  mode, cached per edge), and updates the hover layer. `event.altKey` hides the marker.
- `pointerUp` (line 148): in measure mode, recompute at the release position (not the cached
  hover) and pass the snapped point, or with `Alt` the raw point. In hole mode, call the new
  `onCircle(fit | null)` callback instead of `onPick`.
- New methods on the returned object: `setMeasureMode(mode)`, `snapStatus()`,
  `snapPoint(point, radiusMm): Promise<ModelPoint>` and
  `circleNear(point, radiusMm): Promise<CircleFit | null>` (both await the build; used by the
  editor command), `onSnapStatus(callback)` for the hint.
- `drawOverlay` (line 242): for `kind === "circle"` with `circle`, draw a 64-segment `LineLoop`
  in the circle's plane, a centre dot, and the label `Ø${diameter.toFixed(2)} mm` at the centre.
  For distances, change the label at line 260 from `toFixed(1)` to `toFixed(2)` so it matches
  the Markup row (`MarkupSection.tsx:485`).

### Hover layer (`viewer/snapOverlay.ts`)

`createSnapOverlay(host)` appends its own absolutely positioned element (not the marks layer,
which `clearOverlay` empties and `paintMarks` paints into captures) holding one marker element
and one `<svg>` with a `<polyline>`. API: `show(kind, x, y, path: number[] | null)`, `hide()`,
`dispose()`. Markers are CSS shapes in `workspace.module.css`: square (vertex), triangle
(midpoint), diamond (edge), in the existing `MARK_BLUE` colour with a dark outline, no
animation. `render()` (line 351) calls `hide()` so keyboard zoom never leaves a marker floating.

### Panel and editing state

- `useModelEditing.ts`: add `measureMode` state (reset to `"distance"` in `cancel`, line 75).
  `onPick` (line 92) saves distances with `kind: "distance"` and returns
  `false | { measurement: ModelMeasurement | null }` instead of a boolean (still truthy on
  success, so `ModelPanel.tsx:303` keeps working). New `onCircle(fit)` saves
  `{ kind: "circle", name: "Hole n", start, end, circle }` or sets a hint error
  `"Click the rim of the hole"` when `fit` is null.
- `ModelPanel.tsx:705` hint: in measure mode render a `Segmented` (`controls.tsx:192`) with
  "Distance" and "Hole" inside the existing `ToolHint` (`WorkspaceTools.tsx:479`), followed by
  the instruction. Snap status text from `onSnapStatus`: "Preparing snapping...",
  "Snapping is off for models over 1M triangles." or "Snapping is unavailable for this model".
- `ViewerCanvas.tsx`: pass `measureMode` and `onCircle` through, like `pickMode` and `onPick`
  (line 175).
- `MarkupSection.tsx:415` `MeasurementRow`: for circles show `Ø{d} mm` as the value, the detail
  "Centre X, Y, Z" plus "n sides, d·cos(π/n) mm across flats" when `sides <= 22`, and copy the
  diameter. "Measure again" (line 499) restarts Measure in the matching mode. Update the empty
  note at line 658.
- `ModelPanel.tsx:235` `tool` case: `tool` with `measure` sets the mode after
  `editing.choose("measure")`. `pick` (line 299): if `c.snap`, map points through
  `viewer.snapPoint(p, c.snapRadius ?? 1)`; in hole mode use `viewer.circleNear(points[0], ...)`
  and fail with "No circular edge within 1 mm of that point." Return `measurement` in the
  result. `snapshot` state adds `measureMode`.
- `ModelPanel.tsx:741` already returns early on `altKey` keydowns; nothing to add there, since
  pointer events read `event.altKey` directly. `Alt` is not a panel shortcut.

## Agent-facing tools

No new tool. `loom_model_preview_3d_editor` gains the `snap`, `snapRadius` and `measure` fields
and returns `measurement`. `loom_model_preview_3d_workspace` already returns measurements, now
with `kind` and `circle`; `loom_model_preview_3d_save_workspace` accepts them (the encoded schema
makes `kind` optional, so existing agent payloads still decode).

## Performance

Measured numbers go in TESTING.md; these are estimates for the honest budget.

| Mesh          | Index build (worker) | Index memory | Hover raycast | Snap query |
| ------------- | -------------------- | ------------ | ------------- | ---------- |
| 50k triangles | ~20 ms               | ~3 MB        | ~1 ms         | under 1 ms |
| 1M triangles  | 0.5 to 1.5 s         | 50 to 60 MB  | 20 to 60 ms   | 1 to 3 ms  |

- The build copies positions to the worker (36 MB for 1M non-indexed triangles) and transfers
  the result back without copying. Peak worker memory about 100 MB at 1M.
- Hover cost is dominated by three's raycast, which tests every triangle after the bounding
  sphere check. At 1M that drops hover to roughly 15 to 30 updates per second. Above the cap the
  raycast happens only on click, as today, so nothing gets slower than L23.
- No continuous loop: hover is coalesced to one update per frame while the pointer moves and
  updates the DOM only. Saving a measurement triggers one render through `drawOverlay`.
- Nothing new crosses the network except the saved measurement.

## Alternatives considered

- BVH (`three-mesh-bvh`): makes hover raycasts and occlusion checks cheap, but Kyle excluded the
  viewer performance core, and it is a new dependency.
- `EdgesGeometry` for sharp edges: builds line geometry, not adjacency, and uses string-keyed
  hashing that is slow and memory-heavy at 1M triangles.
- GPU picking (render ids to a buffer): fast but adds a render on hover, which we avoid.
- Time-slicing the build on the main thread: workable, but a worker is simpler to reason about
  and the codebase already bundles workers.
- A separate `holes` workspace collection: duplicates limits, staleness and Markup UI for no gain.
- Geometric (iterative) circle fit or Chernov's Hyper fit: more accurate on partial arcs, but we
  only fit closed loops, where Kåsa is exact enough and closed-form.
