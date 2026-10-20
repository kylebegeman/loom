import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  BotDefinition,
  BotDefinitionInput,
  BotId,
  BotInputs,
  BotRun,
  BotRunId,
  BotsError,
  BotStarterId,
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
import { BotsService, type BotCaller } from "./BotsService.ts";

/** A waiting run call returns the run as it stands after this, even if it is still going. */
export const AGENT_RUN_WAIT_MAX_MS = 10 * 60 * 1000;

const failure = Schema.Union([BotsError, OrchestratorMcpFailure]);
const callerDependencies = [McpInvocationContext, ThreadManagementService];

const AgentBot = Schema.Struct({ ...BotDefinition.fields, activeRuns: Schema.Int });

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
    };
  }),
);
