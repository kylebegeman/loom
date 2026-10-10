# L51 references

## Old Loom

None. Old Loom had no printer data; the 3D panel itself is new in L23.

## Loom today

- Bed presets and setting: `packages/contracts/src/fork/model-preview-3d.ts:141-238`.
- Web bed helpers: `apps/web/src/fork/model-preview-3d/buildPlate.ts:1-52`.
- Settings storage: `apps/server/src/fork/model-preview-3d/store.ts:46-62`,
  `migrations.ts:28`.
- Editable library precedent (versioned value, starter data, conflict message):
  `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1319-1331`,
  `packages/contracts/src/fork/pcb-workspace.ts:277-286`.
- Shared bed list and custom beds: L32 TECHNICAL.md ("Bed list in contracts"), L33
  TECHNICAL.md ("Contracts"). Nozzle zones: L34 README.md and PRODUCT.md.

## Upstream T3 Code

- Effect Schema strips unknown keys on decode, which is why dropping L33 fields from the
  update payload is safe: `.repos/effect-smol/packages/effect/src/SchemaAST.ts:463` (as cited
  by L33).
- Download pattern: `apps/web/src/components/media/mediaContent.ts:29-39`.

## Profile formats (verified)

- **Bambu Studio machine profiles**, read on Kyle's Mac from Bambu Studio 02.08.04.57
  (profile set `BBL.json` version 02.08.00.09) at
  `/Applications/BambuStudio.app/Contents/Resources/profiles/BBL/machine/`:
  - `Bambu Lab H2D 0.4 nozzle.json` inherits `fdm_bbl_3dp_002_common`, which inherits
    `fdm_machine_common`. Merged: `printable_area` `["0x0","350x0","350x320","0x320"]`,
    `printable_height` `"325"`, `nozzle_diameter` `["0.4","0.4"]`, `bed_exclude_area` `[]`,
    `extruder_printable_area` `["0x0,325x0,325x320,0x320","25x0,350x0,350x320,25x320"]`,
    `extruder_printable_height` `["320","325"]`.
  - H2C: `printable_area` 330 wide; `extruder_printable_area`
    `["0x0,325x0,325x320,0x320","25x0,330x0,330x320,25x320"]`.
  - X1, X1 Carbon, X1E, P1P and P1S: `bed_exclude_area` `["0x0","18x0","18x28","0x28"]`.
  - `Bambu Lab H2D.json` (the machine model) lists nozzle sizes `"0.4;0.2;0.6;0.8"` and
    `model_id` `"O1D"`.
  - Updated profiles also live in `~/Library/Application Support/BambuStudio/system/BBL`
    (version 02.08.00.06 on Kyle's Mac, older than the app bundle's). Readers pick the higher
    `version` in each vendor's index JSON.
  - User presets live in `~/Library/Application Support/BambuStudio/user/<id>/machine/`. They
    store only changed keys plus `inherits`, so they must be flattened.
- **Bambu Studio CLI wiki** says configs passed on the command line must be full, not
  inherited: <https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage>.
- **PrusaSlicer config keys**, from `src/libslic3r/PrintConfig.cpp` at tag `version_2.9.6`:
  `bed_shape` (points, default `0x0,200x0,200x200,0x200`, line 404), `max_print_height`
  (line 453), `nozzle_diameter` (line 2495), `printer_model` (line 2653), `filament_density`
  (line 1485), `filament_type` (line 1494), `filament_cost` (line 1535).
  <https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/src/libslic3r/PrintConfig.cpp>
- **OrcaSlicer** is a Bambu Studio fork and is expected to use the same machine keys
  (`printable_area`, `printable_height`, `nozzle_diameter`). Unverified here: Orca is not
  installed on Kyle's Mac. Check one Orca machine profile before shipping the Orca branch of
  the parser. Orca 2.4.2 does not follow `inherits` for CLI configs (OrcaSlicer issue #14718,
  per the Fabrication research, not re-checked here).

## Built-in material numbers

From Bambu Studio 02.08.04.57's generic filament chain (`Generic <type> @base` →
`fdm_filament_<type>` → `fdm_filament_common`), merged leaf over parent:

| Type | `filament_density` | `nozzle_temperature_range_low`/`high`           | `hot_plate_temp` |
| ---- | ------------------ | ----------------------------------------------- | ---------------- |
| PLA  | 1.24               | 190 / 240 (from common)                         | 55               |
| PETG | 1.27               | 220 / 270 (`Generic PETG @base` overrides high) | 70               |
| ABS  | 1.04               | 240 / 280                                       | 90               |
| ASA  | 1.04               | 240 / 280                                       | 100              |
| TPU  | 1.24               | 200 / 250                                       | 35               |

Bambu's `filament_cost` defaults (20 or 30) are placeholders without a currency, so Loom does
not copy them.

## Fabrication app (research, not a dependency)

- Planned `printers` and `materials` tables:
  `~/Developer/docs/apps/fabrication/ARCHITECTURE.md:221-240` and `:342-357`.
- Material tool shape: `~/Developer/docs/apps/fabrication/MCP.md:320-321`.
- Built-in preset ids (`bambu-h2d`, `bambu-h2c`, `anycubic-kobra-s1`) match Loom's.

## Licences

No code is reused. Bambu Studio and OrcaSlicer are AGPL-3.0 and PrusaSlicer is AGPL-3.0;
Loom only reads profile values (numbers) from files on the user's machine and ships a handful
of facts (bed sizes, densities) as data, not their files. Do not copy profile files into the
repository; test fixtures are trimmed to the keys the parser reads and written by hand from
the values above.
