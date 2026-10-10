# L33 references

## Old Loom

No old Loom equivalent. The single custom size comes from L23 and commit `8676e099e5`.

## Loom source this packet builds on

- `packages/contracts/src/fork/model-preview-3d.ts:221-238`: `BuildPlatePresetId` and
  `BuildPlateSetting` with `customMm`.
- `packages/contracts/src/fork/model-preview-3d.ts:390`: `updateSettings` RPC.
- `apps/server/src/fork/model-preview-3d/store.ts:13`, `:46-58`: settings stored as one JSON row
  decoded with the schema.
- `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:972-983`: `getSettings` and
  `updateSettings`.
- `apps/server/src/fork/model-preview-3d/mcp.ts:142-150`, `:438-449`: the settings tools.
- `apps/web/src/fork/model-preview-3d/BedPicker.tsx:44-113`: optimistic save and custom size
  fields.
- `apps/web/src/fork/model-preview-3d/SettingsSection.tsx:35`, `:184-243`: form validation and
  the bed controls.
- L32 TECHNICAL.md, "Bed list in contracts": `listBeds`, `activeBed`, `selectBed`.

## Library behaviour

- Effect Schema strips unknown keys when decoding by default (`onExcessProperty: "ignore"`,
  `.repos/effect-smol/packages/effect/src/SchemaAST.ts:463`). This is why an older server drops
  the new fields instead of failing, and why `customBedId` is a separate field.
- `Schema.optionalKey` (`.repos/effect-smol/packages/effect/src/Schema.ts:2317`) leaves a missing
  key absent after decoding, so the server's spread keeps stored values.

## External

- Slicers keep user printer profiles beside vendor ones and let users hide vendor printers from
  the printer list (Bambu Studio and OrcaSlicer "Printer selection"). Background for the shape of
  this feature; not verified against current versions. No code or assets are reused, so no
  licence applies.
