# L32: Which beds fit?

Status: Ready to build.

Approved by Kyle on 2026-10-10.

The Part tab already says whether the current part fits the active bed. This packet adds a
compact "Which beds fit?" list below that check: one row per bed (printers, surfaces and any
custom beds) saying "Fits", "Fits rotated" or how much too big it is. Clicking a row makes that
bed the active one, so the viewport, the fit card and the status bar follow. Agents get the same
answer: `loom_model_preview_3d_render` returns a fit summary across the user's beds, and the
editor snapshot includes it, so an agent can pick a target printer or resize a part to suit one.

## Scope

- In:
  - A pure fit helper for one part against one bed (as placed, then rotated 90 degrees about Z),
    shared by web and server.
  - A pure bed list shared by web and server, so the server can check every bed (see
    TECHNICAL.md, "Bed list in contracts").
  - The "Which beds fit?" list in Part, with a "Fits N of M" count, the active bed marked, and
    click to select.
  - A `fit` field on the render tool result and on the editor `snapshot` state.
- Out:
  - Fit at an arbitrary angle about Z (diagonal placement). Documented as a follow-up in
    TECHNICAL.md, "Alternatives considered".
  - Placement on the bed (where the part sits). Fit is about size only, as a slicer's
    auto-arrange would place it.
  - Nozzle zones. L34 adds zone-aware results to the same helper.
  - Orientation. L35 owns rotating the part; this packet reads whatever size the viewer and
    the render report.

## Surfaces

- Web and desktop: supported. The list is plain React in the Part tab; no viewer change.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode. Selecting a bed is the existing `updateSettings`
  RPC; the fit summary rides on existing MCP and editor responses (a few kilobytes at most).
- Upstream T3 server: the 3D panel is already hidden there (L23).

## Extension points used

None new. Reuses L23's registrations: `ext-panels` (the panel), `ext-mcp` (the render tool) and
the model editor command over `ext-core`.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L33 (custom beds): without it, the list shows presets plus the single "Custom" size. With it,
  it shows named custom beds and leaves out hidden presets (the active bed is always listed).
  Both work because the list comes from the shared bed list, never from `BUILD_PLATE_PRESETS`.
- L34 (nozzle zones): without it, rows for the H2D and H2C judge the whole bed. With it, the
  same helper returns a zone, and rows say which nozzle area the part fits.
- L35 (lay flat): without it, size is the mesh's axis-aligned box. With it, size is measured
  after the saved orientation, on both web and server, with no change here.
- L40 (units): without it, lengths print in millimetres from one helper in this packet. With it,
  that helper calls `formatLength`.
- L51 (printer library): replaces the data behind the bed list. The fit helper and the list UI
  keep working.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
