# L37 product

## Problem

The section plane (`S`) is the panel's main way to look inside a part, but the cut leaves the
part hollow. Back faces are not drawn, so the user sees through the cut to the far side of the
part and has to infer where material is. Checking a wall thickness means placing two measurement
points on edges that are hard to hit. CAD tools fill the cut and hatch it; the panel should too,
and should answer "how thick is this wall?" by pointing at it.

## What the user can do

- Add a section plane as today. The cut is filled with a hatched cap, so solid and air are
  obvious.
- Hover the cap to see "2.4 mm wall" next to the cursor and a line across the wall at its
  thinnest direction through that point.
- Double-click the cap to keep that as a measurement named "Wall 1", "Wall 2" and so on, listed in
  Markup like any other measurement.
- Turn the fill off with "Filled cut" in the section strip, to see inside the part as before.
- Measure on the cap with the Measure tool: clicks on the cap land on the cut, not on the far
  side of the part.

## Entry points

| Way in                                                         | Way out                                            | Where the state shows                        |
| -------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| Adding a section (`S`, tool rail, saved view, agent `section`) | Removing it                                        | The cap itself; section strip                |
| Section strip "Filled cut" toggle                              | The same toggle                                    | Toggle pressed; cap shown                    |
| Hovering the cap                                               | Moving off the cap, orbiting, removing the section | Readout and chord line                       |
| Double-click on the cap                                        | Delete the measurement in Markup                   | "Wall N" row in Markup; line in the viewport |
| Agent editor `section` with `caps`                             | Same with `caps: false`                            | `state.sectionCaps` in the editor snapshot   |
| Agent editor `wall-thickness`                                  | Not applicable (read only)                         | The tool result                              |

## States

- Loading: the first time a section is enabled for a mesh, the closed-mesh check runs (well under
  a second for typical parts). The cap appears when it finishes; the strip's toggle shows
  "Checking the mesh..." as its tooltip meanwhile. SCAD renders that OpenSCAD reports as manifold
  skip the check.
- Empty: no section, nothing to show. A cut that misses the part (offset beyond it) draws no cap
  and no readout.
- Error, open mesh: "Caps need a closed mesh". The toggle is disabled with that tooltip, the cut
  stays hollow, and hover shows nothing. If only some parts of a multi-part file are open, the
  closed ones are capped and the tooltip says "Some parts aren't closed, so their cut isn't
  filled".
- Wireframe: caps are hidden (wireframe is for seeing edges), and return when wireframe is off.
- Disabled: double-click to keep a wall measurement needs workspace edit permission; without it
  the readout still works and double-click does nothing.
- Stale: wall measurements follow the existing measurement rule: from an earlier version of the
  file they show as stale (`MarkupSection.tsx`, "Measured on an earlier version of the file").

## Surfaces and connection modes

Web and desktop, over every connection mode. All of it is computed in the client from the mesh
already loaded. Mobile has no 3D panel.

## Decisions

- Stencil caps, not a computed cap mesh: exact for any closed mesh, no triangulation of
  arbitrary polygons with holes, and the GPU redraws it for free when the plane moves.
- Closed means every edge is shared by exactly two triangles in opposite directions. Anything
  else could fill air or leave holes, so caps are refused rather than drawn wrong.
- Cap colour: a neutral slate darker than the part in both themes, with a 45° hatch, so it reads
  as "cut material" and stays legible in greyscale.
- The cap is unlit: a flat cut should look flat at any camera angle.
- Thickness is the shortest chord through the cursor within the section plane. It equals the
  true wall thickness when the plane is perpendicular to the wall, and reads thicker otherwise;
  the user guide says to choose the axis across the wall.
- Caps default on and are remembered per section in saved views.
- Hover draws only DOM elements (the label and an SVG line), so moving the mouse over the cap
  never renders a WebGL frame.

## Decisions needed from Kyle

Neither blocks the build. The recommended answers are the defaults the packet is written to.

1. How to keep a wall measurement: double-click on the cap (recommended), single click with no
   tool active, or only through the Measure tool. Double-click does not conflict with orbiting or
   focus clicks and needs no mode.
2. Hatch always on, no setting. Recommendation: yes, matching L36, and the brief's "optional
   hatch" is then covered by "Filled cut" off.
