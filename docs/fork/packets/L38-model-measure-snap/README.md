# L38: Snapping measurements and hole diameters

Status: Ready to build.

Approved by Kyle on 2026-10-10.

Measuring today lands wherever the ray hits the surface, so a "10 mm" wall reads 9.87 mm
because the click was a hair off the corner. This packet makes the Measure tool snap to the
corners, edges and edge midpoints of the part, with a small marker that shows what it will land
on before you click. Holding `Alt` picks freely. A second measure mode, "Hole", takes one click
on the rim of a hole (or a pin) and reports its diameter and centre, for example "Ø3.40 mm",
including the across-flats size when the hole is a low-sided polygon, which is exactly what
OpenSCAD makes of small holes. Agents get the same snapping and hole fit through the editor
command, and get the saved measurement back in the result.

## Scope

- In:
  - A sharp-edge and adjacency index built once per loaded model, in a web worker, only when the
    Measure tool is first used.
  - Hover snapping in Measure: vertex, edge midpoint and point on edge, within about 10 px,
    each with a distinct marker. `Alt` held picks the raw surface point.
  - "Hole" measure mode: one click on a circular edge loop or the wall of a hole; a least-squares
    circle fit in the loop's plane; saved as a new measurement `kind: "circle"`.
  - Overlay and Markup rows for circle measurements ("Ø3.40 mm", centre, sides and across flats).
  - Editor command support: `pick` with `snap`, `tool` with `measure: "hole"`, and the saved
    measurement returned in the editor result.
  - A triangle cap above which snapping and hover are off, with a note in the hint.
- Out:
  - A BVH or any change to the viewer's raycast core (excluded by Kyle).
  - Snapping for Annotate. Annotation regions stay freehand.
  - Angle, radius-of-arc, and face-to-face (parallel plane) measurements. Possible later packet.
  - Snapping on the section cap. The packet that owns `viewer/sectionCaps.ts` can add cap
    candidates later through the same `snap.ts` query.

## Surfaces

- Web and desktop: supported. All work is in the lazily loaded viewer chunk and a worker.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode. Snapping is client-side on the mesh the client already
  downloaded over signed HTTP; only the saved measurement (under 1 KB) crosses the wire through
  the existing workspace RPC.

## Extension points used

None new. Reuses L23's registrations: `ext-panels` (the 3D panel), `ext-mcp` (the editor tool)
and the model editor command bridge over `ext-core`.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. The worker uses Vite's existing `?worker` import (already used upstream at
`apps/web/src/components/DiffWorkerPoolProvider.tsx:3`).

## Relationship to other follow-up packets

- L40 (units): without it, labels print millimetres with the panel's current formatting. With
  it, the overlay label, Markup row and copy value call `formatLength`. One call site each.
- L31 (orthographic camera): screen-space snapping uses `camera.project`, so it works with
  either camera. No change needed.
- L43 (viewport access): `Alt` is reserved for this packet only while a picking tool is active;
  L43's arrow keys are unaffected. Screen reader announcements can read the hover snap kind
  ("Corner", "Midpoint", "Edge") if L43 lands.
- L35 (lay flat): the index is built on the model's world-space positions after orientation, so
  measurements stay in the same world space as today.
- L42 (change ghost): the ghost is outside `model` and is never a snap target.
- L46 (print check): can reuse the sharp-edge index from `snap.ts` if it needs feature edges.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
