# L37 technical

## Overview

The section plane today is one world-space `Plane` applied as a clipping plane to every model
material (`apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:97-110`). The kept side is
where `plane.distanceToPoint(p) >= 0`, and the pick filter uses the same test
(`createViewer.ts:122-124`). This packet adds three things on top of that plane:

1. Stencil caps. For each closed mesh, two invisible copies count how many surfaces each pixel's
   ray passes behind the plane; a quad on the plane is drawn only where the count is not zero.
   This is the technique in three's `webgl_clipping_stencil` example.
2. A closed-mesh check, so caps are only drawn when the count is meaningful.
3. A CPU cross-section (line segments on the plane) for the thickness readout, picking on the cap
   and the editor command.

## Contracts

`packages/contracts/src/fork/model-workspace.ts`, `ModelSection` (`model-workspace.ts:5-10`):

```ts
/** Fill the cut with a cap when the mesh is closed. */
caps: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
```

`ModelSection` is stored inside `ModelCamera` (saved views, annotation cameras) and is the editor
`section` input (`model-editor.ts:47`), so old data and agents that omit it get caps on. The
viewer's initial section (`createViewer.ts:91`) and the panel's default
(`useModelEditing.ts:20-25`) gain `caps: true`.

`packages/contracts/src/fork/model-editor.ts`:

- `ModelEditorAction.action` (`model-editor.ts:6-34`) gains `"wall-thickness"`, using `points`
  (one model-space point; with L35 that is the file's coordinates, otherwise world).
- `ModelWall = Schema.Struct({ thicknessMm: Schema.Number, start: ModelPoint, end: ModelPoint })`.
- `ModelEditorResult` (`model-editor.ts:83-89`) and `ModelEditorComplete`
  (`model-editor.ts:90-100`) gain `wall: Schema.optional(ModelWall)`.
- `ModelEditorState` (`model-editor.ts:65-82`) gains
  `sectionCaps: Schema.optional(Schema.Literals(["filled", "partial", "off", "open-mesh", "none"]))`
  (`"none"` when no section is enabled).

## Server

No server logic. `completeEditor` copies editor fields explicitly
(`apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:888-894`), so add
`...(input.wall ? { wall: input.wall } : {})` there. Update the editor tool's description in
`apps/server/src/fork/model-preview-3d/mcp.ts:14-24` to mention `wall-thickness` and that
`section.caps` defaults to true.

## Storage

None beyond `caps` inside existing saved camera JSON. Wall measurements are ordinary
`ModelMeasurement` rows (`model-workspace.ts:31-36`).

## Clients

### Renderer

`createViewer.ts:55-59` creates the `WebGLRenderer` with
`{ antialias: true, alpha: false, preserveDrawingBuffer: true }`. Add `stencil: true`. three's
default for `stencil` has been `false` since r163 (`src/renderers/WebGLRenderer.js:76` in r186),
and without a stencil buffer the caps silently draw nothing. `preserveDrawingBuffer: true` stays:
`capture` (`createViewer.ts:572-627`) renders to the canvas and copies it with `drawImage`, so
captures include caps with no further change. `autoClear` clears stencil each frame by default.

### Closed-mesh check (`viewer/sectionCaps.ts`)

`closedMesh(geometry): boolean`, pure and cached in a `WeakMap<BufferGeometry, boolean>`:

1. Weld vertices by exact position: hash the three `Float32` bit patterns of each vertex (a
   `Uint32Array` view of the position array) into an open-addressing table of `Int32Array`s.
   Exact equality is right here: STL and 3MF exporters write shared corners with identical
   floats, and a mesh whose corners do not match is not closed for stencil purposes either.
   `BufferGeometryUtils.mergeVertices` would also work but builds string keys, which is slow on
   million-triangle meshes.
2. For every triangle, emit its three directed edges as `a * vertexCount + b` into a
   `Float64Array` (exact up to 2^53, so up to about 94 million vertices).
3. Sort; for each undirected edge, require exactly one `a -> b` and one `b -> a`. Any edge used
   once (a hole), more than twice (non-manifold) or twice in the same direction (flipped winding)
   fails.

The viewer runs the check lazily when a section is first enabled for a model, once per geometry.
When the render summary already says `manifold: true`
(`packages/contracts/src/fork/model-preview-3d.ts:131`), the panel passes that through and the
check is skipped. Per-mesh results give the `"filled"`, `"partial"` and `"open-mesh"` states.

Step 1 uses the shared `weld()` in `viewer/weld.ts` ([MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md), "Mesh welding"), creating it if no other packet has. Its small tolerance also joins
corners that exporters wrote a rounding apart, which only helps the closed check.

### Stencil caps (`viewer/sectionCaps.ts`)

```ts
export function createSectionCaps(
  scene: Scene,
  plane: Plane,
): {
  setModel(model: Object3D | null, closed: (mesh: Mesh) => boolean): void;
  syncTransforms(): void; // after setModel and L35 orientation changes
  update(options: { enabled: boolean; box: Box3; dark: boolean }): void;
  dispose(): void;
};
```

- A `caps` group lives directly in the scene, not under the model, so `meshStats`
  (`viewer/load.ts:46-59`), `applyWireframe` (`createViewer.ts:403-408`), `applySection`,
  `pick`'s `intersectObject(model, true)` and `disposeModel` never see the helper meshes.
- For each closed source mesh, two meshes share its `geometry` (not disposed by the caps; the
  model owns it) with `matrixAutoUpdate = false`, `matrixWorldAutoUpdate = false` and
  `matrixWorld` copied from the source, and `visible` following the source's visibility, both
  resynced by `syncTransforms` (so a part hidden in the PCB 3D view, L61, leaves no cut face):
  - back: `side: BackSide`, `stencilFunc: AlwaysStencilFunc`, all three stencil ops
    `IncrementWrapStencilOp`;
  - front: `side: FrontSide`, stencil ops `DecrementWrapStencilOp`;
  - both: `colorWrite: false`, `depthWrite: false`, `depthTest: false`, `stencilWrite: true`,
    `clippingPlanes: [plane]`, `renderOrder = 1`, `raycast = () => {}`.
- The cap: a `PlaneGeometry` quad sized to the world box diagonal, placed with
  `plane.coplanarPoint(target)` and `lookAt(target - plane.normal)`, `renderOrder = 1.1`,
  `raycast = () => {}`, material:
  `MeshBasicMaterial({ color, stencilWrite: true, stencilRef: 0, stencilFunc: NotEqualStencilFunc, stencilFail/ZFail/ZPass: ReplaceStencilOp })`,
  with `onAfterRender = (renderer) => renderer.clearStencil()`. Unlit, so the cut is flat at any
  angle. No clipping planes on the cap itself.
- Hatch: an `onBeforeCompile` patch on the cap material mixes a darker stripe where
  `fract((gl_FragCoord.x - gl_FragCoord.y) / (6.0 * pixelRatio)) > 0.5`. The stripe runs the
  opposite diagonal to L36's overhang hatch so the two never read as the same thing.
- Colours, set from the theme callback (`createViewer.ts:379-385`): dark theme cap `0x46566b`
  with stripes `0x5b6d85`; light theme cap `0x7f8ea3` with stripes `0x95a3b6`. Both differ from
  the STL part colour `0xa8b4c5` (`viewer/load.ts:85`), the bed and the mark colours.
- Visibility: the caps group is visible only when `section.enabled && section.caps && !wireframe`
  and at least one mesh is closed.

Viewer wiring in `createViewer.ts`: create the caps once; call `setModel` from `setModel`
(`createViewer.ts:513-534`); call `update` from `applySection` (`createViewer.ts:97-110`),
`setWireframe`, `restore` (`createViewer.ts:493-512`) and the theme callback; dispose with the
viewer (`createViewer.ts:628-658`). New method `setClosedHint(manifold: boolean | null)` lets the
panel pass the render summary.

### Cross-section and thickness (`viewer/sectionCaps.ts`)

Pure functions, unit tested:

- `sectionSegments(meshes, plane)`: for each closed mesh, transform triangles to world space with
  its `matrixWorld`, compute signed distances `d = plane.distanceToPoint(v)` (a vertex with
  `d === 0` counts as positive, so shared vertices on the plane are classified consistently), and
  for each triangle with mixed signs emit the segment between the two edge crossings. Each
  segment is oriented with `cross(plane.normal, faceNormal)` so solid lies on its left. Points are
  projected to 2D using the two world axes in the plane (the plane is always axis aligned). Output
  is a `Float64Array` of segments plus a uniform grid index (cell size about
  `sqrt(bboxArea / segmentCount) * 2`, cells listing segment ids).
- `insideSection(section, p)`: nonzero winding number of the oriented segments around `p`, using
  only segments in the grid row to the right of `p`. Winding, not even-odd, so overlapping parts
  of a multi-part file count as solid.
- `wallAt(section, p)`: the shortest chord through `p`. Sample 32 directions over 180°; for each,
  cast rays in both directions with a grid walk (DDA) to the first segment hit, chord length
  `t+ + t-`. Refine around the best sample with a ternary search to 0.1°. Return
  `{ thicknessMm, start, end }` in 2D, mapped back to world. For a point anywhere in a wall of
  thickness `w`, the perpendicular chord has length `w` and every other chord is longer, so the
  minimum is the wall thickness within the plane.

Limits, stated in the user guide: the readout is the thickness within the section plane. A wall
the plane cuts at angle `a` from perpendicular reads `w / cos(a)`; choose the axis across the
wall. Inside a large solid region the readout is that region's narrowest width, which is still
the honest answer to "how thick is the material here".

The section is built lazily, on the first hover (or editor call) after the plane, model or
orientation changes, never while the offset is being scrubbed. A 1M-triangle mesh is one linear
pass (tens of milliseconds); measure on Kyle's largest STL.

### Hover, readout and picking

- Pointer move with no button pressed, no pick tool active and caps visible: coalesce to one
  animation frame, intersect the camera ray with `plane` (`Ray.intersectPlane`), reject if the
  model surface is nearer (one raycast against the model, as `pick` does), then
  `insideSection` and `wallAt`. The result is shown with DOM only: a label mark ("2.4 mm wall")
  placed by the existing marks layer (`createViewer.ts:181-196`) and an SVG `<line>` between the
  projected chord ends in the same layer. No WebGL frame is rendered while hovering.
- The readout hides on pointer leave, when navigation starts (the existing `onNavigate` hook),
  and when the section changes.
- Double-click on the cap (a `dblclick` listener on the canvas; nothing else uses it) calls a new
  `onWallMeasure(start, end)` callback with model-space points (through L35's root when present).
  `useModelEditing.ts` saves it like `onPick` saves a distance (`useModelEditing.ts:92-122`):
  `{ kind: "measurement", item: { id, name: "Wall N", sourceRevision, start, end, visible: true } }`.
- `pick` (`createViewer.ts:112-126`): when caps are visible, also intersect the plane; if that
  point is inside the section and nearer than the mesh hit, return it. Measuring on the cap then
  works with the existing Measure tool.
- Length text: `${thickness.toFixed(1)} mm wall` from one helper, swapped for L40's
  `formatLength` when it lands.

### Panel

- `SectionStrip` (`WorkspaceTools.tsx:420-477`) appends a `ModelTool` "Filled cut" with
  `aria-pressed={section.caps}` before "Remove section". Disabled with the tooltip "Caps need a
  closed mesh" for `"open-mesh"`, tooltip "Some parts aren't closed, so their cut isn't filled"
  for `"partial"`, and "Checking the mesh..." while the check runs.
- `ModelPanel.tsx` passes the cap state from a new viewer callback to the strip, and the render
  summary's `manifold` to the viewer.
- No new keyboard key: caps follow `S`.

## Agent-facing tools

- `loom_model_preview_3d_editor` `{ action: "section", section: { ..., caps: true } }` (existing
  action, new field).
- `{ action: "wall-thickness", points: [[x, y, z]] }`: the panel case in `ModelPanel.tsx:199-382`
  checks that a section is enabled and the cut is capped, projects the point onto the plane, and
  returns `wall` plus the message "2.4 mm wall at that point." Errors: "Enable a section first.",
  "Caps need a closed mesh.", "That point is not inside the cut."
- `snapshot` reports `state.sectionCaps`.
- `capture` returns a PNG with the cap.

## Performance

- No continuous loop. Moving the plane already requests one frame; caps add two extra draws of
  each closed mesh (colour and depth writes off) plus one quad, only while a section is enabled.
- Hover is DOM-only and coalesced to one update per animation frame; it does no work while the
  pointer is still.
- The closed check runs once per geometry, lazily; the section build runs once per plane change,
  lazily. Both are linear or `n log n` in triangles.
- `stencil: true` adds an 8-bit stencil plane to the default framebuffer (usually packed with
  depth as 24/8, so no extra memory in practice). Not separately measured.

## Alternatives considered

- Building a cap mesh from the cut polygons (loop building plus triangulation with holes, for
  example with `ShapeUtils`). Exact too, but fragile on near-degenerate cuts and must be redone
  for every offset change; stencil is free on the GPU.
- `BackSide` rendering of the model in a flat colour (a common cheap trick). Shows the interior
  where back faces are visible, but colours any visible back face, including through holes, and
  cannot measure anything.
- Drawing the model last as in the three.js example (`renderOrder = 6` there). Not needed: opaque
  objects are depth tested, so drawing the cap after the model gives the same result without
  touching model render order.
- Single click to keep a wall measurement. Conflicts with focus clicks on the canvas.
- True 3D thickness (rays along inward normals, or a medial axis). Much more work, and the
  section readout already answers the question when the plane is chosen across the wall.
- A render tool section (OpenSCAD `intersection()` of the part with a half-space `cube`, then the
  usual PNG export). Feasible and headless; left as a follow-up because it duplicates the
  editor `section` plus `capture` path for open panels.
