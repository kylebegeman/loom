# L99 seams

## Extension points created by this packet

None: all existed (L89's).

## Packet seams

None. Pipelines, their runs and attempts live in fork tables and fork services. The engine calls
fork code only: `startRunWith` (L93), the L93 batch start, `definitionAt` (L98),
`BotBudgets.check` (L95) and `isBotInboxRun` (L94). The new subscription is added to the fork's
own `ForkSubscriptionRpcTag` union (`packages/contracts/src/fork/rpc.ts:108`), which the client
stream union already includes through the existing `ext-core` seam. The Pipelines tab is part of
the fork's Bots route.

## Merge check

Run before each commit:

```sh
git fetch -q upstream --tags
tag=$(git tag -l 'v*-nightly.*' --sort=-creatordate | head -1)
git merge-tree --write-tree --name-only --no-messages HEAD "$tag"
```

Recorded when the packet landed: `v0.1.1-nightly.20261020.3411`, 68 conflicting files, the same
68 the branch base already had.

## FORK.md rows

None.

## Where the build differs from the plan

- The engine lives in `apps/server/src/fork/bots/pipelines/`: `templates.ts`, `check.ts`,
  `decide.ts`, `report.ts`, `PipelinesStore.ts`, `starter.ts` and `BotPipelines.ts`. The planned
  test files became `pipelines/pipelines.test.ts` (pure modules) and
  `pipelines/BotPipelines.test.ts` (engine).
- The pipeline RPCs are a separate `BotPipelinesRpcGroup` rather than part of `BotsRpcGroup`.
- The inbox marks a pipeline's stopping run with a `pipeline_stopped` column on
  `fork_bots_runs` instead of a subquery on `stopped_run_id`. Retrying that run is refused with
  "Resume the pipeline instead", and the web shows **Open pipeline run** in place of Retry.
- Untrusted framing is applied when a step renders its bot's instructions, through
  `StartOptions.untrusted`. Pipelines started by a trigger also frame their own inputs, as
  triggered bot runs do.
- The contracts add `stoppedRunId` to the pipeline run, notes on attempts, and a `problems` list of warnings in the `loom_bots_define_pipeline` result. An
  error refuses the save with the first problem rather than the whole list.
- The starter adds a plain **Fixer** bot and the "Review, fix, verify" pipeline, recorded as
  `pipeline:review-fix-verify`. It seeds after the bot starters and is skipped, without recording,
  while the starter reviewer or verifier is missing.
- A pipeline trigger keeps `botId` as the first step's bot, refuses merge conflict events (one
  pipeline per event, not per file) and ignores version follow, since each step pins its own
  version. The web cannot move a saved trigger between a bot and a pipeline. A server without this
  packet ignores `pipelineId` and would run the bot.
- Usage filtered by bot omits per-pipeline rows.
- MCP adds `loom_bots_pipeline_resume`.
- The web run form and run view live in `PipelineRunView.tsx` and the tab in `BotPipelines.tsx`.
  The Pipelines tab is environment-wide rather than per bot. The editor's draft logic is
  `pipelineDraft.ts`, which reuses parameter drafts now exported from `draft.ts`.
