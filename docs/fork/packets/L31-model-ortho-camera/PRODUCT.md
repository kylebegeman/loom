# L31 product

## Problem

The viewport is perspective only (`createViewer.ts:53`). Perspective foreshortening makes it
hard to judge whether two faces line up, whether a hole sits on the centre line, or how a front
view compares with a sketch. Slicers and CAD tools all offer an orthographic toggle. The
four-view sheet that agents read is also perspective today, which makes "front" and "top" look
less like the drawings they stand in for.

## What the user can do

- Press `P`, or tick "Orthographic" in the Display menu, to switch projection. The view keeps
  its direction, centre and apparent size, so the switch reads as a change of lens, not a jump.
- Orbit, pan, zoom, fit, press `1` to `4`, measure, annotate and section exactly as before.
- Save a view in orthographic and get orthographic back when recalling it.
- Capture the four-view sheet and get a drawing-like orthographic sheet regardless of the
  current projection. "Current view" captures what is on screen.
- Ask an agent to show a part in orthographic, or to render orthographic PNGs.

## Entry points

| Way in                                           | Way out                           | Where the state shows                   |
| ------------------------------------------------ | --------------------------------- | --------------------------------------- |
| `P` in the panel                                 | `P` again                         | Display menu checkbox, help popover row |
| Display menu "Orthographic"                      | Untick it                         | Checkbox state                          |
| Recall a saved view stored in ortho              | `P`, or recall another view       | Checkbox; view row says "Orthographic"  |
| Agent editor command `display` with `projection` | Same command, other value, or `P` | Checkbox                                |
| Agent editor command `camera` with a camera      | Any of the above                  | Checkbox                                |

Opening a model, or reloading the panel, starts in perspective. Fit (`F`) and the standard
views keep the current projection.

## States

- Loading: the toggle works before a model arrives; the first frame uses the chosen projection.
- Empty (no model): the checkbox is available and harmless, like Wireframe today.
- Error: no new error states. A render tool call with an OpenSCAD build that rejects
  `--projection` fails with the existing OpenSCAD log in the tool result.
- Disabled: never disabled.
- Stale: a saved view from an earlier revision refits on open as today
  (`ViewsSection.tsx:227-234`) and keeps its stored projection.

## Surfaces and connection modes

Web and desktop. Mobile has no 3D panel. All connection modes behave the same; the setting is
local view state plus one enum in the workspace JSON.

## Decisions

- Orbit controls keep driving the perspective camera; the orthographic camera copies it before
  each frame. One rig means fit, zoom, restore and saved views need no second code path.
- The four-view sheet is always orthographic: it stands in for an engineering drawing.
- Single captures and named-view sheets use the projection on screen or stored with the view:
  the user framed them on purpose.
- Old saved views decode as perspective: that is what they were saved in.
- No settings default: one key is cheaper than another setting to explain.

## Decisions needed from Kyle

1. Default projection for `loom_model_preview_3d_render` when the agent does not pass one.
   Recommendation: orthographic, matching the in-panel four-view sheet and making front, top
   and right views read as drawings. Today it is hard-coded perspective
   (`openscad.ts:79`), so agents relying on the old look would need to pass
   `projection: "perspective"`. Building to the recommendation is safe; flipping it later is a
   one-line change.
