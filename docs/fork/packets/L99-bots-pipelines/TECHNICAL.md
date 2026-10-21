# L99 technical design

## Overview

```text
loom.bots.runPipeline { pipelineId, inputs, projectId?, checkoutThreadId? }
   check every step (bot exists, mode rank, versions) ─▶ pipeline run row + first attempt (pending)
        │
   driver fiber (one per running pipeline run, at most 5 per environment)
        │ pending attempt ─▶ render step inputs from templates ─▶ BotBudgets.check (L95)
        │    single step ─▶ startRunWith(definition, inputs, caller, { pipelineRunId, attempt })
        │    fan-out step ─▶ BotBatches internal start (source inputs, pipelineRunId)
        │ terminal run or finished batch ─▶ capture outputs on the attempt
        │ gate: continue ─▶ next step | stop ─▶ stopped | goTo (round < max) ─▶ earlier step
        ▼
   past the last step ─▶ completed ─▶ report + watchPipelines
```

The engine is a cursor over a fixed list of steps. Every step is an ordinary bot run or batch, so
L89's semaphores, L93's feeder, L95's budgets and L94's run actions apply unchanged. The engine
itself never talks to a provider.

## Contracts

`packages/contracts/src/fork/bots.ts`:

- `BOTS_PIPELINES_FEATURE = "bots-pipelines"`, `BOTS_PIPELINE_MAX_STEPS = 12`,
  `BOTS_PIPELINE_MAX_ROUNDS = 5`, `BOTS_MAX_ACTIVE_PIPELINES = 5`.
- `BotPipelineId`: the `BotId` slug shape. `BotPipelineRunId`: the `BotRunId` shape
  (`packages/contracts/src/fork/bots.ts:168`).
- `BotPipelineStep = { id (slug, unique in the pipeline), botId, version: optionalKey(Union(
Literal("stable"), Literal("latest"), Int >= 1)), inputs: Record(parameterName, template),
forEach: optionalKey({ from: template reference, itemLabel?: template }), onFail:
optionalKey(Union(Literals(["stop", "continue"]), { goTo: stepId, maxRounds: 1 to 5 })),
onNeedsAttention: optionalKey(Literals(["stop", "continue"])), onError:
optionalKey(Literals(["stop", "continue"])), modelSelection: optionalKey(ModelSelection) }`.
  Absent `version` means `latest`; absent gates mean `stop`.
- `BotPipelineInput = { id, name, description, parameters: Array(BotParameter) (at most 12, the
bot parameter schema), steps: Array(BotPipelineStep) (1 to 12) }`. `BotPipeline` adds
  `version`, `createdBy: BotCreator`, `createdAt`, `updatedAt`.
- `BotPipelineAttempt = { seq, stepId, round, state: Literals(["pending", "started", "done",
"skipped"]), botVersion: NullOr(Int), runId: NullOr(BotRunId), batchId: NullOr(BotBatchId),
outcome: NullOr({ status, verdict: NullOr(...), summary: NullOr(String) }), startedAt,
finishedAt }`.
- `BotPipelineRun = { id, pipelineId, pipelineVersion, pipelineName, inputs, projectId,
checkoutThreadId, status: Literals(["running", "waiting", "completed", "stopped", "failed",
"cancelled"]), retryAt: NullOr(String), cursorStepId: NullOr(String), finalVerdict, error,
startedBy, callerThreadId, createdAt, finishedAt }`. `waiting` is a budget pause.
- `BotRun` and `BotBatch` gain `pipelineRunId: optionalKey(NullOr(BotPipelineRunId))`.
- `BotPipelineChange`: `TaggedStruct("pipeline", { pipeline })`,
  `TaggedStruct("pipeline-deleted", { pipelineId })`, `TaggedStruct("pipeline-run", { run })`,
  `TaggedStruct("pipeline-attempt", { pipelineRunId, attempt })`. A separate stream, because a
  new member of `BotsChange` would fail to decode on older clients.

| Tag                           | Payload                                                 | Success                       | Scope                   |
| ----------------------------- | ------------------------------------------------------- | ----------------------------- | ----------------------- |
| `loom.bots.listPipelines`     | `{}`                                                    | `{ pipelines }`               | `orchestration:read`    |
| `loom.bots.checkPipeline`     | `{ pipeline: BotPipelineInput }`                        | `{ problems }`                | `orchestration:read`    |
| `loom.bots.savePipeline`      | `{ pipeline: BotPipelineInput, expectedVersion? }`      | `BotPipeline`                 | `orchestration:operate` |
| `loom.bots.deletePipeline`    | `{ pipelineId }`                                        | `{}`                          | `orchestration:operate` |
| `loom.bots.runPipeline`       | `{ pipelineId, inputs, projectId?, checkoutThreadId? }` | `BotPipelineRun`              | `orchestration:operate` |
| `loom.bots.listPipelineRuns`  | `{ pipelineId?, before?, limit }` (limit at most 50)    | `{ runs, hasMore }`           | `orchestration:read`    |
| `loom.bots.getPipelineRun`    | `{ pipelineRunId }`                                     | `{ run, attempts, report }`   | `orchestration:read`    |
| `loom.bots.cancelPipelineRun` | `{ pipelineRunId }`                                     | `BotPipelineRun`              | `orchestration:operate` |
| `loom.bots.resumePipelineRun` | `{ pipelineRunId }`                                     | `BotPipelineRun`              | `orchestration:operate` |
| `loom.bots.watchPipelines`    | `{}`                                                    | stream of `BotPipelineChange` | `orchestration:read`    |

Each tag gets a row in `FORK_CLIENT_GUARDED_RPC_SCOPES`
(`packages/contracts/src/fork/clientRpcPermissions.ts`), and `watchPipelines` joins
`ForkSubscriptionRpcTag` (`packages/contracts/src/fork/rpc.ts:108`, where `loom.bots.watch`
already sits at `:128`). Refusals use the existing `BotsError` reasons `invalid`, `not_found` and
`permission` with the specific text in `message`.

## Templates

Step inputs are strings in the placeholder syntax bots already use (`PLACEHOLDER`,
`apps/server/src/fork/bots/render.ts:103`). `pipelineTemplates.ts` (pure) resolves:

| Reference                                                                         | Value                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `{{input.<name>}}`                                                                | the pipeline input                                                     |
| `{{steps.<id>.result}}`                                                           | the step's reply (L89 result), or the batch report for a fan-out step  |
| `{{steps.<id>.verdict}}`                                                          | `pass`, `fail` or `needs_attention` (L92); a fan-out step's worst item |
| `{{steps.<id>.summary}}`                                                          | the verdict summary                                                    |
| `{{steps.<id>.findings}}`                                                         | findings as a Markdown list with `path:line`                           |
| `{{item}}`, `{{item.title}}`, `{{item.detail}}`, `{{item.path}}`, `{{item.line}}` | the fan-out item                                                       |
| `{{round}}`                                                                       | the current round of the enclosing loop, starting at 1                 |

A step reads the latest attempt of each referenced step. Values from step outputs are model
output that may quote repository or pull request text, so they are rendered with L97's
`untrusted` option on `renderInstructions` (`render.ts:109`), which wraps them in data tags.
After rendering, each value is cut to its parameter's limit (`STRING_MAX` 2,000 and `TEXT_MAX`
20,000, `render.ts:8-9`) with a trailing "[cut]" and a note on the attempt, then checked with
`validateInputs` (`render.ts:78`), which accepts numbers given as strings. A value that still
fails validation stops the pipeline with the parameter and the message.

## Saving and checking

`checkPipeline` and `savePipeline` run the same pure `checkPipeline(input, bots)`:

1. Step ids are unique; every `botId` exists and is not archived.
2. Every required parameter of each step's bot has a template; unknown parameter names are
   refused.
3. Templates reference pipeline inputs and earlier steps. A later step may be referenced only
   from inside a loop that contains it (`{{steps.verify.findings}}` in Fix), and renders empty in
   round 1.
4. `onFail`, `onNeedsAttention` and `goTo` only on steps whose bot has `output: "verdict"` (L92).
   Text bots have no verdict to gate on. `goTo` targets an earlier step; loops do not nest or overlap.
5. `forEach.from` is `{{steps.<id>.findings}}` of an earlier verdict step, or `{{input.<name>}}` of
   a `text` parameter split into non-empty lines, as L93's `lines` source does. The step bot's
   item parameter must use an `{{item...}}` template.
6. A numeric `version` must exist (L98 `definitionAt`). Without L98, only `latest` is accepted.
7. A step whose bot edits in its own worktree (`worktree: true`) after an earlier editing step
   gets a warning: it will not see the earlier step's changes. Steps that should share edits use
   bots with `checkout: "caller"` (L90) and the run's `checkoutThreadId`.

Problems carry the step id and field so the editor can mark them.

## Engine

`apps/server/src/fork/bots/BotPipelines.ts`, a `Context.Service` in the bots module.

### Start

1. Load the pipeline. Resolve every step's version now with L98's `definitionAt(botId,
version)` and store the result in `versions_json`, so a bot saved mid-run does not change the
   run. Apply each step's `modelSelection` override to its resolved definition.
2. Check the caller once for all steps: the L89 runtime mode rank check for agent callers, and
   that the run's project matches each project-scoped bot. A pipeline never half-starts on a
   permission problem.
3. Refuse with `invalid` when 5 pipeline runs are already running or waiting in this
   environment ("5 pipelines are already running. Wait for one to finish.").
4. In one transaction: the pipeline run row with a snapshot of the pipeline definition, and
   attempt 1 for the first step in state `pending`. Publish and fork the driver.

### Driver

`drive(pipelineRunId)` loops until the run is terminal:

1. **Pending attempt.** Render inputs. Call `BotBudgets.check` (L95) when present. On refusal,
   set `waiting` with `retryAt`, publish, sleep until then, and check again. Then, in one
   transaction, call `startRunWith(definition, inputs, caller, { pipelineRunId })` (the L93
   internal start, which writes the queued run row with `pipeline_run_id`) and set the attempt to
   `started` with its `runId`. A fan-out step instead starts an L93 batch with source `{ type:
"inputs", items }` and `pipelineRunId`, and records `batchId`. A fan-out over zero items is
   `skipped` and the cursor moves on.
2. **Started attempt.** Wait for the run's terminal change on the service's change PubSub, the
   mechanism `BotsService.awaitRun` uses (subscribe, then read, so a finish between the two is not
   missed), with no timeout of its own: the run already has one. A fan-out step waits for its
   batch's `finished` or `cancelled` change from L93.
3. **Done attempt.** Capture the outcome on the attempt (status, verdict, summary, findings, and
   the result cut to 20,000 characters), then decide, in one transaction with the next attempt
   row:
   - run `failed` or `timed_out`, or a batch with failed items: `onError` (`stop` by default);
   - verdict `fail`: `onFail`; `goTo` creates an attempt for the target step with `round + 1`
     while `round < maxRounds`, otherwise the run stops with "Verify still failed after 3
     rounds.";
   - verdict `needs_attention`: `onNeedsAttention`;
   - otherwise the next step, or `completed` after the last.
     A stop sets `stopped` (a gate said stop) or `failed` (an error), `stopped_run_id`, and the
     message.

`finalVerdict` is the verdict of the last verdict step that ran. Cancelling a run of a pipeline
from the run list counts as that step's error.

### Cancel and resume

`cancelPipelineRun` sets `cancelled`, interrupts the driver, and cancels the current run
(`BotsService.cancel`) or batch (`cancelBatch`). `resumePipelineRun` applies to `stopped` and
`failed`: it adds a new pending attempt for the step that stopped (same round), re-resolves that
step's version only if the stored one no longer exists, and restarts the driver. Earlier steps
are not repeated.

### Restart recovery

A `forkParked` step ordered after L89's `BotsService.recover` and L93's batch recovery. L89
recovery fails queued runs ("The server restarted before this run started.") and gives running
runs a new waiter with their remaining time. For each `running` or `waiting` pipeline run:

1. A started attempt whose run is `failed` with `startedAt` null was failed by L89 recovery
   before launch; it returns to `pending` with its `runId` cleared. The failed row stays in run
   history.
2. A started attempt whose run is still running, or whose batch is running, is waited on as in
   step 2 above.
3. The driver restarts. `waiting` runs sleep until `retryAt`, which is already past or not.

Step outcomes live on attempt rows, so a finished step is never run twice.

### Inbox and usage

A run started by a pipeline is an ordinary run, but intermediate failures that a loop handles are
not Kyle's problem. L94's `isBotInboxRun` gains `pipelineRunId == null || run.id ===
stoppedRunId`, and the inbox SQL adds `(pipeline_run_id IS NULL OR id IN (SELECT stopped_run_id
FROM fork_bots_pipeline_runs))`. A stopped pipeline therefore shows exactly one inbox item, its
stopping run, labelled with the pipeline name. L95 usage counts pipeline runs under each bot and
`loom.bots.usage` adds per-pipeline totals from the same rows.

## Report

`renderPipelineReport(run, attempts)`, pure, in `pipelineReport.ts`: the path taken ("Review,
Fix, Verify (fail), Fix, Verify (pass)"), then per attempt the bot, version, model, duration,
verdict, summary and failing findings. Capped at 64 KiB with `truncated`, like L93's report.

## Storage

Migration 11 `Pipelines` in `apps/server/src/fork/bots/migrations.ts` (next free id if another
bots migration landed first; the set holds 1 and 2 today):

- `fork_bots_pipelines(id TEXT PRIMARY KEY, version INTEGER NOT NULL, definition_json TEXT NOT
NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`.
- `fork_bots_pipeline_runs(id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, pipeline_version
INTEGER NOT NULL, definition_json TEXT NOT NULL, versions_json TEXT NOT NULL, inputs_json TEXT
NOT NULL, project_id TEXT, checkout_thread_id TEXT, status TEXT NOT NULL, retry_at TEXT,
cursor_step_id TEXT, final_verdict TEXT, stopped_run_id TEXT, error TEXT, started_by TEXT NOT
NULL, caller_thread_id TEXT, created_at TEXT NOT NULL, finished_at TEXT)`, index
  `(pipeline_id, created_at DESC)` and `(status)`.
- `fork_bots_pipeline_attempts(pipeline_run_id TEXT NOT NULL, seq INTEGER NOT NULL, step_id TEXT
NOT NULL, round INTEGER NOT NULL, state TEXT NOT NULL, bot_version INTEGER, run_id TEXT,
batch_id TEXT, outcome_json TEXT, notes_json TEXT NOT NULL DEFAULT '[]', started_at TEXT,
finished_at TEXT, PRIMARY KEY (pipeline_run_id, seq))`.
- `ALTER TABLE fork_bots_runs ADD COLUMN pipeline_run_id TEXT`,
  `ALTER TABLE fork_bots_batches ADD COLUMN pipeline_run_id TEXT`.

Retention: the newest 100 pipeline runs per pipeline; pruning removes attempts, not bot runs.
L89 run pruning (`RUNS_KEPT_PER_BOT` in `apps/server/src/fork/bots/BotsStore.ts`) skips runs of a
pipeline run that is still running. Deleting a pipeline refuses while it has running runs.

L98 retention keeps versions that a pipeline step pins by number (already listed in L98).

## Starter and clients

L90's starter set gains `review-fix-verify`: Review (verdict), Fix with `forEach` over
`{{steps.review.findings}}`, Verify (verdict) with `onFail: { goTo: "fix", maxRounds: 3 }`,
offered once and recorded in `fork_bots_starters` like starter bots.

- `packages/client-runtime/src/fork/bots.ts`: pipeline and run atoms folded from
  `watchPipelines`; the open run is refetched with `getPipelineRun` after a resubscribe.
- `apps/web/src/fork/bots/PipelineEditor.tsx`: inputs (the bot parameter editor reused), steps
  with bot, version, model override, template fields with a reference menu, fan-out, gate and
  loop controls; `checkPipeline` on a debounce marks problems inline.
- `apps/web/src/fork/bots/PipelineRunView.tsx`: static rows per attempt (status, round,
  duration, verdict chip, link to the run or batch), the report, Cancel and Resume.
- A Pipelines tab in the Bots route's `tab` search param; palette "Run pipeline".

## Agent-facing tools

- `loom_bots_pipelines` (read): pipelines with their steps.
- `loom_bots_define_pipeline` (write): `BotPipelineInput`, refused with the problem list.
- `loom_bots_run_pipeline` (write): run input plus `wait?`; with `wait: true` it waits up to 10
  minutes and returns the report, otherwise the run.
- `loom_bots_pipeline_status` (read), `loom_bots_pipeline_cancel` (write).

## Triggers

With L97, `BotTrigger` gains `pipelineId: optionalKey(NullOr(BotPipelineId))`. `botId` stays
required and holds the first step's bot so older clients still decode the trigger. The firing
path calls `runPipeline`; a refusal is a skipped firing, as for bots.

## Performance and alternatives

One row and about three events per attempt; the driver holds no permits while waiting. Rejected:
workflow scripts in a provider session (die with the session, one provider), a general DAG with
parallel branches (recovery, gates and the run view all get harder; fan-out covers Kyle's
parallel case), and step state only on run rows (loop rounds, skipped fan-outs and gate
decisions have no run row, so recovery would guess).
