# L31 testing

Focused tests only, no sleeps, no repo-wide checks.

## Automated tests

| File                                                                 | Covers                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/fork/model-workspace.test.ts` (new)          | A camera encoded without `projection` decodes as `"perspective"`; `"orthographic"` round-trips; an unknown value fails.                                                                                                                                                                                                                                                                                            |
| `apps/web/src/fork/model-preview-3d/viewer/projection.test.ts` (new) | `syncOrthographic` copies position and orientation; half-height is `d * tan(fov / 2)` and half-width follows aspect; at `fitDistance(box, 40, aspect)` the frustum contains the bounding sphere for aspect 0.5, 1 and 2; `near` sits in front of the sphere's near side even when the eye is inside it. `markerScale` matches the perspective on-screen size (`0.015 / tan(fov / 2)` in NDC) at several distances. |
| `viewer/createViewer.test.ts`                                        | `snapshot()` after `setProjection("orthographic")` reports it; `restore` with each value round-trips; `capture(true)` leaves projection unchanged afterwards. Extend only if the existing WebGL stubs allow it; otherwise rely on the helper tests.                                                                                                                                                                |
| `viewer/captureSheet.test.ts`                                        | Fixture gains `projection`; a view stored in ortho is restored with it and the original is restored after.                                                                                                                                                                                                                                                                                                         |
| `apps/server/src/fork/model-preview-3d/openscad.test.ts`             | `pngArgs(..., "orthographic")` emits `--projection=o`; `"perspective"` emits `--projection=p`.                                                                                                                                                                                                                                                                                                                     |
| `mcp.test.ts`, `ModelPreviewService.test.ts`                         | `renderModelTool` passes `projection` through and applies `DEFAULT_RENDER_PROJECTION` when omitted.                                                                                                                                                                                                                                                                                                                |
| `realOpenScad.test.ts`                                               | With `LOOM_TEST_OPENSCAD` set, an ortho render with `--viewall --autocenter` produces a non-empty PNG.                                                                                                                                                                                                                                                                                                             |

## Commands

```sh
vp test run packages/contracts/src/fork/model-workspace.test.ts \
  apps/web/src/fork/model-preview-3d/viewer \
  apps/server/src/fork/model-preview-3d/openscad.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts \
  apps/server/src/fork/model-preview-3d/workspace.test.ts
vp lint packages/contracts/src/fork/model-workspace.ts \
  packages/contracts/src/fork/model-editor.ts \
  apps/web/src/fork/model-preview-3d apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/client-runtime typecheck
```

Optional, with OpenSCAD installed:

```sh
LOOM_TEST_OPENSCAD=/path/to/openscad \
  vp test run apps/server/src/fork/model-preview-3d/realOpenScad.test.ts
```

## Manual check

On desktop and in a browser against the dev server, with an STL and a `.scad` part:

1. Press `P`. Framing stays put; parallel edges stay parallel. The Display menu shows it ticked.
2. Orbit, pan (`H`, middle drag), scroll, `+`/`-`, `F`, `1` to `4`. No jumps, no clipping when
   zoomed into the part.
3. Measure two points and annotate a region in ortho. Dots are visible and the same size as in
   perspective.
4. Section with `S` in ortho.
5. Save a view in ortho, switch to perspective, recall it: ortho returns. Recall an older view:
   perspective.
6. Capture the four-view sheet from perspective: the sheet is ortho, the screen stays
   perspective. Capture "Current view" in each projection.
7. Ask an agent to call the editor with `{ action: "display", projection: "orthographic" }`,
   then `snapshot`, then the render tool with and without `projection`.
8. Idle check: with the panel open and untouched, the performance panel shows no frames drawn.

## Merge safety

No upstream files. Run the merge preview from CONVENTIONS.md against the newest nightly before
merging, and `scripts/fork/loom.sh check` after.
