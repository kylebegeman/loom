# L39 product

## Problem

A part that reads "42.0 × 18.5 × 7.2 mm" is hard to picture, and a capture shared in a thread
has no scale at all. People put a coin next to a printed part for exactly this reason. The
viewer should be able to do the same before anything is printed.

## What the user can do

- Open the Bed menu and choose an object under "Show for scale": Nothing, Credit card,
  US quarter, 1 euro coin, AA battery, LEGO 2×4 brick, M3×10 screw, or Hand.
- See it on the bed to the right of the part, true to size, in neutral grey.
- Keep it while the part reloads: it moves with the part's new size.
- Capture with it: single captures, four-view captures and named-view capture sheets include it
  when it is in frame.
- Change the same choice in Settings, under the 3D model section, next to the bed.
- Ask an agent to show a coin beside the part and capture it.

## Entry points

| Way in                            | Way out             | Where the state shows                                     |
| --------------------------------- | ------------------- | --------------------------------------------------------- |
| Bed menu, "Show for scale" select | Choose "Nothing"    | The select's value; the object on the bed                 |
| Settings, "Show for scale" row    | Choose "Nothing"    | The row's value                                           |
| Editor `display` with `reference` | `reference: "none"` | `loom_model_preview_3d_settings` returns `scaleReference` |

The Bed toggle (`G`) hides the plate but not the reference: the reference is about the part,
not the printer.

## States

- Loading: none. Geometry builds synchronously in well under a millisecond.
- Empty: "Nothing" is the default; no object, no change to today's view.
- Error: the settings save fails: the menu reverts and shows the existing "Bed not changed"
  style toast with "Scale reference not changed".
- Disabled: a connection that cannot save settings sees the select disabled, with the Bed menu's
  existing note "This connection cannot change model settings."
- Stale: not applicable. The reference has no revision; it re-places on every model load.

## Surfaces and connection modes

Web and desktop: supported. Mobile: no 3D panel. Remote: the choice is an environment setting,
so every client connected to the same environment shows the same reference, the same way the
bed works today.

## Decisions

- Environment setting, not per model: it is a viewing preference like the bed. Per-model would
  need a workspace entity for little gain.
- One neutral grey material, no textures: it must read as "not your part" in both themes and never
  compete with the model's colours.
- To the right of the part with a 10 mm gap, resting on the same plane as the part's lowest
  point: predictable, visible from the default iso view, and never overlapping the part.
- Long side along Y: keeps the reference compact in X so it stays near the part in front views.
- Captures include it when visible: a capture should look like the viewport, and scale in a
  shared image is the main use.
- Not pickable, not measurable, not in fit, bounds, dimensions, bed fit or snapping: it is not
  part of the model.
- Fit (`F`) and standard views keep framing the part only: a hand next to a 10 mm part would
  otherwise shrink the part to a speck. Users pick a reference that suits the part, or zoom out.
- Dimensions come from published standards where they exist and are cited in REFERENCES.md; the
  hand is an average adult size, labelled as an average.

## Decisions needed from Kyle

None blocking. One to confirm: fit and standard views frame the part only, so a large reference
beside a small part is partly out of frame until you zoom out. Recommended: keep it that way;
the alternative (frame part and reference) changes `F` and saved-view behaviour whenever a
reference is on.
