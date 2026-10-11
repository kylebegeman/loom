# L32 testing

Focused tests, no repo-wide checks, no sleeps.

## Results

Implementation branch: `feat/model-camera-bed-fit`, 2026-10-10. The focused results below
were reported during implementation; the commands and manual steps later in this document
are the validation plan, not additional completed checks.

| Check                                                                              | Result                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Shared bed contracts                                                               | Passed: 17 tests                                                                     |
| Focused model server tests, including bed-fit responses                            | Passed: 31 tests                                                                     |
| Web bed helper regressions                                                         | Passed: 7 tests                                                                      |
| Focused lint on changed source                                                     | Passed                                                                               |
| Consumer typechecks                                                                | Passed: contracts, client-runtime, web and server                                    |
| Bed selection, permissions, live reload, narrow layout and themes in a real client | Not run; browser/computer-use verification was not authorized for this pass          |
| Real OpenSCAD geometry summary and fit report                                      | Not run; the optional binary integration test was skipped to keep validation focused |

Server tests use fake process results. They verify the fit response contract and service
behavior, rather than an installed OpenSCAD binary. No release, merge or remote-client
verification is recorded here.

## Automated tests

| File                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/fork/model-beds.test.ts` (new)                       | `fitOnBed`: exact boundaries fit (350 x 320 x 325 on the H2D); each axis 1 mm over is "too-big" with that axis in `overMm`; a footprint that only fits turned is "fits-rotated" (300 x 340 on 350 x 320); a part that fits turned but is too tall is "too-big", not "fits-rotated"; surfaces ignore height (297 x 210 x 5000 on A4 fits); a square part never reports "fits-rotated" when "fits" applies. `listBeds`: every preset id once, in table order, then "custom" with `customMm`; `activeBed` returns the custom slot for `preset: "custom"`. `selectBed`: keeps pattern and `customMm`, ignores unknown ids. `bedFitSummary`: one row per listed bed, `activeBedId` matches, `overMm` is null unless too big, and the result decodes with `BedFitSummary` (round trip through `Schema.decodeUnknownSync`). |
| `apps/web/src/fork/model-preview-3d/buildPlate.test.ts` (update)             | `bedGroups(setting)` keeps groups and order; `fitsBuildVolume` unchanged on its existing cases; `describeFit` words and joining ("12.0 mm too wide, 3.0 mm too tall") with a supplied formatter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src/fork/model-preview-3d/mcp.test.ts` (update)                 | The render tool passes `fit` through and its success schema accepts `fit: null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts` (update) | `renderImages` returns `fit` computed from the summary box against the stored bed setting, and `null` when the summary is missing. Use the existing fake runner fixtures; the real OpenSCAD case (`realOpenScad.test.ts`) can assert a 10 mm cube fits every bed when OpenSCAD is installed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

No component markup tests: the list is a direct render of tested helpers.

## Commands

```sh
vp test run packages/contracts/src/fork/model-beds.test.ts \
  apps/web/src/fork/model-preview-3d/buildPlate.test.ts \
  apps/server/src/fork/model-preview-3d/mcp.test.ts \
  apps/server/src/fork/model-preview-3d/ModelPreviewService.test.ts
vp lint packages/contracts/src/fork apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3`:

1. Open an STL around 340 x 200 x 100 mm. Part lists H2D "Fits", H2C "10.0 mm too wide", the
   Prusa and Creality rows with their overages, surfaces by footprint, and "Fits N of M".
2. Click the H2C row. The plate, the Bed menu label, the fit card and the status bar warning
   change together. Click H2D to go back.
3. Open the same model from a connection without settings permission: rows are readable, not
   clickable, with the tip.
4. Edit the file so it grows; after live reload the list updates in place without reordering.
5. Ask an agent to render the part with `loom_model_preview_3d_render` and to say which printers
   fit. Then ask it for an editor `snapshot` of a GLB and check `state.fit`.
6. Light and dark themes, and the narrow-panel sheet layout.

Upstream server: the panel is unavailable, nothing to check.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge preview in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
