# L34 product

## Problem

Kyle prints on an H2D and an H2C. Both have a left and a right nozzle, and neither nozzle reaches
the whole plate. A part that uses both nozzles (two materials, or support in a second material)
must sit in the 300 mm wide middle area. A part wider than one nozzle's reach can only print
with the same filament loaded in both nozzles. The left nozzle also stops 5 mm lower than the
right. Loom shows the outer envelope (350 x 320 x 325 mm on the H2D) and says "Fits", so these
limits only show up in Bambu Studio.

## The numbers

Coordinates from the plate's front-left corner, in mm. Source: Bambu Studio machine profiles;
the both-nozzle and single-nozzle figures match Bambu's current H2D and H2C spec pages (see
REFERENCES.md).

| Printer | Left nozzle reach           | Right nozzle reach           | Both nozzles                 | Whole plate, same filament in both |
| ------- | --------------------------- | ---------------------------- | ---------------------------- | ---------------------------------- |
| H2D     | X 0 to 325, 325 x 320 x 320 | X 25 to 350, 325 x 320 x 325 | X 25 to 325, 300 x 320 x 320 | 350 x 320 x 320                    |
| H2C     | X 0 to 325, 325 x 320 x 320 | X 25 to 330, 305 x 320 x 325 | X 25 to 325, 300 x 320 x 320 | 330 x 320 x 320                    |

Strips only one nozzle reaches: left nozzle only X 0 to 25 on both printers; right nozzle only
X 325 to 350 on the H2D and X 325 to 330 on the H2C. Depth is the full 320 mm everywhere.

## What the user can do

- See the single-nozzle strips tinted on the viewport plate and in Part's top view when the H2D
  or H2C is the bed.
- Read a legend in the Bed menu: "Both nozzles", "Left nozzle only", "Right nozzle only", with
  sizes.
- Read a fit answer that says which nozzles can print the part:
  - "Fits, with either or both nozzles." (inside the both-nozzle area)
  - "Fits the left nozzle only. Printing with both nozzles needs 300 × 320 × 320 mm." (also
    "right nozzle only", or "either nozzle, not both")
  - "Fits only with the same filament in both nozzles." (wider than one nozzle's reach)
  - The existing overage text when nothing fits, measured against the closest option.
  - "Fits rotated" combines with each of these, as in L32.
- Turn the tint off with "Show nozzle zones" in the Bed menu or Loom settings, and back on.
- Ask an agent whether a part fits the H2D with two materials; the render tool's fit summary
  says which area it fits.

## Entry points

| Way in                                                                      | Way out            | How the state shows                      |
| --------------------------------------------------------------------------- | ------------------ | ---------------------------------------- |
| Choose the H2D or H2C as the bed (any bed menu)                             | Choose another bed | Tinted strips, legend, zone fit text.    |
| "Show nozzle zones" switch in the Bed menu (only shown for beds with zones) | Same switch        | Strips and legend swatches appear or go. |
| Same switch in Loom settings, under the Bed row                             | Same switch        | As above.                                |
| Hide the bed (`G`)                                                          | `G` again          | The strips hide with the plate.          |
| Agent: `loom_model_preview_3d_save_settings` with `showZones`               | Same tool          | As above.                                |

The fit text stays zone-aware when the tint is hidden: the limits are real either way.

## States

- Beds without zones: nothing changes; no legend, no switch.
- Bed shown, zones on: strips drawn in both themes; legend in the Bed menu.
- Zones off: plain plate; the Bed menu shows the switch off and the legend without swatches.
- No permission to change settings: the switch is disabled with the existing tip.
- No model loaded: the plate and strips still draw (the plate sits at the origin).
- Capture: captures include the strips when they are shown, like the grid.

## Surfaces

Web and desktop. Mobile has no 3D panel.

## Decisions

- Numbers come from Bambu Studio's machine profiles, the data the slicer enforces. They agree
  with Bambu's current spec pages. Bambu's US store page and the H2D launch post still say
  325 mm for both-nozzle height; Loom uses 320 mm, the newer and stricter figure.
- Show only the strips one nozzle cannot reach, not three overlapping rectangles. The middle,
  untinted, is the both-nozzle area, which is where most parts sit.
- Fit ignores where the part sits on the plate. The question is whether it can be placed to
  fit, which matches how Kyle arranges parts in the slicer. The viewport keeps centring the plate
  under the part (L23), so on the H2C a centred 300 mm part overlaps the left strip by 10 mm while
  the text says it fits both nozzles. The legend says "Move parts in the slicer; Loom centres the
  plate under the part."
- No material model. Loom does not know which filaments a model uses, so it reports all levels
  and lets Kyle pick. Multi-colour from one nozzle (AMS on one side) works in a single-nozzle
  area, so the text says "nozzle", not "material".
- The outer volume in the presets stays 350 x 320 x 325 (H2D) and 330 x 320 x 325 (H2C), the
  vendor envelope; zones refine it. Overage uses the closest option, so a 200 x 200 x 330 mm part
  on the H2D still says "5.0 mm too tall" (against the right nozzle).
- Zones are on by default; the switch is the way out.
- The preset notes match the profiles (corrected in `1f901fdd6e`):
  - H2D: "Left nozzle 325 × 320 × 320 mm, right nozzle 325 × 320 × 325 mm, both nozzles
    300 × 320 × 320 mm."
  - H2C: "Left nozzle 325 × 320 × 320 mm, right nozzle 305 × 320 × 325 mm, both nozzles
    300 × 320 × 320 mm."

## Decisions needed from Kyle

None. If Kyle wants the store page's 325 mm both-nozzle height instead, it is one number per
printer in `model-beds.ts`; recommended: keep 320 mm, because the slicer profile limits the
left nozzle to 320 mm.
