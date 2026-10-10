# L37 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/fork/model-preview-3d/viewer/sectionCaps.test.ts` (new)        | `closedMesh`: true for a non-indexed `BoxGeometry` and for an indexed one; false with one triangle removed (hole), with one triangle's winding flipped, and with a fin triangle sharing an edge three times; cached per geometry. `sectionSegments`: a Z cut through a 10 mm cube gives four segments forming its square, oriented so the solid is on the left; a vertex exactly on the plane does not produce a duplicate or missing segment; a cut beyond the part gives none. `insideSection`: centre of the square inside, outside point outside, the hollow of a box with 2 mm walls outside, and two overlapping squares (two meshes) inside in the overlap. `wallAt`: 2.0 mm anywhere across a 2 mm wall (centre and near either face), 10 mm for the solid cube's centre, the chord ends lie on the boundary, and a 30° slanted wall of true thickness 2 mm cut horizontally reads `2 / cos(30°)` (documents the limit). `createSectionCaps`: helper meshes are created only for closed meshes, carry the stencil settings from TECHNICAL.md, are not children of the model, and the caps group is hidden when the section is off, `caps` is false or wireframe is on. |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (update)    | The renderer double is constructed with `stencil: true`; `setModel` then `setSection` with caps leaves `meshStats`-style triangle counts and raycasts unchanged (helpers are not in the model); `pick` returns a cap point when the section is on and the cap is nearer; disposing the viewer disposes cap materials but not the model's geometry twice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `packages/contracts/src/fork/model-workspace.test.ts` (new or update)        | A `ModelSection` without `caps` decodes as `true`; a saved view JSON from before the packet recalls with caps on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update) | `completeEditor` passes `wall` through to the editor result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

No markup tests for the strip button or the readout.

## Commands

From the repository root:

```sh
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/sectionCaps.test.ts \
  src/fork/model-preview-3d/viewer/createViewer.test.ts)
(cd packages/contracts && ../../node_modules/.bin/vp test run src/fork/model-workspace.test.ts)
(cd apps/server && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/ModelPreviewService.test.ts)
node_modules/.bin/vp lint apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d packages/contracts/src/fork/model-workspace.ts \
  packages/contracts/src/fork/model-editor.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3`:

1. Open a closed STL enclosure with known wall thickness. Press `S`: the cut is filled and
   hatched. Scrub the offset and flip the side; the cap follows with no lag.
2. Hover a wall: the readout matches the known thickness and the line crosses the wall. Move off
   the part: it disappears. Orbit: it hides.
3. Double-click: "Wall 1" appears in Markup. Use Measure with clicks on the cap.
4. Toggle "Filled cut" off and on. Wireframe on: no cap.
5. Open an STL with a hole: "Caps need a closed mesh". Open a 3MF where one object is open:
   "Some parts aren't closed, so their cut isn't filled".
6. A SCAD part (manifold summary): caps appear without the check.
7. Capture and four-view capture: caps included. Dark and light themes.
8. Save a view with caps off, recall it. Recall a view saved before the packet: caps on.
9. Ask an agent for `{ action: "wall-thickness", points: [...] }` and `snapshot`.
10. With L35: lay the part flat, add a Z section, check the cap follows the rotated part.
11. Performance panel: no frames while hovering the cap.

Upstream T3 server: the panel is unavailable.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge preview in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
