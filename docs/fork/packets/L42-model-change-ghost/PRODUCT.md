# L42 product

## Problem

Live reload is one of the best parts of the 3D panel: an agent edits the SCAD and the part
updates. But the update erases the old shape. Small changes (a hole moved 2 mm, a wall thinned)
are invisible unless you remember exactly what it looked like, and big changes leave you
wondering what else moved. Reviewing an agent's geometry change should be as easy as reviewing
a code diff.

## What the user can do

- After the part reloads because its file changed, see a chip: "Changed. Show previous (D)".
- Press `D` (or click the chip, or tick "Previous version" in the Display menu) to draw the
  previous version as a translucent grey ghost over the current part. Material that was removed
  shows as ghost outside the part; material that was added shows as solid part where there was
  no ghost. Press `D` again to hide it.
- Read the size change in the Part tab under each dimension, for example "X +2.0 mm".
- Dismiss the chip with its close button; `D` keeps working.
- After a SCAD parameter change, press `D` to compare with the previous render too. No chip
  appears for changes you made yourself.
- Orbit, section and capture with the ghost shown; captures include it.
- Ask an agent to show the previous version and capture, to illustrate what it changed.

## Entry points

| Way in                                                     | Way out                                           | Where the state shows                              |
| ---------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `D` in the viewport                                        | `D` again                                         | Ghost in the viewport; Display menu checkbox       |
| Chip "Show previous" after a file change                   | Chip "Hide", `D`, or the close button (chip only) | Chip text switches to "Showing previous. Hide (D)" |
| Display menu, "Previous version" (`D`)                     | Untick it                                         | Checkbox state                                     |
| Command palette, "3D model: Show or hide previous version" | Run it again                                      | Ghost and checkbox                                 |
| Editor `display` with `previous: true`                     | `previous: false`                                 | `snapshot` returns `state.previous.shown`          |

## States

- Loading: none. The previous mesh is already in memory; showing it is one frame.
- Empty: before the first reload there is no previous version. The menu item is disabled with
  the hint "Appears after the model changes", `D` does nothing, no chip.
- Error: the editor command `previous: true` with no previous version fails with
  "No previous version yet."
- Disabled: models over 1,000,000 triangles do not keep a previous version (memory); the menu
  item is disabled with "Not kept for models over 1M triangles". A reload that produces the same
  geometry revision keeps nothing, since there is nothing to compare.
- Stale: the ghost is always the version replaced by the most recent reload. After another
  reload it moves one step forward. If it was showing, it stays showing. Leaving the panel hidden
  for over a minute releases the viewer (L23's hidden release), and the previous version with it.

## Surfaces and connection modes

Web and desktop: supported. Mobile: no 3D panel. Remote: nothing is downloaded beyond the meshes
the panel already loads, so the feature behaves the same over LAN, Tailscale and T3 Connect.

## Decisions

- One previous version per open model, held only by the main panel's viewer: covers "what just
  changed" with bounded memory (at most two meshes); deeper history is L49.
- Ghost style from the shared definition (translucent, depth-tested, unlit, muted grey): reads as
  "not the part" in both themes and shows removed material naturally.
- Chip only for reloads caused by a file change (agent or editor edits), not for your own
  parameter changes or settings changes: you already know what you changed; the chip is for
  changes made elsewhere.
- `D` still works after parameter re-renders, including Live mode: the ghost is the last applied
  geometry before the most recent reload, whatever caused it.
- The section plane clips the ghost too: otherwise the ghost hides the cut.
- Captures include the ghost while shown: a capture should match the viewport, and it is how an
  agent shows a change in a thread.
- Dimension deltas show only when an axis moved by 0.05 mm or more: below that is float noise
  and rounding.
- Same-revision reloads keep no previous: the server's mesh revision already identifies geometry
  (a hash of size, time and inode for files, the render key for SCAD).

## Decisions needed from Kyle

None blocking. One recommendation to confirm: ship v1 without the difference tint. The ghost
already shows added and removed material; the tint needs a worker, a size cap and vertex colours
on the current model (which conflicts with coloured 3MF parts), and is designed in TECHNICAL.md
as a phase 2 if the ghost alone proves not enough.
