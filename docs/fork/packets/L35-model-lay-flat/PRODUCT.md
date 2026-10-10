# L35 product

## Problem

Parts come out of OpenSCAD, CAD exports and downloads in whatever orientation they were modelled
in. A bracket modelled standing up looks fine in the panel but prints on its narrow edge, and the
fit check, dimensions and section planes all describe that wrong pose. Today the only fix is to
ask an agent to edit the source and wait for a re-render, just to see the part the way it will
sit on the bed. Slicers solved this long ago with "place on face" and "lay flat"; the panel
should let the user do the same before any file changes.

## What the user can do

- Press `L` (or click "Lay flat" in the tool rail, or "Lay flat on a face" in Part) and hover the
  part. The flat region under the cursor highlights; clicking it rotates the part so that region
  rests on the bed. The tool stays active so the user can try another face; `Escape` or "Done"
  ends it.
- Choose "Auto lay flat" (Part tab or command palette) to rest the part on its largest flat side.
- See the oriented pose everywhere that reads world space: the bed sits under the part, the status
  bar dimensions and "Larger than the bed" warning use the oriented size, the Part tab fit card
  follows, sections cut horizontally across the oriented part, and captures show it.
- See that an orientation is active: the Part tab "Orientation" row says "Laid flat" (or "As
  modelled"), and the status bar shows a "Laid flat" chip that opens the Part tab.
- Choose "Reset orientation" to return to the file's own axes.
- Choose "Ask agent to bake this rotation" to add a request to the composer that tells the agent
  the exact rotation to apply to the source (`rotate([x, y, z])` for SCAD, a re-export for
  meshes) and to reset the Loom orientation afterwards. Nothing is edited until the agent acts
  and the user reviews it.
- Keep measurements and annotations: they stay attached to the same spots on the part.

## Entry points

| Way in                                                   | Way out                                                              | Where the state shows                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `L` key, tool rail "Lay flat", Part "Lay flat on a face" | `Escape`, hint "Done", `L` again, choosing another tool              | Tool rail button pressed; hint "Click the face to rest on the bed" |
| Clicking a face                                          | "Reset orientation", or click another face                           | Part "Orientation: Laid flat"; status bar "Laid flat" chip         |
| Part "Auto lay flat", palette "3D model: Auto lay flat"  | "Reset orientation"                                                  | Same as above                                                      |
| Agent editor command `orientation` or workspace tool     | Same command with `name: "reset"`, or the user's "Reset orientation" | Same as above; `state.orientation` in the editor snapshot          |
| "Ask agent to bake this rotation"                        | Remove the text from the composer                                    | The composer draft                                                 |

Palette entries: "3D model: Auto lay flat" and "3D model: Reset orientation" (the second only
while an orientation is active). The keyboard path is `L`.

## States

- Loading: before the model loads, the lay flat controls are disabled like Measure (`editDisabled`,
  `apps/web/src/fork/model-preview-3d/ModelPanel.tsx:539`). A saved orientation is applied as soon
  as the model and the workspace are both loaded; until the workspace arrives the part shows as
  modelled, then turns once (no animation).
- Empty: no orientation saved. Part shows "Orientation: As modelled" with "Lay flat on a face" and
  "Auto lay flat"; no Reset button, no status bar chip.
- Hover with no flat region (cursor off the part): no highlight, the hint stays.
- Already resting: clicking the face already on the bed does nothing and the hint briefly says
  "Already resting on that face".
- Error: a failed save shows the existing workspace save error, and the part returns to the last
  saved orientation.
- Disabled: without workspace edit permission, the controls are disabled with the same tip as
  Measure and Annotate. Against a Loom server without the `model-lay-flat` feature the controls
  are hidden; a saved orientation cannot exist there.
- Stale: the orientation keeps applying after the file changes, because a re-render rarely moves
  the faces. When `sourceRevision` differs from the current revision, Part adds "Set on an
  earlier version of this file" next to Reset, so a user who just baked the rotation sees why the
  part looks rotated twice.

## Surfaces and connection modes

Web and desktop, over every connection mode. The orientation is stored on the environment's
server, so another client, the user's other device and agents all see the same pose. Mobile has
no 3D panel.

## Decisions

- Preview only, stored per model in the workspace. The file stays the source of truth; reverting
  is one click.
- Coplanar region, not the clicked triangle: tessellated faces are many triangles, and the region's
  area-weighted normal is what actually lands on the bed.
- Auto uses the largest convex hull face group: every hull face is a stable resting face, and the
  largest is what slicers pick.
- Anchors (measurements, annotations, editor `pick` points) stay in model space, the file's own
  coordinates. Existing data stays valid and marks ride with the part.
- Per-axis measurement deltas in Markup use bed axes when oriented, so "Z" stays print height. The
  distance never changes.
- Sections stay in world space. Horizontal cuts across an oriented part are what a user wants when
  checking layers; the section offset recentres when the orientation changes.
- Saved views store a camera only. Recalling one shows the part as currently oriented.
- Baking is an agent request, never an automatic edit.

## Decisions needed from Kyle

None block the build. The recommended answers below are the defaults the packet is written to.

1. Measurement and annotation anchors in model space (they follow the part) rather than world
   space (they stay where they were on screen). Recommendation: model space.
2. The render tool applies a saved orientation by default, with `orientation: "none"` to opt out.
   Recommendation: yes; an agent asking "how does this look" should see what the user sees.
3. SCAD renders with an orientation go through an exported mesh (TECHNICAL.md, "Server"), which
   can drop per-object colours in the PNGs (whether OpenSCAD keeps 3MF colours on import is
   unverified). It also makes multi-view renders faster. Recommendation: accept.
