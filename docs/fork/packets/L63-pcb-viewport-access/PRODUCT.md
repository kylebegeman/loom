# L63 product

## Problem

The PCB panel has good keyboard shortcuts but tells a screen reader user little. Selecting a
component, switching to the board, running DRC or waiting for a rebuild changes only what is
drawn. The status messages that exist are mounted on demand, so screen readers often skip them
(`PcbPreviewPanel.tsx:715`, `833-837`). The drawing is named after its sheet, not the design.
Closing the tools panel or switching surface can drop keyboard focus out of the panel, which also
turns off the panel's single-key shortcuts until the user clicks back in.

## What the user can do

- Hear what they selected: "U3, ATmega328P", "U3 pin 5, PB2, net SCK", "Net GND",
  "Selection cleared".
- Hear where they are after switching: "Board, Front copper", "Schematic, sheet 2 of 3, Power",
  "4 layers visible", "3D board ready".
- Hear tool steps: "Distance, point 1 of 2. Click two points." and "Select".
- Hear check runs: "Running DRC", then "DRC clean" or "DRC: 3 errors, 5 warnings".
- Hear builds: "Building board" when nothing is on screen yet, then "Board ready"; on a live
  rebuild only "Board updated". Failures keep their existing alert.
- Hear finding steps: "Finding 3 of 12. Error, DRC: Clearance violation." with L52's `.` and `,`,
  or "Showing Clearance violation" after a "Go to" button without L52.
- Hear panel notices such as "Capture attached to your draft."
- Tab through the panel in visual order: document bar, drawing, drawing shelves, tools panel,
  rail, status bar.
- Press `I` from the drawing to open the tools with focus inside them; press `I` or `Escape` to
  close them and return to where they were.
- Keep focus on the drawing while it reloads for a new surface, sheet or layer preset.
- See a focus ring on the drawing and on the 3D board.

## Entry points

| Way in                                                  | Way out                                                 | How to see it                                              |
| ------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Announcements start when the panel opens                | Close the panel; the region goes with it                | Screen reader speech; the same facts are visible on screen |
| `I` opens tools and moves focus in                      | `I`, `Escape` or "Close tools" closes and returns focus | Focus ring on the restored control                         |
| Rail button opens tools; focus stays on the button      | Press it again                                          | `aria-pressed` and the open panel                          |
| Finding steps with `.` and `,` (L52) or "Go to" buttons | Any other navigation                                    | Spoken finding; marker and view on screen                  |

No setting turns announcements off: they are only exposed to assistive technology.

## States

- Loading: building, sheet loading and 3D loading are announced once each; the visible
  operation cards stay.
- Empty: no drawing (blocked, never built) announces nothing; the canvas state card is in the
  normal reading order.
- Error: build, sheet and check failures keep their `role="alert"` notices, which screen readers
  announce on insertion. The announcer does not repeat them.
- Disabled: a surface that is unavailable is skipped by `1`-`3` as today; nothing is announced.
- Stale: "Out of date" stays visible in the status bar; check chips include "out of date" in
  their names.

## Surfaces and connection modes

Web and desktop, all connection modes; everything is local to the client. Mobile has no PCB
panel.

## Decisions

- Copy L43's announcer pattern rather than add a shared module: upstream has none and the two
  panels announce different facts.
- One polite region, one message per change, chosen by priority (finding step, selection,
  place, tool, checks, build, notice): the user hears the result of what they just did first.
- Nothing is announced when the panel first opens; the drawing's name covers it.
- Live rebuilds announce only "updated", not "building": an agent editing a board can save every
  few seconds.
- Check results are announced only after a run the panel watched, so opening the panel does not
  read out old results.
- Failures stay with their existing alerts, to avoid saying everything twice.
- The drawing becomes `role="application"` with `aria-roledescription="drawing"`: its arrow and
  zoom keys must reach it in screen reader browse mode, as L43 does for the 3D canvas.
- No new keys. Finding steps reuse L52's `.` and `,`.
- Visual order is already the DOM order in both layouts, so focus order needs no reordering, only
  focus moves at open, close and remount.

## Decisions needed from Kyle

1. Arrow keys on the PCB 3D board. Today arrows pan the 2D drawing and do nothing in PCB 3D.
   L43 adds `nudge` so arrows orbit (and Shift pans) the 3D model panel. Recommendation: once L43
   lands, use the same in PCB 3D for parity, as a follow-up row in PCB-FOLLOW-UPS.md's key table
   ("Arrows, Shift+arrows: orbit, pan in 3D"). L63 does not build it, because the brief forbids
   new key meanings without a table row.
