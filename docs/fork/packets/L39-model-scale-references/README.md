# L39: Everyday objects for scale

Status: Ready to build.

Approved by Kyle on 2026-10-10.

Millimetres on a status bar do not tell you how big a part feels. This packet adds an optional
everyday object beside the part on the bed: a credit card, a US quarter or a 1 euro coin, an AA
battery, a LEGO 2×4 brick, an M3×10 screw, or an adult hand. You pick it from the Bed menu under
"Show for scale". It is drawn true to size in a neutral grey, sits to the right of the part,
shows up in captures so a screenshot in a thread carries the same sense of size, and never
counts as part of the model: you cannot measure it, pick it, fit to it or see it in the
dimensions. Agents can turn it on through the editor command before a capture.

## Scope

- In:
  - Seven procedural, low-poly reference objects with cited real dimensions, in
    `viewer/references.ts`.
  - Placement on the bed to the right of the part, re-placed whenever the part reloads.
  - A "Show for scale" choice in the Bed menu and a matching row in Settings, saved as an
    environment setting with a decoding default of none.
  - Inclusion in single and four-view captures and in named-view capture sheets.
  - `display` editor command field `reference`.
- Out:
  - Labels or dimension callouts on the reference. The menu names it; captures show the shape.
  - User-supplied reference meshes. A later packet could accept an STL.
  - Dragging the reference around. It has one deterministic place.
  - Changing fit or standard views to include the reference (see PRODUCT.md, decisions).

## Surfaces

- Web and desktop: supported.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode. Geometry is generated on the client; the only wire
  traffic is the existing settings RPC carrying one short string.

## Extension points used

None new. Reuses L23's registrations: `ext-panels` (the panel and Settings section), `ext-mcp`
(the editor and settings tools) and the model editor command bridge over `ext-core`.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. Geometry uses three.js core classes already bundled (`Shape`, `ExtrudeGeometry`,
`CylinderGeometry`, `BoxGeometry`).

## Relationship to other follow-up packets

- L32, L33, L51 (bed lists and printers): the reference sits beside the part, not at a bed
  position, so it does not depend on which bed is active. A wide part on a small bed can push the
  reference past the plate edge; that is fine for a size cue.
- L35 (lay flat): placement reads the model's world-space box, which is already after
  orientation.
- L40 (units): no lengths are shown, so nothing to format.
- L44 (capture export): copies and saves the same capture image, so the reference is included
  whenever it is visible.
- L48 (assemblies): place the reference to the right of the whole assembly's box. If L48 lands
  first, `placeReference` takes the assembly box instead of the single model box.
- L42 and L49 (ghost): the ghost and the reference are both outside `model`; they do not
  interact.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): dimensions and sources.
