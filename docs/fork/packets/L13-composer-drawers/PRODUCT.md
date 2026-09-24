# L13 product

## Problem

Some turns need something the composer does not offer in one step:

- Asking one question of a stronger (or cheaper) model, or with more effort, or letting one
  turn run with full access, without forgetting to switch back.
- Getting an answer in a fixed JSON shape.
- Showing the agent the output of a command (`git log -5`, a failing test) without opening
  a terminal, copying and pasting.
- Pasting something copied a few minutes ago, not only the last thing copied.

Old Loom had a per-turn tool drawer and a clipboard history panel. This packet rebuilds
them as one compact drawer.

## What the user can do

- Click the composer's tools button (or a keybinding, or the palette) to open the drawer
  above the composer; switch tabs with the mouse or the arrow keys on the tab row (not
  `mod+1` to `mod+9`, which upstream uses to jump between threads).
- Once: press "Next message only". A chip appears in the drawer header and on the tools
  button: "Next message only". Change the model, effort or access level with the usual
  pickers. Send. The composer switches back right away, and the thread's stored settings
  switch back when that turn finishes. "Cancel" switches back without sending.
- Schema: paste or write a JSON Schema, or pick a saved one; "Add to prompt" appends
  "Respond with only JSON that matches this schema:" and the schema in a fenced block.
  "Save" keeps it for later (up to 10).
- Shell: type a command and press mod+Enter. It runs in the thread's workspace (its
  worktree when it has one) on the thread's environment. See the exit code, duration and
  output. "Attach" adds a fenced block with the command, exit code and output to the
  prompt. Recent commands are one arrow key away.
- Clipboard: turn it on in Settings > Loom > Composer drawers. Loom then remembers text you
  copy inside Loom and, in the desktop app, what is on the clipboard whenever you come back
  to Loom. Click an item (or Enter) to insert it at the cursor. Delete one item, or clear
  all. Anything that looks like a password, key or token is never recorded.

## Entry points

| Way in                                       | What happens                                                                                                                   | Way out                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Composer footer tools button (wrench icon)   | Opens the drawer on the last used tab.                                                                                         | Same button, Escape, or sending.                   |
| Keybinding `loom.composer-drawers.tools`     | Toggles the drawer.                                                                                                            | Same key or Escape.                                |
| Keybinding `loom.composer-drawers.once`      | Arms Once (opens the drawer on Once); again cancels.                                                                           | Same key, "Cancel", or sending.                    |
| Keybinding `loom.composer-drawers.shell`     | Opens the drawer on Shell with the input focused.                                                                              | Escape.                                            |
| Keybinding `loom.composer-drawers.clipboard` | Opens the drawer on Clipboard.                                                                                                 | Escape.                                            |
| Command palette                              | "Composer tools", "Next message only", "Run a shell command for the prompt", "Clipboard history", "Clear clipboard history".   | As above.                                          |
| Settings > Loom > Composer drawers           | Clipboard history on or off, remember across restarts, read on focus (desktop), clear; shell default timeout and output limit. | Switch off (also clears); pick the defaults again. |

All keybindings are unbound by default.

## States

- Once armed: chip "Next message only" with a Cancel button; the tools button shows a dot.
  After send: chip "Restoring after this turn" until the turn ends, then it disappears.
  If restoring the thread's settings fails: toast "Couldn't switch the thread back.
  Check its model and access level."
- Once unavailable: in a new (draft) thread: "Pick settings for a new thread directly;
  Once is for follow-up messages." While a turn is running: "Available when the thread is
  idle."
- Schema: invalid JSON shows the parse error under the editor and disables "Add to
  prompt". A schema that is valid JSON but not an object or boolean shows "A JSON Schema
  is an object."
- Shell running: spinner and elapsed seconds; the Run button becomes disabled. Timeout:
  "Stopped after 30 s." (the run's timeout) with any output captured before the timeout
  discarded (upstream's runner does not keep partial output on timeout). Exit code
  non-zero: shown in red but still attachable. Output over the cap: "Output truncated to
  64 KB." (the configured limit).
- Shell unavailable: on an upstream server, "Running commands needs a Loom server."; with
  no workspace (thread without a project path), "This thread has no workspace to run in."
- Clipboard off: the tab explains the feature and has "Turn on" (goes to settings, or
  toggles inline).
- Clipboard empty: "Nothing copied yet."

## Copy

- Drawer title: "Composer tools". Tabs: "Once", "Schema", "Shell", "Clipboard".
- Once: heading "Next message only"; body "Change the model, effort or access level with
  the usual controls. Loom switches back after you send."; buttons "Next message only",
  "Cancel".
- Schema: "Add to prompt", "Save", "Saved schemas". Inserted text:
  `Respond with only JSON that matches this JSON Schema:` followed by a ` ```json `
  block.
- Shell: placeholder "Command to run in the workspace"; buttons "Run", "Attach"; timeout
  select "10 s", "30 s", "1 min", "2 min", "5 min", "10 min", preselected to the default
  from settings. Attached block header: `` `$ command` exited with 0 in 1.2 s ``.
- Settings, shell: "Default timeout" (same choices, default "30 s"), description "How long
  a command may run before Loom stops it. You can change it per run."; "Output limit"
  ("64 KB", "256 KB", "512 KB", "1 MB", default "64 KB"), description "Output beyond this
  is cut off. Applies to standard output and errors separately."
- Clipboard: "Recent clipboard", "Clear all", per item "Insert", "Delete". Footer: "Stored
  on this device only."

## Surfaces and connection modes

Web and desktop. On web, clipboard capture covers copies made inside Loom only. The Shell
tab runs on the thread's environment in every connection mode, with the `terminal:operate`
scope (the same power as opening a terminal). On an upstream server only the Shell tab is
unavailable.

## Decisions

- Once uses upstream's own pickers instead of a second set of controls, so provider locks,
  model validation and effort options stay upstream's. The fork only snapshots and restores.
- Output schema is prompt-level (visible text in the message) in v1, because it works for
  every provider. Native `outputSchema` for Codex and Claude's structured output are a
  follow-up, pending SDK verification (they need upstream contract and adapter seams).
- The shell runs on the server (fork RPC), not in a terminal session, and nothing runs
  without the user pressing Run. Defaults are a 30-second timeout and a 64 KB output cap,
  both adjustable in the Loom settings page up to 10 minutes and 1 MB; the server enforces
  those maximums whatever the client sends.
- Clipboard capture from other apps is "latest item when Loom regains focus" (desktop) in
  v1. Background polling in Electron's main process is a possible later option, not
  designed here.
- Clipboard history is off by default, in memory by default, never sent to a server, and
  filtered for secrets locally before it is stored. No clipboard content is ever sent to
  Jev or any other service for secret detection (rejected in the Jev review).
