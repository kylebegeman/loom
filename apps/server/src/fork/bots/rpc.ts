import {
  BOTS_BATCH_WS_METHODS as BB,
  BOTS_DRAFT_WS_METHODS as BD,
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
  type BotsRunInput,
  type BotsSaveInput,
  type BotStarterId,
  type BotsUsageInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { BotBatches } from "./BotBatches.ts";
import { BotsService, USER_CALLER, type BotCaller } from "./BotsService.ts";
import { BotDrafts } from "./fromThread/BotDrafts.ts";

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
