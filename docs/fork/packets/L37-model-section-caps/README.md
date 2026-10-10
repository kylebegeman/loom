# L37: Section caps and wall thickness

Status: Ready to build.

Approved by Kyle on 2026-10-10.

Today a section plane cuts the part open and leaves it hollow: the inside shows as missing faces,
so it is hard to tell solid from air or judge how thick a wall is. This packet fills the cut with
a solid, hatched cap, like a CAD section view, in a colour that stands apart from the part in
both themes. Hovering the cap shows the wall thickness under the cursor ("2.4 mm wall") with a
line across the wall, and double-clicking keeps it as a measurement. Meshes that are not closed
cannot be capped honestly, so the panel says "Caps need a closed mesh" instead of drawing a wrong
fill. Captures include the caps, and agents can turn them on and ask for the thickness at a point
through the editor command.

## Scope

- In:
  - Stencil caps for the existing section plane (`viewer/sectionCaps.ts`), with a screen-space
    hatch, theme colours, and the renderer created with `stencil: true`.
  - A closed-mesh check per geometry, run once on first use, with the "Caps need a closed mesh"
    state.
  - A CPU cross-section of the cut (segments on the plane) used for hover thickness, picking on
    the cap, and the editor command.
  - Hover readout and chord line, double-click to save a "Wall N" measurement.
  - A "Filled cut" toggle in the section strip, stored as `ModelSection.caps` (default on).
  - Editor command `wall-thickness` and `state.sectionCaps`.
- Out:
  - True 3D wall thickness (ray casting along surface normals through the solid). The readout is
    the thickness within the section plane; TECHNICAL.md explains the limit.
  - A section option on `loom_model_preview_3d_render` (an OpenSCAD `intersection()` with a half
    space). Listed as a follow-up in TECHNICAL.md, "Alternatives considered".
  - Several section planes at once.
  - Mobile. Mobile has no 3D panel.

## Surfaces

- Web and desktop: supported.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: entirely client-side apart from the `caps` flag, which rides the existing saved view
  and editor payloads. No new bytes or routes.
- Older Loom server: works. An older server drops the unknown `caps` field from saved views, so
  they recall with caps on (the default). Upstream T3 servers have no 3D panel (L23).

## Extension points used

None new. Reuses L23's registrations: `ext-panels` (the panel) and the model editor command over
`ext-core` (through `ext-mcp`'s editor tool).

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. The stencil technique follows three's `webgl_clipping_stencil` example (MIT); no code from
it is copied beyond the material settings it demonstrates.

## Relationship to other follow-up packets

- L35 (lay flat): sections stay in world space, so a Z cut is horizontal across the oriented part.
  Stencil meshes copy their source mesh's world matrix and resync when the orientation changes.
  Wall measurements are stored in model space like every other anchor.
- L36 (overhangs): the cap uses its own unlit material and is never overhang-shaded.
- L40 (units): the readout uses a single length call site, swapped for `formatLength` when L40
  lands.
- L31 (orthographic camera): the stencil technique is camera independent.
- L42 (change ghost): the ghost is not capped; it is a translucent overlay.
- L44 (capture export): captures render the live canvas, so caps are included.
- L46 (print checks): may later reuse `sectionSegments` for a thin-wall check; nothing here
  depends on it.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
