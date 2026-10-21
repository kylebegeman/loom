# L95 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

| File                                          | Marker       | Lines | Why                                                          |
| --------------------------------------------- | ------------ | ----- | ------------------------------------------------------------ |
| `apps/web/src/components/usage/UsagePage.tsx` | `fork: bots` | 2     | Import and render the Bots section after the Totals section. |

The seam renders one fork component inside `UsageOverview`, after the Totals section, with values
the overview already receives:

```tsx
{
  /* fork: bots */
}
<BotsUsageSection
  window={shownWindow}
  environmentIds={selectedEnvironments.map((environment) => environment.environmentId)}
  totalTokens={merged.totalTokens}
/>;
```

`BotsUsageSection` (`apps/web/src/fork/bots/BotsUsageSection.tsx`) owns its fetching and returns
null unless the primary environment supports `bots-budgets` and is selected, so an upstream change
to the page conflicts on these lines at most. The page has no section registry, which is why this
is a seam and not an extension point.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had. `UsagePage.tsx` merges cleanly.

## FORK.md rows

- `UsagePage.tsx`, slug `bots`, packet L95.
- `docs/fork/seams.tsv`: `apps/web/src/components/usage/UsagePage.tsx	bots	2`.

## Where the build differs from the plan

- The seam is 2 marker lines, not 3: the import and one JSX comment. It sits in `UsageOverview`,
  which receives `selectedEnvironments` rather than `selectedEnvironmentIds`, so it maps the ids
  there.
- The Usage page section reads only the primary environment, where bots live, when it is among
  the selected environments, rather than summing every environment. Its share is of all tokens
  on the page, labelled "about", or "at least" when some runs reported no usage. The Bots page
  share is "of bot tokens", since that page has no all-tokens total.
- The Bots page windows are 24 hours, 7 days and 30 days, all rolling and ending on the current
  minute so a refetch within a minute reuses the query. There is no calendar "today".
- A refusal says how long to wait ("The next run is possible in 23 hours.") rather than a clock
  time, since the server does not know the reader's time zone. `BotsError.retryAt` carries the
  exact instant, and the editor's meter shows it as a local time.
- Budget checks take one global permit, and only for bots with a budget, so two concurrent starts
  cannot both take the last run. Budgets are read from the stored definition, not the caller's.
- A batch's `pausedUntil` is held in memory and not stored. After a restart the batch resumes and
  is refused again if the window still does not allow it, which sets the pause again.
- Usage is read after the run with a separate `providerTurns` call. A turn that reports no tokens,
  or that ran subagents, makes the run's usage partial; a failed read stores no usage and keeps
  the reply.
- Each model row has an `assumed` flag: runs that stored no model are counted under the bot's
  current model and say so.
- Run pruning keeps about 500 runs per bot, so counts for a busy bot over 30 days are exact only
  within what is kept.
- Tests are consolidated: `usage.test.ts` covers the planned `runUsage.test.ts` and the summary
  half of `BotsService.usage.test.ts`; the service tests live in `BotsService.budgets.test.ts`.
  `BotBudgets.test.ts` covers the window and refusal rules and `BotBatches.test.ts` the pause.
- `loom_bots_usage` takes `days` (1 to 30, default 7) and an optional `botId`.
