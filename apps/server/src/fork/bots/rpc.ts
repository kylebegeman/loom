import {
  BOTS_BATCH_WS_METHODS as BB,
  BOTS_DRAFT_WS_METHODS as BD,
  BOTS_PIPELINE_WS_METHODS as BP,
  BOTS_TRIGGER_WS_METHODS as BT,
  BOTS_VERSION_WS_METHODS as BV,
  BOTS_WS_METHODS as B,
  type BotsBatchInput,
  type BotsDismissSuggestionInput,
  type BotsDraftFromThreadInput,
  type BotsRefineDraftInput,
  type BotsSuggestionsInput,
  type BotsDismissInput,
  type BotsError,
  type BotsInboxInput,
  type BotsListBatchesInput,
  type BotsRetryBatchInput,
  type BotsRetryInput,
  type BotsListRunsInput,
  type BotPipelineInput,
  type BotsListPipelineRunsInput,
  type BotsRunPipelineInput,
  type BotsSavePipelineInput,
  type BotsRunInput,
  type BotsSaveInput,
  type BotStarterId,
  type BotsUsageInput,
  type BotsRepinTriggerInput,
  type BotsSaveTriggerInput,
  type BotsTestTriggerInput,
  type BotsTriggerFiringsInput,
  type BotTrigger,
  type BotTriggerChange,
  type BotsRateRunInput,
  type BotsReplayInput,
  type BotsRestoreVersionInput,
  type BotsSetStableInput,
  type BotsSuggestEditInput,
  type BotsVersionRef,
  type BotsVersionsInput,
} from "@t3tools/contracts/fork";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { BotBatches } from "./BotBatches.ts";
import { BotsService, USER_CALLER, type BotCaller } from "./BotsService.ts";
import { BotDrafts } from "./fromThread/BotDrafts.ts";
import { BotPipelines } from "./pipelines/BotPipelines.ts";
import { BotTriggers } from "./triggers/BotTriggers.ts";
import { BotVersions } from "./versions/BotVersions.ts";

export const makeBotsRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* BotsService;
    return {
      [B.list]: () => auth.effect(B.list, service.list().pipe(Effect.map((bots) => ({ bots })))),
      [B.save]: (input: BotsSaveInput) => auth.effect(B.save, service.save(input, USER_CALLER)),
      [B.archive]: (input: { botId: string; archived: boolean }) =>
        auth.effect(B.archive, service.archive(input.botId, input.archived)),
      [B.delete]: (input: { botId: string }) =>
        auth.effect(B.delete, service.delete(input.botId).pipe(Effect.as({}))),
      [B.run]: (input: BotsRunInput) =>
        auth.effect(
          B.run,
          Effect.gen(function* () {
            const caller =
              input.callerThreadId === undefined
                ? USER_CALLER
                : yield* service.threadCaller(input.callerThreadId);
            return yield* service.run(input, caller);
          }),
        ),
      [B.cancel]: (input: { runId: string }) => auth.effect(B.cancel, service.cancel(input.runId)),
      [B.listRuns]: (input: BotsListRunsInput) => auth.effect(B.listRuns, service.listRuns(input)),
      [B.watch]: () => auth.stream(B.watch, service.changes),
      [B.listStarters]: () =>
        auth.effect(
          B.listStarters,
          service.listStarters().pipe(Effect.map((starters) => ({ starters }))),
        ),
      [B.restoreStarter]: (input: { starterId: BotStarterId }) =>
        auth.effect(B.restoreStarter, service.restoreStarter(input.starterId, USER_CALLER)),
      [B.inbox]: (input: BotsInboxInput) => auth.effect(B.inbox, service.inbox(input)),
      [B.retry]: (input: BotsRetryInput) => auth.effect(B.retry, service.retry(input, USER_CALLER)),
      [B.dismiss]: (input: BotsDismissInput) =>
        auth.effect(B.dismiss, service.dismiss(input).pipe(Effect.map((runs) => ({ runs })))),
      [B.promote]: (input: { runId: string }) =>
        auth.effect(B.promote, service.promote(input.runId, USER_CALLER)),
      [B.usage]: (input: BotsUsageInput) => auth.effect(B.usage, service.usage(input)),
    };
  });

export const makeBotBatchesRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const bots = yield* BotsService;
    const batches = yield* BotBatches;
    const callerFor = (input: BotsBatchInput): Effect.Effect<BotCaller, BotsError> =>
      input.callerThreadId === undefined
        ? Effect.succeed(USER_CALLER)
        : bots.threadCaller(input.callerThreadId);
    return {
      [BB.previewBatch]: (input: BotsBatchInput) =>
        auth.effect(
          BB.previewBatch,
          callerFor(input).pipe(Effect.flatMap((caller) => batches.preview(input, caller))),
        ),
      [BB.runBatch]: (input: BotsBatchInput) =>
        auth.effect(
          BB.runBatch,
          callerFor(input).pipe(Effect.flatMap((caller) => batches.runBatch(input, caller))),
        ),
      [BB.listBatches]: (input: BotsListBatchesInput) =>
        auth.effect(BB.listBatches, batches.list(input)),
      [BB.getBatch]: (input: { batchId: string }) =>
        auth.effect(BB.getBatch, batches.get(input.batchId)),
      [BB.cancelBatch]: (input: { batchId: string }) =>
        auth.effect(BB.cancelBatch, batches.cancel(input.batchId)),
      [BB.retryBatch]: (input: BotsRetryBatchInput) =>
        auth.effect(BB.retryBatch, batches.retry(input, USER_CALLER)),
      [BB.batchReport]: (input: { batchId: string }) =>
        auth.effect(BB.batchReport, batches.report(input.batchId)),
      [BB.watchBatches]: () => auth.stream(BB.watchBatches, batches.changes),
    };
  });

export const makeBotDraftsRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const drafts = yield* BotDrafts;
    return {
      [BD.draftFromThread]: (input: BotsDraftFromThreadInput) =>
        auth.effect(BD.draftFromThread, drafts.draftFromThread(input.threadId)),
      [BD.refineDraft]: (input: BotsRefineDraftInput) =>
        auth.effect(BD.refineDraft, drafts.refine(input)),
      [BD.suggestions]: (input: BotsSuggestionsInput) =>
        auth.effect(BD.suggestions, drafts.suggestions(input)),
      [BD.dismissSuggestion]: (input: BotsDismissSuggestionInput) =>
        auth.effect(BD.dismissSuggestion, drafts.dismissSuggestion(input)),
    };
  });

const withoutWebhook = ({ webhook: _webhook, ...trigger }: BotTrigger): BotTrigger => trigger;

export const makeBotTriggersRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const triggers = yield* BotTriggers;
    // The webhook address carries the token, so only sessions that can edit triggers see it.
    const shown = auth.has(AuthOrchestrationOperateScope)
      ? (trigger: BotTrigger) => trigger
      : withoutWebhook;
    const shownChange = (change: BotTriggerChange): BotTriggerChange =>
      change._tag === "trigger" ? { ...change, trigger: shown(change.trigger) } : change;
    return {
      [BT.listTriggers]: (input: { botId?: string }) =>
        auth.effect(
          BT.listTriggers,
          triggers.list(input.botId).pipe(Effect.map((list) => ({ triggers: list.map(shown) }))),
        ),
      [BT.saveTrigger]: (input: BotsSaveTriggerInput) =>
        auth.effect(BT.saveTrigger, triggers.save(input, USER_CALLER)),
      [BT.deleteTrigger]: (input: { triggerId: string }) =>
        auth.effect(BT.deleteTrigger, triggers.delete(input.triggerId).pipe(Effect.as({}))),
      [BT.setTriggerEnabled]: (input: { triggerId: string; enabled: boolean }) =>
        auth.effect(BT.setTriggerEnabled, triggers.setEnabled(input.triggerId, input.enabled)),
      [BT.repinTrigger]: (input: BotsRepinTriggerInput) =>
        auth.effect(BT.repinTrigger, triggers.repin(input)),
      [BT.testTrigger]: (input: BotsTestTriggerInput) =>
        auth.effect(BT.testTrigger, triggers.test(input)),
      [BT.triggerFirings]: (input: BotsTriggerFiringsInput) =>
        auth.effect(BT.triggerFirings, triggers.firings(input)),
      [BT.rotateTriggerToken]: (input: { triggerId: string }) =>
        auth.effect(BT.rotateTriggerToken, triggers.rotate(input.triggerId)),
      [BT.watchTriggers]: () =>
        auth.stream(BT.watchTriggers, triggers.changes.pipe(Stream.map(shownChange))),
    };
  });

export const makeBotVersionsRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* BotsService;
    const versions = yield* BotVersions;
    return {
      [BV.versions]: (input: BotsVersionsInput) =>
        auth.effect(BV.versions, service.versions(input)),
      [BV.version]: (input: BotsVersionRef) => auth.effect(BV.version, service.version(input)),
      [BV.setStable]: (input: BotsSetStableInput) =>
        auth.effect(BV.setStable, service.setStable(input)),
      [BV.restoreVersion]: (input: BotsRestoreVersionInput) =>
        auth.effect(BV.restoreVersion, service.restoreVersion(input, USER_CALLER)),
      [BV.replay]: (input: BotsReplayInput) =>
        auth.effect(BV.replay, versions.replay(input, USER_CALLER)),
      [BV.getReplay]: (input: { replayId: string }) =>
        auth.effect(BV.getReplay, versions.get(input.replayId)),
      [BV.cancelReplay]: (input: { replayId: string }) =>
        auth.effect(BV.cancelReplay, versions.cancel(input.replayId)),
      [BV.rateRun]: (input: BotsRateRunInput) => auth.effect(BV.rateRun, service.rateRun(input)),
      [BV.suggestEdit]: (input: BotsSuggestEditInput) =>
        auth.effect(BV.suggestEdit, versions.suggestEdit(input)),
    };
  });

export const makeBotPipelinesRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const bots = yield* BotsService;
    const pipelines = yield* BotPipelines;
    return {
      [BP.listPipelines]: () =>
        auth.effect(
          BP.listPipelines,
          pipelines.list().pipe(Effect.map((list) => ({ pipelines: list }))),
        ),
      [BP.checkPipeline]: (input: { pipeline: BotPipelineInput }) =>
        auth.effect(
          BP.checkPipeline,
          pipelines.check(input.pipeline).pipe(Effect.map((problems) => ({ problems }))),
        ),
      [BP.savePipeline]: (input: BotsSavePipelineInput) =>
        auth.effect(BP.savePipeline, pipelines.save(input, USER_CALLER)),
      [BP.deletePipeline]: (input: { pipelineId: string }) =>
        auth.effect(BP.deletePipeline, pipelines.delete(input.pipelineId).pipe(Effect.as({}))),
      [BP.runPipeline]: (input: BotsRunPipelineInput) =>
        auth.effect(
          BP.runPipeline,
          Effect.gen(function* () {
            const caller =
              input.callerThreadId === undefined
                ? USER_CALLER
                : yield* bots.threadCaller(input.callerThreadId);
            return yield* pipelines.run(input, caller);
          }),
        ),
      [BP.listPipelineRuns]: (input: BotsListPipelineRunsInput) =>
        auth.effect(BP.listPipelineRuns, pipelines.listRuns(input)),
      [BP.getPipelineRun]: (input: { pipelineRunId: string }) =>
        auth.effect(BP.getPipelineRun, pipelines.getRun(input.pipelineRunId)),
      [BP.cancelPipelineRun]: (input: { pipelineRunId: string }) =>
        auth.effect(BP.cancelPipelineRun, pipelines.cancel(input.pipelineRunId)),
      [BP.resumePipelineRun]: (input: { pipelineRunId: string }) =>
        auth.effect(BP.resumePipelineRun, pipelines.resume(input.pipelineRunId, USER_CALLER)),
      [BP.watchPipelines]: () => auth.stream(BP.watchPipelines, pipelines.changes),
    };
  });
