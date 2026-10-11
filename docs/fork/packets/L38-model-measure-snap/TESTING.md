# L38 testing

## Results

Implementation branch: `feat/model-follow-ghost-snap`, 2026-10-10. Code milestone:
`b0742acf26` implements follow-agent opening, previous-version retention and snapping/holes,
with the coupled contracts, client integrations and L41 seam.

| Focused set                                                                                                                                             | Result                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Contracts `model-measurements.test.ts`, `viewer/snap.test.ts`, `viewer/snapTopology.test.ts`, `viewer/createViewer.test.ts`, `useModelEditing.test.tsx` | 58 passed across 5 files (3 + 10 + 4 + 33 + 8). |

The set covers old measurement decoding, circle payloads, welded topology and feature queries,
worker transfer/completion/cancellation/failure, cap behavior, current-model-only picking,
circle saves and unit-aware labels/captures. The 33 viewer tests include L42 retention cases
and are counted once in the batch. Backend completion and stored-workspace fixtures are part
of the 55-test backend set.

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

| File                                                                         | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-measurements.test.ts` (new)               | A stored measurement without `kind` decodes as `"distance"`; a circle measurement round-trips; zero or negative diameters and out-of-range `sides` fail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/src/fork/model-preview-3d/viewer/snap.test.ts` (new)               | Welding a non-indexed cube gives 8 vertices and 12 triangles with every `across` filled. Cube edges are sharp, the diagonal of each face is not. A 32-segment cylinder's side facets share one region; rims are sharp. A non-manifold edge is sharp with `across = -1`. `fitCircle` returns the exact diameter for a 6-gon and a 64-gon, `sides` 6 and `null` for 200 vertices, rejects a rectangle loop with extra edge vertices, a non-planar loop and a 4-vertex loop. `circleAt` on a plate with a 6-sided hole from a rim edge returns the hole, not the plate outline; from a wall face of a smooth hole returns the nearer rim. `snapNear` returns a vertex inside the radius, prefers a vertex over a closer edge point, falls back to `face` outside the radius, and drops candidates rejected by `keep` (section plane). `snapNearPoint` finds the corner within 1 mm and leaves a far point unchanged. |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (extend)    | Entering Measure on a model above `SNAP_TRIANGLE_LIMIT` reports `"off"` and never builds. `setModel` resets snap state. Pointer moves in measure mode schedule at most one frame of hover work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/model-preview-3d/useModelEditing.test.tsx` (extend)       | Distances save with `kind: "distance"`; `onCircle` saves `Hole 1` with `start`/`end` one diameter apart and the `circle` payload; a null fit saves nothing and sets the hint error; `cancel` resets the mode to distance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (extend) | `completeEditorAction` with a `measurement` returns it to the waiting editor call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`viewer/snapTopology.test.ts` tests world-space indexed and instance extraction, worker
transfer/completion, termination on cancellation and failures, and the triangle cap with a
worker double. The worker's topology algorithm is covered by the pure tests; real browser
worker execution remains part of the manual check.

## Commands

From the repository root:

```sh
(cd packages/contracts && ../../node_modules/.bin/vp test run src/fork/model-measurements.test.ts)
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/snap.test.ts \
  src/fork/model-preview-3d/viewer/snapTopology.test.ts \
  src/fork/model-preview-3d/viewer/createViewer.test.ts \
  src/fork/model-preview-3d/useModelEditing.test.tsx)
(cd apps/server && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/ModelPreviewService.test.ts)
node_modules/.bin/vp lint packages/contracts/src/fork apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Performance measurement

Large-mesh profiling remains unrun. During an authorized desktop verification, record here
on Kyle's machine with a 1M triangle STL such as a high-`$fn` OpenSCAD export: index build time from the worker message to ready,
the worker's peak memory from the Performance panel, and the median hover update time over ten
seconds of moving the mouse. If hover is over 50 ms, lower `SNAP_TRIANGLE_LIMIT` to the size
where it is 30 ms and note the new number in PRODUCT.md.

## Manual checks for Kyle

1. Open a box STL, press `M`, hover a corner: square marker; an edge midpoint: triangle; along
   an edge: diamond. Measure corner to corner: a round number.
2. Hold `Alt` and click mid-face: the point lands where clicked.
3. Turn on a section plane, hover near the cut: no markers on the removed side.
4. Render an OpenSCAD plate with `cylinder(d = 3.4, h = 10)` subtracted. Switch the hint to
   "Hole", hover the rim (loop highlight and preview), click: "Ø3.40 mm", "6 sides, 2.94 mm
   across flats". Repeat with `$fn = 64`: no across-flats line.
5. Click a flat face in Hole mode: "Click the rim of the hole", nothing saved.
6. Edit the SCAD so the hole changes: the row moves to "Earlier versions"; "Measure again"
   comes back in Hole mode.
7. Open a 1.5M triangle model: Measure works, hint says snapping is off.
8. Ask an agent to measure the hole through the editor tool; it reports the diameter from the
   returned `measurement`.
9. Variants comparison and a PCB 3D board: no change in behaviour.

## Merge safety

- Contracts: additive fields with decoding defaults; old workspaces decode. Run the contracts
  test above.
- Shared files: see [SEAMS.md](./SEAMS.md). Rebase on whichever of L31, L36 and L43 lands first
  and keep the `pointerMove`/`pointerUp` branches separate from theirs.
- Upstream: no upstream files. Before an upstream integration, check with
  `git merge-tree --write-tree --name-only --no-messages HEAD "$tag"` that nothing here appears.
