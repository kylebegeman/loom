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
- **Sample one model.** The same dialog has a "Same model, several times" mode: one provider
  and model, run 2 to 6 times with the same prompt (the same 6-thread cap). Members are named
  "<title> (<provider> <model>, run 2 of 3)". Useful to see how much one model's answers vary.
- **Get a ranking hint.** When every member of a compare run has stopped working, "Rank with
  Jev" asks Jev which result best meets a rubric (prefilled from settings, editable per run).
  The run shows Jev's pick, the order it implies and the confidence, labeled as a hint: Jev
  sees an excerpt of each result (the final reply and a capped diff), never whole transcripts,
  and never the provider or model names. It changes nothing: no thread is archived, merged or
  preferred.
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
- **Delegated workspace.** A delegated thread gets its own new worktree by default, so its
  edits never collide with the caller's. For read-only jobs (research, review) the agent can
  pass `worktree: false` to run in the caller's workspace instead; Loom then starts the task
  with a one-line note telling the child not to edit files.
- **Jev routing for delegated threads.** When an agent delegates without naming a provider
  or model, and "Let agents use this" is on for "Delegated thread routing" (Loom settings,
  Jev), Jev picks the model and reasoning effort from Kyle's routing candidates (each with a
  description Kyle writes, and the efforts it may use). Without Jev, or when Jev is slow,
  fails or is unsure, the child uses the caller's model and effort, as before. The Runs panel
  shows how each child's model was chosen ("Picked by Jev (confidence 0.74)", "Caller's model:
  Jev timed out", or "Chosen by the agent").
- **Stay in control.** Delegation is off by default; a thread can have at most four active
  children (configurable); children cannot delegate further unless the depth limit is raised;
  a child never gets a more permissive runtime mode than its parent; approvals in children
  come to Kyle as usual.
- **Clean up.** Stop all members of a run; archive a run to hide it (reverse: show archived,
  unarchive); remove a run's grouping without touching its threads. Deleting threads removes
  them from their run.

## Entry points

| Action              | Where                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compare models      | Palette "Compare models..."; Runs panel "New compare"; keybinding command `loom.multi-thread-runs.compare` (unbound).                                                                                                                    |
| Runs panel          | Right panel launcher and "+" menu ("Runs", letter N); palette "Show runs"; keybinding command `loom.multi-thread-runs.runs` (unbound).                                                                                                   |
| Delegation settings | Settings > Loom > Multi-thread runs (scope-gated like General: applies to the selected environment).                                                                                                                                     |
| Jev features        | Settings > Loom > Jev: "Use Jev" for "Delegated thread routing" (plus "Let agents use this", which routing needs) and for "Compare ranking hint" (no agent switch); routing candidates and the default rubric live in Multi-thread runs. |
| Ranking hint        | Runs panel, on a finished compare run: "Rank with Jev"; "Re-rank"; "Clear hint".                                                                                                                                                         |
| Agent tools         | `loom_multi_thread_runs_start_thread`, `loom_multi_thread_runs_get_thread` on T3's MCP server, visible to every agent.                                                                                                                   |
| Leave               | Close the panel tab; Archive or Remove a run; turn delegation off.                                                                                                                                                                       |

## Copy

- Dialog: title "Compare models"; mode switch "Different models" / "Same model, several
  times"; prompt placeholder "What should every model do?"; member row "Provider and model";
  "Add model" (up to 6); in the second mode one "Provider and model" row and "Runs" (2 to 6);
  workspace options "Separate worktrees (recommended)" and "Project root (read-only
  questions)"; warning with project root and more than one member: "Members share the
  project root and can overwrite each other's edits."; button "Start N threads".
- Ranking: button "Rank with Jev"; dialog field "Rubric" (prefilled, at most 1,000
  characters) and the note "Jev sees each member's final reply and a capped diff, not the
  whole thread. Provider and model names are not sent."; result line "Jev hint: <member>
  looks best against the rubric (confidence 0.71). Order: <member>, <member>, <member>.";
  low confidence: "Jev had no clear pick for this rubric."; failure: "Jev could not rank
  these (timed out). Try again."; stale: "Results changed since this hint.".
- Routing settings: "Routing candidates" with rows "Provider and model", "When to use it"
  (description, 10 to 300 characters, sent to Jev), "Allowed efforts"; help text "Used only
  when an agent delegates without naming a model and Jev routing is allowed for agents.";
  "Default ranking rubric" (default "Does what the prompt asks, is correct, changes only what
  is needed, and says what is left open.").
- Panel empty state: "No runs in this project yet. Compare models, or let agents start
  threads from Settings > Loom."
- Settings: "Let agents start threads" with help text "Adds two tools to every agent session
  on this environment: start a thread and read a thread it started. Children are ordinary
  threads you can open and stop."; "Active children per thread" (1 to 8, default 4);
  "Delegation depth" (1 to 3, default 1: children cannot delegate).
- Tool descriptions (short, they cost tokens every turn):
  - start: "Start a new T3 Code thread in this project to work on a task in parallel,
    optionally with another provider or model, in its own git worktree unless worktree is
    false (read-only jobs only). Returns the thread id. Use loom_multi_thread_runs_get_thread
    to check on it."
  - get: "Read the status, last reply and changed files of a thread you started with
    loom_multi_thread_runs_start_thread. Pass waitSeconds to wait until it stops working."
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
  with a reason when fewer than two provider instances are ready ("Different models" mode)
  or when none is ready ("Same model" mode). Jev UI (rank button, routing settings) hidden
  without the `decide` capability (routing labels on existing members still show); "Rank with Jev" hidden unless Jev is
  usable for it ("Use Jev" on, key saved), and disabled with "Waiting for N members to
  finish" while members work. The routing editor notes when "Let agents use this" is off.
- Ranking in progress: "Asking Jev..." on the button (at most 5 seconds, then the timeout
  message).

## Surfaces and connection modes

Web and desktop are required and identical. Mobile: no UI; members are ordinary threads.
Remote works; MCP tools run on the environment that hosts the agent. Upstream T3 servers:
hidden. Upstream clients on a Loom server: runs are invisible but threads are ordinary.

## Decisions

- Exactly two agent tools, as Kyle decided. Waiting is a parameter of `get_thread`, not a
  third tool. Reason: every tool costs tokens in every session.
- Runs are a fork grouping over ordinary threads, not a scheduler: no retries, budgets or
  leases. Reason: the smallest model that makes compare and delegation work.
- Threads start on the server (one code path for the dialog and the tools), through existing
  commands, including upstream's project setup script for new worktrees. Reason: one path,
  validated where the state lives.
- Delegation is off by default and bounded, because every agent session sees the tools.
- Compare offers "same prompt, same model, N times" in v1, within the same 6-thread cap.
  Reason (Kyle): sampling one model is as useful as comparing models, and it reuses the same
  starter and run grouping.
- Delegated threads default to a new worktree; `worktree: false` uses the caller's workspace
  for read-only jobs such as research or review. Reason (Kyle): isolation by default, with a
  cheap path for jobs that write nothing.
- Jev routes model and effort for delegated threads (feature
  `multi-thread-runs.delegate-routing`), only for agent calls that name no model, only with
  "Let agents use this" on, falling back to the caller's model and effort. Reason (Kyle, Jev
  cross-cutting decision): cheap, calibrated routing with a safe default.
- Compare gets a Jev ranking hint against a rubric (feature `multi-thread-runs.compare-rank`),
  user-started, labeled as a hint because Jev sees excerpts, not whole transcripts; the
  fallback is no ranking. Reason (Kyle): a first read on which result to open first, never an
  automatic judgment.
