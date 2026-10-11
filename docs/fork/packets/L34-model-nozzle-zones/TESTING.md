# L34 testing

Focused tests, no repo-wide checks, no sleeps.

## Results

Implementation branch: `feat/model-zones-overhangs-lint`, 2026-10-10. Model milestone:
`59244e6191` implements nozzle zones, zone-aware fit, overhang shading and host statistics.

The nozzle-zone foundation passed **46 tests across three files**:
`packages/contracts/src/fork/model-beds.test.ts`,
`apps/web/src/fork/model-preview-3d/buildPlate.test.ts` and
`apps/web/src/fork/model-preview-3d/viewer/zones.test.ts`. Shared schema, settings-hook and
capture/editor regressions passed **16 tests across four files**. These shared checks are
counted once in the integrated batch.

The integrated L34/L36/L45 batch passed **157 focused tests across 17 files**, counted once:
46 nozzle-zone tests, 35 viewer tests, 49 backend/shared-overhang tests, 16 shared
schema/settings/capture/editor tests and 11 lint-gate/PCB regressions. One additional real
OpenSCAD T-shape test passed in an eighteenth file, with two older real tests skipped by name
filter. It checked overhang statistics and temporary-mesh cleanup. The strict fork lint gate
and contracts, web, server and client-runtime package typechecks all passed; existing Effect
suggestions remain informational.

Initial shared-hook and server fixture typing issues and web exact-optional-property errors
were corrected before the final passing checks. The first real T-shape run failed only on an
exact floating-point centre assertion; tolerant coordinate assertions passed on rerun.

No real web/desktop or remote-client interaction, live GPU shader/image inspection, Bambu
Studio comparison, large-mesh profiling, full `loom.sh check` or upstream integration rehearsal
has been run for this batch. The remaining manual steps below are a validation plan, not
completed evidence.

## Automated tests

| File                                                                                                     | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-beds.test.ts` (update)                                                | Zone data: H2D and H2C zones lie inside their `volumeMm` and every height is at most the bed height. `sharedZone`: H2D and H2C give offset [25, 0], footprint [300, 320], height 320; non-overlapping zones give null. `singleZoneStrips`: H2D left [0, 0]/[25, 320] and right [325, 0]/[25, 320]; H2C right [325, 0]/[5, 320]; a zone fully inside another gives no strip for it. `fitBed`: every Done-when case in IMPLEMENTATION.md; a 320 x 290 x 100 box on the H2D is "fits-rotated" with `all-zones`; a bed without zones returns `zone: null` and the same `fit` as `fitOnBed`; `withinMm` is the shared box for an `all-zones` answer. `showZones` decodes to true when absent. With L32: `bedFitSummary` rows carry `zone` only for the H2D and H2C and still decode with `BedFitSummary`. |
| `apps/web/src/fork/model-preview-3d/buildPlate.test.ts` (update)                                         | `resolvePlate` returns the active bed's zones and `showZones`; `describeZoneFit` short and long words for each reach, with a supplied formatter; null for beds without zones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/fork/model-preview-3d/viewer/zones.test.ts` (new)                                          | `stripPlacement` on a 350 x 320 bed: the left strip centres at x -162.5, y 0; the right at x 162.5. `createZoneStrips` builds one mesh per strip with depth test and write off and `renderOrder` -3.5; `setTheme` changes colours; `dispose` disposes every geometry and material.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (update)                                | `setBed` with strips adds them under the bed group; a later `setBed` without strips leaves none and disposes the old ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/server/src/fork/model-preview-3d/mcp.test.ts` and `ModelPreviewService.test.ts` (update, with L32) | The fit summary for a 340 x 200 x 100 box on the H2D has `zone.reach` "whole-bed".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Commands

```sh
vp test run packages/contracts/src/fork/model-beds.test.ts \
  apps/web/src/fork/model-preview-3d/buildPlate.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/zones.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts
vp lint packages/contracts/src/fork apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

L32 is already present on this branch, so retain the server fit-summary coverage.

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3`:

1. Open an STL. Choose the H2D. Front view (`2`): the tinted strips are at the far left and far
   right of the plate. Top view (`3`): both run the full depth.
2. Choose the H2C: the right strip is a thin 5 mm band. Choose the Prusa Core One: no strips,
   no legend, no switch.
3. Open Part with parts of the sizes in IMPLEMENTATION.md, "Done when", and read the fit text.
4. Bed menu, "Show nozzle zones" off: strips and swatch go, fit text stays. Reload: still off.
   Turn it on from Loom settings and save.
5. Hide the bed with `G`: the strips hide too. Capture a view with the bed shown: strips appear
   in the PNG.
6. Light and dark themes: the strips are visible but quieter than the major grid lines.
7. Kyle compares one real part against Bambu Studio's plate on the H2D and H2C: the strip widths
   and the fit answers agree.
8. With L32, ask an agent whether a 340 mm wide part can print on the H2D with two materials.

Upstream server: the panel is unavailable, nothing to check.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
