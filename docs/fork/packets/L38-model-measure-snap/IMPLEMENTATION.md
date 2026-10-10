# L38 implementation

Base: `feat/model-bed-picker` (or `main` once it merges). Commit after each step with
`feat(fork-model-measure-snap): ...`. Every step leaves the tree compiling and tests passing.
Paths below are relative to `apps/web/src/fork/model-preview-3d/` unless written in full.

## 1. Contracts

1. In `packages/contracts/src/fork/model-workspace.ts`, add `ModelCircle`, `kind` with its
   decoding default, and optional `circle` exactly as in TECHNICAL.md. Export the type.
2. In `packages/contracts/src/fork/model-editor.ts`, add `snap`, `snapRadius`, `measure` to
   `ModelEditorAction`, `measureMode` to `ModelEditorState`, and `measurement` to
   `ModelEditorResult` and `ModelEditorComplete`.
3. Fix every `ModelMeasurement` literal the typechecker now flags (it requires `kind` on the
   decoded type): `useModelEditing.ts:99` and test fixtures. Use `kind: "distance"`.
4. Add a contracts test: a stored measurement without `kind` decodes to `"distance"`; a circle
   round-trips; a negative diameter fails.

## 2. Server pass-through

1. `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:894`: spread `measurement`
   into the `completeEditor` result.
2. `apps/server/src/fork/model-preview-3d/mcp.ts:16`: extend the editor tool description.
3. Extend the existing editor completion test in `ModelPreviewService.test.ts` to assert the
   field reaches the caller.

## 3. Topology and queries (pure)

1. Create `viewer/snap.ts` with `SNAP_TRIANGLE_LIMIT`, `SHARP_ANGLE_DEGREES`, `Topology`,
   `buildTopology`, `snapNear`, `snapNearPoint`, `circleAt` and `fitCircle` as specified.
   Typed arrays only; no `Map` keyed by strings.
2. Create `viewer/snap.test.ts` (see TESTING.md) with fixtures built from three's `BoxGeometry`
   and `CylinderGeometry` converted with `toNonIndexed()` to mimic STL, plus a plate with a
   6-sided and a 32-sided hole built by hand.

## 4. Worker

1. Create `viewer/snapTopology.worker.ts`: `onmessage` receives
   `{ id, positions: Float32Array, index: Uint32Array | null }`, calls `buildTopology`, posts
   `{ id, topology }` with all arrays in the transfer list, or `{ id, error }`.
2. In `snap.ts`, add `buildTopologies(meshes, signal)`: spawns one worker (imported with
   `?worker`), sends each mesh's world-space positions (apply `matrixWorld`, copy), resolves a
   `Map<Mesh, Topology>`, terminates the worker when done or aborted. Fall back to calling
   `buildTopology` inline when `typeof Worker === "undefined"`.

## 5. Hover layer

1. Create `viewer/snapOverlay.ts` with `createSnapOverlay(host)` returning
   `{ show, hide, dispose }`.
2. Add `.model-snap`, `.model-snap-marker[data-kind=vertex|midpoint|edge]` and
   `.model-snap-path` to `workspace.module.css`. Static shapes, `pointer-events: none`, no
   transitions.

## 6. Viewer wiring (`viewer/createViewer.ts`)

1. Change `pick()` (line 112) to return `{ point, mesh, faceIndex }`; update the annotate path
   in `pointerMove` and `pointerUp` to use `.point`.
2. Add `measureMode`, `topologies`, `snapState`, the build trigger in `setPickMode`, the reset
   in `setModel`, and abort plus `snapOverlay.dispose()` in `dispose`.
3. Coalesced hover in `pointerMove` for measure mode; `pointerleave` hides the marker; `render`
   hides it.
4. Snapped click in `pointerUp`; hole mode calls `onCircle`.
5. Add `setMeasureMode`, `snapStatus`, `onSnapStatus`, `snapPoint`, `circleNear`, and the
   `onCircle` callback slot (set alongside `onPick` in `setPickMode`).
6. In `drawOverlay`, draw circles and switch distance labels to two decimals.

## 7. Panel

1. `useModelEditing.ts`: `measureMode` state and setter, reset in `cancel`; `onPick` return
   shape; new `onCircle`; `Hole n` naming counts existing circle measurements.
2. `viewer/ViewerCanvas.tsx`: props `measureMode` and `onCircle`, applied in effects next to
   `setPickMode` (line 175).
3. `ModelPanel.tsx`: hint with the `Segmented` switch and snap status (line 705); editor cases
   `tool`, `pick` and `snapshot` (lines 235, 299, 376).
4. `MarkupSection.tsx`: circle rows in `MeasurementRow` (line 415), "Measure again" mode, empty
   note (line 658).
5. `WorkspaceTools.tsx:197` `HELP`: add `["Free pick while measuring", "Hold Alt"]`.

## 8. Docs

Update the Measure section of `docs/fork/user/model-preview-3d.md`: snapping, `Alt`, Hole mode
and across flats. Two or three sentences, no UI tour.

## Done when

- Hovering a box corner in Measure shows a square marker, and two snapped corner clicks on a
  20 mm cube read exactly "20.00 mm".
- Holding `Alt` places points off-feature.
- One click on the rim of an OpenSCAD `cylinder(d = 3.4)` hole saves "Ø3.40 mm" with
  "6 sides, 2.94 mm across flats"; a `$fn = 64` hole reports no across-flats line.
- A wall click on a smooth hole saves the nearer rim's diameter.
- A click on a flat face in Hole mode saves nothing and shows "Click the rim of the hole".
- A model over 1,000,000 triangles measures as before, without hover, and says why.
- An agent can `tool` with `measure: "hole"`, `pick` one point within 1 mm of a rim, and receive
  the saved `measurement`; `pick` with `snap: true` lands on the nearest corner.
- An existing workspace with distance measurements loads unchanged.
- Thumbnail, comparison and PCB viewers behave exactly as before.
