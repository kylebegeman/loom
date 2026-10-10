# L42: Show the previous version after a change

Status: Ready to build.

Approved by Kyle on 2026-10-10.

When an agent edits a model, the viewer reloads and the old shape is gone, so "what changed?"
means flipping between commits or trusting the agent's summary. With this packet the viewer
keeps the shape it just replaced. A small chip says "Changed. Show previous (D)"; pressing `D`
draws the previous version as a faint, see-through ghost in the same place, so added and
removed material is obvious at a glance. The Part tab shows how each dimension moved
("X +2.0 mm"). It works the same for SCAD re-renders, so tweaking a parameter and pressing `D`
compares with the last result. Agents can show the ghost before a capture to illustrate a change.

## Scope

- In:
  - Keep exactly one previous mesh per open model in the main panel, handed over on reload,
    disposed on the next reload, on tab close and on the panel's hidden release.
  - `viewer/ghost.ts`, created from the shared definition in
    [MODEL-3D-FOLLOW-UPS.md](../MODEL-3D-FOLLOW-UPS.md), plus three additive methods this packet
    needs (see TECHNICAL.md, "Ghost").
  - `D`, a "Previous version" item in the Display menu, a command palette action and the
    editor `display` field `previous`, all toggling the ghost.
  - The "Changed" chip after reloads caused by a file change, dismissible.
  - Dimension deltas in Part.
  - The ghost in captures while shown.
- Out:
  - The difference tint (colouring changed regions). Designed in TECHNICAL.md as a phase 2;
    see PRODUCT.md for the recommendation.
  - More than one step of history. L49 owns history across checkpoints and reuses the ghost.
  - Ghosts in the variants comparison, thumbnail or PCB viewers.

## Surfaces

- Web and desktop: supported.
- Mobile: not supported. Mobile has no 3D panel.
- Remote: works on every connection mode. The previous mesh is the one the client already
  downloaded over signed HTTP; nothing new is fetched or sent.

## Extension points used

None new. Reuses L23's registrations: `ext-panels` (the panel), the fork command palette source
already registered by L23 (`apps/web/src/fork/model-preview-3d/palette.tsx`), `ext-mcp` (the
editor tool) and the model editor command bridge over `ext-core`.

## Packet seams

None. Every file touched is fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None.

## Relationship to other follow-up packets

- L49 (history): reuses `viewer/ghost.ts`. The viewer's shared `setGhost(object)` slot is L49's;
  this packet keeps its own ghost instance for "previous", so `D` and the history timeline do
  not fight over one slot. If L49 lands first, this packet reuses its `ghost.ts` and adds only
  the missing methods.
- L38 (snapping): the ghost is outside `model`, never pickable or snappable.
- L39 (scale references): independent; both live outside `model`.
- L40 (units): the Part deltas call `formatLength` when it exists; until then they print
  millimetres with one decimal, like the status bar.
- L35 (lay flat): the previous model keeps the transform it had when it was replaced. If the
  orientation changed in the same reload, the ghost shows the old orientation, which is the
  honest "before".
- L36 (section caps): the section plane also clips the ghost; caps are not drawn for it.
- L44 (capture export): exports the same capture, ghost included when shown.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch (none).
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
