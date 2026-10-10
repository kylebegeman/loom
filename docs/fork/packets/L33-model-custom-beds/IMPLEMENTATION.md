# L33 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, MODEL-3D-FOLLOW-UPS.md and this
folder. Kyle must have approved the schema change (PRODUCT.md, "Decisions needed from Kyle").
Start the branch from `main` once `feat/model-bed-picker` has merged, otherwise from that branch
(`8676e099e5`). If `packages/contracts/src/fork/model-beds.ts` exists, L32 or L34 landed first
and step 1 is done.

## Steps

1. **Bed module (skip if `model-beds.ts` exists).** Do L32 IMPLEMENTATION.md steps 1 and 2
   (move the bed definitions; add `listBeds`, `activeBed`, `selectBed`; route `buildPlate.ts`
   and the two direct note reads through them). Commit the move on its own:
   `refactor(fork-model-custom-beds): keep bed data in one contracts module`.
2. **Schema.** In `model-beds.ts` add `CUSTOM_BED_LIMIT`, `CustomBedId`, `CustomBed`, the three
   new `BuildPlateSetting` fields with decoding defaults, and `BuildPlateSettingUpdate`. In
   `model-preview-3d.ts` add `ModelPreviewSettingsUpdate`, use it as the `updateSettings`
   payload (`:390`) and extend `DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate`. Add contracts tests
   for decoding old settings and for the limits.
3. **Helpers.** Extend `listBeds`, `activeBed` and `selectBed` for named beds and hidden presets.
   Add `addCustomBed`, `updateCustomBed`, `removeCustomBed`, `setPresetHidden`,
   `newCustomBedId` and `customBedNameError`. Test each.
4. **Server.** `ModelPreviewService.updateSettings` (`:973-982`) takes
   `ModelPreviewSettingsUpdate` and merges `buildPlate` with the stored value. Change the MCP
   save tool's parameter (`mcp.ts:144`) and description. Add the service and MCP tests.
5. **Labels.** In `buildPlate.ts` rename the slot to "Custom size" (`:18`, `:33-35` move into
   `listBeds`), and update the aria labels that say "Custom bed" for the size fields
   (`BedPicker.tsx:94`, `SettingsSection.tsx:223`) to "Custom size".
6. **Bed menu.** In `BedPicker.tsx`: radio values are bed ids through `selectBed`; `CustomSize`
   edits whichever custom bed is active; add "Save as bed" for the slot and the "Manage beds"
   link; extend `samePlate`. In `ModelInspector.tsx`'s `PrinterMenu` use `selectBed` and the new
   link label.
7. **Settings.** Add `ManageBeds.tsx` and render it in `SettingsSection.tsx` in place of the
   custom size block (`:217-243`). Use the `Switch`, `Input`, `Checkbox` and `Button` variants
   from `components/ui` without restyling. Disable "Save settings" on a name error. Check light
   and dark themes and a narrow settings width.
8. **Docs.** In `docs/fork/user/model-preview-3d.md`, extend the Bed menu paragraph (lines 9-12)
   with two sentences: save a custom size as a named bed, and hide presets in Loom settings under
   Beds. Update this packet's Status and the index row.

Commit message: `feat(fork-model-custom-beds): save named beds and hide unused presets`.

## Done when

The definition of done in [CONVENTIONS.md](../CONVENTIONS.md#definition-of-done), plus:

- Settings saved before this packet load unchanged: same bed, same custom size, no named beds,
  nothing hidden.
- A custom size saved as "Laser" appears under Custom in the Bed menu, Part's printer menu and
  settings, survives a reload and a second client, and selecting it changes the plate.
- Resizing the active named bed from the Bed menu persists; renaming in settings changes every
  label after "Save settings".
- Deleting the active named bed in settings shows Bambu Lab H2D in the Bed row; after "Save
  settings" the plate is the H2D.
- Hiding every printer except the H2D and H2C leaves those two plus surfaces and Custom in the
  menus; the active preset's switch is disabled with "In use".
- `loom_model_preview_3d_save_settings` with the settings shape from before this packet (no new
  fields) keeps every named bed and hidden preset.
- An agent can add a named bed and select it in one save.
