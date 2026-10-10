# L32 product

## Problem

Kyle owns several printers (H2D, H2C, Kobra S1) and designs parts with agents. Today Part only
answers "does it fit the bed I picked?", so finding out which printer can take a part means
switching beds one at a time. Agents have no fit information at all: the render tool returns a
bounding box but nothing about any printer.

## What the user can do

- Open Part and see every bed with a one-word answer: "Fits", "Fits rotated", or the overage
  in the same words the fit card uses ("12.0 mm too wide, 3.0 mm too tall").
- See at a glance how many beds fit ("Fits 9 of 14").
- Click a row to make that bed the active bed. The viewport plate, the fit card, the status bar
  warning and variants follow, exactly as when the bed is chosen from the Bed menu.
- Ask an agent "which of my printers can print this?" and get an answer grounded in the same
  numbers, because the render tool returns a fit summary.

## Entry points

| Way in                                | Way out                                                                 | How the state shows                                        |
| ------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Part tab, "Which beds fit?" list      | Switch tab, or hide the inspector (`I`)                                 | The list itself; the active row is marked "Active".        |
| Click a row to select that bed        | Click another row, or use the Bed menu, Part's printer menu or settings | Bed menu label, Part's printer menu, viewport plate.       |
| Agent: `loom_model_preview_3d_render` | Not applicable (read-only)                                              | `fit` in the tool result.                                  |
| Agent: editor `snapshot`              | Not applicable (read-only)                                              | `state.fit` in the result.                                 |
| Agent: select a bed                   | Same tool with another bed                                              | Existing `loom_model_preview_3d_save_settings`, unchanged. |

No new keybinding and no palette entry: selecting a bed is already in three places, and the list
is a read-out first.

## States

- Loading: before the model loads, Part already shows "Dimensions appear when the model loads."
  (`apps/web/src/fork/model-preview-3d/ModelInspector.tsx:360`). The list is not rendered.
- Empty: there is always at least one bed (the active one), so the list is never empty.
- Error: when the model fails to load, Part has no stats and shows the same empty note.
- Disabled: when the connection cannot change model settings, rows stay readable but are not
  clickable, with the existing tip "This connection cannot change model settings."
- Pending: after a click, the clicked row shows as active immediately (the optimistic value from
  `useBuildPlate`), and reverts with the existing "Bed not changed" toast on failure
  (`apps/web/src/fork/model-preview-3d/BedPicker.tsx:61`).
- Stale: the list recomputes whenever the model reloads or the bed setting changes. It has no
  cached state of its own.
- Agent, no geometry summary: an OpenSCAD build without `--summary-file` gives no bounding box,
  so `fit` is `null` and the tool description says why.

## Surfaces and connection modes

Web and desktop show the list. Mobile has no 3D panel. Remote connections behave the same, since
selection is the existing settings RPC. An upstream T3 server never shows the panel.

## Decisions

- Keep the list in menu order (printers, surfaces, custom), not fitting beds first. Rows that
  jump around when the part reloads are harder to scan than a stable list with a count, and the
  order matches the Bed menu.
- Mark the active bed in place rather than pinning it to the top, for the same reason.
- Check as placed and rotated 90 degrees about Z only. It matches what the fit card already says
  (`ModelInspector.tsx:368`) and what a person does on a slicer plate; diagonal fit is rarely
  useful and is documented as a follow-up.
- Report overage for the part as placed, in the fit card's words ("too wide", "too deep",
  "too tall"), so the list and the card never disagree.
- Surfaces are included and judged on footprint only, as the fit card does.
- Hidden presets (L33) are left out of the list and the agent summary; the active bed is always
  included.
- Agents select a bed with the existing save settings tool; no new tool.

## Decisions needed from Kyle

None. Two choices above are easy to reverse: list order (recommended: stable menu order) and
diagonal fit (recommended: not now).
