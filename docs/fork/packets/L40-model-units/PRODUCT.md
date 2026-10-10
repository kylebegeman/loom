# L40 product

## Problem

Kyle measures some things with inch rulers and buys hardware in inch sizes, while every slicer
and the H2D and H2C work in millimetres. The 3D panel only speaks millimetres, so checking a part
against an inch dimension means converting in his head, and the existing "1 in grid" bed pattern
sits under millimetre labels.

## What the user can do

- Choose "Millimetres" or "Inches" once per environment. Every length in the 3D panel follows:
  status bar size, Part dimensions, clearance and overage, bed sizes in every bed menu, the
  plate diagram, measurement rows and the labels drawn in the viewport and in captures, saved
  view section offsets, variant sizes and comparisons.
- Type lengths in the chosen unit: custom bed size and the section offset field. Values are
  stored in millimetres.
- Copy a measurement in the chosen unit.
- Switch back at any time; nothing stored changes.

## Entry points

| Way in                                                           | Way out                                         | How the state shows                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Loom settings, 3D model, "Units": Inches                         | Same control: Millimetres, then "Save settings" | Every length shows "in".                                                         |
| Bed menu, "Units" segmented control (mm, in)                     | Same control                                    | Saves at once, like the bed.                                                     |
| Command palette, "3D model: Switch units" (panel open)           | Run it again                                    | Toggles and saves; a toast says "Lengths in inches" or "Lengths in millimetres". |
| Agent: `loom_model_preview_3d_save_settings` with `displayUnits` | Same tool                                       | As above.                                                                        |

No keyboard key: switching units is rare, and the key table has no spare letter that reads as
"units".

## States

- Default and old settings: millimetres, exactly as today.
- Inches: decimal inches with one more decimal than the millimetre text (Part sizes "1.38 in",
  measurements "0.500 in", whole-millimetre text such as clearance "0.4 in").
- Bed volumes in menus drop trailing zeros so presets stay short ("13.78 × 12.6 × 12.8 in";
  Letter reads "11 × 8.5 in").
- Saving: Bed menu and palette use the optimistic save with a "Units not changed" toast on
  failure. Settings use "Save settings".
- No permission: the controls are disabled with the existing tip; the panel keeps showing the
  saved unit.
- Inputs: an inch value outside 0.4 to 78.7 in (10 to 2000 mm) for a bed size is invalid and
  not saved, like today's millimetre limits.

## Surfaces

Web and desktop. Mobile has no 3D panel.

## Decisions

- Per environment, stored with the other 3D settings, as Kyle asked: one machine's panel looks
  the same from every client.
- Display only. Agents, saved data, tool inputs and outputs, the annotation request text
  ("Region (mm)") and model files stay in millimetres. Tool descriptions say so.
- Captures paint measurement labels in the display unit, with the unit written out, so an agent
  looking at an image still sees which unit it is.
- Decimal inches, not fractions. Fractions do not round-trip for typed values and no other
  surface needs them.
- Units and the bed grid are independent. Kyle can pair inches with the 1 in grid himself; the
  Bed menu shows both controls together.
- Preset notes (vendor text such as the H2D nozzle sizes) stay as written, in millimetres. L34's
  zone legend, which is computed, follows the display unit.
- Customizer parameter fields are not converted: Loom cannot know a SCAD parameter's unit.
- Typed inch values are stored rounded to 0.1 mm, so a bed typed as 12 in is 304.8 mm and shows
  as 12 in again.

## Decisions needed from Kyle

None.
