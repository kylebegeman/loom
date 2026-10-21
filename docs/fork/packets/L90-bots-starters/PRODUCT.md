# L90 product

## Problem

An empty bot library teaches nothing. Kyle already runs the same three jobs by hand every day:
resolve a merge conflict, review a change through a specific lens, and check whether a claim is
actually true. Each time the brief is rewritten from memory, so quality drifts and nobody can tell
which wording worked.

## What Kyle gets

- **Merge conflict resolver.** Input: `file` (the conflicted path). Runs in the checkout that has the
  conflict, usually an integration worktree: the calling thread's checkout when an agent or the
  composer starts it, or the checkout Kyle picks in the run form. Never a scratch folder or a new
  worktree, because the conflict lives in that checkout's index. Reads both sides and the merge base,
  resolves the hunks, keeps fork seams intact, runs the narrowest check for that file and reports
  what it chose and why. Auto-accept edits, 20-minute timeout, one run per file at a time
  (concurrency 4 across files).
- **Reviewer.** Inputs: `target` (a path, branch, commit range or PR number) and `lens`, a choice
  of `correctness`, `surfaces` or `fidelity`. Read-only: it runs in plan interaction mode with
  approval-required runtime mode and is told not to edit. Correctness looks for bugs and broken
  contracts; surfaces walks the "Hit every surface" list from `AGENTS.md`; fidelity checks the
  change against the packet or request it claims to implement. 15-minute timeout.
- **Verifier.** Inputs: `target` and `claim` (for example "the inbox hides dismissed runs"). It
  runs the smallest check that proves or disproves the claim and replies with what ran and the
  answer. A short 10-minute limit keeps it from turning into an investigation.
- **Marked as starters.** Each card shows a "Starter" chip. Editing a starter is normal: it gets
  new versions like any bot, and the chip says "Starter, edited".
- **Restore.** "Restore starter" puts the shipped text back as a new version. If Kyle deleted a
  starter, the Bots page lists it under "Starters you removed" with a "Restore" button. Deleting a
  starter never brings it back on the next restart.

## Decisions

- The ids are fixed (`merge-conflict-resolver`, `reviewer`, `verifier`) so agents and later
  packets can name them.
- The model is whatever the environment's default model is when the starter is seeded. Starters
  cannot know which providers an environment has; Kyle pins a different model in the editor.
- A newer Loom with better starter text does not overwrite Kyle's copy. The card says "A newer
  starter is available" and restore applies it.

## Not in this packet

Structured verdicts for the reviewer and verifier arrive with L92, which turns their output
contract on. Running the resolver over every conflict at once is L93.
