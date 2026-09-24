# L08 product

## Problem

Kyle subscribes to several agent providers and often wants to see how two or three of them
handle the same task, or to let one agent hand a well-scoped piece of work to another (for
example Claude plans and Codex implements a sub-task in its own worktree). Today that means
creating each thread by hand, pasting the prompt, and hunting for them in the sidebar
afterwards; agents have no way to start or check on another thread at all.

## What the user can do

- **Compare models.** Write one prompt, pick two to six provider and model pairs, choose
  whether each gets its own worktree (default) or they all read the project root, and start.
  Each member is an ordinary thread named "<title> (<provider> <model>)".
- **Watch runs.** The Runs panel lists the project's runs newest first: title, kind
  (Compare, or Delegated by "<thread>"), age and an aggregate status (Working, Needs you,
  Done, Error). Expanding a run shows each member with provider, model, status, branch and
  changes, with Open, Stop and, when thread lineage (L02) is installed, Open side by side.
- **Filter.** By status (All, Working, Needs you, Done), by provider, and by text (title,
  prompt, model).
- **Let agents delegate.** With "Let agents start threads" on (Loom settings), an agent can
  start a thread in the same project on any configured provider and later read its status,
  last reply and changes. Delegated threads appear in the Runs panel under a run named after
  the delegating thread, and in the sidebar like any thread.
- **Stay in control.** Delegation is off by default; a thread can have at most four active
  children (configurable); children cannot delegate further unless the depth limit is raised;
  a child never gets a more permissive runtime mode than its parent; approvals in children
  come to Kyle as usual.
- **Clean up.** Stop all members of a run; archive a run to hide it (reverse: show archived,
  unarchive); remove a run's grouping without touching its threads. Deleting threads removes
  them from their run.

## Entry points

| Action              | Where                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Compare models      | Palette "Compare models..."; Runs panel "New compare"; keybinding command `loom.multi-thread-runs.compare` (unbound).                  |
| Runs panel          | Right panel launcher and "+" menu ("Runs", letter N); palette "Show runs"; keybinding command `loom.multi-thread-runs.runs` (unbound). |
| Delegation settings | Settings > Loom > Multi-thread runs (scope-gated like General: applies to the selected environment).                                   |
| Agent tools         | `loom_multi_thread_runs_start_thread`, `loom_multi_thread_runs_get_thread` on T3's MCP server, visible to every agent.                 |
| Leave               | Close the panel tab; Archive or Remove a run; turn delegation off.                                                                     |

## Copy

- Dialog: title "Compare models"; prompt placeholder "What should every model do?"; member
  row "Provider and model"; "Add model" (up to 6); workspace options "Separate worktrees
  (recommended)" and "Project root (read-only questions)"; warning with project root and more
  than one member: "Members share the project root and can overwrite each other's edits.";
  button "Start N threads".
- Panel empty state: "No runs in this project yet. Compare models, or let agents start
  threads from Settings > Loom."
- Settings: "Let agents start threads" with help text "Adds two tools to every agent session
  on this environment: start a thread and read a thread it started. Children are ordinary
  threads you can open and stop."; "Active children per thread" (1 to 8, default 4);
  "Delegation depth" (1 to 3, default 1: children cannot delegate).
- Tool descriptions (short, they cost tokens every turn):
  - start: "Start a new T3 Code thread in this project to work on a task in parallel,
    optionally with another provider or model, usually in its own git worktree. Returns the
    thread id. Use get_thread to check on it."
  - get: "Read the status, last reply and changed files of a thread you started. Pass
    waitSeconds to wait until it stops working."
- Tool errors in plain words: "Thread delegation is turned off in Loom settings.", "This
  thread already has 4 active child threads.", "Child threads cannot start more threads
  (delegation depth 1).", "Provider instance 'x' is not available.", "You can only read
  threads you started."

## States

- Loading: panel skeleton while `list` loads; member rows use live thread shells.
- Empty: the copy above.
- Error: failed starts are listed in the dialog per member ("Codex: Could not create the
  worktree: ..."); members that started stay started. List errors show a retry.
- In progress: "Starting 3 threads..." in the dialog; the panel shows new members as
  Starting until their shells report a session.
- Disabled: all entry points hidden without `multi-thread-runs`; "New compare" disabled
  with a reason when fewer than two provider instances are ready.

## Surfaces and connection modes

Web and desktop are required and identical. Mobile: no UI; members are ordinary threads.
Remote works; MCP tools run on the environment that hosts the agent. Upstream T3 servers:
hidden. Upstream clients on a Loom server: runs are invisible but threads are ordinary.

## Decisions and open questions

Decisions:

- Exactly two agent tools, as Kyle decided. Waiting is a parameter of `get_thread`, not a
  third tool.
- Runs are a fork grouping over ordinary threads, not a scheduler: no retries, budgets or
  leases.
- Threads start on the server (one code path for the dialog and the tools), through existing
  commands, including upstream's project setup script for new worktrees.
- Delegation is off by default and bounded, because every agent session sees the tools.

Open questions for Kyle:

- Should compare offer "same prompt, same model, N times" (sampling) as well as different
  models? The dialog allows repeating a model; no special mode.
- Default workspace for delegated threads: a new worktree (packet default) or the caller's
  workspace? The tool exposes `worktree: boolean` with default true.
