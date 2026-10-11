# L42 testing

## Results

Implementation branch: `feat/model-follow-ghost-snap`, 2026-10-10. Code milestone:
`b0742acf26` implements follow-agent opening, previous-version retention and snapping/holes,
with the coupled contracts, client integrations and L41 seam.

| Focused set                                                                                                                      | Result                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `viewer/ghost.test.ts`, `viewer/ViewerCanvas.test.tsx`, `ModelInspector.test.ts`, `viewer/load.test.ts`, `previousModel.test.ts` | 24 passed across 5 files (2 + 6 + 5 + 9 + 2); 1 existing loader test skipped. |
| Shared `viewer/createViewer.test.ts`                                                                                             | 33 passed, included once in the 58-test snapping/viewer set.                  |

The retention cases verify original-material/image cleanup, geometry disposal once,
one retained version, cap and instance counts, section clipping, fit/pick exclusion,
shown/hidden captures and same-revision clearing. Canvas and metadata tests cover release
reset and current choices during a pending download. Root integration keeps the cap note
about the replaced mesh and clears unchanged cached SCAD previews even without a download.

The integrated L41/L42/L38 batch passed **156 focused tests across 19 files**, counted once:
55 backend/schema/authorization tests, 19 follow-agent client tests, 58 shared snapping/viewer
and editing tests, and 24 ghost/canvas/inspector/loader/metadata regressions. One existing 3MF
loader test was skipped because `DOMParser` is unavailable in the Node test environment.

Strict lint passed on changed files, and contracts, client-runtime, web and server typechecks
passed. The L41 seam-marker/manifest check and `git diff --check` passed.

Browser/desktop and remote-client interaction, actual GPU rendering and image inspection,
large-mesh profiling, the full `loom.sh check` and upstream integration rehearsals remain
unrun. The manual steps below are a validation plan, not completed checks.

## Focused tests

| File                                                                      | Proves                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/viewer/ghost.test.ts` (new)           | `set(object)` disposes the object's original materials and textures and gives every mesh the ghost material; a second `set` disposes the first ghost's geometries; `set(null)` and `dispose` leave nothing allocated; `setVisible(false)` hides without disposing; `setClipping` applies planes to the material; ghost meshes keep their geometry and transforms.                                                          |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (extend) | With `keepPrevious` off, `setModel` disposes the outgoing model exactly as before. With it on, the outgoing model becomes the ghost, is hidden until `showPrevious(true)`, is not hit by picking, does not change `fit()` distance, and is disposed by the next `setModel`, by `keepPrevious(false)` and by `dispose()`. Over `GHOST_TRIANGLE_LIMIT` nothing is kept. A section plane set before or after clips the ghost. |
| `apps/web/src/fork/model-preview-3d/ModelInspector.test.ts` (extend)      | `dimensionDelta` returns signed per-axis deltas, drops axes under 0.05 mm, and formats "+2.0 mm" and "−1.5 mm".                                                                                                                                                                                                                                                                                                            |

`ViewerCanvas.test.tsx` covers unchanged revision clearing before stats are reported, revision
reset after release and current retention choices during an in-flight download.
`previousModel.test.ts` covers metadata for first load, unchanged revisions and failed retention.
`viewer/load.test.ts` covers active instance triangle counts for the retention budget. The chip
and watcher UI still need the integrated client checks below; no panel test rig was added.

## Commands

```sh
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/ghost.test.ts \
  src/fork/model-preview-3d/viewer/createViewer.test.ts \
  src/fork/model-preview-3d/ModelInspector.test.ts \
  src/fork/model-preview-3d/viewer/ViewerCanvas.test.tsx \
  src/fork/model-preview-3d/viewer/load.test.ts \
  src/fork/model-preview-3d/previousModel.test.ts)
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
