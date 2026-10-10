# L51 product

## Problem

Beds in Loom are whatever ships in the code. A printer that is not in the table, a second
nozzle size, or a different material can only be approximated with a custom size, and
nothing knows what a printer can actually print with. L47 needs a material's density and price
to turn filament length into grams and cost, L34's nozzle zones are fixed to two presets, and
Kyle's own printers are spread between the preset table and settings. One editable list of
printers and materials fixes all of that.

## What the user can do

- Open Loom settings, 3D models, and see "Printers": every built-in printer and surface and
  every entry they added, grouped Printers and Surfaces, each with its size and nozzle sizes.
- Add a printer or surface with a name, width, depth, height (or "No height limit" for a
  surface), bed shape (rectangle or round), nozzle sizes, the materials it prints, optional
  nozzle zones and notes.
- Duplicate any entry, including a built-in, to start from its numbers. Edit or delete their
  own entries. Built-ins are read-only; they can be hidden from menus and shown again.
- "Import printer profile": pick a Bambu Studio or OrcaSlicer machine profile (`.json`) or a
  PrusaSlicer config (`.ini`). Loom reads the bed size, height, nozzle size, round beds and,
  for the H2D and H2C, the nozzle zones, then opens the new entry for review before saving.
- Keep a list of materials: name, type (PLA, PETG and so on), brand, colour, density and
  cost per kilogram, plus nozzle and bed temperature ranges for reference. Five generic
  built-in materials (PLA, PETG, ABS, ASA, TPU) are there from the start with no price.
- Mark which materials a printer uses, and which one is its default.
- "Export library" saves one `.json` file with every user printer and material; "Import
  library" merges such a file back, on this or another environment.
- Pick any printer as the bed from the existing bed menus, Part's printer menu and settings.
  The viewport, fit check, L32's fit list and the status bar follow, as they do today.
- Ask an agent to add or adjust a printer or material through
  `loom_model_preview_3d_save_printers`, or read the library with
  `loom_model_preview_3d_printers`.

## Entry points

| Way in                                                          | Way out                                                              | How the state shows                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Loom settings, 3D models, "Printers"                            | Leave settings                                                       | The list, with a "Built in" or "Imported" tag per row.                                  |
| "Add printer" or "Add surface"                                  | "Cancel" in the editor, or delete the entry                          | New row; it is selectable in bed menus once saved.                                      |
| "Duplicate" on any row                                          | Delete the copy                                                      | Copy named "<name> copy", tagged as yours.                                              |
| "Edit" on a user row                                            | "Cancel"                                                             | Editor with the saved values.                                                           |
| "Delete" on a user row                                          | "Undo" in the toast for 10 seconds, or re-import an export           | Row gone. Deleting the active bed selects the default bed first.                        |
| "Hide" on a built-in                                            | "Show" on the same row (hidden rows stay listed in settings, dimmed) | Gone from bed menus; still listed in settings.                                          |
| "Import printer profile"                                        | "Cancel" in the review step                                          | Editor pre-filled, tagged "Imported from Bambu Studio" (or Orca or Prusa).              |
| "Export library" / "Import library"                             | Delete imported entries                                              | A summary toast: "Imported 3 printers and 2 materials. 1 already existed and was kept." |
| Bed menus and Part's printer menu                               | Pick another bed                                                     | Active bed checked, as today.                                                           |
| "Manage printers" link at the bottom of the Bed menu            | Back to the panel                                                    | Opens Loom settings at Printers.                                                        |
| Agent: `loom_model_preview_3d_printers` and `..._save_printers` | Same tools                                                           | The settings list reloads on the next open, or shows the conflict message below.        |

## States

- Loading: "Loading printers" (the existing `OperationStatus` line) while the library loads.
  Bed menus keep showing the built-ins until it arrives, so they never flash empty.
- Empty: built-ins always exist, so the list is never empty. With no user entries the
  "Your printers" group reads "No printers of your own yet. Add one or import a profile."
- Error, load: "Could not load printers." with "Retry"; bed menus fall back to built-ins.
- Error, save conflict: "Printers changed on another client. Reload to see the latest." with
  "Reload". Nothing is overwritten.
- Error, import: "This file is not a printer profile Loom can read." or a specific reason
  ("The profile has no bed size."). The review step never saves a half-read entry.
- Error, validation: field messages on the editor ("Width must be 10 to 2000 mm.").
- Disabled: without permission to change settings, the editor buttons are disabled with the
  existing settings tip; the list is still readable.
- Stale: if the active bed is deleted elsewhere, the bed menus fall back to the default bed
  and Part shows "The selected printer was removed." until another bed is picked.
- Limit: 64 beds in total. "Add printer" is disabled at the limit with "Up to 64 printers and
  surfaces."

## Surfaces and connection modes

Web and desktop share the settings section and bed menus. Mobile has no 3D panel or 3D
settings, so it shows nothing. On a remote environment the library belongs to that
environment host, like the other 3D settings; importing a profile reads the file in the
browser, so the user picks files from the machine they sit at. An upstream T3 server has no
3D model feature, so none of this appears.

## Decisions

- Built-ins stay in code as data, not in storage. Updating Loom can fix a built-in's numbers
  without a migration, and a user who wants different numbers duplicates it.
- Built-in ids are today's preset ids (`bambu-h2d` and so on). Saved settings, workspaces and
  L47 mappings that name them keep working.
- User entries use L33's id form (`custom-<uuid>`) and L33's `customBedId` setting selects
  them. Old custom bed ids keep resolving because the migration keeps them.
- Materials are a separate list that printers reference by id. One PLA price serves every
  printer.
- Cost has no currency in the library. L47 formats it with its currency setting.
- Import reads one profile file at a time and always goes through review. Profiles vary a lot
  between slicer versions; a person should see the numbers before they become a bed.
- The library export format (`loom.printers`, version 1) is camelCase JSON that maps column
  for column onto the Fabrication app's planned printers and materials tables.
- Deleting is undoable for 10 seconds; exports are the long-term backup.

## Decisions needed from Kyle

1. **Where the library is stored.** Recommended: a `printers` row in the fork's existing
   `fork_model_preview_3d_settings` key/value table, next to the settings row, with its own
   version number. It needs no migration, cannot be dropped by an older client saving
   settings, and is backed up with the rest of the environment's state. Alternatives: a
   `printers.json` file under `<stateDir>/fork/model-preview-3d/` (the PCB hardware library
   pattern, easier to hand-edit), or fields inside the settings row (rejected: every settings
   save would carry the whole library, and an older client would drop it).
2. **The bed setting schema change.** Recommended: no new selection field. Built-ins keep
   using `buildPlate.preset`; user entries use `preset: "custom"` plus `customBedId` (added
   by L33, or by L51 exactly as L33 defines it). L33's `customBeds` and `hiddenPresets`
   fields stay in the schema, read once by the migration and then ignored, and are removed
   from the update payload so nothing writes them again. This keeps older clients degrading
   to "Custom size" instead of failing.
3. **Built-in materials.** Recommended: ship PLA, PETG, ABS, ASA and TPU with densities from
   Bambu Studio's generic profiles and no price, so cost shows only once Kyle enters prices.
