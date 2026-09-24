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

| Way in                                       | What happens                                                                                                                 | Way out                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Composer footer tools button (wrench icon)   | Opens the drawer on the last used tab.                                                                                       | Same button, Escape, or sending. |
| Keybinding `loom.composer-drawers.tools`     | Toggles the drawer.                                                                                                          | Same key or Escape.              |
| Keybinding `loom.composer-drawers.once`      | Arms Once (opens the drawer on Once); again cancels.                                                                         | Same key, "Cancel", or sending.  |
| Keybinding `loom.composer-drawers.shell`     | Opens the drawer on Shell with the input focused.                                                                            | Escape.                          |
| Keybinding `loom.composer-drawers.clipboard` | Opens the drawer on Clipboard.                                                                                               | Escape.                          |
| Command palette                              | "Composer tools", "Next message only", "Run a shell command for the prompt", "Clipboard history", "Clear clipboard history". | As above.                        |
| Settings > Loom > Composer drawers           | Clipboard history on or off, remember across restarts, read on focus (desktop), clear.                                       | Switch off (also clears).        |

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
  "Stopped after 30 s." with any output captured before the timeout discarded (upstream's
  runner does not keep partial output on timeout). Exit code non-zero: shown in red but
  still attachable. Output over the cap: "Output truncated to 64 KB."
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
  select "10 s", "30 s", "2 min". Attached block header: `` `$ command` exited with 0 in 1.2 s ``.
- Clipboard: "Recent clipboard", "Clear all", per item "Insert", "Delete". Footer: "Stored
  on this device only."

## Surfaces and connection modes

Web and desktop. On web, clipboard capture covers copies made inside Loom only. The Shell
tab runs on the thread's environment in every connection mode, with the `terminal:operate`
scope (the same power as opening a terminal). On an upstream server only the Shell tab is
unavailable.

## Decisions and open questions

Decisions:

- Once uses upstream's own pickers instead of a second set of controls, so provider locks,
  model validation and effort options stay upstream's. The fork only snapshots and restores.
- Output schema is prompt-level (visible text in the message), because native schemas need
  upstream contract and adapter seams for one provider.
- The shell runs on the server (fork RPC), not in a terminal session, with a 30-second
  default timeout and a 64 KB output cap, and nothing runs without the user pressing Run.
- Clipboard history is off by default, in memory by default, never sent to a server, and
  filtered for secrets before it is stored.

Open questions for Kyle:

1. Clipboard capture from other apps while Loom is in the background needs polling in
   Electron's main process (old Loom polled every 1.5 s) through `ext-desktop` (EXTENSION-POINTS.md section 13). Is "latest item when Loom regains focus" enough for now?
2. Is the prompt-level schema acceptable, or should a later provider packet add native
   `outputSchema` for Codex (and Claude's structured output, if the SDK supports it)?
3. Default shell timeout 30 s and cap 64 KB: right numbers?
