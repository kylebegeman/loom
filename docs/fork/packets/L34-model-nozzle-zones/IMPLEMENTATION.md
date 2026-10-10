# L34 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md and this
folder. Start the branch from `main` once `feat/model-bed-picker` has merged, otherwise from that
branch (`8676e099e5`). Check which of L32 and L33 have landed: `model-beds.ts` exists if either
did, `fitOnBed` and `bedFitSummary` exist if L32 did, and `BuildPlateSettingUpdate` exists if L33
did. Check that MODEL-3D-FOLLOW-UPS.md lists `heightMm` in the zone shape.

## Steps

1. **Bed module (skip if `model-beds.ts` exists).** Do L32 IMPLEMENTATION.md steps 1 and 2.
   Commit the move on its own:
   `refactor(fork-model-nozzle-zones): keep bed data in one contracts module`.
2. **Fit primitive (skip if L32 landed).** Add L32's `BedFit` and `fitOnBed` exactly as L32
   TECHNICAL.md, "Fit", defines them, with their tests. L32 then skips its step 3's contracts
   half.
3. **Zone data and geometry.** Add `BedZone`, the `zones` field on `BuildPlatePreset` and `Bed`,
   the H2D and H2C data, `sharedZone` and `singleZoneStrips`. Make
   `listBeds` copy `zones`. Tests in `model-beds.test.ts`.
4. **Zone fit.** Add `ZoneFit`, `BedFitResult` and `fitBed`. If L32 landed, switch
   `bedFitSummary` to `fitBed`, add the row `zone` field and the render tool description
   sentence in `mcp.ts`, and extend `mcp.test.ts` and `ModelPreviewService.test.ts` with an H2D
   case. Tests for every rule in TECHNICAL.md, "Fit".
5. **Setting.** Add `showZones` to `BuildPlateSetting` and the defaults; if L33 landed, add it to
   `BuildPlateSettingUpdate`. Decode-default test.
6. **Web helpers.** In `buildPlate.ts` extend `Plate` and `resolvePlate`, add `fitPlate` and
   `describeZoneFit`; update `buildPlate.test.ts`.
7. **Viewport.** Add `viewer/zones.ts` and `viewer/zones.test.ts`. Add the optional `strips`
   parameter to `createViewer.setBed`, chaining theme and dispose. Pass strips from
   `ViewerCanvas.tsx:100`. Extend `createViewer.test.ts` with a `setBed` call that has strips and
   one that removes them, asserting the bed group's child count and that dispose runs.
8. **Part and status bar.** `PlateFit` strips; fit card on `fitPlate` and `describeZoneFit`;
   L32's list rows (if present) use the short form; `ModelPanel.tsx:695` uses `fitPlate`.
9. **Bed menu and settings.** Switch and legend in `BedPicker.tsx`, switch in
   `SettingsSection.tsx`, `.model-zone-swatch` in `workspace.module.css`. Check both themes, the
   narrow sheet layout and a connection without settings permission.
10. **Docs.** In `docs/fork/user/model-preview-3d.md`, add two sentences to the Bed menu
    paragraph (lines 9-12): on the H2D and H2C the tinted strips are where only one nozzle
    reaches, and the fit text says which nozzles can print the part; "Show nozzle zones" turns
    the tint off. Update this packet's Status and the index row.

Commit message: `feat(fork-model-nozzle-zones): show H2D and H2C nozzle reach and fit by zone`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- With the H2D selected, the plate shows tinted strips X 0 to 25 and X 325 to 350 (left and
  right in the front view); with the H2C, X 0 to 25 and X 325 to 330. Other beds are plain.
- Part's top view shows the same strips.
- On the H2D: a 250 x 250 x 100 mm box says it fits with either or both nozzles; a
  310 x 310 x 100 mm box fits either nozzle, not both; a 200 x 200 x 323 mm box fits the right
  nozzle only; a 340 x 200 x 100 mm box fits only with the same filament in both nozzles; a
  340 x 200 x 324 mm box is 4.0 mm too tall.
- On the H2C: a 310 x 310 x 100 mm box fits the left nozzle only.
- "Show nozzle zones" off removes the strips and swatches but keeps the zone fit text; it
  persists across reload and a second client.
- With L32, `loom_model_preview_3d_render` returns `zone` on the H2D and H2C rows with the same
  answers.
- The preset notes match PRODUCT.md.
