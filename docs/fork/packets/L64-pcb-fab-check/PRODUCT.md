# L64 product

## Problem

KiCad's DRC checks a board against the rules in the board file, which are whatever the template
or the agent set. They are rarely the limits of the fab Kyle will order from. A 0.1 mm via drill
passes DRC and then either fails the fab's upload review or quietly doubles the price. Finding
out means reading a capabilities page, converting mils, and comparing numbers by hand, every
time the agent changes the board. Fab limits also change, so remembered numbers go stale.

## What the user can do

- Open the Checks tab, choose the **Fab** card, pick a fab and run the check.
- See a verdict ("Fits JLCPCB standard", "3 problems for OSH Park 4-layer"), the list of
  findings below the fab's limits with the measured value and the limit, and Locate each one on
  the board. With L52, the findings are markers on the board.
- See board-level problems: a layer count, thickness or finish the fab does not offer.
- See cost drivers for that fab: "4 vias use a 0.15 mm drill, which JLCPCB charges extra for",
  "Board is 112 x 80 mm, above the 100 x 100 mm price tier", "Castellated holes cost extra". For
  OSH Park, an estimate from its per-area price.
- See where each limit came from (fab page link) and when Loom last checked it.
- Duplicate a built-in fab, adjust its numbers (for a fab's "advanced" options he has paid for,
  or a local maker), name it, and make it the default.
- Ask an agent: "check the board against JLCPCB and fix what fails". The agent runs
  `loom_pcb_fab_check`, edits the board, and runs it again.

## Entry points, with reverse states

| Entry point                                            | Way in                                       | Way out                                                                         |
| ------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------- |
| Checks tab, **Fab** card                               | Shows the last fab result or the empty state | Choose ERC or DRC                                                               |
| Fab picker in the card                                 | Chooses which fab to check against           | Pick another; the default is preselected                                        |
| "Run fab check"                                        | Runs the check                               | "Cancel" while running                                                          |
| "Fab capabilities…" (card and PCB settings)            | Opens the manage dialog                      | Close or Escape; unsaved edits ask to discard                                   |
| Manage dialog, "Duplicate" on a built-in               | Adds an editable copy                        | "Delete" on the copy                                                            |
| Manage dialog, "Set as default"                        | Makes it the default fab                     | "Set as default" on another; deleting the default falls back to JLCPCB standard |
| `loom_pcb_fab_check`, `loom_pcb_save_fab_capabilities` | Same as above for agents                     | Same tools                                                                      |

Built-ins cannot be edited or deleted, so a bad edit never loses the reference values.
No new keyboard shortcut; L52's `.` and `,` step through fab markers when the Fab card is active.

## States

- Loading: "Loading previous fab check" while `latestFabCheck` loads; "Checking against
  JLCPCB standard" with Cancel while running, with the existing line "KiCad processes one task
  at a time. A preview may finish first."
- Empty: "No fab check yet" with the fab picker and "Run fab check", and one line: "Runs DRC with
  this fab's limits on a copy of the board. Your files are not changed."
- Error: KiCad missing or too old, the run failed or timed out, or the report could not be read.
  The card shows the message and "Try again". A saved user entry that no longer decodes is
  skipped with a notice naming it.
- Disabled: no board ("Fab checks need a KiCad board" for tscircuit and schematic-only designs);
  no terminal permission ("This connection needs permission to run terminal commands."); the
  manage dialog is read-only without operate permission.
- Stale: the board changed since the check ("out of date", as DRC does), or the fab entry was
  edited since ("Limits changed since this check"). Both keep the old findings visible.
- Partial: on KiCad 9, "Zones were checked as last filled in KiCad." When the fab does not
  publish a value (OSH Park edge clearance), that rule is skipped and listed as "Not checked".

## Surfaces and connection modes

Web and desktop, local and remote. Mobile has no PCB panel. Upstream servers have no PCB panel.

## Decisions

- DRC with the fab's limits, not a separate geometry engine: KiCad already measures every
  clearance correctly, including zones and arcs.
- A temporary copy with appended rules: the user's `.kicad_dru` and board are never written, and
  later rules in a `.kicad_dru` take precedence, so the fab limits win.
- Board minimums cleared in the copy: otherwise the board's own stricter minimums would report
  non-fab problems as if they were fab limits.
- Only fab-relevant rule types count as fab findings. Other DRC findings (unconnected items,
  courtyards) are counted as "also in DRC" with a link to the DRC card, not repeated.
- Two JLCPCB tiers: "standard" is no surcharge and JLCPCB's recommended values; "advanced" is the
  smallest JLCPCB makes, usually at extra cost. That split is what Kyle decides between.
- Conservative values when a fab varies by layer count (JLCPCB annular ring, track): the stricter
  number, with the looser one in the notes.
- User entries environment-wide, next to the hardware library: fab limits belong to the person,
  not one project, and every thread on the environment sees the same entries.
- Built-ins as code data with a checked date: they ship with Loom and are updated by editing one
  file; the date tells Kyle how old they are.
- Cost drivers qualitative, from published rules: Loom never calls a pricing API.
- KiCad boards only: DRC needs a KiCad board, and a half-check would mislead.

## Decisions needed from Kyle

None. The two optional fields this packet needs, `minEdgeClearanceMm` and `minHoleToHoleMm`
(null when a fab does not publish them), were added to the shared definition in
PCB-FOLLOW-UPS.md on 2026-10-10: JLCPCB and PCBWay publish both, and both are common reasons a
board is rejected.
