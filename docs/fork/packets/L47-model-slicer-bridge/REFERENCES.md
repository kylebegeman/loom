# L47 references

"Verified" means read on 2026-10-10 from the installed app on Kyle's Mac or from the slicer's
source at the cited tag or branch. "Unverified" items must be checked before the step that
relies on them is finished (IMPLEMENTATION.md, steps 4, 14 and 15).

## Old Loom

None. Old Loom had no slicing; the 3D panel itself is new in L23.

## Loom today

- OpenSCAD run, timeout and truncated output:
  `apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:469-487`.
- Render jobs and interruption: `ModelPreviewService.ts:587-622`. Output protection:
  `:135-139`. Signing: `:179-202`. Status probe and cache: `:268-322`.
- Mesh transform through an OpenSCAD wrapper: `ModelPreviewService.ts:1153-1160`.
- Streaming 3MF reading with `yauzl`: `apps/server/src/fork/model-preview-3d/threeMfUnits.ts`.
- Cache pruning: `apps/server/src/fork/model-preview-3d/renderCache.ts:27-39`.
- Opening a host app, Mac only:
  `apps/server/src/fork/apple-build-tooling/AppleBuildService.ts:1524-1531`;
  local desktop check: `apps/web/src/fork/apple-build-tooling/AppleBuildPanel.tsx:69-70`.

## Upstream T3 Code

- Detached spawn options and `launchAndUnref`:
  `apps/server/src/process/externalLauncher.ts:96-101`, `:692-705`.
- Terminal scope for host launches: `packages/contracts/src/auth.ts:90`,
  `packages/contracts/src/fork/clientRpcPermissions.ts:43`.

## Bambu Studio (verified)

- Installed version 02.08.04.57 at `/Applications/BambuStudio.app/Contents/MacOS/BambuStudio`;
  `Contents/Info.plist` is XML with `CFBundleShortVersionString`.
- `--help` on that build lists, with these meanings: `--datadir` ("Use and store all program
  settings at the given directory instead of the default"), `--slice` (0 for all plates, i for
  plate i), `--load-settings "machine.json;process.json"`, `--load-filaments`,
  `--load-filament-ids`, `--outputdir`, `--export-3mf`, `--export-slicedata`, `--min-save`,
  `--mstpp` (maximum slicing time per plate), `--no-check`, `--pipe`, `--arrange` and
  `--orient` (0 disable, 1 enable), `--ensure-on-bed`, `--info`, `--debug` (0 to 5),
  `--uptodate`, `--allow-newer-file`.
- Official CLI page, which says settings files must be full configs rather than files that
  `inherit`: <https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage>.
- System profiles: the app bundle's `Contents/Resources/profiles/BBL.json` is version
  02.08.00.09; `~/Library/Application Support/BambuStudio/system/BBL.json` is 02.08.00.06. The
  index has `machine_model_list`, `machine_list`, `process_list` and `filament_list` entries of
  `{ name, sub_path }`. `user/default/{machine,process,filament}` is empty on Kyle's Mac.
- `Bambu Lab H2D 0.4 nozzle` inherits `fdm_bbl_3dp_002_common`, with `from: "system"`,
  `instantiation: "true"` and `printer_model: "Bambu Lab H2D"`. The machine model
  `Bambu Lab H2D.json` has `nozzle_diameter "0.4;0.2;0.6;0.8"` and `model_id "O1D"`.
- Preset names used for the suggested mappings exist: `0.20mm Standard @BBL H2D`, `H2C`, `X1C`,
  `A1M`; `Bambu PLA Basic @BBL H2D`, `H2C`, `X1C`, `A1M`; machines `Bambu Lab H2C 0.4 nozzle`,
  `Bambu Lab X1 Carbon 0.4 nozzle`, `Bambu Lab A1 mini 0.4 nozzle`. `Bambu PLA Basic @BBL H2D`
  has `compatible_printers ["Bambu Lab H2D 0.4 nozzle"]`.
- Generic filament `filament_cost` values are 20 or 30 with no currency, so Loom treats them as
  absent unless the user's own preset changes them.
- 3MF metadata names, from `src/libslic3r/Format/bbs_3mf.cpp` on `master`
  (<https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp>):
  file `Metadata/slice_info.config`; plate keys `prediction`, `weight`, `outside`,
  `support_used`, `printer_model_id`, `nozzle_diameters`; `<filament>` attributes `id`,
  `type`, `color`, `used_m`, `used_g`; `<warning>` with `msg`. The `level` and `error_code`
  warning attributes were not found in that file (unverified; read them if present).
- G-code totals, from `src/libslic3r/GCode/GCodeProcessor.cpp` on `master`:
  `; model printing time: %s; total estimated time: %s`, `; total layer number: %zd`, and the
  `total filament weight [g]`, `total filament volume [cm^3]`, `total filament length [mm]`
  labels written as `; <label> : a,b`. Reserved tags include `FEATURE:`, `LAYER_HEIGHT:`,
  ` CHANGE_LAYER`, ` WIPE_START`, ` WIPE_END`.
- Feature names, from `ExtrusionEntity::role_to_string` in
  `src/libslic3r/ExtrusionEntity.cpp` on `master`: "Inner wall", "Outer wall",
  "Overhang wall", "Sparse infill", "Internal solid infill", "Top surface", "Bottom surface",
  "Bridge", "Gap infill", "Skirt", "Brim", "Support", "Support interface",
  "Support transition", "Prime tower", and others mapped to `other`.

## Bambu Studio (unverified)

- That a flattened profile with `from: "User"` and `instantiation: "true"` is accepted by
  `--load-settings`, and that `--datadir` pointing at an empty folder is enough for a slice.
  The Fabrication research found prior art that flattens presets
  (<https://github.com/voska/bambu>, small and unvetted). Check with the first real slice.
- The `; HEADER_BLOCK_START` and `; Z_HEIGHT:` comments; the design does not depend on them.
- Linux and Windows paths for the executable and data folder.

## OrcaSlicer (unverified, not installed on Kyle's Mac)

- 2.4.2 (2026-07-07) shares Bambu Studio's flags, including `--load-settings`,
  `--load-filaments`, `--outputdir`, `--arrange`, `--orient` and `--datadir`. Documented at
  <https://www.orcaslicer.com/wiki/cli/cli_mode>.
- 2.4.2 does not follow `inherits` for CLI configs (issue #14718; the fix merged after 2.4.2),
  and user presets inheriting user presets still fail (#15604). Flattening in Loom avoids both.
- A clean exit with the wrong printer's G-code (#15450) is why every result is verified.
- Other known CLI issues: a crash with filament slot above 1 on single-extruder profiles
  (#15632) and error -100 on very dense meshes (#15786).
- These come from the Fabrication research
  (`~/Developer/docs/apps/fabrication/REFERENCES.md`, "OrcaSlicer"), not re-checked here.

## PrusaSlicer

- Verified, at tag `version_2.9.6`: G-code reserved tags `TYPE:`, `HEIGHT:`, `WIDTH:`,
  `LAYER_CHANGE`, `WIPE_START`, `WIPE_END` (`src/libslic3r/GCode/GCodeProcessor.cpp`), and the
  role names "Perimeter", "External perimeter", "Overhang perimeter", "Internal infill",
  "Solid infill", "Top solid infill", "Ironing", "Bridge infill", "Gap fill", "Skirt/Brim",
  "Support material", "Support material interface", "Wipe tower", "Custom"
  (`src/libslic3r/ExtrusionRole.cpp`).
  <https://github.com/prusa3d/PrusaSlicer/tree/version_2.9.6>
- Verified: the `binary_gcode` printer option exists (`PrintConfig.cpp`).
- Unverified (Fabrication research): the CLI actions `--export-gcode`, `--load`,
  `--output`, `--datadir`; presets by name since 2.8 with `--printer-profile`,
  `--print-profile` and `--material-profile`, which resolve against vendor bundles in
  `--datadir`; `--binary-gcode 0` on the command line; the footer lines
  `; filament used [g] =`, `; total filament used [g] =`, `; filament cost =` and
  `; estimated printing time (normal mode) =`.
- Pointing `--datadir` at the GUI's own folder is avoided because of a reported datadir
  corruption issue (#15693, per the Fabrication research). That is why v1 uses an exported
  config instead of named presets.
- 3.0.0 alpha rewrites CLI parsing (Fabrication research); `supported` stays false for 3.x
  until tested.

## Fabrication app (research, not a dependency)

- Slicing pipeline and output parsing: `~/Developer/docs/apps/fabrication/ARCHITECTURE.md:103`.
- Slicer facts and issues: `~/Developer/docs/apps/fabrication/REFERENCES.md`, "Slicers".

## Licences

Bambu Studio, OrcaSlicer and PrusaSlicer are AGPL-3.0. Loom runs them as separate programs the
user installed and reads their output files and profile values; no slicer code is copied, and
the role-name and metadata-key tables are facts about file formats. Test fixtures are written
by hand with only the keys the parser reads; do not copy profile files or sliced output from a
slicer into the repository.
