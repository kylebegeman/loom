import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  BotBatch,
  BotBatchReport,
  BotBatchRetryResult,
  BotBatchSource,
  BotBatchId,
  BotDefinition,
  BotDefinitionInput,
  BotDraftResult,
  BotId,
  BotInputs,
  BotParameterName,
  BotRun,
  BotRunId,
  BotsDismissInput,
  BotsError,
  BotStarterId,
  BotSuggestion,
  BotsRetryBatchInput,
  BotsRetryInput,
  BotsSaveTriggerInput,
  BotsUsageResult,
  BotTrigger,
  BotTriggerId,
  BOTS_LIST_RUNS_MAX_LIMIT,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { loadCaller, readThread } from "../../mcp/threadAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { BotBatches } from "./BotBatches.ts";
import { BotsService, type BotCaller } from "./BotsService.ts";
import { BotDrafts } from "./fromThread/BotDrafts.ts";
import { BotTriggers } from "./triggers/BotTriggers.ts";

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
  Tool.make("loom_bots_inbox", {
    description:
      "List bot runs that need a person, newest first: failed and timed-out runs, and verdict runs that ended needs_attention. Each run carries its error or verdict, inputs and the model it used. Retry one with loom_bots_retry or dismiss it with loom_bots_dismiss.",
    parameters: Schema.Struct({
      limit: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: BOTS_LIST_RUNS_MAX_LIMIT })),
      ),
    }),
    success: Schema.Struct({
      runs: Schema.Array(BotRun),
      total: Schema.Int,
      hasMore: Schema.Boolean,
    }),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_usage", {
    description:
      "Read what bots used over the last days (default 7, at most 30): per bot, its runs, outcomes, pass or success rate, median and longest duration, tokens and a split by model. Tokens are a lower bound when usageComplete is false. Also returns each budgeted bot's runs and tokens in the last 24 hours and, when a budget is reached, retryAt, the instant the next run may start.",
    parameters: Schema.Struct({
      days: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
      botId: Schema.optionalKey(BotId),
    }),
    success: BotsUsageResult,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_retry", {
    description:
      "Run an inbox run again with the same inputs, project and checkout, using the bot as saved now. Pass modelSelection to use another model for this retry only. The old run leaves the inbox; a run can be retried once, so retry the newer run after that.",
    parameters: BotsRetryInput,
    success: BotRun,
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_dismiss", {
    description:
      "Remove finished runs from the bots inbox without rerunning them, or with dismissed:false put them back.",
    parameters: BotsDismissInput,
    success: Schema.Struct({ runs: Schema.Array(BotRun) }),
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
  Tool.make("loom_bots_draft_from_thread", {
    description:
      "Draft a bot from a thread's opening request, by default this thread's. Pull request numbers and file paths become {{pr}} and {{file}} parameters, and the model, modes and workspace come from the thread. Nothing is saved: review the draft, generalize its instructions, then save it with loom_bots_define. notes explains what the draft changed.",
    parameters: Schema.Struct({ threadId: Schema.optionalKey(ThreadId) }),
    success: BotDraftResult,
    failure,
    dependencies: callerDependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_suggestions", {
    description:
      "List requests that opened three or more threads in 14 days with the same shape, the same job on different files, pull requests or values. Each is a candidate bot; draft one from its newest thread with loom_bots_draft_from_thread.",
    success: Schema.Struct({ suggestions: Schema.Array(BotSuggestion) }),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_triggers", {
    description:
      "List bot triggers, optionally for one bot: what event each listens for, how event fields map to the bot's inputs, its cooldown and daily limit, and when it last fired.",
    parameters: Schema.Struct({ botId: Schema.optionalKey(BotId) }),
    success: Schema.Struct({ triggers: Schema.Array(BotTrigger) }),
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_bots_save_trigger", {
    description:
      "Create or update a trigger that runs a bot when an event happens: a pull request's checks start failing, a pull request opens, a thread settles in a project, a schedule comes due, a webhook arrives, or `scripts/fork/loom.sh integrate` hits merge conflicts. mapping fills each bot input from an event field ({field}) or a fixed value ({value}); every required input needs one. Webhook and merge conflict triggers return webhook.url (or webhook.path on this server) to give the sender. Runs start with this thread's runtime mode as their ceiling, and a trigger skips its runs once the bot changes unless followLatest is set.",
    parameters: BotsSaveTriggerInput,
    success: BotTrigger,
    failure,
    dependencies: callerDependencies,
  }),
  Tool.make("loom_bots_set_trigger_enabled", {
    description: "Turn a bot trigger on or off. A schedule trigger turned on counts from now.",
    parameters: Schema.Struct({ triggerId: BotTriggerId, enabled: Schema.Boolean }),
    success: BotTrigger,
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
      loom_bots_inbox: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(BotsService, (service) => service.inbox({ limit: input.limit ?? 20 })),
        ),
      ),
      loom_bots_usage: McpToolAccess.reads((input) =>
        onHost(
          Effect.gen(function* () {
            const service = yield* BotsService;
            const now = DateTime.toEpochMillis(yield* DateTime.now);
            const days = input.days ?? 7;
            return yield* service.usage({
              since: DateTime.formatIso(DateTime.makeUnsafe(now - days * 24 * 60 * 60 * 1000)),
              until: DateTime.formatIso(DateTime.makeUnsafe(now)),
              ...(input.botId === undefined ? {} : { botId: input.botId }),
            });
          }),
        ),
      ),
      loom_bots_retry: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          const caller = yield* agentCaller;
          return yield* onHost(
            Effect.flatMap(BotsService, (service) => service.retry(input, caller)),
          );
        }),
      ),
      loom_bots_dismiss: McpToolAccess.writes((input) =>
        onHost(
          Effect.flatMap(BotsService, (service) =>
            service.dismiss(input).pipe(Effect.map((runs) => ({ runs }))),
          ),
        ),
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
      loom_bots_draft_from_thread: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const { projection } = yield* readThread(input.threadId);
          return yield* onHost(
            Effect.flatMap(BotDrafts, (drafts) => drafts.draftFromThread(projection.thread.id)),
          );
        }),
      ),
      loom_bots_suggestions: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(BotDrafts, (drafts) => drafts.suggestions({}))),
      ),
      loom_bots_triggers: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(BotTriggers, (triggers) =>
            triggers.list(input.botId).pipe(Effect.map((list) => ({ triggers: list }))),
          ),
        ),
      ),
      loom_bots_save_trigger: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          const caller = yield* agentCaller;
          return yield* onHost(
            Effect.flatMap(BotTriggers, (triggers) => triggers.save(input, caller)),
          );
        }),
      ),
      loom_bots_set_trigger_enabled: McpToolAccess.writes((input) =>
        onHost(
          Effect.flatMap(BotTriggers, (triggers) =>
            triggers.setEnabled(input.triggerId, input.enabled),
          ),
        ),
      ),
    };
  }),
);
