# L48 product

## Problem

Enclosure work is about how parts fit together, and Loom shows one part at a time. Kyle designs
a case in SCAD, exports the board from the PCB view as a GLB, and then has no way to see the
board inside the case, check that the lid closes without hitting a connector, or confirm the
0.3 mm gap he intended. Agents have it worse: they can render each part but cannot ask "does the
USB-C plug clear the wall?" or "move the board 2 mm up and check again".

## What the user can do

- Create an assembly from the model picker ("New assembly"), name it, and add parts from the
  workspace, including PCB references in `.loom/pcb-references/`. Or ask an agent to make one.
- Open an assembly from the picker ("Assemblies" filter), the command palette or by path. It
  opens in the 3D panel like a model, with the bed, display menu, section view and captures.
- In Parts, see every part with its name, file, triangle count and state; hide or show it, give
  it a colour, isolate it (only it visible), and select it by clicking the row or the part in the
  viewport.
- With a part selected, type its position (mm) and rotation (degrees about X, Y, Z), nudge with
  the field steppers (1 mm, 10 mm with Shift, 0.1 mm with Alt; rotation in 15 degree steps),
  turn it a quarter about any axis, drop it to the bed, or align it to another part: left, centre
  or right faces on X, Y or Z, or "on top of" and "below" with an offset.
- For a SCAD or build123d part, set its parameters or parameter set for this assembly only. The file's own
  last-used values are untouched.
- Drag "Explode" to pull parts apart from the assembly centre, or press `E` to toggle between
  assembled and the last exploded amount. Exploded is a view; positions in the file never change.
- In Fit, list clearance pairs ("Board to case: at least 0.3 mm"), add or remove them, and run
  "Check fit". See each pair as "Clear", "Touching", "Intersects", "Inside" or a measured gap,
  with pins on intersections and the closest points. Click a result to frame it.
- Measure, annotate for the agent and save views exactly as for a single part; they belong to
  the assembly.
- Edit any part file and see only that part reload; edit the assembly file in an editor or let
  an agent change it and see the panel follow.

## Entry points

| Way in                                                                                                       | Way out                                                                              | How the state is visible                                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Picker "New assembly" (creates the file and opens it).                                                       | Close the panel tab. The file stays in the repository; delete it with any file tool. | The picker lists it under "Assemblies".                                                                               |
| Picker "Assemblies" filter, command palette "3D model: Open ..." rows, opening a `.loom-assembly.json` path. | Close the tab or pick another file.                                                  | Panel title shows the assembly name.                                                                                  |
| "Add part" in Parts.                                                                                         | "Remove from assembly" in the part's menu, with "Undo" in the toast.                 | Part row appears or disappears.                                                                                       |
| Eye toggle on a part row.                                                                                    | The same toggle. Saved in the file.                                                  | Eye icon, dimmed row, part hidden.                                                                                    |
| "Isolate" on a part row.                                                                                     | "Show all" in the banner, Escape, or isolating another part.                         | "Isolated: Board" banner over the viewport. Not saved.                                                                |
| Colour swatch on a part row.                                                                                 | "File colour" in the swatch menu restores the file's own materials.                  | Swatch fill. Saved in the file.                                                                                       |
| Select a part (row or viewport click).                                                                       | Click empty space, Escape, or select another.                                        | Row highlight and a thin box around the part.                                                                         |
| Position and rotation fields, quarter turns, "Drop to bed", "Align to part...".                              | Edit back, or "Undo" in the toast for the last change.                               | Field values; the part moves.                                                                                         |
| "Explode" slider, `E`.                                                                                       | Slider to 0, `E` again.                                                              | Slider value; Measure and Annotate are disabled while exploded, with the tip "Collapse the exploded view to measure". |
| "Add clearance" in Fit.                                                                                      | "Remove" on the clearance row.                                                       | Row with the required gap.                                                                                            |
| "Check fit".                                                                                                 | "Cancel" while running.                                                              | "Checking..." then per-pair results; "Out of date" after any move or part change.                                     |

`E` is the only new key, allocated to L48 in MODEL-3D-FOLLOW-UPS.md. Escape exits isolate,
selection and the picked result in that order through the existing key handler.

## States

- Loading: the assembly file loads first, then parts in document order, at most four at a time;
  each row shows "Loading..." until its mesh arrives. The viewer shows parts as they load and
  frames the assembly once all visible parts are in.
- Empty: a new assembly says "No parts yet. Add a part from this workspace." with "Add part".
- Error: an invalid file shows the first validation problem with its JSON path ("parts[2].path:
  The file was deleted or moved.") and "Open as text"; the panel does not overwrite a file it
  cannot read. A missing or failing part shows its error in its row and the rest still load.
- Over budget: parts after the 5,000,000 triangle display budget show "Not loaded: over the
  display budget" with "Load anyway". Parts above the file size limit show the usual "Load
  anyway".
- Stale: fit results dim and read "Out of date" when any part file, transform, visibility or
  clearance changed since the check. Another client's edit of the file reloads the panel; a save
  from this panel that loses the race shows "The assembly changed on another client. Reload to
  see the latest."
- Disabled: STEP and build123d parts need the host's Python CAD environment; an unavailable
  renderer reports a per-part error while the rest of the assembly works. A single-file
  executable build shows "Fit checks are not available in this build." in Fit. A connection
  without operate permission can view but not edit. Fit checks, alignment and drop-to-bed need
  terminal permission because they can render Python source parts.

## Surfaces and connection modes

Web and desktop. Mobile has no 3D panel. Parts stream through signed URLs as single models do,
so remote clients work the same over LAN, Tailscale and T3 Connect; the fit check runs on the
host. Two clients editing the same assembly are serialized by the file's revision.

## Decisions

- One file per assembly in the repository, not a hidden Loom record: it goes with the branch and
  the worktree, shows in reviews and is plain JSON an agent can write with any tool.
- Part paths are relative to the assembly file, like glTF buffer URIs, so a folder can move as a
  unit.
- Parts keep their own coordinates; the assembly adds a translation and rotation. A PCB GLB lands
  with its board origin, a SCAD part with its `[0, 0, 0]`.
- Rotation is degrees about X, then Y, then Z (three.js "XYZ" order), the order people type.
- Explode, isolate and selection are view state, never written to the file. Visibility and colour
  are part of the design and are saved.
- The fit check is on demand, not automatic: it can take seconds on large boards.
- Coplanar faces count as "Touching", not "Intersects": a lid resting on a rim is intended.
- At most 32 parts and 32 clearance pairs per assembly, enough for an enclosure with fasteners.

## Decisions needed from Kyle

1. Storage. Recommendation: the repository file `*.loom-assembly.json`, not a workspace entity.
   The 3D workspace store is keyed by workspace root and path
   (`apps/server/src/fork/model-preview-3d/ModelPreviewService.ts:794-799`), so an entity would
   not follow a branch into a worktree, would not be visible to collaborators and would not be
   editable by an agent's ordinary file tools. The cost is one small file per assembly.
2. Placement tools in v1. Recommendation: numeric fields, quarter turns, nudge steps and align,
   and no free drag gizmo. Fit work needs exact numbers; a gizmo adds a mode that competes with
   orbit and pan, needs drag undo and invites imprecise placement. If wanted later, three's
   `TransformControls` adds it without a new dependency.
3. Order with L46. Recommendation: build L48 after L46, which provides the readers, grid, worker
   and its one build seam. L48 can carry them if it must go first, but the packet is then much
   larger.
