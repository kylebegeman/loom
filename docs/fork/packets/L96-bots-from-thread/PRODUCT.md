# L96 product

## Problem

The best bot instructions already exist: they are the briefs Kyle wrote in threads that went
well. Rewriting one from scratch in the bot editor is slow, and the repeated briefs Kyle (and his
orchestrators) keep pasting are exactly the jobs that should be bots, but nothing points them out.

## What Kyle gets

- **Save as bot.** In any thread's menu, "Save as bot…" opens the bot editor, already filled:
  - **Name and id** from the thread title ("Resolve merge conflict" becomes `resolve-merge-conflict`).
  - **Instructions** from the first message Kyle sent, with concrete values swapped for
    placeholders: `apps/web/src/App.tsx` becomes `{{file}}`, `#482` becomes `{{pr}}`.
  - **Parameters** for each placeholder, typed (a file is a string, a pull request number is a
    number), with the original value as the example in the description.
  - **Model, runtime mode and interaction mode** from the thread.
  - **Workspace**: a project bot for the thread's project, in a worktree when the thread had one.
    Nothing is saved until Kyle presses Save.
- **Refine.** A "Refine with model" button asks the thread's model to tighten the instructions,
  name the parameters well and write a description. It takes up to three minutes and shows a
  static "Refining" state with Cancel. Kyle sees the result in the editor before saving.
- **From the palette.** "Save this thread as a bot" while a thread is open.
- **Suggestions.** When three or more threads in two weeks start with the same kind of brief, the
  Bots page shows "You started 4 threads like 'Resolve the merge conflict in {{file}}' this
  week. Make it a bot?" with Create and Dismiss. Create opens the editor from the newest of those
  threads.
- **Agents too.** An orchestrator calls `loom_bots_draft_from_thread` on a thread it launched and
  saves the result with `loom_bots_define`, so a brief it keeps rewriting becomes a measured bot.

## Decisions

- The deterministic draft always works, offline and instantly. Refinement is optional because it
  costs a model call and can be wrong.
- Only the first message becomes instructions. Later messages are corrections specific to that
  thread; including them would bake one-off fixes into every run.
- Suggestions count briefs from Kyle and from agents, since repeated orchestrator briefs are the
  strongest signal. Bot runs, scheduled task runs and promoted bot threads are never counted.

## Not in this packet

Merging several threads into one bot, learning from later corrections, and suggestions outside
the Bots page.
