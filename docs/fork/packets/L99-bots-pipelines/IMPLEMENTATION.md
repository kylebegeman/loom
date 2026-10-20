# L99 implementation

Prerequisites: L89, L92, L93 and L98 landed. L95 and L97 are optional; their hooks are skipped
when the packet is absent. Read [TECHNICAL.md](./TECHNICAL.md) first.

## Steps

1. **Contracts.** In `packages/contracts/src/fork/bots.ts` add the constants, `BotPipelineId`,
   `BotPipelineRunId`, `BotPipelineStep`, `BotPipelineInput`, `BotPipeline`,
   `BotPipelineAttempt`, `BotPipelineRun`, `BotPipelineChange`, the `pipelineRunId` optional key
   on `BotRun` and `BotBatch`, and the ten RPCs in `BotsRpcGroup`. Add the scope rows in
   `packages/contracts/src/fork/clientRpcPermissions.ts` and `watchPipelines` to
   `ForkSubscriptionRpcTag` in `packages/contracts/src/fork/rpc.ts`. Add `bots-pipelines` to the
   server's advertised features in `apps/server/src/fork/features.ts`.
2. **Templates.** `apps/server/src/fork/bots/pipelineTemplates.ts`: parse references, resolve
   them against `{ inputs, attempts, item, round }`, cut to parameter limits, return values and
   notes. Reuse `PLACEHOLDER` and the L97 `untrusted` rendering from `render.ts`; export what is
   needed rather than copying the regex.
3. **Checker.** `apps/server/src/fork/bots/pipelineCheck.ts`: the pure `checkPipeline(input,
bots, versionsExist)` with the seven rules, returning `{ stepId, field, message }` problems.
4. **Migration 11.** Append `Pipelines` to `BotsMigrations` (next free id if another bots
   migration landed first). Add store functions in `BotsStore.ts` or a sibling
   `PipelinesStore.ts`: pipeline CRUD with `expectedVersion`, run and attempt rows, the
   "start step" transaction helper that takes an effect writing the run row, and pruning.
5. **Internal starts.** Extend `startRunWith`'s options with `pipelineRunId` and write it on the
   run row. Extend the L93 batch start with `pipelineRunId` and an internal entry point that
   accepts a resolved definition and an `inputs` source without the preview step.
6. **Engine.** `apps/server/src/fork/bots/BotPipelines.ts`: start, driver, gate decision,
   cancel, resume, recovery. Keep the gate decision a pure function `decide(step, attempt,
rounds)` so it is tested without SQLite. Fork drivers into the service scope as the batch
   feeder does.
7. **Recovery wiring.** Register the recovery under `forkParked` after L89's and L93's recovery,
   the same way `BotsService` registers its own (`BotsService.recover` under `forkParked` in
   `apps/server/src/fork/bots/BotsService.ts`).
8. **Inbox and usage.** Extend `isBotInboxRun` and the inbox SQL (L94) and the usage rows (L95)
   when those packets are present.
9. **Report.** `apps/server/src/fork/bots/pipelineReport.ts`, pure.
10. **RPC and MCP.** Handlers in `apps/server/src/fork/bots/rpc.ts` that decode, call one
    service method and map errors. MCP tools in `apps/server/src/fork/bots/mcp.ts`, with
    `wait` using the same 10-minute cap as `loom_bots_run_batch`.
11. **Starter.** Add `review-fix-verify` to `starters.ts` (L90) once the starter Review and
    Verify bots are verdict bots.
12. **Triggers.** When L97 is present, add `pipelineId` to `BotTrigger` and branch the firing
    path.
13. **Client runtime.** Atoms, the `watchPipelines` fold and commands in
    `packages/client-runtime/src/fork/bots.ts`.
14. **Web.** `PipelineEditor.tsx`, `PipelineRunView.tsx`, the Pipelines tab and the palette
    entry. Use existing `components/ui` variants; no new animation.

Checkpoints: after step 6 the engine tests pass; after step 10 an agent can define and run a
pipeline through MCP; after step 14 Kyle can build and watch "Review, fix, verify" on the Bots
page.

## Checks

```sh
vp test run apps/server/src/fork/bots/pipelineTemplates.test.ts \
  apps/server/src/fork/bots/pipelineCheck.test.ts \
  apps/server/src/fork/bots/BotPipelines.test.ts \
  apps/server/src/fork/bots/pipelineReport.test.ts
```

Then targeted lint and typecheck for `apps/server`, `packages/contracts`,
`packages/client-runtime` and `apps/web`. No repo-wide checks.

## Done when

- A three-step pipeline with fan-out and a loop runs to completion, stops at its loop limit when
  Verify keeps failing, and resumes from the stopping step.
- Restarting the server mid-step continues the pipeline without repeating finished steps.
- A stopped pipeline shows one inbox item; intermediate loop failures show none.
- Older clients without `bots-pipelines` decode runs, batches and triggers that carry the new
  optional keys.
