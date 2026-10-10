# L61 implementation

Branch from `main`. Commits use `feat(fork-pcb-3d-tools): ...`. Every step leaves the tree
compiling and its tests passing. Paths under `viewer/` are relative to
`apps/web/src/fork/model-preview-3d/`.

1. **Shared viewer pieces.** Check which 3D packets have landed (`git log --oneline main --
apps/web/src/fork/model-preview-3d/viewer/` and the presence of the files below). For each
   missing one, build only the subset L61 needs, exactly as that packet's TECHNICAL.md and
   IMPLEMENTATION.md specify, in its location, with its tests. Commit each subset separately
   with the 3D packet's scope (for example `feat(fork-model-ortho-camera): ...`) so the 3D
   packet later finds it done and adds only its model-panel parts.
   - L31 missing: L31 steps 1 to 3. `ModelProjection` and `ModelCamera.projection` with the
     `"perspective"` decoding default and the fixture updates; `viewer/projection.ts`; `ortho`,
     `activeCamera()`, `setProjection`, `snapshot`/`restore` in `createViewer.ts`. Leave the
     model panel's `P` key, Display item, four-view rule and render-tool projection to L31.
   - L37 missing: L37 steps 1 to 5. `stencil: true`; `ModelSection.caps` with its `true`
     default and fixture updates; `closedMesh` and `createSectionCaps` in
     `viewer/sectionCaps.ts`; the viewer wiring and cap state callback; "Filled cut" in
     `SectionStrip`. Leave `sectionSegments`, `insideSection`, `wallAt`, hover thickness and the
     `wall-thickness` editor action to L37.
   - Weld missing (none of L35, L37, L38 landed): `viewer/weld.ts` exactly as the "Mesh
     welding" shared definition in [MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md).
   - L38 missing: L38 sections 3 to 6 without hole mode. `viewer/snap.ts` with
     `SNAP_TRIANGLE_LIMIT`, `SHARP_ANGLE_DEGREES`, `Topology`, `buildTopology`, `snapNear`,
     `snapNearPoint` and `buildTopologies`; `viewer/snapTopology.worker.ts`;
     `viewer/snapOverlay.ts` and its CSS; `pick()` returning `{ point, mesh, faceIndex }`;
     coalesced hover, snapped clicks, `snapStatus`, `onSnapStatus` and `snapPoint`. Leave
     `circleAt`, `fitCircle`, `ModelMeasurement.kind`, Markup and the model editor fields to
     L38.
2. **Viewer additions.** In `viewer/createViewer.ts`, add `shownIn(object, root)` and use it in
   `pick`'s hit filter (`:123-124`, or wherever L38 moved it). Add `invalidate()` to the
   returned object. In `viewer/sectionCaps.ts`, make `syncTransforms` copy each source mesh's
   effective visibility to its helper pair, and call it from `invalidate()`. Extend
   `createViewer.test.ts`.
3. **Contracts.** In `packages/contracts/src/fork/pcb-workspace.ts`, add `Pcb3dLayers`,
   `Pcb3dLayersPatch`, `Pcb3dSide`, `Pcb3dSnap`, `Pcb3dMeasurement` and `Pcb3dHeights`; the four
   action literals and six action fields; `measurement3d` on `PcbEditorResult` and
   `PcbCompleteEditorInput`; the six optional `state` keys. Add
   `packages/contracts/src/fork/pcb-workspace.test.ts` (TESTING.md).
4. **Server pass-through.** Spread `measurement3d` in `completeEditorAction`
   (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2383-2387`). Extend the
   `loom_pcb_editor` description (`mcp.ts:27`). Add the pass-through test.
5. **Part classification.** Create `apps/web/src/fork/pcb-preview/board3dParts.ts`
   (`classifyBoard`, `availableLayers`) and `board3dParts.test.ts`.
6. **Heights.** Create `apps/web/src/fork/pcb-preview/heights.ts` (`HEIGHT_PARTS_LIMIT`,
   `partHeights`, `heightAt`, `heightOfPart`, `boardFrame`) and `heights.test.ts`.
7. **Board3D display.** Add the `display`, `onDisplay`, `inspection` and `onSelect` props and
   `Board3dDisplay` type to `Board3D.tsx`. Keep the loaded root in a ref; after `setModel`
   (`:99`) classify, compute heights and apply display; add the display effect. Extend
   `Pcb3dHandle` with `state()` and make `restore` report projection and section through
   `onDisplay`. In `PcbPreviewPanel.tsx`, add `display3d` state and pass the props
   (`:1176-1186`). Extend `Board3D.test.tsx`.
8. **Board3D tools.** Create `Board3DTools.tsx` with the Display menu, Measure, Section plane and
   Heights controls and the tool hint. Add tool state, measurements, overlays and the handle
   methods `tool`, `chooseTool`, `cancelTool`, `measure`, `clearMeasurements` and `height` to
   `Board3D.tsx`. Add the optional `removeKey` prop to `SectionStrip` in
   `model-preview-3d/WorkspaceTools.tsx` and pass `null`. Format readouts with L54's
   `formatLength` if `apps/web/src/fork/pcb-preview/length.ts` exists, else `toFixed(2)` mm.
9. **Panel keys and editor.** In `PcbPreviewPanel.tsx`, add the `Escape`, `M` and `P` lines to
   the key handler (`:1041-1068`), the `display`, `section`, `measure` and `height` cases and
   the 3D branch of `tool` to the editor handler (`:386-571`), the snapshot spread
   (`:545-570`) and `measurement3d` in the completion (`:574-586`). Unknown actions already
   fail after `6ddf84c1aa` (local `fix/preview-defects`); add that `default` case if your base
   lacks it.
10. **Shortcut list.** In `WorkspaceChrome.tsx`, add the `P` row to `SHORTCUTS`, add
    `SHORTCUTS_3D` and the `rows` prop on `ShortcutHelp`; render it in Board3D's nav shelf.
11. **Docs.** In `docs/fork/user/pcb-preview.md`: add `P` and "M measures in 3D" to the
    shortcuts sentence (line 12), two or three sentences on the 3D tools (orthographic, section,
    measure and height, Heights, display toggles) near the 3D mention, and a `t3 pcb editor`
    example for `height` in "Agent and terminal access" (line 76). If L38 has landed, update the
    sentence in [L38's TECHNICAL.md](../L38-model-measure-snap/TECHNICAL.md) (line 191) that
    says the PCB viewer never enters Measure.

## Done when

- `P` in 3D toggles orthographic with no jump in framing, Top view shows the board outline as a
  true rectangle, and `P` in 2D does nothing.
- A section through a KiCad board shows a filled board cut. Hiding Top components removes their
  cut faces too.
- Two snapped clicks on opposite corners of a rectangular board read its width to 0.01 mm of the
  inspection bounds width; `Alt` clicks are free.
- Height mode on the top of a part matches the Heights row for that part. A board with a
  through-hole connector reports a non-zero "Below board" value from its leads.
- Hidden layers are neither drawn nor picked; Hide Solder mask shows the copper; on a tscircuit
  board Copper and Silkscreen are disabled with their tooltip.
- After a source change the board reloads with the same projection, section and hidden layers,
  no old measurements, and new heights.
- Agents can do all of the above through `loom_pcb_editor` and `t3 pcb editor`: `display`,
  `section`, `measure`, `height`, `tool`, and `snapshot` returns `heights`, `layers3d`,
  `measurements3d`, `sectionCaps` and the camera projection and section.
- The 3D view has a shortcut list that only lists keys that work there.
- Nothing renders while the board is idle (Performance panel shows no frames).
