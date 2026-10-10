# L38 testing

## Focused tests

| File                                                                         | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-workspace.test.ts` (new)                  | A stored measurement without `kind` decodes as `"distance"`; a circle measurement round-trips; zero or negative diameters and out-of-range `sides` fail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/web/src/fork/model-preview-3d/viewer/snap.test.ts` (new)               | Welding a non-indexed cube gives 8 vertices and 12 triangles with every `across` filled. Cube edges are sharp, the diagonal of each face is not. A 32-segment cylinder's side facets share one region; rims are sharp. A non-manifold edge is sharp with `across = -1`. `fitCircle` returns the exact diameter for a 6-gon and a 64-gon, `sides` 6 and `null` for 200 vertices, rejects a rectangle loop with extra edge vertices, a non-planar loop and a 4-vertex loop. `circleAt` on a plate with a 6-sided hole from a rim edge returns the hole, not the plate outline; from a wall face of a smooth hole returns the nearer rim. `snapNear` returns a vertex inside the radius, prefers a vertex over a closer edge point, falls back to `face` outside the radius, and drops candidates rejected by `keep` (section plane). `snapNearPoint` finds the corner within 1 mm and leaves a far point unchanged. |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (extend)    | Entering Measure on a model above `SNAP_TRIANGLE_LIMIT` reports `"off"` and never builds. `setModel` resets snap state. Pointer moves in measure mode schedule at most one frame of hover work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/model-preview-3d/useModelEditing.test.tsx` (extend)       | Distances save with `kind: "distance"`; `onCircle` saves `Hole 1` with `start`/`end` one diameter apart and the `circle` payload; a null fit saves nothing and sets the hint error; `cancel` resets the mode to distance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (extend) | `completeEditorAction` with a `measurement` returns it to the waiting editor call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The worker file is a thin wrapper around `buildTopology`; it is covered by the pure tests and
the manual check, not by a worker test harness.

## Commands

From the repository root:

```sh
(cd packages/contracts && ../../node_modules/.bin/vp test run src/fork/model-workspace.test.ts)
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/snap.test.ts \
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

Before merging, record in the PR description on Kyle's machine (desktop build, a 1M triangle
STL such as a high-`$fn` OpenSCAD export): index build time from the worker message to ready,
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
