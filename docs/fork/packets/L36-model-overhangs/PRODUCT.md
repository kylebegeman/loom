# L36 product

## Problem

Whether a part needs supports, and where, is the first thing to know before printing. Today the
panel shows a uniform grey part, so the user has to slice it to find out, and an agent designing
a part has no way to check its own work for overhangs at all. Slicers shade overhangs in their
prepare view; the panel should do the same while the part is still being designed, and give
agents a number they can act on.

## What the user can do

- Press `V`, or tick "Overhangs" in the display menu, to shade overhangs. Downward faces tilted
  more than the threshold from vertical turn orange with a fine diagonal hatch. Faces sitting on
  the bed are not shaded.
- Read the legend chip, "Overhangs over 45°", while the mode is on. Clicking it opens a small
  popover with the "Overhang angle" slider (30° to 70°, 1° steps) and the line "Angle from
  vertical. Downward faces tilted more than this are shaded." Changing it updates the shading
  immediately and is saved for this environment.
- Turn it off with `V`, the display menu, or the chip's "Hide overhangs" button.
- Save a view with overhangs on; recalling it turns them back on. Captures and review sheets
  include the shading.
- Lay the part flat (L35) and watch the shading change with it.

## Entry points

| Way in                                        | Way out                            | Where the state shows                                     |
| --------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `V`                                           | `V`                                | Legend chip in the viewport; checkbox in the display menu |
| Display menu "Overhangs"                      | Untick it                          | Same                                                      |
| Palette "3D model: Show overhangs"            | Palette "3D model: Hide overhangs" | Same                                                      |
| Recalling a saved view with overhangs on      | Recalling one without, or `V`      | Same                                                      |
| Agent editor `display` with `overhangs: true` | `overhangs: false`                 | Same; `camera.overhangs` in the editor snapshot           |
| Chip popover slider                           | Drag back; default 45°             | Chip text "Overhangs over N°"                             |

## States

- Loading: the toggle works before a model loads; shading appears with the model.
- Empty: no overhangs at this angle. The chip reads "No overhangs over 45°" so the user knows the
  mode is on and found nothing, instead of wondering whether it worked. The panel knows this
  from a cheap CPU pass over the loaded geometry, run only when the mode, angle or orientation
  changes.
- Wireframe: lines have no face to judge. The chip stays, with the tooltip "Overhangs show on
  solid faces"; turning wireframe off shows the shading again.
- Unsupported material: an unlit glTF material (`MeshBasicMaterial`) or a custom shader cannot
  be shaded. Those meshes stay as they are and the chip tooltip says "Some parts use materials
  that can't be shaded".
- Disabled: without settings permission, the slider is disabled with the same treatment as the
  bed picker; the toggle still works because it is display state. Against an older Loom server
  the slider is hidden and the angle is 45°.
- Error: there is no failure mode in the viewer beyond the unsupported material case. A failed
  settings save shows the existing settings error and the slider returns to the saved value.
- Stale: none. Shading is recomputed by the GPU every frame it draws, so it always matches the
  current mesh and orientation.

## Surfaces and connection modes

Web and desktop, over every connection mode. Shading costs nothing on the network. Mobile has no
3D panel.

## Decisions

- Measured from vertical, default 45°, range 30° to 70° in 1° steps. Matches Cura's convention
  and the common rule of thumb; Bambu Studio and PrusaSlicer measure from horizontal, so the user
  guide gives the conversion.
- Geometric face normals, not smoothed vertex normals, so a smooth-shaded glTF is judged by its
  real facets, as a slicer would.
- Faces in the first 0.2 mm above the bed are never shaded: they print on the plate.
- Orange tint plus hatch: orange against the blue-grey part is a safe pair for common colour
  vision deficiencies, and the hatch carries the meaning without colour.
- The threshold is an environment setting (it describes the printer and material); the on/off
  state is view state, like wireframe.
- Shading is a material patch compiled with the model, so toggling and dragging the slider never
  recompile shaders or hitch.

## Decisions needed from Kyle

1. The render tool returns overhang statistics (total and overhang area, percentage, and the ten
   largest regions with their centres in model coordinates), not shaded images. OpenSCAD's PNG
   export colours by `color()` only, so shading by face angle would need splitting the mesh into
   two coloured imports and rendering in preview mode, which is unverified. Recommendation:
   ship statistics now; agents that need a picture use the editor `capture` while the panel is
   open. Run the coloured-import spike later if agents ask for headless images.
2. Hatch on by default with no setting to turn it off. Recommendation: yes. It is subtle at 8 px
   and keeps the mode colour-blind safe in captures sent to agents.
