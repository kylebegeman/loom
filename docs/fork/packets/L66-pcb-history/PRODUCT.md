# L66 product

## Problem

An agent works on a board over many turns: it adds a sub-sheet, reroutes a connector, swaps a
regulator, then "fixes" something that was fine. The PCB panel shows only the latest saved
files. The Compare tool can diff two revisions, but its list mixes Git commits with every hidden
`refs/t3/` ref in the repository, from every thread, labelled "t3 checkpoint ref=..." with no
turn number. To see the board as it was three turns ago, Kyle has to guess which ref that was.
To take the design back, he has to roll back the whole thread or ask the agent to undo its own
work file by file, and a KiCad design is never one file: the board, the root schematic, its
sub-sheets and the project's libraries have to come back together or the project breaks.

## What the user can do

1. **Open the timeline.** Press `T`, click the History button in the panel's document bar, or
   run "PCB: Toggle history" from the palette. A strip appears under the drawing with one chip
   per version, oldest on the left: "Start", "Turn 2", "Turn 5", "Turn 8", then "Now". A version
   is a turn that changed a file the design uses. More than 30 such turns adds an "Earlier"
   chip that loads the next page.
2. **View a version.** Click a chip, or press `[` (older) and `]` (newer). The drawing shows
   that version and the status bar reads "Viewing turn 5 of 9" with "Back to current". "of 9"
   is the thread's latest turn, matching the chat. The view, sheet, layer preset and camera
   stay where they were, so stepping shows the same place on the board changing. Switching to
   the schematic, another sheet or 3D keeps showing the same version. Hovering a chip shows
   when the turn ended and which design files it changed ("Changed power.kicad_sch,
   main.kicad_pcb").
3. **Compare.** While viewing a version, "Compare" opens the Compare tab with From set to that
   turn and To set to the current files, and runs it. The existing overlay, before, after and
   difference views and the structural changes list work as today. The From and To lists show
   this thread's turns as "Turn 5" next to Git commits.
4. **Restore.** While viewing a version, "Restore this version..." opens a confirmation:
   "Restore main from turn 5? This replaces 3 design files in the workspace." The files are
   listed (board, schematics, project). Two checkboxes appear when they apply, both off:
   - "Also restore 2 supporting files" (library tables, project libraries, assets), listed,
     with "Other designs may use these files."
   - "Also remove 1 file added since turn 5" (for example a sub-sheet the agent added later),
     listed.
     When KiCad has the design open, the dialog adds "KiCad has this design open. Close it
     first, or KiCad may save over the restored files." When an agent is working in the thread
     it adds "The agent is working in this thread and may change these files again." After
     restoring, the panel returns to Now and shows "Restored main from turn 5." with "Undo".
     Undo puts back exactly what was there before, all files at once.
5. **Let the agent do it.** Ask "show me the board from before you moved the USB connector" or
   "put the power sheet back the way it was in turn 4". The agent lists versions with
   `loom_pcb_history`, renders old sheets with `loom_pcb_render` and `loom_pcb_read_sheet`,
   compares with `loom_pcb_compare`, and restores with `loom_pcb_restore_version`. It can also
   drive the strip through the editor command so Kyle sees the version it means.

While a version is shown it is read-only: notes, measuring, saved views, Inspect selection,
checks, simulation, parameters, capture and export are disabled. Inspect, Checks, Simulate and
Parameters show "These tools work on the current version." Pan, zoom, fit, sheet switching,
layer presets and layer visibility keep working.

Turn numbering follows the chat. A file Kyle saves from KiCad between turns appears in the
next turn's checkpoint, so it is listed under that turn. Turns that left every design file
byte-for-byte the same as the version before them fold into the earlier chip.

## Entry points

| Way in                                                                           | Way out                                                                                                       | How the state is visible                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `T`, History button, palette "PCB: Toggle history", editor action `turn-history` | `T` again, the button, the same palette entry, the strip's close button, `turn-history` with `enabled: false` | Strip under the drawing; History button pressed.                                  |
| Click a chip, `[` / `]`, palette "PCB: Previous version" / "Next version"        | "Back to current", the "Now" chip, `]` from the newest version, hiding the strip                              | Status bar "Viewing turn 5 of 9"; selected chip filled; read-only tools disabled. |
| "Compare" in the strip, editor action `turn-compare`                             | Close the Compare tab, or "Back to current"                                                                   | Compare tab open with "Turn 5" in From.                                           |
| "Restore this version..." and confirm                                            | "Undo" in the notice, or restore another version                                                              | Notice "Restored main from turn 5."; the Now chip reads "Same as turn 5".         |

Undo stays available until the panel closes, another restore runs for that design, or seven
days pass. The server keeps the last 20 undo records, so an agent can undo too.

## States

| State                      | What the user sees                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading list               | The strip shows "Loading history..." in place of chips. The drawing keeps the current version.                                                                                                            |
| Loading a version          | The chip shows a spinner and the status bar reads "Loading turn 5..." with "Cancel". The previous drawing stays until the new sheet arrives. Fast `[` presses only render the last one.                   |
| Empty, no turns yet        | "No turns have changed this design yet. Each turn the agent finishes saves a version."                                                                                                                    |
| Empty, only Start          | One "Start" chip and "Now".                                                                                                                                                                               |
| Not a Git workspace        | "History needs a Git workspace. Loom saves a version at the end of each turn in Git projects."                                                                                                            |
| Design absent at a version | Chip "Turn 3 (not created yet)". Viewing it shows "main did not exist after turn 3." Restore is disabled.                                                                                                 |
| View absent at a version   | "This version has no board yet." (or "no schematic"), with the other view's button.                                                                                                                       |
| Version too large          | "This version uses more than 2,000 files or 256 MB; it cannot be previewed."                                                                                                                              |
| Files in Git LFS           | "This version is stored in Git LFS and cannot be previewed here." Restore is disabled.                                                                                                                    |
| tscircuit not trusted      | The existing trust prompt, unchanged. Old versions run the same way as current ones.                                                                                                                      |
| Render error               | The tool log in the existing failure card, prefixed "Turn 5:".                                                                                                                                            |
| Version removed (rollback) | "Turn 6 is no longer available. The thread was rolled back." The strip reloads.                                                                                                                           |
| Restore conflict           | "main changed since you opened history. Check the latest version, then try again." The strip reloads.                                                                                                     |
| Restore failed partway     | "Restore stopped and the files were put back. <reason>". Nothing is left half restored.                                                                                                                   |
| Undo conflict              | "main changed after the restore, so Undo would overwrite newer work." Undo is removed.                                                                                                                    |
| Disabled, no permission    | Restore is hidden without the operate grant; viewing needs the terminal grant like any render and shows the existing "This connection needs permission to run terminal commands to build previews." card. |
| Stale                      | A finished turn adds a chip without moving the selection. While a version is shown, a change to the current files updates Now only.                                                                       |

## Surfaces and connection modes

Web and desktop share the panel. Mobile has no PCB panel; agents in mobile-started turns can
use the tools. Local, LAN, Tailscale and T3 Connect behave the same: lists and actions go over
the WebSocket RPCs, sheets come through the existing `readSheet` RPC as today, and a version's
3D board comes through the existing signed file URL with the environment's origin.

## Decisions

- **Checkpoints, not Git commits, for the timeline.** They exist for every turn without the
  user committing, and turn numbers match the chat. Commits stay in Compare.
- **Thread-scoped, and Compare's list fixed to match.** Other threads' refs have their own
  numbering and are rarely what "turn 4" means. Listing them was a defect.
- **A version is the design's file set, not one file.** KiCad needs its sheets and libraries;
  tscircuit needs its imports. The set is computed the same way for listing, viewing and
  restoring.
- **Restore writes all design files or none.** Files are staged first and put back if any
  write fails, and one Undo covers the set.
- **Supporting files and removals are opt-in.** Libraries and assets are often shared with
  other designs; deleting is never a default.
- **Compare reuses the existing tool.** It already diffs any two refs; a second compare engine
  would drift.
- **Read-only viewing.** Notes, measurements and checks belong to the current files.
- **One history service.** The Git extraction, restore and undo code is L49's, used by both
  panels.

## Decisions needed from Kyle

None block the build. Recommended defaults, which the packet uses:

1. **Agent restore tool marked destructive.** Recommended: `loom_pcb_restore_version` ships
   with `Tool.Destructive` true, like L49's tool, so hosts that confirm destructive tools ask
   first.
2. **Removing files added since the version.** Recommended: offer it as a listed checkbox, off
   by default and undoable. Without it, a sub-sheet the agent added later stays on disk and
   shows up as its own design in the design menu.
3. **Undo retention.** Recommended: the last 20 records, at most seven days, in the server's
   state directory, matching L49.
4. **Commits in Compare.** Recommended: keep the design's Git commits in Compare's list beside
   the thread's turns, since L24 shipped that and it is the only way to reach commit history.
