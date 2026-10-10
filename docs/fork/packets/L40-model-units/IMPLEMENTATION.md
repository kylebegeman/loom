# L40 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md and this
folder. Start the branch from `main` once `feat/model-bed-picker` has merged, otherwise from that
branch (`8676e099e5`). Rerun the inventory search
(`rg -n "toFixed|\bmm\b|formatVolume|unit=" apps/web/src/fork/model-preview-3d`) and add any
length site that other packets have landed since this packet was written.

## Steps

1. **Setting.** Add `DisplayUnits` and `displayUnits` to `model-preview-3d.ts` with the decoding
   default and the default value; if L33 landed, add the `optionalKey` to
   `ModelPreviewSettingsUpdate`. Update the two MCP descriptions in `mcp.ts`. Add a contracts
   decode test and extend `store.test.ts` with an old settings row.
2. **Units module.** Add `units.ts` with the conversion, formatting, context and
   `useDisplayUnitsSetting`, and `units.test.ts`.
3. **Providers.** Wrap `ModelFile` (`ModelPanel.tsx:90`) and the settings form in
   `DisplayUnitsProvider`. Keep `displayUnits` out of the reload key.
4. **Display sites.** Convert every "After" row in TECHNICAL.md, "Inventory", one file at a time.
   Replace `formatVolume` with `formatLengths` and delete it. Check that
   `rg -n "toFixed\(.*mm|\} mm|>mm<" apps/web/src/fork/model-preview-3d` finds only the
   "Not converted" rows.
5. **Viewer.** Add `setLengthFormat` to `createViewer.ts` and call it from `ViewerCanvas.tsx`.
   Extend `createViewer.test.ts`: a measurement label uses the formatter, and changing it
   requests one render.
6. **Inputs.** Custom bed size fields (Bed menu, settings, and L33's Manage beds if present) and
   the section offset `Scrub`.
7. **Controls.** Units select in settings, `Segmented` in the Bed menu, `"toggle-units"` in
   `actions.ts`, `palette.tsx` and the `onModelAction` handler.
8. **Follow-up packets.** For each landed packet that left a "swap to formatLength" call site
   (L32 `describeFit` callers, L34 legend, and any others), pass `formatLength` with the current
   unit.
9. **Docs.** In `docs/fork/user/model-preview-3d.md`, replace "Dimensions are in millimetres"
   (line 21) with one sentence: lengths show in millimetres or inches, chosen in Loom settings or
   the Bed menu, and agents always work in millimetres. Update this packet's Status and the
   index row.

Commit message: `feat(fork-model-units): show lengths in millimetres or inches`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- With old settings, every length reads exactly as before.
- With inches, a 25.4 mm cube shows "1.00 × 1.00 × 1.00 in" in the status bar, Part shows
  "1.00 in" per axis, and a measurement across it reads "1.000 in" in the row and "1.00 in" in
  the viewport label and in a capture.
- The Bed menu lists the H2D as "13.78 × 12.6 × 12.8 in" and Letter as "11 × 8.5 in".
- Typing 12 in as a custom width stores 304.8 mm (check with `loom_model_preview_3d_settings`)
  and shows 12 in again; 0.3 in is refused.
- The section offset field steps by 0.02 in, and the stored section offset is in mm.
- Switching units from the Bed menu updates the whole panel at once; from the palette it toggles
  with a toast; a failed save reverts with "Units not changed".
- No tool input or output changed shape, and every value an agent receives is in mm.
