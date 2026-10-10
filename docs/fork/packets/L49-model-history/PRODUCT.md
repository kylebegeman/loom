# L49 product

## Problem

An agent iterates on a part over many turns. Today the panel only shows the latest file. To see
what the bracket looked like three turns ago, Kyle has to find the turn's diff, read SCAD by
eye, or ask the agent to undo things. When a later turn makes the part worse, there is no quick
way to look back, measure the difference, or take just that one file back without rolling the
whole thread back. Requests resolved through annotations also lose their link to the turn that
did the work.

## What the user can do

1. **Open the timeline.** Press `T`, click the History button in the panel's document bar, or
   run "3D model: Toggle history" from the palette. A strip appears under the viewport with one
   chip per version, oldest on the left: "Start", "Turn 2", "Turn 4", "Turn 7", then "Now". A
   version is a turn that changed the model or a file it uses. If the thread has more than 30
   such turns, an "Earlier" chip at the left loads the next page.
2. **View a version.** Click a chip, or press `[` (older) and `]` (newer). The viewport shows
   that version and the status bar reads "Viewing turn 4 of 9" with a "Back to current" button.
   "of 9" is the thread's latest turn number, so it matches the chat. The camera does not move.
   Hovering a chip shows when the turn ended and which files it changed ("Changed bracket.scad,
   gear.scad").
3. **Compare.** While viewing a version (or Now), click "Compare" and pick another version
   (default: the next older one). The other version appears as a translucent ghost and the
   status bar adds "Turn 4 vs turn 2: X +2.0, Y 0.0, Z -1.5 mm, +1,204 triangles". "Stop
   comparing" removes it.
4. **Restore.** While viewing a version, "Restore this version..." opens a confirmation:
   "Restore bracket.scad from turn 4? This replaces the current file in the workspace." For a
   SCAD model with included files that differ from today, a checkbox reads "Also restore 2
   included files" and lists them (off by default). If an agent is working in the thread the
   dialog adds "The agent is working in this thread and may change this file again." After
   restoring, the panel returns to Now and shows "Restored bracket.scad from turn 4." with
   "Undo". Undo puts back exactly what was there before.
5. **Follow a resolved request.** In Markup, an accepted annotation reads "Accepted in turn 6"
   with "View turn 6", which opens the strip on that version.
6. **Let the agent do it.** Ask "show me how the bracket changed since turn 3" or "put
   gear.scad back the way it was in turn 5". The agent lists versions with
   `loom_model_preview_3d_history`, renders old ones with `loom_model_preview_3d_render`, and
   restores with `loom_model_preview_3d_restore_version`. It can also drive the strip through
   the editor command so Kyle sees the version it is talking about.

While a version is shown it is read-only: measuring, annotating, capturing, saving views,
section toggling and the customizer are disabled, with the customizer showing "Parameters apply
to the current version." Orbit, pan, zoom, standard views, wireframe, grid and axes keep
working, and an existing section plane stays applied.

Turn numbering follows the chat. A file Kyle edits by hand between turns appears in the next
turn's checkpoint, so it is listed under that turn. Turns that left the model byte-for-byte the
same as the version before them (for example, one that changed an include and then changed it
back) are folded into the earlier chip.

## Entry points

| Way in                                                                                                  | Way out                                                                          | How the state is visible                                                             |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `T`, History button, palette "3D model: Toggle history"                                                 | `T` again, the button, the same palette entry, the strip's close button          | Strip under the viewport; History button pressed.                                    |
| Click a chip, `[` / `]`, palette "3D model: Previous version" / "Next version", "View turn N" in Markup | "Back to current", the "Now" chip, `]` from the newest version, hiding the strip | Status bar "Viewing turn 4 of 9"; selected chip filled; read-only controls disabled. |
| "Compare" then a version                                                                                | "Stop comparing", choosing Now as the shown version, hiding the strip            | Ghost in the viewport; delta text in the status bar; compared chip marked.           |
| "Restore this version..." and confirm                                                                   | "Undo" in the notice, or restore another version                                 | Notice "Restored bracket.scad from turn 4."; the strip's Now chip matches turn 4.    |
| Agent editor command `turn-history` / `turn-compare`                                                    | The same actions with `enabled: false`, or any user click                        | Same as the user paths; agent actions show in the panel like other editor commands.  |
| Annotation accepted                                                                                     | Reopen the annotation (clears the link)                                          | "Accepted in turn 6" in Markup; the chip shows a check mark.                         |

Undo stays available until the panel is closed, another restore runs for that file, or seven
days pass. The server keeps the last 20 undo records, so an agent can undo too.

## States

| State                      | What the user sees                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading list               | The strip shows "Loading history..." in place of chips. The viewport keeps the current model.                                                                                                                                         |
| Loading a version          | The chip shows a spinner; the viewport keeps the previous view until the new mesh arrives, then swaps. The status bar reads "Loading turn 4..." with "Cancel". Rendering an old SCAD shows "Rendering turn 4..." and the same cancel. |
| Empty, no checkpoints yet  | "No turns have changed this model yet. Each turn the agent finishes saves a version."                                                                                                                                                 |
| Empty, only Start          | One "Start" chip and "Now".                                                                                                                                                                                                           |
| Not a Git workspace        | "History needs a Git workspace. Loom saves a version at the end of each turn in Git projects."                                                                                                                                        |
| Model absent at a version  | Chip "Turn 5 (deleted)". Viewing it shows "bracket.scad did not exist after turn 5." Restore is disabled.                                                                                                                             |
| Version stored in Git LFS  | "This version is stored in Git LFS and cannot be previewed here." Restore is disabled.                                                                                                                                                |
| Version too large          | The existing "too large" message with "Load anyway", as for current files.                                                                                                                                                            |
| Render error               | The SCAD log appears in the Part tab as today, prefixed "Turn 4:"; the status bar reads "Error".                                                                                                                                      |
| Version removed (rollback) | "Turn 6 is no longer available. The thread was rolled back." The strip reloads.                                                                                                                                                       |
| Restore conflict           | "bracket.scad changed since you opened history. Check the latest version, then try again." The strip reloads.                                                                                                                         |
| Undo conflict              | "bracket.scad changed after the restore, so Undo would overwrite newer work." Undo is removed.                                                                                                                                        |
| Disabled, no permission    | Restore is hidden when the client lacks the operate grant (same permission atom pattern as render). Viewing and comparing still work.                                                                                                 |
| Stale                      | When a turn finishes while the strip is open, a new chip appears without moving the selection. While viewing an old version, a change to the current file updates Now only.                                                           |

## Surfaces and connection modes

Web and desktop share the panel. Mobile has no 3D panel. Local, LAN, Tailscale and T3 Connect
all work the same way: lists and actions go over the WebSocket RPCs, and mesh bytes go over the
existing signed file URL with the environment's origin, so a remote browser loads them like any
current model.

## Decisions

- **Checkpoints, not Git commits.** They exist for every turn without the user committing, and
  their turn numbers match the chat.
- **Thread-scoped.** Another thread's turns would need its own numbering and are rarely what
  Kyle means by "turn 4".
- **Versions keyed by the files the model uses now.** Listing stays cheap (no SCAD parsing per
  turn); the version itself is materialized with its own includes at that time.
- **Old SCAD renders with source defaults.** Today's parameter sets may name parameters the old
  file does not have.
- **Restore is a plain workspace write.** The next turn sees it like any edit, upstream rollback
  stays untouched, and Undo is a fork record, not a Git operation.
- **Read-only viewing.** Markup and measurements belong to the current geometry.
- **One compare ghost.** Enough to see the change; side-by-side stays in the variants dialog.
- **Server sets `resolvedIn`.** Clients cannot claim a turn they did not see.

## Decisions needed from Kyle

None block the build. Recommended defaults, which the packet uses:

1. **Agent restore tool marked destructive.** Recommended: ship
   `loom_model_preview_3d_restore_version` with `Tool.Destructive` true, so hosts that confirm
   destructive tools ask first. The agent can already write files, so this adds parity and an
   Undo, not new power.
2. **"Also restore included files" off by default.** Recommended: off, because includes are
   often shared by other models.
3. **Undo retention.** Recommended: the last 20 records, at most seven days, in the server's
   state directory.
