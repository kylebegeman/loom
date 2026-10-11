# L35 testing

Focused tests, no repo-wide checks, no sleeps.

## Verification evidence (2026-10-10)

Implementation milestones: `331537b175` (contracts and host services), `90db501feb` (viewer and inspector integration).

On `feat/model-orientation-sections-print-check`, 35 core tests passed across five files: orientation helpers (12),
editing lifecycle and wall saving (14), bake-request preparation (1), workspace contracts (5)
and server workspace operations (3). The shared viewer and canvas run passed 62 tests across
three files, including orientation bounds, model-space picks and retained ghost transforms;
see [L37's evidence](../L37-model-section-caps/TESTING.md). These overlapping runs are not added
together. Server render-tool coverage is recorded with the integration milestone.

Contracts, client-runtime, web and server package typechecks passed.
Targeted lint passed for the checked files, including the ten root integration files. Browser, desktop, GPU, relay and real-model
performance checks were not run. No repository-wide checks were run.

## Automated tests

| File                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/model-workspace.test.ts` (new)                  | A workspace JSON without `orientation` decodes with `orientation: null`; a stored non-unit quaternion still decodes (no whole-workspace failure); the `orientation` operation rejects `[0, 0, 0, 2]` with "Use a unit quaternion" and accepts `item: null`; `normalizeQuaternion` returns `w >= 0` and identity for zeros; `quaternionMatrix` of a 90 degree turn about X maps +Y to +Z.                                                                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/model-preview-3d/workspace.test.ts` (update)           | `applyWorkspaceOperation` sets, replaces and resets the orientation; stores it normalized; leaves views, measurements and the other collections untouched; `remove` still works on a workspace with an orientation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/web/src/fork/model-preview-3d/viewer/orientation.test.ts` (new)        | `restingQuaternion` sends the given normal to (0, 0, -1) and composes with an existing rotation (lay flat twice ends on the second face); `buildAdjacency` on a non-indexed `BoxGeometry` clone finds three neighbours per triangle and `-1` on an open plane's border; `coplanarRegion` on a box returns the two triangles of one side and its area, and on a 64-segment cylinder's side does not spread past 2 degrees; `hullRestingNormal` on a cube with one chamfered corner returns a full side, and on a wedge returns its base; `bakeRotation` Euler "ZYX" angles rebuild the same matrix as OpenSCAD's `Rz * Ry * Rx` for random quaternions (including a 90 degree Y case), and `dz` rests the origin-rotated box at Z=0; `bedDelta` swaps Y and Z for a 90 degree X turn. |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (update)    | With the existing renderer double: `setOrientation` of a 10 x 20 x 30 box turned 90 degrees about X reports size 10 x 30 x 20 and keeps the box centre fixed; the bed moves to the new minimum Z; a pick returns model-space coordinates (same point before and after a rotation); `setModel` with a stored orientation reports oriented stats on first load; `setOrientation(null)` restores the original stats; an enabled section's offset recentres.                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src/fork/model-preview-3d/openscad.test.ts` (update)            | `meshArgs` puts `--export-format binstl`, backend, sorted `-D` overrides and the source last.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update) | With the fake runner: an STL with a saved orientation writes a wrapper containing `multmatrix(` before `scale(`; a SCAD with an orientation runs one mesh export then imports it for every view; `orientation: "none"` keeps today's wrapper; the result carries the applied orientation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/server/src/fork/model-preview-3d/mcp.test.ts` (update)                 | The render tool forwards `orientation` and its success schema accepts `orientation: null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

No markup tests for the Part row or rail button: they render tested state.

## Commands

From the repository root:

```sh
(cd packages/contracts && ../../node_modules/.bin/vp test run src/fork/model-workspace.test.ts)
(cd apps/server && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/workspace.test.ts src/fork/model-preview-3d/openscad.test.ts \
  src/fork/model-preview-3d/ModelPreviewService.test.ts src/fork/model-preview-3d/mcp.test.ts)
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/orientation.test.ts \
  src/fork/model-preview-3d/viewer/createViewer.test.ts)
node_modules/.bin/vp lint apps/server/src/fork/model-preview-3d apps/server/src/fork/features.ts \
  apps/web/src/fork/model-preview-3d packages/contracts/src/fork/model-workspace.ts \
  packages/contracts/src/fork/model-editor.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

With OpenSCAD installed, also run the real render case:
`(cd apps/server && LOOM_TEST_OPENSCAD=/path/to/OpenSCAD ../../node_modules/.bin/vp test run src/fork/model-preview-3d/realOpenScad.test.ts)`,
extended with one oriented 10 x 20 x 30 cube whose summary box is 10 x 30 x 20.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3` seeded with
`vp run migrate-dev-db`:

1. Open a tall STL bracket. Press `L`, hover: the flat region under the cursor highlights. Click
   the back face: the part rests on it, the bed moves under it, the status bar size and the
   "Larger than the bed" warning update, and the "Laid flat" chip appears.
2. Click a face inside a pocket: the part rests on its lowest points and the hint says the face
   cannot touch the bed.
3. Take a measurement, lay flat on another face: the measurement stays on the part with the same
   distance; Markup deltas read in bed axes.
4. Add a Z section, then lay flat: the cut stays horizontal and recentres.
5. "Reset orientation": everything returns. Use the palette entries and the `L` key too.
6. Open the same model on a second client (remote over Tailscale if available): same pose.
7. "Ask agent to bake this rotation" on a SCAD file: the composer gets the request; send it,
   let the agent edit, then confirm the stale note and that resetting gives the right pose.
8. Ask an agent to call `loom_model_preview_3d_render` before and after laying flat, and
   `loom_model_preview_3d_editor` with `{ action: "orientation", name: "auto" }`.
9. A connection without workspace edit permission: controls disabled with the tip.
10. Light and dark themes; narrow panel.

Upstream T3 server: the panel is unavailable. Older Loom server: no lay flat controls.

## Merge safety

The full release rehearsal is deferred. Before merge, use the preview in SEAMS.md; after
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
