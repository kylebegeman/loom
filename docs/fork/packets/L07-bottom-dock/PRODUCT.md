# L07 product

Selection: P10 in [selections.md](../../selections.md): "Build each tab as its own feature,
one at a time: tasks, activity ledger, approvals and the rest. T3 has only a terminal drawer
today."

## Problem

The space under the chat only holds a terminal. Kyle keeps a dev server, a test watcher and
a linter going per project, and today they share the terminal tabs with his own shell work,
with no overview of what is running. When several threads wait for approval he has to open
each one to answer.

Two phases were retired on 2026-10-09 (README, "Retired parts"): phase 3, Activity, because
upstream covers it with find in thread and the timeline minimap, and phase 5, the Jev risk
badge, because Jev moved to its own project outside Loom. The remaining phases keep their
numbers.

## The dock (phase 1)

What the user sees and can do:

- The dock sits under the chat column, where the terminal drawer is today, and spans the
  chat column's width (not the right panel's).
- A thin tab strip at the top of the dock: Terminal, then the fork tabs that are installed
  (Tasks, Approvals), then a collapse button on the right. The strip is shown only
  while the dock is open, and only if at least one fork tab is installed; otherwise the
  terminal drawer looks exactly like upstream's.
- One tab is shown at a time. Clicking a tab switches; clicking the active tab does nothing;
  the collapse button closes the dock.
- The dock height is shared by all tabs of a thread and is the terminal drawer's own height:
  dragging the top edge of any tab resizes all of them, and the value is remembered per
  thread (upstream already persists it).
- The dock remembers per thread which fork tab was last used.
- The terminal works exactly as before: Cmd+J (`terminal.toggle`) opens and closes it, the
  header's terminal button does the same, splits and new terminals keep their shortcuts,
  and opening the terminal while a fork tab is showing switches the dock to Terminal.

Entry points:

| Entry           | Way in                                                                                                                                                             | Way out            | Where the state shows  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------- |
| Tab strip       | Click a tab                                                                                                                                                        | Collapse button    | The dock               |
| Keybinding      | `loom.bottom-dock.toggle` (open to the last used fork tab, or close); per-tab commands from phases 2 and 4; all unbound by default, bound in Settings, Keybindings | Same keys          | The dock               |
| Command palette | "Show Tasks", "Show Approvals" (per installed tab), "Hide bottom dock"                                                                                             | "Hide bottom dock" | The dock               |
| Terminal        | `terminal.toggle` and the header button (upstream)                                                                                                                 | Same               | The dock, Terminal tab |
| Settings        | None                                                                                                                                                               |                    |                        |

States: closed (nothing rendered beyond upstream's collapsed drawer); open on Terminal
(upstream drawer plus strip); open on a fork tab (strip plus that tab). No thread selected
(draft or empty route): the dock is not rendered, as upstream renders no drawer there.

## Tasks (phase 2)

Problem it solves: long-running project commands (dev server, test watcher, type checker)
need a home with status at a glance, separate from ad-hoc terminal work.

What the user can do:

- See the project's scripts (upstream's project scripts, the same list as the header's
  script menu) as rows with icon, name and state: Idle, Running, Finished, or Stopped (the
  shell ended; Restart).
- Run, Stop (sends Ctrl-C) and Restart a script. Each script runs in its own terminal
  session (`task-<script id>`), so running the dev server never takes over the user's
  shell.
- Select a row to see its live output in the right half of the tab (the real terminal view,
  so colors, links and scrollback work, and the user can type into it, for example to answer
  a prompt).
- Run an ad-hoc command from a one-line field at the top ("Run a command"), which creates a
  task row for it (`task-cmd-<n>`), and re-run recent commands (last 10 per project, stored on
  this device).
- Remove a finished ad-hoc task row (closes its terminal session).
- "Open in Terminal tab" switches to the Terminal tab with that session active.

States: no project scripts ("This project has no scripts. Add them in Project settings, or
run a command above." with a link to the project settings page); a script whose terminal
failed to open (the error message on the row, Retry); a task finished (row shows "Finished",
output kept until Restart or Remove); running tasks keep running when the dock is closed or
the user switches threads (they are terminal sessions on the server); the tab label shows a
running count ("Tasks 2").

Entry points: the Tasks tab; `loom.bottom-dock.tasks` (unbound); palette "Show Tasks" and
"Run task: <script name>" per script; way out: Stop, Remove, closing the dock (tasks keep
running; state visible in the tab label and the Terminal tab's session list).

## Approvals (phase 4)

Problem it solves: several threads waiting for approval at once.

What the user can do:

- See every pending approval across all threads in every connected environment, oldest
  first, grouped by thread (thread title, project, environment when there are several).
- Read what is being asked (command, file change, app access) as upstream's approval panel
  shows it.
- Approve, approve for the session, or decline in place, with the options the provider
  offers for that request. The row disappears when the thread's state updates.
- See pending questions (user input requests) too, with "Open thread" (answering needs the
  thread's composer).
- Open any thread from its group header.

States: none pending ("No approvals waiting."); a response failed (inline error on the row,
buttons re-enabled); many threads (the first 20 threads with pending requests load their
details; others show "Open thread to review"); an environment disconnected (its threads are
absent, as in the sidebar). The tab label shows the pending count ("Approvals 3") while the
dock is open.

Entry points: the Approvals tab; `loom.bottom-dock.approvals` (unbound); palette "Show
Approvals"; the sidebar's existing "Pending Approval" pills are unchanged; way out: answer
or collapse.

## Surfaces and connection modes

- Web and desktop: all phases.
- Mobile: not supported; mobile users answer approvals in each thread as today.
- Remote and upstream servers: all phases work, since they use only upstream data and
  upstream commands.

## Decisions

- The terminal tab is upstream's drawer, untouched. The fork adds a strip and sibling tabs;
  it never wraps, restyles or re-implements the terminal. Reason: zero drift from upstream's
  terminal.
- One tab at a time, one shared height per thread (the terminal's own). Reason: no height
  jumps, and upstream already persists the height.
- Tasks run in terminal sessions, exactly like upstream's script runner, so they behave the
  same locally and remotely and survive closing the dock. Reason: the terminal already has
  streaming, stop and reconnect.
- Tasks (`task-*` sessions) stay visible in the Terminal tab's session list too; the fork
  does not hide them. Reason (Kyle): they are real terminal sessions, and hiding them would
  need an extra seam in the drawer.
- The tab strip is hidden while Terminal is the only tab and appears once a second tab ships.
  Reason (Kyle): phase 1 alone changes nothing visible.
- Approvals is a client-side view over data the client already has or can subscribe to.
  Reason: no server work, works on upstream servers.
- Run Ledger and Run Packets are dropped. Reason: they depended on old Loom systems T3 does
  not have (brief).
- Activity tab (phase 3): retired by Kyle on 2026-10-09; upstream has find in thread and the
  timeline minimap.
- Approval risk badge (phase 5, Jev): retired by Kyle on 2026-10-09; Jev moved to its own
  project outside Loom.
