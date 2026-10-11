# L67 testing

## Implemented coverage

Focused tests exercise the generated source, assembly operations and enclosure worker. No markup snapshots or repo-wide checks are required for this packet.

| Test                                                                   | Coverage                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/fork/pcb-preview/enclosure/features.test.ts`          | Drawing-frame fitting, mounting holes, edge connector detection and exclusion, assumed model heights, default standoff planning, deterministic source and edited-source detection.                                                         |
| `apps/server/src/fork/pcb-preview/enclosure/service.test.ts`           | Preview without workspace writes, portable version 2 assembly creation, preserving existing and concurrently created assemblies, protecting edited source, explicit overwrite and rejecting an output directory outside the workspace.     |
| `apps/server/src/fork/pcb-preview/PcbPreviewService.test.ts`           | Existing PCB service regressions, enclosure capability and source revision behavior. Generated assembly files and the default enclosure output directory do not change a tscircuit board's source hash.                                    |
| `apps/server/src/fork/model-preview-3d/assembly/boardFeatures.test.ts` | Real temporary reference files, version 1 metadata compatibility, bounded GLB JSON reads without loading binary geometry, and invalid metadata errors.                                                                                     |
| `packages/contracts/src/fork/model-assembly.test.ts`                   | Version 1 and version 2 compatibility, writer version selection and enclosure part validation.                                                                                                                                             |
| `apps/server/src/fork/model-preview-3d/assembly/operations.test.ts`    | Requirement patches, rotated board placement, frame-preserving replacement and removing dangling enclosure references.                                                                                                                     |
| `apps/server/src/fork/model-preview-3d/check/enclosure.test.ts`        | Synthetic wall and lid clearance, connector openings, solid, missing, displaced and embedded bosses, corrective moves, open meshes and closed hollow cavities. Floor samples omit drilled holes, whose boss contact is checked separately. |
| `apps/server/src/fork/pcb-preview/rpc.test.ts`                         | Denied enclosure and reference-export calls cannot start CAD work; terminal grants reach the service.                                                                                                                                      |
| `apps/web/src/fork/pcb-preview/EnclosureTab.interactions.test.tsx`     | CAD permission notices, legacy reference rejection before assembly writes, portable case creation and failed undo feedback.                                                                                                                |
| `apps/web/src/fork/pcb-preview/enclosureState.test.ts`                 | Capability combinations, assembly path and stale board reference detection.                                                                                                                                                                |
| `apps/web/src/fork/model-preview-3d/useAssembly.test.tsx`              | Save/undo behavior, preserving failed-save errors after refresh, terminal permission for board placement, and restoring enclosure requirements after part replacement.                                                                     |
| `packages/client-runtime/src/fork/pcb-preview.permissions.test.ts`     | Enclosure and reference-export commands require destination terminal grants.                                                                                                                                                               |

The existing assembly checker, geometry and authorization tests also passed in the focused implementation runs. Contracts, client runtime, server and web package typechecks passed, along with lint of changed files. The PCB editor completion test acquires its event stream before requesting an action, so asynchronous design resolution cannot race subscription setup.

## Real OpenSCAD proof

`apps/server/src/fork/pcb-preview/enclosure/realOpenScad.test.ts` is opt-in through `LOOM_TEST_OPENSCAD`. It generates a case for a 60 × 40 mm board with a mounting hole and a modeled component, renders `base`, `lid` and `fit`, and checks:

- Successful CLI exits without warnings or errors.
- Nonempty meshes and watertight base and lid.
- Base XY dimensions matching the planned exterior within 0.01 mm.
- The actual rendered case passing the enclosure worker, with a seated standoff and 1 mm lid clearance.

This test passed locally with `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD`. Temporary sources and meshes are cleaned up by the test scope.

```sh
LOOM_TEST_OPENSCAD=/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD \
  ./node_modules/.bin/vp test run \
  apps/server/src/fork/pcb-preview/enclosure/realOpenScad.test.ts
```

## Focused commands

Run only the files affected by subsequent changes. These paths match the current implementation:

```sh
./node_modules/.bin/vp test run \
  apps/server/src/fork/pcb-preview/enclosure/features.test.ts \
  apps/server/src/fork/pcb-preview/enclosure/service.test.ts \
  apps/server/src/fork/model-preview-3d/assembly/boardFeatures.test.ts \
  apps/server/src/fork/model-preview-3d/assembly/operations.test.ts \
  apps/server/src/fork/model-preview-3d/check/enclosure.test.ts \
  packages/contracts/src/fork/model-assembly.test.ts \
  apps/server/src/fork/pcb-preview/rpc.test.ts \
  apps/web/src/fork/pcb-preview/EnclosureTab.interactions.test.tsx \
  apps/web/src/fork/pcb-preview/enclosureState.test.ts \
  apps/web/src/fork/model-preview-3d/useAssembly.test.tsx \
  packages/client-runtime/src/fork/pcb-preview.permissions.test.ts
```

Use package-scoped typechecks for affected consumers and lint only changed files. Do not run repo-wide checks.

## Verification limits

No real-client browser or desktop interaction pass was run. Mobile has no PCB/assembly inspector surface; it shares the contracts and command permissions. The workflow uses destination environment RPCs and workspace-relative paths, but tailnet interaction was not exercised in this run.

Real KiCad/tscircuit reference export, generated build123d execution, fabrication and the full geometric limits matrix were not verified for L67. Generated component boxes remain conservative estimates, and open or inconsistently wound case geometry produces unchecked findings. Review those findings before manufacturing.

For an authorized integrated client pass, verify generation, edited-source overwrite cancellation, stale board replacement, an existing STL case, finding pins and suggested-move undo. These are follow-up verification targets, not claims of completed manual testing.
