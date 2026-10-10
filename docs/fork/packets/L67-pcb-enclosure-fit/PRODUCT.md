# L67 product

## Problem

The PCB panel can already save a board reference for case design: "Export board reference…"
writes the 3D board and a JSON file of bounds, thickness, holes and component positions into a
thread's workspace (`apps/server/src/fork/pcb-preview/PcbPreviewService.ts:2392-2463`). Nothing
uses it yet. Today the user, or an agent, opens the GLB beside a case model, guesses, prints, and
finds out on the bench that the USB-C plug hits the wall, a capacitor touches the lid, or a
standoff sits 0.8 mm off its hole. The board already knows its outline, holes, part heights and
which connectors face an edge. Loom should check the case against those facts, and when there is
no case, write a decent first one from them.

## What the user can do

- Open the PCB panel's "Enclosure" tab for a design with a board and see whether a current board
  reference exists, and whether the board's case assembly exists.
- "Generate case": choose wall, floor and lid thickness, gaps, standoff height and corner radius
  (all prefilled from the board), optionally "Also write build123d (Python)", and get a case
  folder beside the design. The case opens in the 3D model panel, assembled with the board.
- "Use an existing case": pick one or more model files (STL, 3MF, OBJ, glTF or SCAD) as the case
  parts. Loom adds them and the board to the board's assembly and centres the board over them.
- "Check fit": run the enclosure checks and read one row per finding:
  - Walls: the smallest gap on each side of the board outline, against the wall gap.
  - Above and below: the tallest parts on each side against the lid and the floor.
  - Connectors: each edge connector, whether its opening is clear, partly blocked or blocked,
    and how far its face sits from the wall.
  - Mounting holes: each hole, whether a standoff meets it, the gap, and how far off centre.
  - Interference: any part of the board that intersects the case (L48's pair check).
- "Show in 3D": open the assembly in the model panel's Fit tab with pins at each finding.
  Clicking a row there frames it.
- "Apply suggested move": when the holes agree on one offset, move the board by it.
- "Update board": after the design changes, export a fresh reference and swap it into the
  assembly in the same place.
- Edit the generated SCAD in the model panel's customizer or by hand, and check again.

Agents do all of the above through tools (TECHNICAL.md, "Agent-facing tools").

## Entry points

| Way in                                                                     | Way out                                                                          | Where the state shows                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| Inspector rail "Enclosure" (or `loom_pcb_editor` `open-tools` `Enclosure`) | Another tab, or close the rail                                                   | The tab                              |
| "Generate case"                                                            | Delete the folder; "Regenerate" rewrites only files Loom wrote and nobody edited | Tab lists the files and the assembly |
| "Use an existing case"                                                     | Remove the part in the model panel's Parts tab (L48)                             | Tab lists the case parts             |
| "Check fit"                                                                | "Cancel" while running; results go stale when anything changes                   | Tab summary, model Fit tab           |
| Enclosure on an assembly (`set-enclosure`)                                 | "Stop checking as an enclosure" (`clear-enclosure`)                              | Fit tab enclosure section            |
| "Apply suggested move"                                                     | Undo with the reverse move shown in the toast, or edit Position                  | Parts tab position fields            |
| "Update board"                                                             | Previous references stay in `.loom/pcb-references`; swap back with `swap-board`  | Tab reference line                   |

## States

- **Loading.** "Preparing the board reference…" while the GLB exports (KiCad can take several
  seconds); "Checking fit…" with "Cancel" during a check. No spinner animates while idle.
- **Empty.** No board file: "Add a board file to check an enclosure." (worded like the 3D
  view's "Add a board file to view it in 3D.", `PcbPreviewService.ts:1649`). No case yet: the generate form and "Use an existing case".
- **Disabled.**
  - KiCad 9 or older: "KiCad 10 or newer is required for the GLB board export." (`:1643-1647`),
    and both actions are disabled with that reason.
  - tscircuit without execution allowed: the tab sits in the same execution gate as Inspect.
  - Server without `pcb-enclosure-fit`: the tab is not shown.
  - Server without `model-assemblies` (L48): only "Generate case" (SCAD) is shown, with "Fit
    checks arrive with 3D assemblies." under it.
  - Without `model-python-cad` (L50): the build123d checkbox is not shown.
- **Error.** Tool and check errors show inline with their message and "Try again". A hand-edited
  generated file: "case.scad was edited after Loom wrote it. Overwrite it?" with "Overwrite" and
  "Cancel". A mirrored board frame: "The 3D board is mirrored against the drawing. Check the
  board's 3D export." and checks continue with the 3D board as truth.
- **Warnings** (shown above the results, never blocking):
  - "No 3D models for 12 parts. Their height is assumed to be 10 mm." (parts with no mesh).
  - "Mounting holes come from the board outline only" when none are found.
  - "Heights are box heights, so rotated parts may read taller than they are."
- **Stale.**
  - Reference: the design's current source hash differs from the assembly board's metadata
    `sourceHash`. Shows "The board changed since this reference." with "Update board".
  - Results: the assembly, a part revision or a transform changed since the report (L48's
    `report.key` rule). Results grey out with "Results are out of date. Check again."

## Surfaces and connection modes

Web and desktop, local and remote. GLBs and SCAD renders reach the viewer through the existing
signed routes; reports are small JSON over the WebSocket (capped, see TECHNICAL.md). Mobile has
no PCB panel and no model panel, so there is nothing to show there. An agent driving a remote
environment gets the same files and reports.

## Decisions

- Board in case is an L48 assembly, not a new scene type: one file format, one viewer, one fit
  check.
- Case geometry is generated in the board part's own frame, so the generated assembly needs no
  rotation and the user's edits stay simple.
- The board's facts come from the reference GLB and its metadata, not the live design, so an
  assembly in another thread or branch still checks without the design present.
- Clearance rules are rays against the case mesh, not a solver. They are fast, explainable and
  name the place that fails.
- OpenSCAD is always written because L23 renders it today; build123d only when L50 can open it.
- Generated sources carry a hash of their own content, so Loom never overwrites a hand edit
  without asking.
- No new keyboard shortcut. The tab and buttons are enough.
- Loom never orders, prints, slices or uploads. Output is files in the workspace.

## Decisions needed from Kyle

1. **Where the case files and the assembly live.** Recommend the assembly at
   `<design dir>/<stem>.loom-assembly.json` and generated files in `<design dir>/<stem>-enclosure/`,
   so both travel with the design in git and the tab can find them without saved state.
   Alternative: a top-level `enclosures/` folder.
2. **Enclosure requirements in the assembly file.** Recommend an optional `enclosure` section in
   L48's file, which raises the written version to 2 when present, so an older Loom opens it
   read-only rather than dropping the section. Alternative: a sidecar JSON per assembly.
3. **Plated mounting holes.** KiCad's `MountingHole_*_Pad` footprints use plated pads that
   inspection ignores today (`semantics.ts:145-147`), so most real boards report no holes.
   Recommend counting `thru_hole` pads in footprints whose name contains `MountingHole` with a
   `plated` flag. This also changes hole counts in L55's stats and the reference JSON.
4. **Edge connector detection.** Recommend a heuristic (reference prefix `J`, `P`, `CN`, `USB` or
   a connector-like footprint, and a 3D box within 1 mm of the outline or past it) with
   per-assembly include and exclude lists. Alternative: only connectors the user lists.
5. **Starter style for v1.** Recommend one style: a tray that follows the outline, a flat lid
   with a locating lip, and screw bosses with pilot holes. No snap fits or vents in v1.
