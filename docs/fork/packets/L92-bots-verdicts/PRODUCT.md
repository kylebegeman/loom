# L92 product

## Problem

A reviewer's reply is a wall of prose. Kyle has to read every one to learn whether anything is
wrong, an orchestrating agent has to guess from wording, and nothing can count outcomes across
many runs. Batches (L93), the inbox (L94), budgets (L95) and pipelines (L99) all need a run to say
plainly whether it passed.

## What Kyle gets

- **An output setting.** In the bot editor, "Reply" is either "Text" or "Verdict". Text is
  today's behavior.
- **Verdict runs.** A verdict bot's reply is decoded into:
  - `pass`, `fail` or `needs_attention`;
  - a summary of at most a paragraph;
  - findings, each with a title, detail, and optional path and line.
- **Chips.** Each run on the Bots page shows a green Pass, red Fail or amber Needs attention chip
  next to its status. A filter row above the runs list narrows to one verdict.
- **Findings.** Opening a run lists its findings with `path:line` in monospace and a copy button,
  above the full reply.
- **Honest failure.** If the bot replies with something that is not a valid verdict, the run is
  still completed, the chip says Needs attention, the summary says the reply was not a valid
  verdict, and the raw reply is shown in full. Nothing is guessed.
- **Agents read JSON.** `loom_bots_run` with `wait`, and `loom_bots_run_status`, return the
  verdict object. An orchestrator can branch on `verdict` without parsing prose. The L91 message
  posted back to a thread starts with the verdict and summary.
- **Starters upgraded.** The reviewer and verifier starters get a new revision with verdict output
  on. Kyle's existing copies show "Newer starter available" (L90); restore applies it.

## Decisions

- One fixed verdict shape for every bot. Counting "26 pass, 3 fail, 1 needs attention" across a
  batch only works if every bot speaks the same language.
- `fail` is an answer, not an error: the run completed and found a problem. Failed or timed-out
  runs have no verdict at all.
- Text bots stay text. Nothing changes for a bot until Kyle switches it.

## Not in this packet

Custom schemas per bot, verdict-based alerts (L97 triggers send results to the inbox), and
gates that stop a pipeline on `fail` (L99).
