# L36: Overhang shading

Status: Needs decision: the render tool returns overhang statistics, not shaded images.

Approved by Kyle on 2026-10-10.

Before slicing, the question that matters most about a printed part is where it will need
support. This packet adds an "Overhangs" display mode: press `V` (or tick it in the display
menu) and every downward-facing surface steeper than the threshold is tinted orange with a fine
diagonal hatch, so it reads in both themes and without relying on colour. A legend chip,
"Overhangs over 45°", sits in the viewport while the mode is on; clicking it opens a slider from
30° to 70°. Shading is computed in world space, so it follows L35's lay flat, and faces resting on
the bed are never marked. Agents can switch the mode through the editor command, see it in panel
captures, and ask `loom_model_preview_3d_render` for overhang statistics (area, share of the
surface, and the largest regions) even when no panel is open.

## Scope

- In:
  - `viewer/overhangs.ts`: a material patch (one shared set of uniforms, no recompile when the
    angle or toggle changes) that tints and hatches overhang fragments, excluding the first layer
    above the bed.
  - The `V` key, a "Overhangs" checkbox in the display menu, the legend chip with its slider
    popover, a `HELP` row and a palette toggle.
  - `overhangAngleDegrees` in settings (30 to 70, default 45) and `overhangs` in `ModelCamera`, so
    saved views and annotations recall the mode.
  - Editor command `display` gains `overhangs`.
  - Render tool `overhangs` option returning statistics from a server-side pure helper.
- Out:
  - Shaded PNGs from the render tool. OpenSCAD's PNG export cannot colour faces by normal; a
    coloured-import spike is described in TECHNICAL.md and left for Kyle to approve.
  - Support generation, bridges detection, or minimum feature checks (L46 print checks).
  - Per-printer thresholds. One environment-wide angle for now.
  - Mobile. Mobile has no 3D panel.

## Surfaces

- Web and desktop: supported.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: shading is client-side. The threshold rides the existing settings RPC; statistics ride
  the existing MCP response (well under 2 KB). No new bytes or routes.
- Older Loom server: the display mode works (it is client-only); the threshold slider falls back
  to 45° because an older server drops the unknown setting, so the slider is hidden unless the
  server advertises `model-overhangs`. The render tool option exists only on servers that have it.

## Extension points used

None new. Reuses L23's registrations: `ext-panels` (the panel), `ext-settings` (the angle),
`ext-mcp` (the render tool), palette entries and the model editor command over `ext-core`.
Appends `"model-overhangs"` to `LOOM_SERVER_FEATURES` (`apps/server/src/fork/features.ts:2`).

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L35 (lay flat): without it, shading uses the file's own axes. With it, the shader reads world
  normals and world height, so it follows the orientation with no extra code; the statistics take
  the saved orientation's "up" direction (TECHNICAL.md, "Server").
- L37 (section caps): caps use their own material and are not shaded. Cut faces are not real
  surfaces, so this is correct.
- L31 (orthographic camera): independent. The hatch is in screen space and works with either
  camera.
- L40 (units): areas in the chip tooltip go through the single length call site; the angle is
  degrees in both unit systems.
- L44 (capture export): captures render the live scene, so exported images include the shading.
- L46 (print checks): reuses `overhangStats` from this packet for its overhang check instead of
  writing a second one.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
