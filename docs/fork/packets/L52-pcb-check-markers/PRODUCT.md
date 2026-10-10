# L52 product

## Problem

ERC and DRC answer "what is wrong" but not "where". Today you read a list in Checks, expand a
rule, and press a Locate button per item, one at a time. For ERC that button currently goes to
the wrong place on `main` (fixed on the unmerged local `fix/preview-defects` branch): KiCad
writes ERC positions a hundred times too small in the versions Loom supports (see TECHNICAL.md, "The ERC scale bug"), so Locate centres near the sheet's top left
corner. Anyone triaging a report with more than a handful of findings wants to see them all on
the drawing and walk through them.

## What the user can do

- See every finding of the latest ERC on the schematic sheet it belongs to, and every finding
  of the latest DRC on the board, as severity pins.
- Press `.` for the next finding and `,` for the previous one. The drawing switches sheet if
  needed and centres on the finding; Checks opens with that finding highlighted.
- Click a pin in Select mode to make it the active finding.
- See the other parts of a multi-item finding (for example both pads of a clearance
  violation) as rings joined to the pin while that finding is active.
- Press `C`, or use the "Show on drawing" switch in Checks, to show or hide the pins.
- Turn on "Show excluded" in Checks to see excluded findings in the list and on the drawing.
- Tell at a glance that the report is older than the saved files: pins are dimmed and the
  active finding's detail says "Stale".
- Use Locate on any finding and land on the right place, whatever unit the report used.

## Entry points

| Way in                                                  | Way out                                                                 | Way to see the state                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Run ERC or DRC (Checks, agent or L58)                   | Hide markers with `C` or the toggle                                     | Pins on the drawing; counts in the status bar chips            |
| `C` key or "Show on drawing" switch in Checks           | `C` again or the switch                                                 | The switch state; pins present or absent                       |
| `.` / `,` keys                                          | `Escape` clears the active finding, then closes Checks (existing order) | Active pin has a ring; status line "Finding 3 of 12" in Checks |
| Click a pin in Select mode                              | Click empty drawing or press `Escape`                                   | Same as above                                                  |
| Locate button on a finding item                         | Same as above                                                           | The drawing centres on the item; the finding becomes active    |
| "Show excluded" (the Excluded count in Checks)          | Press it again                                                          | The count is pressed; excluded pins are drawn hollow           |
| Agent `loom_pcb_editor` `finding` and `markers` actions | Agent sends `markers` with `enabled: false`, or the user presses `C`    | Editor snapshot lists visible markers and the active one       |

The markers preference persists on this device. The active finding is per panel session and
clears when the design changes.

## States

- Loading: while previous checks load, no pins; Checks shows "Loading previous checks" as
  today.
- Empty: no report for this surface, or a clean report. No pins. `.` shows the notice
  "No findings on this drawing." in the canvas notice stack.
- No located findings: a report whose findings carry no positions (some DRC parity entries
  have only a footprint description). The list works; `.` shows "These findings have no
  position on the drawing."
- Error: a failed or timed-out check has no findings, so no pins; Checks shows the log.
- Disabled: 3D surface (keys do nothing, the switch stays available), tscircuit designs (no
  ERC or DRC), and connections without permission to run checks (existing pins still show).
- Stale: the report's `sourceHash` differs from the drawing's. Pins draw at half opacity, the
  active finding's tags include a "Stale" badge, and stepping still works. Running the check
  again clears it.
- Truncated: the report is bounded at 500 findings; pins show what was kept and Checks keeps
  its "Showing a bounded report" hint.

## Surfaces and connection modes

Web and desktop, in the PCB panel's 2D drawings. Mobile has no PCB panel. Markers work the same
on local, LAN, Tailscale and T3 Connect connections because they use data the panel already
receives. On an upstream T3 server there is no PCB panel.

## Decisions

- One marker per finding, at its first item with a position. A clearance violation between two
  pads is one problem, so it is one pin and one step; its second pad shows as a ring when
  active. Drawing every item would double the pins and make stepping visit the same problem
  twice.
- Findings without any position get no marker and are skipped by stepping, but stay in the
  list.
- Markers ignore the Checks search box and the Errors/Warnings filter; those are list tools.
  Markers follow only "Show excluded", which is now one shared switch.
- Stepping order: errors before warnings before info, then sheet order, then top to bottom and
  left to right. This is the shared definition's "severity, then position" order.
- Stepping crosses sheets on the schematic. `.` on the last finding wraps to the first, with
  the status line "Back to the first finding".
- `C` hides pins but stepping still works and shows them again, so the keys never do nothing
  silently.
- Pins keep a constant on-screen size while zooming, so they stay findable on a fitted A3
  sheet and do not cover parts when zoomed in.
- Positions are normalized on the server, so every client and agent gets millimetres and the
  KiCad bug is fixed in one place.

## Decisions needed from Kyle

None. One coordination point is recorded for the packet index instead: L52 and L54 both mention
Locate in other units. Recommended split: L52 converts on the server, L54 only formats
(README.md, "Relationship to other follow-up packets").
