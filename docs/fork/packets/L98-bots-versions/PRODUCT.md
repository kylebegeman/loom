# L98 product

## Problem

A bot is only better than an ad-hoc brief if its brief keeps getting better. Today an edit
overwrites the definition: Kyle cannot see what changed, cannot go back, and cannot tell whether
the reviewer that now catches one bug also stopped catching another. Triggers (L97) and pipelines
(L99) make this sharper, because they run a bot unattended; an edit to the brief silently changes
what they do.

## What Kyle gets

- **History.** The bot editor's History tab lists every version: number, when, who saved it
  (Kyle, an agent, or a starter restore), a one-line summary of what changed ("Instructions,
  timeout"), and its runs, pass rate and median tokens from L92 and L95.
- **Compare.** Pick two versions to see the instructions as a diff and every other changed field
  as "Before / After" rows.
- **Restore.** "Restore this version" saves its definition as a new version. History never
  rewinds.
- **Stable version.** "Mark as stable" on a version. Triggers and pipeline steps can follow
  Stable instead of a fixed number or Latest, so Kyle can keep editing while unattended work keeps
  using the version he trusts. The bot list shows "v7, stable v5" when they differ.
- **Replay.** From the editor with unsaved changes, or from any version, Kyle picks past runs
  (filters: verdict, rating, failed, newest, or hand-picked, up to 20) and presses Replay. Loom
  runs the draft on each run's inputs and shows a table: inputs, the original result and verdict,
  the new result and verdict, duration and tokens. Rows where a verdict changed are highlighted,
  and a summary reads "Fixed 2, broke 0, same 8". Then Kyle saves, or edits and replays again.
- **Ratings and notes.** Each finished run has thumbs up, thumbs down and a short note ("missed
  the null check in parse"). Ratings show in history and work as replay filters.
- **Suggest an edit.** On a bot with down-rated runs, "Suggest an edit" asks a model to propose a
  revised brief from the current one, those runs' inputs and results, and Kyle's notes. The
  proposal opens as a draft in the editor with the diff visible; Kyle can replay it before saving.

## Decisions

- Version numbers never repeat. Deleting a bot and creating one with the same id continues the
  numbering, so an old run never points at a different definition with its number.
- Replay runs are real bot runs (same caps, same hidden threads), marked as replays. They count
  toward usage and budgets, because they cost the same, but never appear in the inbox.
- Replays on a bot with side effects run the same way the original did. The replay dialog warns
  when the bot's workspace is a project checkout rather than a worktree or scratch folder.
- Archiving or marking stable does not create a version; only definition changes do.

## Not in this packet

Automatic grading of text results, scheduled regression replays, and sharing versions between
computers (L100).
