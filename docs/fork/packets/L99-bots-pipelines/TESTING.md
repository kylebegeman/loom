# L99 testing

Focused tests with `it.effect`, in the style of
`apps/server/src/fork/bots/BotsService.test.ts`. Run waits use the change PubSub or a
`Deferred`, never sleeps. Budget waits use `TestClock`.

## Pure

- `pipelineTemplates.test.ts`: every reference kind; the latest attempt of a looped step; a
  forward reference inside a loop is empty in round 1; step outputs wrapped in data tags and
  pipeline inputs plain; values cut to `TEXT_MAX` and `STRING_MAX` with a note.
- `pipelineCheck.test.ts`, one case per rule: duplicate ids, unknown or archived bots, missing
  and unknown parameters, a later-step reference outside a loop, a gate on a text bot, `goTo`
  forward, overlapping loops, `forEach` from a text step, an item parameter without `{{item}}`,
  a missing numeric version (and any number without L98), and the worktree warning.
- `decide`: pass; fail with `stop`, `continue`, and `goTo` below and at `maxRounds`;
  `needs_attention`; failed, timed out and cancelled runs with `onError`; a fan-out with one
  failed item; the last step completing.
- `pipelineReport.test.ts`: the path line for a two-round loop, and truncation at 64 KiB.

## Engine

`BotPipelines.test.ts` with the real `BotsService`, `BotBatches` and fork SQLite, and the test
provider layer `BotsService.test.ts` already uses:

- **Happy path.** Review (verdict pass), Fix, Verify (pass): three attempts, `completed`,
  `finalVerdict` pass, each run row carries `pipelineRunId`, versions recorded per attempt.
- **Fan-out.** Review returns three findings; Fix runs as a batch of three with
  `pipelineRunId`; zero findings skips the step.
- **Loop limit.** Verify always fails with `maxRounds: 3`: Fix and Verify each run three times,
  then the run is `stopped` with the round message and `stoppedRunId` set to the last Verify run.
- **Resume.** Resuming that run adds one Verify attempt in the same round; Review is not repeated.
- **Mixed providers.** Two steps with different `modelSelection`, one by override; each launch
  receives its own model.
- **Pinned versions.** Saving a step's bot mid-run does not change the version later attempts
  use.
- **Permission.** An agent caller at `auto` cannot start a pipeline containing a
  `full-access` bot, and no run row is written.
- **Limit.** The sixth concurrent pipeline run is refused.
- **Cancel.** Cancelling during a fan-out cancels the batch and its running items.
- **Budget (with L95).** A refused step sets `waiting` with `retryAt`; advancing `TestClock`
  past it starts the step.

## Restart

Using the same pattern as "settles runs a stopped server left behind" in
`BotsService.test.ts`: write state, build a fresh service layer over the same database, run
recovery, then assert.

- A started attempt whose run was queued: L89 recovery fails the run before launch; the attempt
  returns to pending and starts once; the failed row stays in history.
- A started attempt whose run is running: the driver waits for it and moves on when it finishes.
- A fan-out attempt mid-batch: L93 recovery restarts the feeder; the pipeline continues after
  the batch finishes.
- A `waiting` run with `retryAt` in the past starts its step immediately.
- No finished step is launched a second time in any case (count launches on the test provider).

## Inbox and compatibility

- With L94: a pipeline that loops twice and then passes adds nothing to the inbox; a stopped one
  adds exactly its stopping run.
- Decoding a `BotRun`, `BotBatch` and (with L97) `BotTrigger` that carry `pipelineRunId` or
  `pipelineId` with the previous schema succeeds.

## Manual

On request only: one web pass running the starter pipeline through one loop, with a dev server
restart mid-step.
