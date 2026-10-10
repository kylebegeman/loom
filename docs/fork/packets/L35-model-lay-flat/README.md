# L35: Lay flat

Status: Ready to build.

Approved by Kyle on 2026-10-10.

A part often arrives in the orientation it was modelled in, not the one it prints in. This packet
lets the user press `L` (or the "Lay flat" tool) and click any face to rest the part on it, or
choose "Auto lay flat" to rest it on its largest flat side. The rotation is preview-only: it is
saved per model in the 3D workspace, never written into the file, and "Reset orientation" undoes
it. While a part is oriented, the bed, fit check, dimensions, sections and (with L36) overhang
shading all follow the new pose, and the Part tab says so. When the user wants the change in the
source, "Ask agent to bake this rotation" drafts a composer request with the exact `rotate()` (or
mesh re-export) to apply. Agents get the same controls through the editor command and the
workspace tool, and `loom_model_preview_3d_render` renders the part as it is oriented.

## Scope

- In:
  - The shared `orientation` workspace entity (exact schema in TECHNICAL.md), its workspace
    operation (set or reset), and server handling.
  - `viewer/orientation.ts`: coplanar face region, rotation to the bed, auto lay flat from the
    convex hull, and part-space/world-space conversion.
  - A "Lay flat" pick mode (`L`, the tool rail, the Part tab) with a hover highlight of the face
    region that will touch the bed.
  - "Auto lay flat", "Reset orientation" and "Ask agent to bake this rotation" in the Part tab and
    the command palette.
  - Measurement and annotation anchors kept in model space so they ride with the part.
  - Editor command `orientation` (auto, reset, face at a point) and `state.orientation` in the
    editor snapshot.
  - `loom_model_preview_3d_render` honours a saved orientation (opt out with
    `orientation: "none"`).
- Out:
  - Rotating by typed angles or a rotate gizmo. A follow-up can add one on top of the same entity.
  - Editing the model file. Baking is always an agent request the user reviews.
  - Arranging several parts or rotating parts of an assembly separately (L48 owns assemblies).
  - Server-side auto lay flat. Agents without an open panel compute a quaternion and save it with
    `loom_model_preview_3d_save_workspace`.

## Surfaces

- Web and desktop: supported.
- Mobile: not supported. Mobile has no 3D panel. The orientation is still stored on the server, so
  a later mobile viewer would read it.
- Remote: works on every connection mode. The orientation is a few dozen bytes in the existing
  workspace stream and `updateWorkspace` RPC; no new bytes or routes.
- Older Loom server: the client sees no `model-lay-flat` feature and hides the lay flat controls,
  because an older server rejects the new workspace operation. Upstream T3 servers have no 3D
  panel (L23).

## Extension points used

None new. Reuses L23's registrations: `ext-panels` (the panel), `ext-mcp` (the render, editor and
workspace tools), the palette entries and the model editor command over `ext-core`. It appends
`"model-lay-flat"` to `LOOM_SERVER_FEATURES` (`apps/server/src/fork/features.ts:2`), which is
fork-owned.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. `ConvexHull` and `BufferGeometryUtils.mergeVertices` ship in three's `examples/jsm`, which
L23 already depends on (three 0.186.0, MIT).

## Relationship to other follow-up packets

This packet creates the shared "Model orientation" definition in
[MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md#model-orientation-created-by-l35-read-by-l32-l36-l46-l47-l48).

- L32 (bed fit): without L35, fit uses the file's own axes. With it, the viewer's stats and the
  render summary are already oriented, so the "Which beds fit?" list follows with no change.
- L36 (overhangs): computed in world space, so shading follows the orientation automatically. The
  render tool's overhang statistics read the oriented mesh this packet produces.
- L37 (section caps): sections stay in world space (horizontal cuts stay horizontal); caps follow
  the rotated mesh because the stencil meshes copy their source's world matrix.
- L40 (units): the bake request and Part tab print angles, not lengths. The "Resting on a face of
  N mm²" message uses one formatting call site to swap for `formatLength` when it lands.
- L46, L47, L48: apply the same rotation server side when the entity exists (shared definition).
- L31 (orthographic camera), L43 (viewport access), L44 (capture export): independent. Captures
  include the oriented part because they render the live scene.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
