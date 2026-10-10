# L47 product

## Problem

Kyle designs parts with an agent in Loom and then opens Bambu Studio to find out whether a
change made the print an hour longer or doubled the support. That round trip breaks the loop
the 3D panel is built for, and an agent comparing variants has no idea what any of them cost
to print. The slicer is already installed; Loom should ask it.

## What the user can do

- See "Print" in the Part tab with a headline like "4 h 12 m, 38 g PLA" and the details: print
  time, filament length and weight per filament, support (an estimate, or "None"), layers,
  and cost when the material has a price.
- Click "Estimate print" (or ask an agent) to slice the current part with the active bed's
  profiles. Cached estimates for the same geometry, orientation and profiles appear without
  slicing again.
- Cancel a slice in progress.
- See the slicer's warnings, for example "Some objects are outside the plate" or a nozzle
  area message on the H2D.
- Press `Y` or click "Show layers" to replace the part with its sliced extrusion paths, drag
  the layer slider (or use the arrow keys on it) to step through layers, and read
  "Layer 120 of 210, Z 24.20 mm". Press `Y` again or "Hide layers" to return.
- On the desktop app connected to its own environment, click "Open in Bambu Studio" (or the
  mapped slicer) to open the sliced project there. In a browser or a remote client, click
  "Download 3MF" instead.
- In Variants, see a print time beside each variant that has one, and click "Estimate print
  times" to slice the visible variants one after another.
- In Loom settings, 3D models, "Slicing": see which slicers were found and their versions,
  set a path when one is not detected, set the slice timeout and the currency for costs, and
  map each printer to a slicer and its printer, process and filament profiles. Bambu printers
  offer "Use Bambu Studio defaults".

## Entry points

| Way in                                                                                               | Way out                                                              | How the state shows                                                                                   |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Estimate print" in Part, Print                                                                      | "Cancel" while slicing                                               | `OperationStatus` "Slicing with Bambu Studio" with elapsed time, then the result.                     |
| Command palette "3D model: Estimate print"                                                           | Same "Cancel"                                                        | As above.                                                                                             |
| Agent: `loom_model_preview_3d_slice`                                                                 | The agent's turn ends or is stopped; the slice is interrupted        | Result appears in Part for the same file when it finishes (it is cached).                             |
| `Y`, "Show layers" in Print, palette "3D model: Show or hide sliced layers", editor command `layers` | `Y`, "Hide layers", `Escape`, the same palette entry, editor command | Slider and layer label at the bottom of the viewport; the Print section's button reads "Hide layers". |
| "Open in Bambu Studio" (local desktop only)                                                          | Close the slicer                                                     | Toast "Opened in Bambu Studio."                                                                       |
| "Download 3MF"                                                                                       | None needed                                                          | Browser download.                                                                                     |
| "Estimate print times" in Variants                                                                   | "Cancel" in the same bar                                             | Each variant shows "Slicing", then its time.                                                          |
| Loom settings, 3D models, Slicing                                                                    | Clear a mapping with "Remove"                                        | Each printer row shows its slicer and profiles, or "Not set up".                                      |
| "Set up slicing" link in Print when the bed has no mapping                                           | Back to the panel                                                    | Opens settings at Slicing.                                                                            |

## States

- Loading: the cached estimate is fetched when Part opens; until then Print shows nothing
  rather than a spinner, so the tab does not jump.
- Not set up: "Choose a slicer profile for Bambu Lab H2D to estimate print time." with
  "Set up slicing".
- Surface bed: "Print estimates need a printer. Choose one in the Bed menu."
- Slicer missing: "Bambu Studio was not found on this host. Set its path in Loom settings."
- Unsupported file: "Slicing needs an STL, 3MF, OBJ or OpenSCAD file." (GLB and glTF), and
  for STEP without L50, "Slicing STEP needs the Python CAD setup."
- In progress: `OperationStatus` with elapsed time and "Cancel". Other panel actions stay
  usable; only one slice per file runs, and a new request replaces the old one.
- Error: the slicer's reason when it gives one ("Slicing failed: the profile is for a 0.4 mm
  nozzle but the printer has 0.6 mm."), otherwise "The slicer exited without a result." with
  the last log lines under "Slicer log". Timeouts read "Slicing took longer than 5 minutes.
  Raise the timeout in Loom settings."
- Wrong result: when the output names a different printer than the mapping (a known slicer bug
  where the CLI exits cleanly with the wrong printer), the result is discarded with "The slicer
  used a different printer than the mapping. Check the profiles in Loom settings."
- Stale: when the geometry, orientation or mapping changes, the last result stays visible,
  dimmed, with an "Out of date" chip and "Estimate again". Layers hide when stale.
- Orientation not applied: when L35 has saved an orientation but the file is 3MF or OBJ and
  OpenSCAD is missing, the estimate is shown with "Orientation not applied: install OpenSCAD
  to slice rotated 3MF and OBJ files."
- Disabled: without permission to run model commands, "Estimate print" is disabled with the
  existing permission tip. With agent tools disabled in settings, the MCP tool refuses.

## Surfaces and connection modes

Web and desktop share all of this. "Open in slicer" needs the desktop app talking to its own
local environment, because the slicer opens on the host's screen; everywhere else it is
"Download 3MF", which works over LAN, Tailscale and T3 Connect through the signed file route.
Mobile has no 3D panel. An upstream T3 server has no 3D feature.

## Decisions

- Kyle chose to build slicing estimates in Loom on 2026-10-10, using the Fabrication app's
  research. Loom still never sends a job to a printer.
- One adapter for the Bambu Studio family (Bambu Studio and OrcaSlicer share a CLI and output
  format) and one for PrusaSlicer. Build order: Bambu Studio, then OrcaSlicer, then
  PrusaSlicer.
- The slicer is chosen per bed. A Kobra S1 maps to OrcaSlicer; Prusa printers to
  PrusaSlicer; Bambu printers to Bambu Studio.
- Loom reads installed profiles read-only and writes flattened copies only into its own state
  folder. It never edits the slicer's configuration.
- The slicer runs with a Loom-owned data directory, so slicing never touches the GUI's
  settings, login or network plugin.
- Estimates are on demand. Slicing a 300 mm part can take a minute; doing it on every edit
  would load the host for answers nobody asked for.
- Numbers come from the slicer's own output, never from Loom's guess, except the support
  weight, which Bambu Studio does not report and Loom estimates from support toolpaths
  (labelled "about").
- "Open in slicer" opens the sliced 3MF project, so the user sees exactly what was estimated.
- The layer preview draws extrusion only (no travel moves), capped at one million segments.

## Decisions needed from Kyle

1. **Which slicer comes first.** Recommended: Bambu Studio. It is installed on Kyle's Mac,
   both of his main printers are Bambu, and its CLI and 3MF metadata are verified in
   REFERENCES.md. OrcaSlicer reuses the same adapter; PrusaSlicer follows.
2. **Where profiles come from.** Recommended: read the installed Bambu Studio and OrcaSlicer
   profiles read-only and flatten them in Loom, with "Import profile" for anything else.
   The alternative, limiting v1 to profiles the user exports, is simpler but Bambu Studio's
   exports still `inherit` from system profiles, so Loom has to flatten either way.
   PrusaSlicer v1 uses an exported config file (File, Export, Export Config), because its
   system presets live in the GUI's data folder that Loom should not touch.
3. **The `Y` key** for showing and hiding sliced layers. Recommended: yes; add the row to
   MODEL-3D-FOLLOW-UPS.md. The slider takes the arrow keys only while it has focus, so it
   does not collide with L43.
4. **Auto estimate.** Recommended: no setting in v1. Cached results show automatically and
   everything else is one click. Revisit if Kyle finds himself clicking it after every change.
