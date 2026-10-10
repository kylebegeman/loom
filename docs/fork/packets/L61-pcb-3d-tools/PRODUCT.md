# L61 product

## Problem

The 3D board answers "does it look right" but not "will it fit". Today it offers four camera
views, zoom and fit (`apps/web/src/fork/pcb-preview/Board3D.tsx:150-176,202-239`), always in
perspective, with no way to cut through the board, measure in 3D or read how tall anything is.
To size an enclosure you need the tallest part on each side, lead protrusion under the board,
and spacing between parts, and today that means exporting to another CAD tool. Agents have the
same gap: the editor snapshot reports the camera but nothing about the board's geometry
(`PcbPreviewPanel.tsx:545-570`).

## What the user can do

- Press `P` in the 3D board, or tick "Orthographic" in the Display menu, to switch projection.
  Standard views (Top, Front, Right) in orthographic read like a drawing.
- Open the section plane from its tool button, pick an axis, scrub the offset, flip the side.
  Closed parts show a hatched cut face; the board body is the main one.
- Press `M` (or the Measure button) and click two points for a distance. Points snap to
  vertices, edge midpoints and sharp edges, shown before you click. Hold `Alt` to place a free
  point. Switch the hint to Height and click any point to see its height above the board top,
  or below the board bottom for points underneath.
- Open Heights to read: "Above board: 11.20 mm · J3", "Below board: 3.05 mm · J1" (through-hole
  leads count), "Board: 1.60 mm", then a list of parts by height. Clicking a row draws that
  part's height and selects it in the panel, as clicking it in 2D does.
- Use the Display menu to hide or show Board, Solder mask, Copper, Silkscreen, Top components and
  Bottom components. Hiding the mask is how you see copper; hiding the board and the top
  components leaves the bottom side to inspect from above.
- Capture, attach to the draft and agent captures include the projection, section, hidden layers
  and measurements on screen.

## Entry points

| Way in                                                  | Way out                                                                          | Where the state shows                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `P`, Display menu "Orthographic"                        | `P` again, untick                                                                | Checked item; `camera.projection` in the snapshot                                        |
| Section tool button                                     | Same button, or "Remove section" in the strip                                    | Pressed button, the strip, the cut; `camera.section` in the snapshot                     |
| "Filled cut" in the section strip (L37)                 | The same toggle                                                                  | Pressed toggle, the cap; `sectionCaps` in the snapshot                                   |
| Display menu layer items                                | Tick again                                                                       | Checked items; the Display button reads "Display · 2 hidden"; `layers3d` in the snapshot |
| `M` or Measure button                                   | `Escape`, "Done" in the hint, the button again                                   | Pressed button and hint; `tool3d` in the snapshot                                        |
| Height mode in the Measure hint                         | Distance mode, or leave Measure                                                  | Hint title "Height"; `tool3d: "height"`                                                  |
| Each measurement                                        | "Clear" in the hint, a reload of the board, leaving 3D                           | Line and label in the scene; `measurements3d` in the snapshot                            |
| Heights button                                          | Close the popover                                                                | The popover; `heights` in the snapshot                                                   |
| Heights row click                                       | Clear, or another row                                                            | A height line on the board and the panel selection                                       |
| Agent `display`, `section`, `measure`, `height`, `tool` | The same actions with the opposite value; `measure` with `enabled: false` clears | The same controls; the snapshot                                                          |

Projection, section and layer toggles are kept while the panel is open, across reloads and
2D/3D switches, and reset when the panel closes, like the model panel's display state
(`apps/web/src/fork/model-preview-3d/ModelPanel.tsx:134`). Measurements reset on reload.

## States

- Loading: while the board exports or loads (`Board3D.tsx:177-201`), every new control is
  disabled, as zoom and fit are today (`busy`, `Board3D.tsx:146`).
- Snapping not ready: entering Measure on a large board shows L38's building state in the hint;
  clicks before it is ready place unsnapped points. Above L38's `SNAP_TRIANGLE_LIMIT` (1,000,000
  triangles) the hint says "Snapping is off for boards this large" and points are free.
- Empty heights: a board with no component models shows "No component models in this 3D board.
  Install the footprint 3D models in KiCad, then retry." Board thickness still shows.
- Error, no board body: if no board body mesh is found, Heights says "Heights need the board body
  in the 3D export" and Height mode is disabled with the same tooltip.
- Disabled layers: tscircuit paints copper and silkscreen as board textures, so those two items
  are disabled with the tooltip "tscircuit draws copper and silkscreen on the board surface".
  Solder mask is disabled when the board has none.
- Caps: "Filled cut" follows L37's states. When the board body is closed and some part models
  are not, the strip says "Some parts aren't closed, so their cut isn't filled" (L37's copy).
- Stale: a source change re-exports and reloads the board (`Board3D.tsx:54-66,78-116`).
  Projection, section and layers re-apply to the new board, measurements are cleared, heights
  are recomputed. While reloading the tools stay disabled, so nothing shows the old board's
  numbers against the new one.
- Agent errors: actions in 2D or before load fail with the existing "Open a loaded 3D board for
  this action." (`PcbPreviewPanel.tsx:383-386`). Asking to show copper on a tscircuit board
  fails with "This 3D board has no separate copper layer. tscircuit draws it on the board."

## Surfaces and connection modes

Web and desktop: supported. Mobile has no PCB panel. Over LAN, Tailscale or T3 Connect the
board bytes still come from the signed URL, and all measuring runs in the client, so remote use
behaves as local. Older servers: the panel works because every new control is client-side; the
agent actions need a server with the new editor schema, and an older server rejects them at
decoding with a clear schema error.

## Decisions

- Reuse the model viewer's projection, caps and snap modules rather than a PCB copy: one
  implementation, one set of fixes (`Board3D.tsx:7,89` already uses the model viewer factory).
- `M` opens 3D Measure: it is already "measure" in the panel, and 2D tools are off in 3D
  (`PcbPreviewPanel.tsx:1054`).
- Heights include lead protrusion below the board: that is what collides with an enclosure
  floor, and part models include leads.
- Solder mask gets its own toggle: copper sits under the mask, and hiding the mask is the only way
  to read it in 3D. The brief's four groups become six rows.
- Hidden parts cannot be picked or snapped: measuring through something you hid is the point of
  hiding it.
- Display state is per open panel, not saved per design: the model panel does the same.
- No section key until Kyle allocates one: [PCB-FOLLOW-UPS.md](../PCB-FOLLOW-UPS.md) allocates
  only `P` to L61.

## Decisions needed from Kyle

1. Allocate `S` for the section plane in the PCB panel, matching the model panel? Recommended:
   yes. It is free in the PCB key table, and the shared section strip already shows `S` on its
   Remove button. Until then L61 hides that key hint (TECHNICAL.md, "Clients").
2. Keep 3D measurements transient? Recommended: yes. Saving them needs a 3D measurement entity
   in the PCB workspace, which no one asked for, and captures already keep them on record.

Not part of this packet, noted for L63: `F`, `0`, `+`, `-` and arrow keys do nothing in 3D
because only the 2D viewport handles them (`SvgViewport.tsx:378-395`).
