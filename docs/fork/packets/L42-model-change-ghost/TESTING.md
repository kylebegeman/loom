# L42 testing

## Focused tests

| File                                                                      | Proves                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/viewer/ghost.test.ts` (new)           | `set(object)` disposes the object's original materials and textures and gives every mesh the ghost material; a second `set` disposes the first ghost's geometries; `set(null)` and `dispose` leave nothing allocated; `setVisible(false)` hides without disposing; `setClipping` applies planes to the material; ghost meshes keep their geometry and transforms.                                                          |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (extend) | With `keepPrevious` off, `setModel` disposes the outgoing model exactly as before. With it on, the outgoing model becomes the ghost, is hidden until `showPrevious(true)`, is not hit by picking, does not change `fit()` distance, and is disposed by the next `setModel`, by `keepPrevious(false)` and by `dispose()`. Over `GHOST_TRIANGLE_LIMIT` nothing is kept. A section plane set before or after clips the ghost. |
| `apps/web/src/fork/model-preview-3d/ModelInspector.test.ts` (extend)      | `dimensionDelta` returns signed per-axis deltas, drops axes under 0.05 mm, and formats "+2.0 mm" and "−1.5 mm".                                                                                                                                                                                                                                                                                                            |

The chip and reload-cause rules live in `ModelPanel.tsx`, which has no test harness today; they
are covered by the manual checks below rather than by a new panel test rig.

## Commands

```sh
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/ghost.test.ts \
  src/fork/model-preview-3d/viewer/createViewer.test.ts \
  src/fork/model-preview-3d/ModelInspector.test.ts)
node_modules/.bin/vp lint packages/contracts/src/fork apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual checks for Kyle

1. Open a SCAD part, edit its width in your editor and save. The chip appears; `D` shows the old
   shape in grey; Part shows the X delta. `D` hides it; the chip offers "Show previous" again.
2. Dismiss the chip; `D` still toggles.
3. Change a customizer value and apply: no chip; `D` shows the previous render. Repeat in Live
   mode while dragging a slider: the ghost follows the last applied render.
4. Turn on a section plane through a moved hole: both old and new holes are visible in the cut.
5. Capture with the ghost shown and hidden; four-view capture too.
6. Switch theme with the ghost shown: it stays readable.
7. Open the Display menu before any change: "Previous version" is disabled with its note.
8. Hide the panel for over a minute and return: no previous version.
9. Ask an agent to make a change, show the previous version and capture.
10. Open a variant comparison and a PCB 3D board: no ghost, no change.

## Merge safety

- Contracts: two optional fields; no persisted data changes.
- Shared files: see [SEAMS.md](./SEAMS.md). The `setModel` change is the riskiest overlap
  (L35 also touches it); keep the retention branch as one block around the old dispose lines.
- Shared definition: if L49 created `ghost.ts` first, add methods only; do not change `set`.
- Upstream: no upstream files. Before an upstream integration, confirm with
  `git merge-tree --write-tree --name-only --no-messages HEAD "$tag"` that none appear.
