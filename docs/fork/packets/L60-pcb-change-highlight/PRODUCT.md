# L60 product

## Problem

Live reload is one of the PCB panel's best parts: an agent edits the schematic and the drawing
updates (`watch`, `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1170-1227`). But the
update erases the old drawing. On a board with 80 parts, the user cannot tell whether the agent
moved the two decoupling capacitors it said it moved, or also nudged the regulator and rerouted
a trace. The Compare tab (`RevisionCompare.tsx`) answers this only between Git commits or
checkpoints, after picking two revisions, and only as a list plus an image blend.

## What the user can do

- After a reload of a design they have already seen, see a chip in the panel's top bar:
  "Changed. Show changes (D)". Its tooltip gives counts ("2 parts moved, 1 added, 3 nets").
- Press `D` or the chip to show the highlights on the current drawing:
  - Added parts: a green ring at the part.
  - Removed parts: a red cross at their old position.
  - Moved parts: a blue ring at the new position and a thin arrow from the old one.
  - Changed parts (value, footprint, rotation or side, pin nets): an amber ring.
  - Net changes: small marks on the pins that joined (green) or left (red) a net.
  - Other drawing changes: dashed neutral boxes around areas whose drawing changed, labelled
    "Drawing changed" in the list. These catch traces, vias, zones, the board outline,
    schematic wires and labels.
- Open the chip's list: changes grouped as Added, Removed, Moved, Changed and Nets, using the
  Compare tab's icons. Clicking a part selects and centres it; clicking a net highlights it.
- Press `D` again, or the chip's "Hide changes", to hide them. "Dismiss" (X) hides the chip
  until the next change.
- Switch between schematic and board, or open the linked view: part and net highlights follow,
  since they come from the design data, not one drawing. Drawing boxes appear only when the
  same view, sheet and layers were shown before and after.
- Change a design while its tab is hidden (an agent turn, an edit in KiCad), then return: the
  chip shows what changed since they last looked.

"Since the version shown before" means one step: after two quick reloads, the highlight shows
the second change. Like L42, there is no history here.

## Entry points

| Way in                        | Way out                               | Way to see it                     |
| ----------------------------- | ------------------------------------- | --------------------------------- |
| `D`                           | `D`                                   | Chip pressed state, overlay       |
| Chip "Show changes"           | Chip "Hide changes"; X dismisses chip | Chip label                        |
| Agent `changes` editor action | Agent `changes` with `enabled: false` | `state.changes.shown` in snapshot |
| Change list item              | Select another part or net            | Selection ring, as today          |

The **?** shortcut list gets "Show changes since the last reload: D". The command palette has
no per-panel actions today (`apps/web/src/fork/pcb-preview/palette.tsx:5-25`); this packet
does not add one.

## States

- Loading: after a reload, the chip appears once the new inspection matches the drawing.
  Drawing boxes are computed the first time highlights are shown; until then the list shows
  "Checking the drawing…". No spinner on the drawing.
- Empty: first view of a design in this session, or a reload with no structural and no drawing
  difference (a touched file): no chip.
- Error: the raster failed (a sheet too large, a decode error): parts and nets still show; the
  list says "Drawing changes are unavailable for this reload."
- Disabled: 3D view (`D` does nothing; the chip is hidden), a drawing tool other than select
  is active (`D` still works, as `1`-`3` do), a history version is shown (L66).
- Stale: the next reload replaces the pair. A design switch starts over from that design's own
  last seen version.

## Surfaces and connection modes

Web and desktop. Mobile has no PCB panel. Local, remote and tunnel behave the same: nothing
new is fetched.

## Decisions

- The baseline is the last version the user saw in this session, per design. That is what
  "after a reload" means, and it survives hiding the tab.
- Parts and nets come from the existing structural diff, extended; traces and other geometry
  come from a raster comparison of the two drawings. Inspection data has no trace geometry
  (`PcbInspection`, `packages/contracts/src/fork/pcb-workspace.ts:35-54`), and adding it would
  send every segment over the WebSocket on every reload.
- Moves are reported as moves. Today `compareInspections` reports a moved part as "pcb, pins",
  because pin positions are absolute (`semantics.ts:452-453`); the shared diff fixes that for
  the Compare tab too.
- Highlights are off until asked for. A reload never paints over the drawing on its own.
- No timers or animation; the chip stays until the next reload or dismissal.
- Captures include the highlights, as with every overlay.

## Decisions needed from Kyle

None. Two calls made here that Kyle may want to know about:

- The shared diff lives in `packages/contracts/src/fork/` because server and web both need it
  and that package already carries small pure helpers for fork features; `packages/shared`
  would need an upstream `package.json` export.
- The Compare tab's detail text changes from "pcb, pins" to "pcb" for a moved part.
