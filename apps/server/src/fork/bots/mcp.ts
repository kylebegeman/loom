import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  BotBatch,
  BotBatchReport,
  BotBatchRetryResult,
  BotBatchSource,
  BotBatchId,
  BotDefinition,
  BotDefinitionInput,
  BotId,
  BotInputs,
  BotParameterName,
  BotRun,
  BotRunId,
  BotsError,
  BotStarterId,
  BotsRetryBatchInput,
} from "@t3tools/contracts/fork";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { loadCaller } from "../../mcp/threadAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { BotBatches } from "./BotBatches.ts";
import { BotsService, type BotCaller } from "./BotsService.ts";

/** A waiting run call returns the run as it stands after this, even if it is still going. */
export const AGENT_RUN_WAIT_MAX_MS = 10 * 60 * 1000;

const failure = Schema.Union([BotsError, OrchestratorMcpFailure]);
const callerDependencies = [McpInvocationContext, ThreadManagementService];

const AgentBot = Schema.Struct({ ...BotDefinition.fields, activeRuns: Schema.Int });
const BatchWithReport = Schema.Struct({ batch: BotBatch, report: BotBatchReport });

export const BotsToolkit = Toolkit.make(
  Tool.make("loom_bots_list", {
    description:
      "List the bots this thread's project can run: each one's brief, typed parameters, pinned model and modes, timeout, and how many runs are active. A bot with an origin is a Loom starter. A bot whose output is verdict ends each completed run with a structured verdict you can branch on. Prefer running a bot over briefing a new thread for the same job.",
    success: Schema.Struct({ bots: Schema.Array(AgentBot) }),
    failure,
    dependencies: callerDependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_define", {
    description:
      "Create or replace a bot: a reusable job with fixed instructions, {{name}} placeholders filled from typed parameters, and pinned model, modes, workspace, timeout and concurrency. Set output to verdict to have each completed run return pass, fail or needs_attention with a summary and findings. Pass expectedVersion from loom_bots_list to avoid overwriting someone else's edit. A bot cannot run in a broader runtime mode than this thread.",
    parameters: Schema.Struct({
      ...BotDefinitionInput.fields,
      expectedVersion: Schema.optionalKey(Schema.Int),
    }),
    success: BotDefinition,
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_run", {
    description:
      "Run a bot with its inputs. The run is a hidden thread with the bot's own settings. With wait:true, returns once the run ends or after its timeout (at most 10 minutes), including the bot's final reply and, for a verdict bot, its decoded verdict; otherwise returns the queued run at once. With notify:true, returns at once and posts the bot's result to this thread when the run ends, waking it. Do not combine wait and notify. A bot run cannot start another bot. Project workspaces default to this thread's project. A bot whose workspace checkout is `caller` runs in this thread's checkout, or in checkoutThreadId's.",
    parameters: Schema.Struct({
      botId: BotId,
      inputs: BotInputs,
      projectId: Schema.optionalKey(ProjectId),
      checkoutThreadId: Schema.optionalKey(ThreadId),
      wait: Schema.optionalKey(Schema.Boolean),
      notify: Schema.optionalKey(Schema.Boolean),
    }),
    success: BotRun,
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_restore_starter", {
    description:
      "Put a Loom starter bot back to its shipped instructions and settings as a new version, keeping its model and project scope. Recreates a deleted starter and unarchives an archived one.",
    parameters: Schema.Struct({ starterId: BotStarterId }),
    success: BotDefinition,
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_run_status", {
    description:
      'Read one bot run by id, including its status, final reply, verdict and error. A verdict with source "invalid" means the reply was not a verdict; read the reply.',
    parameters: Schema.Struct({ runId: BotRunId }),
    success: BotRun,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_cancel", {
    description: "Cancel a queued or running bot run.",
    parameters: Schema.Struct({ runId: BotRunId }),
    success: BotRun,
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_run_batch", {
    description:
      "Run one bot over many items, up to 200, as a batch. Pass source {type:'inputs', items:[...]} with one inputs record per item, or a source Loom resolves: lines (one item per line), glob (tracked files), conflicts (conflicted files in the checkout), pullRequests (open pull requests) or search (files by name or content). Every source but inputs needs itemParameter, the input each item fills; sharedInputs fill the rest. Items run under the bot's concurrency limit, and the whole batch is refused if any item is invalid. With wait:true, returns once the batch finishes or after 10 minutes with its report, which lists every item that did not pass; otherwise returns the batch at once. Read it later with loom_bots_batch_status.",
    parameters: Schema.Struct({
      botId: BotId,
      source: BotBatchSource,
      itemParameter: Schema.optionalKey(BotParameterName),
      sharedInputs: Schema.optionalKey(BotInputs),
      projectId: Schema.optionalKey(ProjectId),
      wait: Schema.optionalKey(Schema.Boolean),
    }),
    success: Schema.Struct({ batch: BotBatch, report: Schema.optionalKey(BotBatchReport) }),
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_batch_status", {
    description:
      "Read a bot batch by id: its status, counts, and a report naming every item that failed or needs attention, with each run's thread id.",
    parameters: Schema.Struct({ batchId: BotBatchId }),
    success: BatchWithReport,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_batch_retry", {
    description:
      "Run a finished or cancelled batch's failed and timed-out items again; include failed_and_attention to also rerun verdict items that need attention. useLatest reruns with the bot as saved now instead of the version the batch started with. An item runs at most 5 times in all; items past that are listed in exhausted.",
    parameters: BotsRetryBatchInput,
    success: BotBatchRetryResult,
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_batch_cancel", {
    description:
      "Cancel a running batch: waiting items are skipped and runs in flight are cancelled.",
    parameters: Schema.Struct({ batchId: BotBatchId }),
    success: BotBatch,
    failure,
    dependencies: callerDependencies,
  }),
);

const agentCaller = loadCaller().pipe(
  Effect.map(({ caller, limits }): BotCaller => ({
    actor: "agent",
    threadId: caller?.id ?? null,
    projectId: caller?.projectId ?? null,
    runtimeMode: limits.runtimeMode,
  })),
);

export const botsHandlers = McpToolAccess.toLayer(
  BotsToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_bots_list: McpToolAccess.reads(() =>
        Effect.gen(function* () {
          const caller = yield* loadCaller();
          const projectId = caller.caller?.projectId ?? null;
          return yield* onHost(
            Effect.gen(function* () {
              const service = yield* BotsService;
              const bots = yield* service.list();
              return {
                bots: bots
                  .filter(
                    (bot) =>
                      bot.archivedAt === null &&
                      (bot.scopeProjectId === null || bot.scopeProjectId === projectId),
                  )
                  .map((bot) => ({ ...bot, activeRuns: service.activeRunCount(bot.id) })),
              };
            }),
          );
        }),
      ),
      loom_bots_define: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          const caller = yield* agentCaller;
          return yield* onHost(
            Effect.flatMap(BotsService, (service) => service.save(input, caller)),
          );
        }),
      ),
      loom_bots_run: McpToolAccess.writes(({ wait, ...input }) =>
        Effect.gen(function* () {
          if (wait === true && input.notify === true)
            return yield* new BotsError({
              reason: "invalid",
              message: "Use wait or notify, not both.",
            });
          const caller = yield* agentCaller;
          return yield* onHost(
            Effect.gen(function* () {
              const service = yield* BotsService;
              const run = yield* service.run(input, caller);
              if (wait !== true) return run;
              const bot = (yield* service.list()).find((candidate) => candidate.id === run.botId);
              const waitMs = Math.min(AGENT_RUN_WAIT_MAX_MS, (bot?.timeoutMinutes ?? 10) * 60_000);
              return yield* service.awaitRun(run.id, waitMs);
            }),
          );
        }),
      ),
      loom_bots_restore_starter: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          const caller = yield* agentCaller;
          return yield* onHost(
            Effect.flatMap(BotsService, (service) =>
              service.restoreStarter(input.starterId, caller),
            ),
          );
        }),
      ),
      loom_bots_run_status: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(BotsService, (service) => service.getRun(input.runId))),
      ),
      loom_bots_cancel: McpToolAccess.writes((input) =>
        onHost(Effect.flatMap(BotsService, (service) => service.cancel(input.runId))),
      ),
      loom_bots_run_batch: McpToolAccess.writes(({ wait, ...input }) =>
        Effect.gen(function* () {
          const caller = yield* agentCaller;
          return yield* onHost(
            Effect.gen(function* () {
              const batches = yield* BotBatches;
              const batch = yield* batches.runBatch(input, caller);
              if (wait !== true) return { batch };
              const settled = yield* batches.awaitBatch(batch.id, AGENT_RUN_WAIT_MAX_MS);
              return { batch: settled, report: yield* batches.report(batch.id) };
            }),
          );
        }),
      ),
      loom_bots_batch_status: McpToolAccess.reads((input) =>
        onHost(
          Effect.gen(function* () {
            const batches = yield* BotBatches;
            const { batch } = yield* batches.get(input.batchId);
            return { batch, report: yield* batches.report(input.batchId) };
          }),
        ),
      ),
      loom_bots_batch_retry: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          const caller = yield* agentCaller;
          return yield* onHost(
            Effect.flatMap(BotBatches, (batches) => batches.retry(input, caller)),
          );
        }),
      ),
      loom_bots_batch_cancel: McpToolAccess.writes((input) =>
        onHost(Effect.flatMap(BotBatches, (batches) => batches.cancel(input.batchId))),
      ),
    };
  }),
);
