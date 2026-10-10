# L40 testing

Focused tests, no repo-wide checks, no sleeps.

## Automated tests

| File                                                                                      | Covers                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/fork/model-preview-3d/units.test.ts` (new)                                  | `fromMm`/`toMm` round trip; `formatLength` defaults ("12.3 mm", "0.50 in" for 12.7 mm), `digits` 0 and 2 in both units, `trim` ("11 in", "8.5 in"), `unit: false`, `-0` shown as "0"; `formatLengths` joins with " × ", skips null and writes the unit once. |
| `packages/contracts/src/fork/model-preview-3d.test.ts` (new, or update if L33 created it) | Settings without `displayUnits` decode to `"mm"`; `"cm"` is rejected; with L33, the update payload accepts a missing `displayUnits`.                                                                                                                         |
| `apps/server/src/fork/model-preview-3d/store.test.ts` (update)                            | A stored row without the field reads back as `"mm"`; a saved `"in"` persists.                                                                                                                                                                                |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (update)                 | A measurement label is drawn with the formatter set by `setLengthFormat`, and the default matches today's text.                                                                                                                                              |
| `apps/web/src/fork/model-preview-3d/buildPlate.test.ts` (update)                          | Remove `formatVolume` cases if any; nothing else.                                                                                                                                                                                                            |

The site conversions are one-line swaps of tested formatting, so they get no markup tests. The
`rg` check in IMPLEMENTATION.md step 4 stands in for an inventory test.

## Commands

```sh
vp test run apps/web/src/fork/model-preview-3d/units.test.ts \
  packages/contracts/src/fork/model-preview-3d.test.ts \
  apps/server/src/fork/model-preview-3d/store.test.ts \
  apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts \
  apps/web/src/fork/model-preview-3d/buildPlate.test.ts
vp lint packages/contracts/src/fork apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual check

With Kyle's permission, in a dev client against a worktree `.t3`:

1. Open a model with old settings: nothing reads differently from `main`.
2. Bed menu, Units "in". The status bar, Part, the plate diagram and both bed menus switch at
   once. Reload: still inches. A second browser on the same environment shows inches.
3. Measure an edge: row, viewport label and a capture (`loom_model_preview_3d_editor` capture)
   all read inches; "Copy value" pastes the inch number.
4. Section: drag and type in the offset field in inches; save a view and read its row.
5. Variants: sizes and a comparison read inches.
6. Custom bed: type 12 x 9 x 10 in; check the stored mm with the settings tool. Type 0.3 in and
   see it refused with the inch range.
7. Settings: switch to millimetres, see the custom bed fields convert before saving, save.
8. Palette: "3D model: Switch units" toggles with a toast.
9. From a connection without settings permission: controls disabled; lengths follow the saved
   unit.
10. Ask an agent for the part size: it answers from tool output in mm.

Upstream server: the panel is unavailable, nothing to check.

## Merge safety

Run `scripts/fork/loom.sh check` and the merge check in SEAMS.md; expect no conflicts. After
merge to `main`, Kyle runs `scripts/fork/loom.sh integrate nightly --dry-run`.
