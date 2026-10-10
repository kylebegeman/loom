# L33 product

## Problem

Kyle compares parts against more than one non-preset bed (a friend's printer, a cutting mat, a
laser bed), but the environment remembers only one custom size, so switching between them means
retyping numbers. The Bed menu also lists every preset, most of which he does not own, which
makes the menu long in a small viewport popover.

## What the user can do

- Save the current custom size as a named bed: "Save as bed", type a name, Enter.
- Pick any named bed from the Custom group in the viewport Bed menu, Part's printer menu or
  settings, like a preset.
- Change the size of the active named bed from the Bed menu, the same way the custom size is
  edited today.
- In Loom settings, under "Beds": add a custom bed, rename it, change its width, depth and height
  (or tick "No height limit" for a flat surface), and delete it.
- Hide presets he never uses. Hidden presets disappear from every bed menu and from the fit list
  (L32); show them again from the same switches.
- Keep using "Custom size" as a quick scratch size that is never named.

## Entry points

| Way in                                                   | Way out                                                            | How the state shows                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Bed menu, Custom size, "Save as bed"                     | Delete the bed in settings                                         | The bed appears under Custom in every bed menu.                   |
| Settings, Beds, "Add custom bed"                         | Delete button on the row; nothing is removed until "Save settings" | The row in settings; the menus.                                   |
| Rename (settings row name field)                         | Rename again                                                       | Menu labels, the Bed trigger label.                               |
| Resize (Bed menu fields for the active bed, or settings) | Resize again                                                       | Size beside the name in menus; the plate.                         |
| Hide a preset (settings switch)                          | Turn the switch back on                                            | The preset is missing from menus; settings shows it switched off. |
| Bed menu, "Manage beds"                                  | Back to the panel                                                  | Opens Loom settings.                                              |

Agents can do all of this with `loom_model_preview_3d_save_settings`; see TECHNICAL.md.

## States

- Empty: no custom beds. Custom shows only "Custom size"; settings shows "No custom beds yet."
  above "Add custom bed".
- Limit: at 24 custom beds, "Add custom bed" and "Save as bed" are disabled with
  "Up to 24 custom beds."
- Invalid input: a size outside 10 to 2000 mm or an empty name marks the field invalid and does
  not save, as the custom size fields do today (`BedPicker.tsx:72-87`).
- Saving and failure: menu actions save at once with the existing optimistic pattern and the
  "Bed not changed" toast on failure (`BedPicker.tsx:44-69`). Settings edits save with "Save
  settings", as every other 3D setting does.
- Disabled: without permission to change model settings, menus are read-only with the existing
  tip, and the settings controls are disabled.
- Active bed hidden: the active preset's switch is disabled with "In use". If settings arrive
  with the active preset hidden anyway (another device or an agent), menus still list it, so the
  current choice is always visible; it disappears once another bed is chosen.
- Active bed deleted: the Bed row in settings switches to the default bed (Bambu Lab H2D) at
  once, so the effect is visible before "Save settings". Leaving settings without saving keeps
  the bed.
- Stale reference: if `customBedId` names a bed that no longer exists, the plate falls back to
  "Custom size" and the menus show that.

## Surfaces and connection modes

Web and desktop. Mobile has no 3D settings or panel. Remote connections use the same settings
RPC. An older Loom server that lacks this packet keeps working with the custom size only: it
drops the new fields, so named beds are not saved there (see TECHNICAL.md, "Version skew").

## Decisions

- Keep `customMm` as the unsaved "Custom size" slot instead of migrating it into a named entry.
  No migration, nothing changes for existing settings or older clients, and a scratch size is
  useful on its own.
- Rename the slot's label from "Custom" and "Custom bed" to "Custom size" everywhere, so it reads
  differently from named beds.
- A named bed may have no height limit (a flat surface), matching presets' surfaces.
- Deleting the active bed selects the default bed rather than refusing the delete. Deleting
  happens only in settings, so "Save settings" is the confirmation and no Undo toast is needed.
- The active preset cannot be hidden; the switch says why.
- Presets cannot be renamed or edited: they are vendor data, and L51 is where printers become
  editable.
- Custom beds keep insertion order in menus; "Custom size" is always last.
- Limits: 24 custom beds, names 1 to 60 characters (trimmed; duplicate names refused
  case-insensitively in the UI), sizes 10 to 2000 mm per axis like `customMm`.
- Saves merge: the update payload treats missing new fields as "keep what is stored", so an
  older client or an agent sending the old settings shape cannot erase custom beds.

## Decisions needed from Kyle

1. **Approve the settings schema change.** Three new fields on the bed setting with decoding
   defaults, and an update payload whose new fields are optional and merged on the server.
   Recommended: approve as designed. Nothing is migrated; old saved settings decode unchanged.
2. **What deleting the active custom bed selects.** Recommended: the default bed (H2D), with the
   change shown in the Bed row before saving. The alternative is "Custom size" with the deleted
   bed's footprint, which keeps the plate unchanged but cannot represent a bed with no height
   limit.
