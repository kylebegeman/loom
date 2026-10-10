# L31: Orthographic camera

Status: Ready to build

Approved by Kyle on 2026-10-10.

The 3D model viewport can switch between perspective and orthographic projection. Orthographic
shows parallel edges as parallel and keeps every part of the model at the same scale, which is
what you want when checking alignment, comparing a part against a drawing or reading a front or
top view. `P` toggles it, the Display menu shows it, saved views remember it, and the four-view
sheet is always orthographic like a drawing. Agents can set it through the editor command and
ask the render tool for orthographic PNGs.

## Scope

- In:
  - An `OrthographicCamera` in the viewer that follows the existing perspective rig, so orbit,
    pan, zoom, fit, standard views and restore keep working unchanged.
  - `P` key and an "Orthographic" checkbox in the Display menu.
  - `projection` on `ModelCamera`, so saved views, annotations and the editor `camera` action
    carry it. Old rows decode as perspective.
  - Four-view sheet always orthographic. Single captures and named-view sheets use each view's
    own projection.
  - `projection` on the editor `display` action and on `loom_model_preview_3d_render`.
- Out:
  - A projection setting or default in Settings (the panel always opens in perspective).
  - Animated transitions between projections.
  - Dimension annotations or drawing borders on the sheet.

## Surfaces

Web and desktop: supported. Mobile has no 3D panel. Remote: nothing new crosses the wire except
one enum field in the workspace JSON and the editor command, so LAN, Tailscale and T3 Connect
behave as today.

## Extension points used

Reuses L23's `ext-panels`, `ext-mcp` and `ext-web-root` + `ext-keybindings` (the panel key
handler). Creates none.

## Packet seams

None. Every edit is in fork-owned L23 files. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. three 0.186.0 already ships `OrthographicCamera`.

## Relationship to other follow-up packets

- L43 (viewport access): its announcer reads the projection when L31 has landed. Without L31 it
  simply has nothing to announce for it. Arrow-key orbit and pan work in either projection
  because L31 keeps OrbitControls on the perspective rig.
- L44 (capture export): copy and save reuse the same capture functions, so exported images
  follow the projection automatically.
- L36, L37, L38, L42 (overlays and picking): they must render and raycast with
  `activeCamera()`, not `camera`. L31 adds that accessor; packets that land later use it.
- L40 (units): no interaction.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
