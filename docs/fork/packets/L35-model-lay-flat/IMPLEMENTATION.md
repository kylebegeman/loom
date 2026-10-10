# L35 implementation

Start from the bed picker base named in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md) (`8676e099e5` or `main` once it merges).
Each step leaves the tree compiling and its tests passing. Commit per step with the
`fork-model-lay-flat` scope.

1. **Root group, no behaviour change.** In `viewer/createViewer.ts`, create `root = new Group()`,
   add it to the scene, add the model to it in `setModel` (`createViewer.ts:513-534`) and remove
   it from it on replace and in `dispose` (`createViewer.ts:628-658`). Move `overlay`
   (`createViewer.ts:89-90`) under `root`. Make `placeMarks` and `paintMarks` project
   `mark.position` through `root.matrixWorld`, and make `pick` (`createViewer.ts:112-126`) return
   `root.worldToLocal(hit.point.clone())` after the section filter. With an identity root all of
   this is a no-op; the existing `createViewer.test.ts` cases must pass unchanged.
2. **Contracts.** Add `ModelQuaternion`, `ModelOrientation`, `normalizeQuaternion`,
   `quaternionMatrix`, `ModelWorkspace.orientation` with its decoding default, the `orientation`
   operation and `EMPTY_MODEL_WORKSPACE.orientation` in `model-workspace.ts`. Add the
   `"orientation"` action, the `"lay-flat"` tool literal and optional `state.orientation` in
   `model-editor.ts`. Fix any object literal of type `ModelWorkspace` the typecheck flags.
3. **Server workspace.** Handle the operation in `applyWorkspaceOperation`
   (`apps/server/src/fork/model-preview-3d/workspace.ts:5`), append `"model-lay-flat"` to
   `LOOM_SERVER_FEATURES` (`apps/server/src/fork/features.ts:2`) and update the `save_workspace`
   description (`mcp.ts:78-91`). Add the workspace and contracts tests.
4. **Pure orientation helpers.** Create `viewer/orientation.ts` with `restingQuaternion`,
   `buildAdjacency`, `coplanarRegion`, `hullRestingNormal`, `bakeRotation`, `bedDelta` and the
   named constants `FLAT_TOLERANCE_DEGREES = 2`, `HULL_GROUP_DEGREES = 1`,
   `FLOATING_FACE_MM = 0.1`. Test them before wiring any UI.
5. **Viewer methods.** Add `setOrientation`, `faceOrientationAt` and `autoOrientation` to the
   object `createViewer` returns, plus the `"lay-flat"` pick mode with the coalesced hover
   highlight. `setModel` applies the stored orientation before `placeBed`. Use
   `Box3.setFromObject(model, true)` whenever the orientation is not identity. Extend
   `createViewer.test.ts` with the stats and anchor cases in TESTING.md.
6. **Panel state.** Pass `workspace.data.orientation` to `ViewerCanvas` as a prop and apply it in
   an effect that reports stats (`ViewerCanvas.tsx:121-131`). Widen `picking`
   (`useModelEditing.ts:26`) and route `"lay-flat"` picks in `onPick`
   (`useModelEditing.ts:92-122`) to `faceOrientationAt` and a workspace save. Apply optimistically
   and roll back on failure.
7. **Controls.** `PickTool`, the "Lay flat" rail button and the `HELP` row in `WorkspaceTools.tsx`;
   the `L` line in `ModelPanel.tsx:748-765`; the hint at `ModelPanel.tsx:705-711`; the status bar
   chip; all hidden unless the server advertises `model-lay-flat`.
8. **Part tab and Markup.** The Orientation row in `PartSection` (`ModelInspector.tsx:336`) with
   "Lay flat on a face", "Auto lay flat", "Reset orientation", "Ask agent to bake this rotation"
   and the stale note. `bedDelta` in `MarkupSection.tsx:432`. The bake request through the
   composer store as `prepareRequest` does (`useModelEditing.ts:171-185`).
9. **Palette.** `"auto-lay-flat"` and `"reset-orientation"` in `ModelAction` (`actions.ts:2`) and
   their titles in `palette.tsx:54-60`; the panel listener runs them.
10. **Editor command.** The `orientation` case and `"lay-flat"` tool name in
    `ModelPanel.tsx:199-382`, the per-action `message`, and `state.orientation` in the snapshot
    branch (`ModelPanel.tsx:386-411`).
11. **Variants.** Apply the orientation to the thumbnail viewer in `VariantsInspector.tsx:677`.
12. **Render tool.** `meshArgs` in `openscad.ts`; the `options` argument, oriented mesh wrapper and
    SCAD export step in `renderImages` (`ModelPreviewService.ts:1104-1254`); the `orientation`
    parameter and result in `mcp.ts:181-227`. Tests for both.
13. **User guide.** In "Explore and review a design" of `docs/fork/user/model-preview-3d.md`, add
    a short paragraph: **L** lays the part on a clicked face, **Auto lay flat** picks the largest
    flat side, the rotation never edits the file and is shared like views, and **Ask agent to
    bake this rotation** drafts the source change. Mention that measurements stay on the part.

## Done when

- Clicking a face of a tilted test bracket rests that face on the bed; the status bar size, the
  "Larger than the bed" warning and the Part fit card change accordingly.
- "Auto lay flat" on a cube with a chamfered corner picks a full side, not the chamfer.
- Reloading the panel, opening the model on another client, and an agent's `snapshot` all show the
  same orientation; "Reset orientation" returns the part to the file's axes everywhere.
- A measurement taken before laying flat still spans the same two spots on the part and shows the
  same distance; its deltas read in bed axes.
- A section along Z cuts horizontally across the oriented part.
- `loom_model_preview_3d_render` returns oriented images and an oriented summary box, and
  `orientation: "none"` returns the file's own pose.
- Against a Loom server without `model-lay-flat`, no lay flat control appears.
- No frame renders while the pointer is still (check with the performance panel).
- Focused tests, lint and the four typechecks in TESTING.md pass.
