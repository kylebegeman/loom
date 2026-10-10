# L56 product

## Problem

Checking an assembly drawing, the copper alone, or silkscreen against mask openings means
clicking eight to twelve eye toggles in Layers, every time, on every board. Saved sets help
but are per design, so each new board starts from nothing. The status bar also says "Front
copper" while a saved set is showing (`PcbPreviewPanel.tsx:1334-1342`), so it misreports what
is on screen.

## What the user can do

- Apply a built-in preset with one click in Layers or from the drawing's layer menu.
- See which preset or saved set is active: its chip is pressed, and the shelf and status bar
  show its name. A manual change afterwards shows "Custom" as today.
- Hide built-ins they do not use, and show them again from the section menu.
- Duplicate a built-in into a saved set, then adjust it like any saved set.
- Ask an agent to "show the assembly front": it sends the editor `layers` command with
  `name: "assembly-front"`.

| Preset           | Id                 | Visible layers                                          |
| ---------------- | ------------------ | ------------------------------------------------------- |
| Assembly front   | `assembly-front`   | F.Fab, F.Silkscreen, F.Courtyard, Edge.Cuts             |
| Assembly back    | `assembly-back`    | B.Fab, B.Silkscreen, B.Courtyard, Edge.Cuts             |
| Copper only      | `copper-only`      | F.Cu, every In*n*.Cu, B.Cu                              |
| Fab review       | `fab-review`       | all copper, F.Mask, B.Mask, F.Paste, B.Paste, Edge.Cuts |
| Silkscreen check | `silkscreen-check` | F.Silkscreen, B.Silkscreen, F.Mask, B.Mask, Edge.Cuts   |

Every other layer is hidden. Opacity is 1 for every layer. Layers missing from a board are
skipped; a preset whose layers are all missing, apart from Edge.Cuts, is shown disabled with
the hint "This board has none of these layers".

## Entry points

| Way in                                                              | Way out                                                       | Where the state shows                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Layers, "Presets" chip                                              | Another chip, a copper preset, a saved set, or any eye toggle | Pressed chip; shelf label; status bar                |
| Drawing layer menu, "Presets" group                                 | Same menu, another item                                       | Check mark in the menu; shelf label                  |
| Chip "Hide" (the chip's remove button, label "Hide Assembly front") | Section menu, "Show Assembly front"                           | Section count ("3 of 5"); the menu lists hidden ones |
| Section menu, "Duplicate as saved set", per preset                  | Remove the saved set (existing chip remove)                   | New chip under "Saved sets"                          |
| Editor command `layers` with `name`                                 | Any other `layers` command or user action                     | `loom_pcb_editor` snapshot `layerPreset`             |

## States

- Loading: before the board is inspected the section is not shown; the tab already says
  "Reading board layers" (`LayersTab.tsx:85-90`).
- Empty: all five hidden. The section shows "All presets are hidden." with the menu still
  available to show them.
- Error: duplicating fails (no write grant, conflict, or 20 saved sets already). The existing
  write error line under Saved sets shows the message; a full list disables "Duplicate" with
  "Saved sets are full (20)".
- Disabled: "Duplicate" without the workspace write grant (`canSave`), matching "Save set".
  Applying and hiding need no grant.
- Stale: a board reload with new or removed layers re-resolves the active preset against the
  new layer list, so the preset stays pressed and new inner copper layers appear in "Copper
  only".

## Surfaces and connection modes

Web and desktop, KiCad boards. Mobile has no PCB panel. Every connection mode works; only
"Duplicate" writes, through the existing workspace RPC.

## Decisions

- Data lives in contracts so the server-side packets that draw assembly pages (L57, L65) use
  the same layer lists.
- Ids are stable kebab-case strings; display names may change, ids may not.
- Hidden built-ins are per device: hiding is a personal clutter choice and needs no grant.
- Opacity 1 everywhere: presets choose layers, not looks. Duplicate to tune opacity.
- "Silkscreen check" shows both sides, as specified. Use Solo on one side when the overlap is
  confusing.
- The existing copper segment (Front, Back, All copper) stays; it controls the base render and
  remembered selection (`PcbPreviewPanel.tsx:642-646`), and changing it is out of scope.

## Decisions needed from Kyle

None.
