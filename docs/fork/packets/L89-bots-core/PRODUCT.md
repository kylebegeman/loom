# L89 product

## Problem

Orchestrating agents brief the same roles from scratch many times a day: resolve this merge
conflict, review this change for correctness, verify this claim. The brief drifts, the model is
whatever the caller happened to use, and every run lands in the Settled list beside real work.
There is no way to say "this job always runs like this" and then just run it.

## What Kyle gets

- **A Bots page.** A bot icon in the sidebar footer, after Sites, opens `/loom/bots`. The page
  is the doorway to everything about bots: the library, the editor, the run form, what is
  running now and what finished or failed recently.
- **Bot definitions.** Name, description, instructions, inputs, model and effort, runtime and
  interaction modes, where it runs (a fresh scratch folder, a project checkout, or a new
  worktree), a timeout and how many runs may happen at once. Bots can be global or scoped to
  one project. Every save makes a new version number.
- **Inputs like a function.** Each input has a name, label, type (short text, long text, number,
  yes/no, or a choice list), whether it is required and a default. The run form is generated
  from them. Instructions refer to inputs as `{{name}}`.
- **Runs that keep their focus.** A run always uses the bot's model, modes and workspace, no
  matter who started it. If it passes its timeout it is stopped. If too many runs are already
  going, it waits its turn.
- **Runs out of the way.** Run threads do not appear in the sidebar, navigation or notifications.
  The Bots page shows each run's status, inputs, duration and final reply, and opens the full
  thread when needed.
- **Agents can use bots.** An agent can list bots, define one, run one and wait for its reply or
  check on it later, and cancel a run. An agent cannot start a bot with broader permissions than
  it has itself.
- **Palette.** "Go to Bots" and "Run bot" (pick a bot, then the page opens its run form).

## Decisions

- Storage is the Loom library: fork SQLite tables on the environment.
- A run is a thread. That keeps transcripts, checkpoints, providers and interruption working
  with no new execution engine.
- Mobile is later; it simply never shows bot run threads.

## Not in this packet

Starter bots, composer `/` invocation, structured verdicts, batches, the inbox, budgets, save
thread as bot, triggers, version history, pipelines and Library sync are L90 to L100.
