# L35 technical

## Overview

An orientation is one unit quaternion per model, stored in the 3D workspace next to views and
measurements. The viewer wraps the loaded model in an orientation group that rotates the part
about the centre of its own bounding box. Everything downstream already works in world space:
the bed follows the world box (`placeBed`, `apps/web/src/fork/model-preview-3d/viewer/createViewer.ts:431-440`),
section planes are world-space clipping planes (`createViewer.ts:97-110`), and stats come from a
world box (`viewer/load.ts:46-59`). So the oriented part "rests on the bed, centred" without
moving the model to Z=0: the plate moves under it, exactly as it does today for unoriented parts.

Anchors stay in model space. Measurements, annotations and editor `pick` points are stored in the
file's own coordinates (today's world coordinates, since the model root is untransformed), so
existing data stays valid and annotation regions keep meaning something to an agent editing the
source.

Three new behaviours sit on top: picking a face (coplanar region and its area-weighted normal),
auto lay flat (largest convex hull face group), and the server applying the same rotation in the
render tool.

## Contracts

`packages/contracts/src/fork/model-workspace.ts` (shared definition, created here):

```ts
import * as Effect from "effect/Effect";

export const ModelQuaternion = Schema.Tuple([finite, finite, finite, finite]);
/** Stored rotation of the part about its own bounding-box centre. x, y, z, w order. */
export const ModelOrientation = Schema.Struct({
  quaternion: ModelQuaternion,
  sourceRevision: identity.sourceRevision,
});
const unitQuaternion = ModelQuaternion.check(
  Schema.makeFilter(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) < 1e-3, {
    message: "Use a unit quaternion [x, y, z, w].",
  }),
);
```

- `ModelWorkspace` (`model-workspace.ts:62-68`) gains
  `orientation: Schema.NullOr(ModelOrientation).pipe(Schema.withDecodingDefault(Effect.succeed(null)))`,
  following `BuildPlateSetting.pattern` (`packages/contracts/src/fork/model-preview-3d.ts:237`).
  Rows saved before this packet decode with `orientation: null`. The shared definition says
  "or absent"; `null` is that state on the wire.
- `ModelWorkspaceOperation` (`model-workspace.ts:69-80`) gains
  `Schema.Struct({ kind: Schema.Literal("orientation"), item: Schema.NullOr(Schema.Struct({ quaternion: unitQuaternion, sourceRevision: identity.sourceRevision })) })`.
  `null` resets. The unit check sits on the operation, not the stored entity, so a stored value
  can never make a whole workspace fail to decode.
- `EMPTY_MODEL_WORKSPACE` (`model-workspace.ts:91-97`) gains `orientation: null`.
- Two pure helpers in the same file, used by web and server so both rotate identically:
  `normalizeQuaternion(q)` (unit length, `w >= 0`, identity for a zero vector) and
  `quaternionMatrix(q): [[number, number, number], ...]` (row-major 3x3).

`packages/contracts/src/fork/model-editor.ts`:

- `ModelEditorAction.action` (`model-editor.ts:6-34`) gains `"orientation"`. It uses the existing
  `name` (`"auto" | "reset" | "face"`) and `points` (one model-space point on the face).
- `ModelEditorState.tool` (`model-editor.ts:67`) widens to `["measure", "annotate", "lay-flat"]`.
- `ModelEditorState` gains `orientation: Schema.optional(Schema.NullOr(ModelOrientation))`.
  Optional, so a server decoding a state from an older client still succeeds.

Editor `points` everywhere (the `pick` action included) are model-space coordinates. Before this
packet that was the same as world space; the tool description says so now.

## Server

- `apps/server/src/fork/model-preview-3d/workspace.ts:5`: `applyWorkspaceOperation` handles
  `kind === "orientation"` before the collection lookup:
  `decode({ ...state, orientation: item && { ...item, quaternion: normalizeQuaternion(item.quaternion) } })`.
  No limit is needed: there is one orientation per model.
- `apps/server/src/fork/features.ts:2-11`: append `"model-lay-flat"`. Clients use it to hide the
  controls against older Loom servers, which would reject the new operation kind.
- `apps/server/src/fork/model-preview-3d/mcp.ts:78-91`: `save_workspace` already takes
  `W.ModelWorkspaceOperation`, so the new kind is accepted with no code change. Update its
  description: "Add, update or remove a view, measurement, annotation, capture preset or variant,
  or set the model's orientation (`{ kind: "orientation", item: { quaternion, sourceRevision } }`,
  `item: null` resets)."
- Render tool (`mcp.ts:181-201`, `renderModelTool` at `mcp.ts:212-227`): new optional parameter
  `orientation: Schema.optional(Schema.Literals(["saved", "none"]))` (default `"saved"`), and the
  success schema gains `orientation: Schema.NullOr(ModelOrientation)`, the rotation applied.
  Description gains: "Applies the model's saved Loom orientation unless orientation is none."
- `ModelPreviewService.renderImages` (`ModelPreviewService.ts:1104`) takes a fourth argument,
  `options: { orientation?: "saved" | "none" }` (other packets add fields to the same object).
  When the mode is `"saved"` it reads `getWorkspace(file)` (`ModelPreviewService.ts:793`) and,
  if `orientation` is set:
  - Mesh formats: the existing wrapper (`ModelPreviewService.ts:1156-1162`) becomes
    `multmatrix(${matrix}) scale(${scale}) import(${json(path)});` where `matrix` is the 4x4 from
    `quaternionMatrix` with a zero translation.
  - SCAD: first export the part once with the same overrides, backend and timeout to
    `<runId>.stl` (`--export-format binstl`, the flag `renderArgs` already uses at
    `openscad.ts:54`), then render the views from the mesh wrapper above. A new pure builder
    `meshArgs({ source, output, overrides, info, settings })` in `openscad.ts` keeps argument
    order testable. The SCAD's echo and warning log comes from the export run.
  - `--autocenter --viewall` (`openscad.ts:72-82`) frame the result, so no translation is needed.
    The `--summary` bounding box comes from the oriented wrapper run, so the size the tool
    returns (and L32's fit summary) is oriented.
  - Return `orientation` so the agent knows what it is looking at.
- The rotation is applied about the origin on the server and about the box centre in the viewer.
  Both give the same shape and size; only placement differs, and both consumers derive placement.

## Storage

The workspace JSON in `fork_model_preview_3d_workspace (project_id, path, value_json)`
(`apps/server/src/fork/model-preview-3d/store.ts:11`) gains the `orientation` field. No migration:
the decoding default covers old rows. Scope is the existing workspace scope (project, canonical
root, model path).

## Clients

### Viewer (`viewer/orientation.ts`, new, plus `createViewer.ts` methods)

Pure helpers (unit tested, no WebGL):

- `restingQuaternion(normalWorld, current)`: `new Quaternion().setFromUnitVectors(n, DOWN)`
  premultiplied onto `current`, then `normalizeQuaternion`. `DOWN = (0, 0, -1)`.
- `buildAdjacency(geometry)`: welds with the shared `weld()` in `viewer/weld.ts` ([MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md), "Mesh welding"), creating it if no other packet has. It
  replaces an earlier plan to use `BufferGeometryUtils.mergeVertices(clone, 1e-4)`, which copies
  every attribute. The welded index keeps triangle order, so a raycast `faceIndex` maps straight
  to it. Edges are keyed
  `min * vertexCount + max` in a `Float64Array`, sorted, and paired into an `Int32Array` of three
  neighbours per triangle (`-1` for an open edge). Built lazily on the first lay flat hover and
  cached in a `WeakMap<BufferGeometry, Adjacency>` that `setModel` drops.
- `coplanarRegion(geometry, adjacency, seed, toleranceDegrees = FLAT_TOLERANCE_DEGREES)`: breadth
  first from the seed triangle, accepting a neighbour when its normal is within 2 degrees of the
  seed's normal (compared to the seed, not the neighbour, so gently curved surfaces do not creep).
  Returns triangle ids, total area, and the area-weighted normal in geometry space.
- `hullRestingNormal(points)`: `new ConvexHull().setFromPoints(points)` (three r186,
  `examples/jsm/math/ConvexHull.js:61`), groups hull faces whose normals are within 1 degree,
  sums `face.area` per group (`ConvexHull.js:1092`), and returns the group with the largest area
  (ties: the one giving the lower resulting height). Points are the welded unique vertices in
  model space.
- `bakeRotation(q, partCentre, orientedMinZ)`: OpenSCAD `rotate([x, y, z])` applies X, then Y,
  then Z about fixed axes, which is `Rz * Ry * Rx`, the matrix three builds for Euler order
  `"ZYX"`. So `new Euler().setFromQuaternion(q, "ZYX")` gives the angles in degrees. Also returns
  the exact 4x4 for `multmatrix` and the `translate([0, 0, dz])` that rests the origin-rotated
  part at Z=0 (`dz = -(orientedMinZ - root.position.z)`, see below).
- `bedDelta(start, end, q)`: the measurement delta rotated into bed axes, for Markup.

Viewer changes in `createViewer.ts`:

- A `root` group is created once and added to the scene. `setModel` (`createViewer.ts:513-534`)
  adds the model to `root` instead of the scene, computes the precise part-space box once (identity
  rotation), then applies the viewer's current orientation before `placeBed`, so a reload never
  flashes the unrotated pose.
- `setOrientation(q: ModelQuaternion | null)`: sets `root.quaternion`, and
  `root.position = c - q * c` where `c` is the part-space box centre, so the part turns in place.
  Recomputes `box` with `new Box3().setFromObject(model, true)` (precise; the default loose box is
  wrong after arbitrary rotations), calls `placeBed`, recentres an enabled section's offset to the
  new box centre on its axis, redraws overlays, refits the camera keeping its direction
  (`refit`, `createViewer.ts:536-548`) and calls `requestRender`. Returns the same stats shape as
  `meshStats` so `ModelPanel` keeps one `onStats` path (`ModelPanel.tsx:485-492`).
- The `overlay` group (`createViewer.ts:89-90`) becomes a child of `root`, so measurement lines,
  dots and annotation polylines ride with the part in model space. `placeMarks` and
  `paintMarks` (`createViewer.ts:186-196`, `278-300`) project
  `mark.position.clone().applyMatrix4(root.matrixWorld)`.
- `pick` (`createViewer.ts:112-126`) filters by the section plane in world space as today, then
  returns `root.worldToLocal(hit.point.clone())`.
- `pickMode` (`createViewer.ts:92`) gains `"lay-flat"`. In that mode `pointermove` without a
  pressed button raycasts once per animation frame (coalesced like `requestRender`), and when the
  hit triangle is outside the current highlighted region, floods the new region and replaces a
  highlight mesh (`MeshBasicMaterial`, `MARK_BLUE`, opacity 0.35, `polygonOffset`). A click
  reports the model-space point through the existing `onPick` callback.
- `faceOrientationAt(point: ModelPoint)`: finds the triangle nearest the point (one linear pass;
  agents and clicks are rare), floods its region, transforms the normal with the mesh's world
  normal matrix, and returns `{ quaternion, areaMm2, floats }`, where `floats` is true when the
  region's lowest point would sit more than 0.1 mm above the part's lowest point (a face in a
  concavity: the part rests on other points and the hint says so).
- `autoOrientation()`: returns the hull-based quaternion (absolute, not composed).

### Panel

- `useModelEditing.ts:26`: `picking` widens to include `"lay-flat"`. `onPick`
  (`useModelEditing.ts:92-122`) routes `"lay-flat"` to `viewer.faceOrientationAt(points[0])` and
  saves `{ kind: "orientation", item: { quaternion, sourceRevision } }` through
  `workspace.mutate`. It stays in lay flat mode.
- The orientation comes from `workspace.data.orientation`; `ViewerCanvas` gets an `orientation`
  prop and an effect that calls `onOriented(viewer.setOrientation(...))`, next to the existing
  `setSection` effect (`viewer/ViewerCanvas.tsx:121-131`). Saving is optimistic in the panel:
  apply first, roll back to the stored value if the mutation fails.
- `ModelPanel.tsx:748-765`: one line, `else if (key === "l" && !editDisabled && layFlat) startTool("lay-flat");`
  where `layFlat` is the capability check (`loomFeaturesOf(...).includes("model-lay-flat")`, the
  pattern at `apps/web/src/fork/model-preview-3d/Shortcuts.tsx:20`). The tool hint
  (`ModelPanel.tsx:705-711`) gains "Click the face to rest on the bed".
- `WorkspaceTools.tsx:358`: `PickTool` gains `"lay-flat"`; `ToolRail` (`WorkspaceTools.tsx:360-413`)
  appends a "Lay flat" `ModelTool` with `kbd="L"` after Annotate. `HELP`
  (`WorkspaceTools.tsx:197-207`) gains the `L` row.
- Part tab (`ModelInspector.tsx:336`, `PartSection`): an "Orientation" row. "As modelled" with
  "Lay flat on a face" and "Auto lay flat"; or "Laid flat" with "Reset orientation" and "Ask agent
  to bake this rotation", plus "Set on an earlier version of this file" when stale.
- Status bar (`ModelPanel.tsx:1136-1160`): a "Laid flat" chip that opens Part, shown only while
  an orientation is set.
- `MarkupSection.tsx:432` uses `bedDelta` when an orientation is set; the distance is unchanged.
- Palette (`palette.tsx:54-60`, `actions.ts:2`): `ModelAction` gains `"auto-lay-flat"` and
  `"reset-orientation"`, titled "3D model: Auto lay flat" and "3D model: Reset orientation".
- Bake request: the same composer path `prepareRequest` uses (`useModelEditing.ts:171-185`,
  `useComposerDraftStore.getState().setPrompt`), with no image. Text for SCAD:

  ```text
  Bake the Loom orientation into <path>.
  Wrap the top-level geometry in rotate([x, y, z]) (degrees; OpenSCAD applies X, then Y, then
  Z). Exact equivalent: multmatrix([[...], [...], [...], [0, 0, 0, 1]]).
  Then translate([0, 0, dz]) so the lowest point sits at Z=0.
  When the file re-renders, reset the Loom orientation with loom_model_preview_3d_save_workspace
  and { "kind": "orientation", "item": null } so the rotation is not applied twice.
  ```

  Meshes get "Re-export <path> rotated by this matrix, then translated by dz", with the same
  matrix and reset instruction, and "keep the original file unless I say otherwise".

- Variant thumbnails (`VariantsInspector.tsx:677`) call `setOrientation` on their own viewer, so
  thumbnails and the stored `dimensions` (`VariantsInspector.tsx:764`) match the panel.

## Agent-facing tools

- `loom_model_preview_3d_editor` with `{ action: "orientation", name: "auto" }`,
  `{ action: "orientation", name: "reset" }` or
  `{ action: "orientation", name: "face", points: [[x, y, z]] }`. The handler in
  `ModelPanel.tsx:199-382` checks `editing.canEdit && editing.ready`, computes, saves and sets the
  result message ("Resting on a face of 1240 mm².", "No face at that point.", "Orientation
  reset."). The generic message at `ModelPanel.tsx:384` becomes `message ?? "3D editor action
completed."`.
- `{ action: "tool", name: "lay-flat" }` enters the pick mode; `snapshot` reports
  `state.tool` and `state.orientation`.
- `loom_model_preview_3d_save_workspace` sets or resets the orientation headless.
- `loom_model_preview_3d_workspace` returns it.
- `loom_model_preview_3d_render` renders it (above).
- `t3 model <action>` gets all of this for free; it calls the same tools.

## Performance

- No new animation. Each orientation change is one `requestRender`. Hover in lay flat mode
  renders at most once per animation frame while the pointer moves, and only rebuilds the
  highlight when the region changes; it stops when the pointer stops.
- Adjacency for a 1M-triangle STL: about 3M edge keys (24 MB `Float64Array`) and a sort, built
  once on first use and freed on the next `setModel`. Measure on Kyle's largest STL; if it takes
  over 300 ms, show "Finding faces..." in the hint while it builds.
- Auto lay flat runs QuickHull on welded unique vertices. On a 1M-triangle mesh that is roughly
  half a million points; if it blocks for more than 300 ms in practice, move it to a worker as a
  follow-up rather than sampling (sampling can miss the true hull face).
- Precise `Box3` walks every vertex once per orientation change.
- Payload: the orientation adds under 100 bytes to the workspace stream. The SCAD render path adds
  one mesh export but each view then imports a mesh instead of re-running CSG, so multi-view
  renders get faster.

## Alternatives considered

- Move the model so its minimum Z is 0 (the shared definition's wording). Equivalent on screen and
  in every measured value, but it would move the model's coordinates, which the viewer
  deliberately keeps (`createViewer.ts:431-432`). Rotating about the box centre and letting the bed
  follow keeps one placement rule for oriented and unoriented parts.
- Store Euler angles. Ambiguous order and gimbal lock; the shared definition fixes a quaternion.
- Anchors in world space. Marks would stay put while the part turns under them, and every existing
  measurement would need migrating.
- Only offer convex hull faces for clicking (PrusaSlicer's "Place on Face" does this). Simpler and
  always stable, but users click the face they mean; we allow any face and say when the part
  will rest on other points instead.
- Rotate the camera in OpenSCAD instead of the part. `--camera` takes Euler angles whose exact
  composition is not documented; a `multmatrix` wrapper is exact.
- Include the SCAD file inside `multmatrix() { include <...> }`. Assignments inside a block are
  scoped to it, so `-D` overrides of top-level variables would stop applying. Unverified in
  detail, and the mesh export path avoids the question.
