# L36 testing

Focused tests, no repo-wide checks, no sleeps.

## Results

Implementation branch: `feat/model-zones-overhangs-lint`, 2026-10-10. Model milestone:
`59244e6191` implements nozzle zones, zone-aware fit, overhang shading and host statistics. The agreed scope is
live shading and editor captures plus host statistics; headless shaded PNG output is excluded.

Shared schema, settings-hook and capture/editor regressions passed **16 tests across four
files**: `packages/contracts/src/fork/model-preview-3d.test.ts`,
`apps/web/src/fork/model-preview-3d/overhangSettings.test.ts`,
`viewer/captureSheet.test.ts` and `useModelEditing.test.tsx`. They are counted once across
the integrated L34/L36/L45 batch.

| Final focused set                                                                                                   | Result                                                    |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `model-overhangs.test.ts`, `overhangMesh.test.ts`, `openscad.test.ts`, `ModelPreviewService.test.ts`, `mcp.test.ts` | Passed: 49 tests across 5 files (9 + 3 + 6 + 24 + 7).     |
| `viewer/overhangs.test.ts`, `viewer/createViewer.test.ts`, `viewer/ViewerCanvas.test.tsx`                           | Passed: 35 tests across 3 files.                          |
| Shared schema/settings/capture/editor files above                                                                   | Passed: 16 tests across 4 files.                          |
| Strict fork lint gate; contracts, web, server and client-runtime typechecks                                         | Passed; existing Effect suggestions are informational.    |
| Optional `realOpenScad.test.ts`, T-shape name filter only                                                           | Passed: 1 real test; 2 older tests skipped by the filter. |

The integrated L34/L36/L45 batch passed **157 focused tests across 17 files**, counted once:
46 nozzle-zone tests, 35 viewer tests, 49 backend/shared-overhang tests, 16 shared regressions
and 11 lint-gate/PCB regressions. The real OpenSCAD test is one additional pass in an
eighteenth file. It measured the T shape's underside as 96 mm², its largest region centre
approximately [5, 5, 10], original-up orientation and removal of the temporary analysis mesh.
Its initial exact centre assertion failed on floating-point precision; tolerant coordinate
assertions passed on rerun. Initial shared-hook/server fixture typing and web optional-property
issues were corrected before the final passing checks.

Browser/desktop and remote-client interaction, actual GPU shader compilation and image
inspection, large-mesh profiling, the full `loom.sh check` and upstream integration rehearsals
remain unrun. The commands and manual steps below are a validation plan, not additional
completed checks.

## Automated tests

| File                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-overhangs.test.ts` (new)                  | `overhangStats` on an axis-aligned cube: no overhang (the bottom is in the bed band), total area 6 x side²; on a cube lifted by a 1 mm stem (two boxes): the cube's underside is an overhang and the stem's base is not; a 45° chamfered ceiling counts at a 40° threshold and not at 50°; exactly vertical walls never count; `up` turned 90° (as from an L35 orientation) moves the overhang to the face that now points down; region union joins triangles sharing a vertex, splits two separate ledges, keeps the ten largest, and reports centres in model coordinates; `overhangPercent` is overhang over total area. Also: a settings JSON without `overhangAngleDegrees` decodes as 45, and 29 or 71 is rejected; a `ModelCamera` without `overhangs` decodes as `false`. |
| `apps/web/src/fork/model-preview-3d/viewer/overhangs.test.ts` (new)          | `patch` on a `MeshStandardMaterial`: calling the recorded `onBeforeCompile` with a fake shader object inserts the vertex varying after `#include <project_vertex>` and the fragment block after `#include <normal_fragment_maps>`, and assigns the shared uniform objects (so `setAngle(50)` changes `sin` on every patched material without touching `needsUpdate`); `customProgramCacheKey` preserves the prior material key; an existing `onBeforeCompile` still runs; `patch` returns false for `MeshBasicMaterial` and `ShaderMaterial` and patches a material only once.                                                                                                                                                                                                    |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (update)    | `snapshot` includes `overhangs`; `restore` with `overhangs: true` enables the uniform; `setModel` sets `bedZ` to the box minimum; angle changes coalesce into one render; indexed/nested/instance/mirrored geometry, cached input replacement and shaded capture restore behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/server/src/fork/model-preview-3d/overhangMesh.test.ts` (new)           | `parseBinaryStl` reads a two-triangle fixture, ignores stored normals, and rejects a truncated file or a count that disagrees with the size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update) | With the fake runner: `overhangs` adds one binstl export (SCAD: with the same `-D` overrides and backend) and returns stats; without it, the run list is unchanged; explicit and saved thresholds, import wrappers/3MF scaling, failure/timeout/cancellation cleanup. L35 orientation integration is future work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/server/src/fork/model-preview-3d/openscad.test.ts` (update)            | Binary analysis export arguments preserve the selected backend and literal parameter overrides.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/server/src/fork/model-preview-3d/mcp.test.ts` (update)                 | The render tool forwards `overhangs` and `overhangAngle`, rejects 25, and its success schema accepts a stats object.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

`apps/web/src/fork/model-preview-3d/overhangSettings.test.ts` covers live angle preview,
release commits preserving other pending settings, permission denial and save failure rollback.
Its fourth regression preserves a successfully acknowledged 51° angle when a later 60° save
fails before the settings atom updates the stale 45° props.
No markup tests for the chip or menu item.

## Commands

From the repository root:

```sh
(cd packages/contracts && ../../node_modules/.bin/vp test run src/fork/model-overhangs.test.ts)
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/overhangs.test.ts \
  src/fork/model-preview-3d/viewer/createViewer.test.ts)
(cd apps/server && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/overhangMesh.test.ts \
  src/fork/model-preview-3d/ModelPreviewService.test.ts src/fork/model-preview-3d/mcp.test.ts)
node_modules/.bin/vp lint apps/server/src/fork/model-preview-3d apps/server/src/fork/features.ts \
  apps/web/src/fork/model-preview-3d packages/contracts/src/fork/model-overhangs.ts \
  packages/contracts/src/fork/model-preview-3d.ts packages/contracts/src/fork/model-workspace.ts \
  packages/contracts/src/fork/model-editor.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

With OpenSCAD installed, run only the optional T-shape analysis check against temporary fixture
state:

```sh
LOOM_TEST_OPENSCAD=/path/to/OpenSCAD node_modules/.bin/vp test run \
  apps/server/src/fork/model-preview-3d/realOpenScad.test.ts \
  -t 'computes headless overhang statistics for a T shape and removes its analysis mesh'
```

The check verifies host statistics and analysis-mesh cleanup; it does not inspect live shader
output or the rendered PNG appearance.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3`:

1. Open an STL with a ledge, a 45° chamfer and a flat base. Press `V`: the ledge underside is
   shaded, the base is not. Drag the slider from 30° to 70° and watch the chamfer flip at 45°.
2. Reload; the angle persists. Open settings saved before the packet: 45°.
3. Wireframe on: the chip tooltip explains; off again: shading returns.
4. Dark and light themes; take a capture and view it in greyscale.
5. Save a view with overhangs on; turn them off; recall the view.
6. A glTF with smooth normals: shading follows facets; an unlit glTF part stays unshaded and
   the tooltip says so.
7. With L35: lay the part flat and watch the shading change.
8. A connection without settings permission: the slider is disabled, the toggle works.
9. Ask an agent for `loom_model_preview_3d_render` with `overhangs: true` and compare its areas
   with the chip tooltip.

Upstream T3 server: the panel is unavailable. Older Loom server: toggle works, slider hidden.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge preview in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
