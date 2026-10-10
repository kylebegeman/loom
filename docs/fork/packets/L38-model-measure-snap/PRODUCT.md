# L38 product

## Problem

The Measure tool takes the exact surface point under the cursor. On a printed part what you want
is almost always a feature: corner to corner, edge to edge, the size of a hole. Hitting a corner
by hand is a pixel hunt, so values come out as 9.87 mm instead of 10.00 mm and you cannot tell
whether the part or the click is wrong. Holes are worse: there is no way to measure a diameter
at all, and a hole OpenSCAD drew as a hexagon prints smaller than its nominal size.

## What the user can do

- Turn on Measure (`M`) and move over the part. A marker shows where the click will land:
  a square on a corner, a triangle on an edge midpoint, a diamond on an edge, nothing on a plain
  face. The edge under the cursor is highlighted. Click twice to save a distance, as today.
- Hold `Alt` while clicking to ignore snapping and take the raw surface point.
- Switch the Measure hint to "Hole" and click the rim of a hole, or its wall (the wall works for
  smooth holes; a hexagonal hole's walls are flat faces, so click its rim). The loop that will
  be used is highlighted while hovering, with a preview of the diameter. One click saves
  "Hole 1: Ø3.40 mm". The Markup row shows the diameter, the centre, and for polygonal holes the
  side count and the across-flats size ("6 sides, 2.94 mm across flats"). This works for pins
  and bosses too.
- Copy a hole's diameter from the row menu, rename it, hide it, or delete it, like a distance.
- Agents can ask for snapping when they pick points, measure a hole from one point near its rim,
  and read back the saved value.

## Entry points

| Way in                                                                  | Way out                                              | Where the state shows                              |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Measure tool (`M`, tool rail, Markup "Click two points")                | `Esc`, "Done", `M` again                             | Hint pill, crosshair cursor                        |
| "Distance" / "Hole" switch in the Measure hint                          | The other option; leaving Measure resets to Distance | Selected segment in the hint                       |
| Snapping (on whenever Measure is active and the model is under the cap) | Hold `Alt` for one pick                              | Hover marker and highlighted edge                  |
| Editor `tool` with `measure: "hole"`                                    | `tool` with `name: "select"` or `cancel-tool`        | `state.tool` and `state.measureMode` in `snapshot` |
| Editor `pick` with `snap: true`                                         | Omit `snap`                                          | `measurement` in the result                        |

## States

- Loading: the first time Measure is turned on for a model, the hint reads "Preparing snapping..."
  while the worker builds the index (well under a second for typical parts). Clicks still work
  and take the raw point until it is ready.
- Empty: Markup keeps today's empty note, extended: "Click two points on the model to measure
  the distance between them, or use Hole to measure a diameter."
- Error:
  - Hole click with no circular loop nearby: the hint shows "Click the rim of the hole" for the
    next pick. Nothing is saved.
  - Index build failure (worker error): snapping turns off for this model with the hint
    "Snapping is unavailable for this model"; measuring keeps working without it.
- Disabled: above 1,000,000 triangles snapping and hover are off; the hint ends with
  "Snapping is off for models over 1M triangles." Hole mode is hidden in that case.
- Stale: circle measurements are scoped by `sourceRevision` exactly like distances. After the
  part changes they move to "Earlier versions" in Markup and "Measure again" re-enters Hole mode.

## Surfaces and connection modes

Web and desktop: full support. Mobile: no 3D panel. Remote: everything runs on the client's copy
of the mesh; nothing new is downloaded. Older clients viewing a newer workspace see a circle
measurement as a distance line across the diameter with the diameter value, which is still
correct (see TECHNICAL.md, "Version skew").

## Decisions

- Snap radius 10 CSS px: matches common CAD hover tolerance and stays usable on a trackpad.
- Priority vertex, then midpoint, then edge, then face: corners are what people measure most.
- Sharp edge threshold 20 degrees: keeps facets of a 30-segment cylinder (12 degrees) smooth and
  catches rims and box edges (90 degrees). The three.js default of 1 degree would mark every
  facet of a curved surface.
- Hole fit in the loop's own plane with a least-squares circle: one click, works on any
  orientation, exact on OpenSCAD polygons whose vertices lie on the circle.
- Report across flats for polygons of 22 sides or fewer: there the flat-to-flat size is more
  than 1 percent under the vertex diameter (`1 - cos(π/n)`); from 23 sides it is under 1 percent.
- Build the index in a worker on first use of Measure: no cost for people who never measure, and
  the main thread stays responsive.
- Cap at 1,000,000 triangles: hover raycasts without a BVH cost tens of milliseconds above that.
- Store circles as a new `kind` on the existing measurement entity rather than a new entity: one
  list, one limit, one stale rule, and old clients still draw something true.
- The overlay label shows two decimals, matching the Markup row (today the overlay uses one).

## Decisions needed from Kyle

None. The cap is a named constant; TESTING.md asks for the measured build and hover times on
Kyle's machine so the number can move if it feels wrong.
