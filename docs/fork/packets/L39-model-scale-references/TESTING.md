# L39 testing

## Focused tests

| File                                                                      | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/fork/model-preview-3d/viewer/references.test.ts` (new)      | For each kind, the built group's bounding box matches the cited size within 0.01 mm (card 53.98 × 85.60 × 0.76, quarter Ø24.26 × 1.75, euro Ø23.25 × 2.33, AA 14.5 × 50.5 × 14.5, brick 15.8 × 31.8 × 11.3 with studs, screw 5.5 × 13.0 × 5.5, hand 190 long). `"none"` returns null. `placeReference` puts the box's minimum X exactly `REFERENCE_GAP_MM` past the part, centres it on the part's Y, and rests it on the part's minimum Z, for a part not centred at the origin. `dispose` releases every geometry and the material. |
| `apps/web/src/fork/model-preview-3d/viewer/createViewer.test.ts` (extend) | After `setReference("card")`, `fit()` frames the same distance as with no reference; `setModel` with a bigger part re-places it; picking ignores it.                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/server/src/fork/model-preview-3d/store.test.ts` (extend)            | Stored settings JSON without `scaleReference` loads as `"none"`; a saved value round-trips.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

No markup tests for the menu or the settings row.

## Commands

```sh
(cd apps/web && ../../node_modules/.bin/vp test run \
  src/fork/model-preview-3d/viewer/references.test.ts \
  src/fork/model-preview-3d/viewer/createViewer.test.ts)
(cd apps/server && ../../node_modules/.bin/vp test run src/fork/model-preview-3d/store.test.ts)
node_modules/.bin/vp lint packages/contracts/src/fork apps/web/src/fork/model-preview-3d \
  apps/server/src/fork/model-preview-3d
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter t3 typecheck
```

## Manual checks for Kyle

1. Open a small part, Bed menu, "Show for scale", pick each object in turn. Each sits to the
   right of the part on the plate, grey, sensible size.
2. Press `G`: the plate hides, the reference stays. Turn on wireframe and a section plane: the
   reference is unaffected.
3. Measure across the reference: clicks go nowhere. Status bar and Part dimensions unchanged.
4. Capture (single and four views) and a named-view sheet: the reference appears when in frame.
5. Change the part (edit the SCAD) so it grows: the reference moves out with it.
6. Check Settings shows the same choice; set "Nothing" there and the viewport clears.
7. Switch light and dark themes: the reference reads as neutral in both.
8. Ask an agent to show a coin and capture; then to remove it.

## Merge safety

- Contracts: one new file and an additive setting with a decoding default; old settings decode.
- Shared files: see [SEAMS.md](./SEAMS.md). The `BedPicker.tsx` change appends one control and
  one hook; rebase against L32, L33 and L34 if they land first.
- Upstream: no upstream files. Before an upstream integration, confirm with
  `git merge-tree --write-tree --name-only --no-messages HEAD "$tag"` that none appear.
