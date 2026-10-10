# L54 product

## Problem

Board work mixes units. KiCad stores millimetres, many fab houses quote 6 mil track and
space, connector datasheets are often in inches, and older footprints sit on a 50 mil grid.
The PCB panel only speaks millimetres, in seven places that each format on their own, and a
check report in any other unit cannot be located on the drawing (`ChecksView.tsx:361`).

## What the user can do

- Pick millimetres, mils or inches once. Every length in the panel follows: distance and angle
  marks on the drawing and in Marks, the board size and thickness in Inspect, Board stats (L55),
  check coordinates in Checks, hardware sizes in the library.
- Type hardware width and height in the chosen unit. A suffix overrides it: "0.5 in", "40mil"
  or "12.7mm" all work in any mode.
- Press "Locate" on any check finding with a position, whatever unit the report used.
- Ask an agent about a length and get millimetres, the same as before.

Display rules:

| Unit | Example (12.7 mm) | Decimals                         |
| ---- | ----------------- | -------------------------------- |
| mm   | "12.70 mm"        | as today at each site            |
| mil  | "500.0 mil"       | one fewer than mm, never below 0 |
| in   | "0.500 in"        | one more than mm                 |

Areas show in mm² for millimetres and in² for mils and inches (square mils are unreadable).

## Entry points

| Way in                                               | Way out                            | Where the state shows                                   |
| ---------------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| Status bar units menu ("mm", "mil", "in"), PCB panel | Pick another unit in the same menu | The menu label and every length in the panel            |
| Settings, PCB, "Length units" select                 | Pick another unit                  | The select; the panel updates live in other open panels |

Both write the same per-device preference. There is no keyboard key; the brief keeps keys for
frequent actions. The command palette has one PCB item today (`palette.tsx:18`) and does not
gain a units item.

## States

- Loading: none. The preference is read synchronously from device storage at startup
  (`preferences.ts:22-30`).
- Empty: with no saved preference the unit is millimetres, exactly as today.
- Error: device storage unavailable or full. The choice applies for the session and is not
  remembered, as for other PCB preferences (`preferences.ts:31-37`). No message.
- Disabled: never. Changing the unit writes nothing to the environment, so it needs no grant.
- Stale: not applicable. A report in an unknown unit (not mm, in or mils) shows its raw numbers
  with the unit name the report gave, and "Locate" stays off for it.

## Surfaces and connection modes

Web and desktop. Mobile has no PCB panel. The setting is local to each browser profile or
desktop install, so it behaves the same over local, Tailscale and T3 Connect.

## Decisions

- Per device, not per environment. PCB has no environment settings store, and the only other
  PCB preference that is not about one design (the Electronics URL) is already per device
  (`settings.tsx:94-97`). A display unit is a reading preference, needs no write grant, and a
  remote viewer should not change what Kyle sees at his desk.
- Millimetres, mils and inches only. Those are the units KiCad offers for reports
  (`kicad-cli pcb drc --units`).
- Everything stored and sent stays in millimetres. One canonical unit avoids double conversion
  bugs and keeps agents consistent.
- Draft summaries prepared for an agent (`summary.ts:29`, `HardwareLibrary.tsx:173`) stay in
  millimetres, because they are agent input, not display.
- No units field on MCP outputs. A per-device preference has no single answer for an
  environment-level tool, and one unit for agents removes a class of mistakes. Tool descriptions
  say "Lengths and coordinates are in millimetres."
- Separate module from `units.ts`, which formats electrical values (`units.ts`, `parseEng`,
  `formatEng`).

## Decisions needed from Kyle

1. Should the PCB unit and the 3D unit (L40) be one setting? Recommendation: keep them
   separate. Mils only make sense for boards, L40 stores its unit per environment beside the
   build plate, and a printing workflow in millimetres next to a board reviewed in mils is a
   real combination. Both use the same function names, so merging later is a small change.
