# L37 implementation

Start from the bed picker base named in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md) (`8676e099e5` or `main` once it merges).
Each step leaves the tree compiling and its tests passing. Commit per step with the
`fork-model-section-caps` scope.

1. **Stencil buffer.** Add `stencil: true` to the `WebGLRenderer` options
   (`viewer/createViewer.ts:55-59`) with a one-line comment that caps need it and three defaults
   it off since r163. Assert the option in `createViewer.test.ts`.
2. **Contracts.** `ModelSection.caps` with its decoding default (`model-workspace.ts:5-10`); the
   `"wall-thickness"` action, `ModelWall`, `wall` on `ModelEditorResult` and
   `ModelEditorComplete`, and `state.sectionCaps` (`model-editor.ts`). Add `caps: true` to the
   viewer's initial section (`createViewer.ts:91`), the panel default (`useModelEditing.ts:20-25`)
   and the test fixtures the typecheck flags.
3. **Closed-mesh check.** `closedMesh` in `viewer/sectionCaps.ts`, pure, with its tests.
4. **Stencil caps.** `createSectionCaps` in `viewer/sectionCaps.ts`. Wire it in `createViewer.ts`:
   create once, `setModel` from `setModel` (`createViewer.ts:513-534`), `update` from
   `applySection` (`createViewer.ts:97-110`), `setWireframe`, `restore` and the theme callback
   (`createViewer.ts:379-385`), `dispose` from `dispose` (`createViewer.ts:628-658`). Add
   `setClosedHint` and a cap state callback. If L35 has landed, call `syncTransforms` from
   `setOrientation`.
5. **Strip toggle.** "Filled cut" in `SectionStrip` (`WorkspaceTools.tsx:420-477`) with its
   disabled and tooltip states; pass the cap state and the render summary's `manifold` from
   `ModelPanel.tsx`.
6. **Cross-section maths.** `sectionSegments`, `insideSection` and `wallAt` in
   `viewer/sectionCaps.ts`, pure, with tests on known shapes.
7. **Hover readout.** The coalesced pointer-move handler, DOM label and SVG chord in the marks
   layer (`createViewer.ts:181-240`), hidden on leave, navigation and section change. Style the
   line in `workspace.module.css` using the measurement blue.
8. **Keep and pick.** The `dblclick` handler and `onWallMeasure`; the save in `useModelEditing.ts`
   next to `onPick` (`useModelEditing.ts:92-122`), named "Wall N"; cap-aware `pick`
   (`createViewer.ts:112-126`).
9. **Editor command.** The `wall-thickness` case and `state.sectionCaps` in `ModelPanel.tsx`
   (`199-411`); copy `wall` in `completeEditor` (`ModelPreviewService.ts:888-894`); update the
   editor tool description (`mcp.ts:14-24`).
10. **User guide.** In "Explore and review a design" of `docs/fork/user/model-preview-3d.md`,
    extend the section plane sentences: the cut is filled when the mesh is closed, hover shows
    the wall thickness in the plane (pick the axis across the wall), double-click keeps it, and
    "Filled cut" turns the fill off.

## Done when

- A section through a closed STL box with 2 mm walls shows a hatched cap on the walls and no cap
  in the hollow; hovering any point of a wall reads "2.0 mm wall" (within 0.05 mm) and the line
  crosses the wall at right angles.
- Scrubbing the offset moves the cap with no visible lag and no extra frames once the pointer
  stops.
- An open STL (one face deleted) shows a hollow cut and the disabled "Filled cut" with "Caps need
  a closed mesh".
- Captures and four-view captures include the cap.
- Double-click keeps "Wall 1" in Markup with the same distance as the readout.
- Measure clicks on the cap land on the cut.
- Light and dark themes both show a cap distinct from the part; caps hide in wireframe.
- An agent gets `wall.thicknessMm` from `{ action: "wall-thickness", points: [...] }` and
  `state.sectionCaps` from `snapshot`.
- Focused tests, lint and the typechecks in TESTING.md pass.
