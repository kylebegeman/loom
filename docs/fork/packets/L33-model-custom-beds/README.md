# L33: Named custom beds and a shorter bed menu

Status: Implemented locally (`feat/model-orientation-sections-print-check`).

Approved by Kyle on 2026-10-10.

Today the environment has one custom bed size, and the Bed menu always lists fourteen presets.
This packet lets Kyle save several named custom beds (a printer that is not a preset, a desk mat,
a laser bed) with their own width, depth and optional height, pick them from the Custom group in
every bed menu, and edit, rename or delete them. A "Beds" area in Loom settings also hides
presets he never uses, so the menus list only his printers and surfaces. The unsaved "Custom size"
stays as a scratch slot, so old settings load untouched.

## Scope

- In:
  - `customBeds` (up to 24 named beds), `customBedId` (which named bed is active) and
    `hiddenPresets` on the bed setting, all with decoding defaults; `customMm` kept as the
    "Custom size" slot.
  - Pure helpers in `model-beds.ts` to list, select, add, update, remove and hide beds.
  - Bed menu: named beds under Custom, size editing for the active custom bed, "Save as bed"
    from Custom size, a "Manage beds" link.
  - Settings, "Beds": show or hide each preset, add, rename, resize and delete custom beds.
  - A merge-on-save update payload so a client or agent that does not know the new fields never
    erases them.
- Out:
  - Editing or renaming presets (they are vendor data; L51 makes printers editable).
  - Per-bed patterns, nozzle zones on custom beds (L34 covers presets; L51 covers editable
    zones), sharing beds across environments.
  - Mobile UI.

## Surfaces

- Web and desktop: supported, in the viewport Bed menu, Part's printer menu and Loom settings.
- Mobile: not supported. Mobile has no 3D panel or 3D settings.
- Remote: works on every connection mode; everything is the existing settings RPC.
- Upstream T3 server: no 3D panel or settings section, as today.

## Extension points used

None new. Reuses L23's `ext-settings` registration (the 3D model section), `ext-panels` and
`ext-mcp` (the settings tools).

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L32 (bed fit): with it, the "Which beds fit?" list and the agent summary include named custom
  beds and leave out hidden presets. Without it, nothing else changes. Whichever of L32, L33 or
  L34 lands first creates `packages/contracts/src/fork/model-beds.ts` (L32 TECHNICAL.md, "Bed
  list in contracts").
- L34 (nozzle zones): zones live on presets. Custom beds have none; hiding the H2D hides its zones
  with it.
- L40 (units): with it, custom bed sizes are shown and typed in the display unit and stored in
  millimetres. Without it, millimetres.
- L51 (printer library): replaces where beds come from. It must import every `customBeds` entry
  with the same id (so `customBedId` stays valid) and honour `hiddenPresets`.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
