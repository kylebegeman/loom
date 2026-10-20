# L93 product

## Problem

The jobs bots are best at come in piles: nineteen conflicted files after an upstream merge, every
open pull request before a release, every file that matches a pattern. Today that means nineteen
runs started by hand, nineteen replies read one at a time, and no single place that says how many
worked.

## What Kyle gets

- **Run on many.** On any bot, "Run on many" opens a source picker:
  - **Lines**: paste text; each non-empty line is one item.
  - **Files**: a glob such as `apps/web/src/**/*.tsx`, matched against tracked files in the
    project.
  - **Merge conflicts**: every conflicted file in a checkout Kyle picks (the project root or a
    thread's worktree).
  - **Pull requests**: open pull requests for the project, optionally filtered by text.
  - **Search**: file-name or content search results in the project.
- **Map the item to an input.** Kyle chooses which bot input receives each item (for the
  resolver, `file`), and fills the other inputs once for the whole batch (for the reviewer, the
  lens).
- **Preview first.** The picker shows "19 items" with the first few listed before anything starts.
  Sources that find more than 200 items are refused with the count, so Kyle narrows the source.
- **One action.** "Resolve all 19 conflicts" starts the batch. Items run as fast as the bot's
  concurrency limit and the environment's 20-run ceiling allow; the rest wait their turn.
- **Progress grid.** The batch view shows one small square per item: waiting, running, done,
  failed, plus verdict colors when the bot returns verdicts. Clicking a square opens that run.
  No animation; squares change color when the state changes.
- **Retry failed.** "Retry failed" reruns only failed and timed-out items; "Retry failed and
  needs attention" includes those verdicts too. Earlier attempts stay visible on the item.
- **Report.** When the batch ends, the report reads like "26 pass, 3 fail, 1 needs attention" with
  each failing item's summary and findings, and a "Copy report" button that copies Markdown.
- **Agents batch too.** An orchestrator calls `loom_bots_run_batch` with a list of inputs (or a
  source) and gets a batch id, then reads the report when it finishes, or waits for it.

## Decisions

- 200 items per batch. Large enough for any real conflict set or release sweep, small enough that
  a mistake costs minutes, not hours.
- A batch never bypasses the bot's limits. It is a queue in front of the same semaphores.
- Items that never started survive a restart and continue; items that were running continue the
  way any run does (L89).

## Not in this packet

Mixed bots in one batch, conditional follow-up runs, and chaining a fix after a failing review
(all L99). Budgets that stop a batch midway arrive with L95.
