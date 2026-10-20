# L95 product

## Problem

Once bots run on triggers and in batches, nobody is watching each run. Kyle cannot tell which
bots earn their keep, which ones quietly fail half the time, or which one burned a day of tokens
looping on a bad prompt. There is also no way to say "this bot may run 50 times a day and no
more".

## What Kyle gets

- **Usage per bot.** The Bots page Usage tab lists every bot for a window (today, 7 days, 30 days):
  runs, success rate, median and slowest duration, tokens, and its share of all processed tokens
  in that window. One line reads like "Reviewer: 140 runs this week, 94% pass, 2m median, 3% of
  tokens". Clicking a bot shows the same numbers per model, which makes "retry on another model"
  (L94) a measured choice.
- **Success rate that means something.** For verdict bots (L92) it is the pass rate. For text bots
  it is the share of runs that completed. Cancelled runs are left out of both.
- **Budgets.** In the bot editor, two optional limits: runs per 24 hours and tokens per 24 hours.
  The editor shows a static meter ("38 of 50 runs in the last 24 hours").
- **Clear refusals.** A run over budget is refused before it starts: "Reviewer reached its budget
  of 50 runs per 24 hours. The next run is possible at 14:32." The same message reaches agents
  through MCP.
- **Batches wait instead of failing.** A batch that hits the budget pauses with that message and
  continues on its own when the window allows.
- **Usage page.** Under Totals, a short Bots section: bot tokens in the shown window, their share,
  and the top three bots, with a link to the Bots page.

## Decisions

- Windows are rolling 24 hours, not calendar days, so a budget never resets all at once at
  midnight.
- The token limit counts finished runs. A run already in progress is never stopped by a budget,
  so a ceiling can be passed by the runs that were in flight when it was reached.
- Tokens come from what the provider reported for the run's turns. When a provider reports no
  usage, the numbers say "at least" and the share is not shown as exact.

## Not in this packet

Dollar limits, per-project budgets, and alerts before a budget is reached.
