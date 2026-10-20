import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { ProviderInteractionMode, RuntimeMode } from "../providerPolicy.ts";

export const BOTS_FEATURE = "bots";
export const BOTS_STARTERS_FEATURE = "bots-starters";
export const BOTS_INVOCATION_FEATURE = "bots-invocation";

export const BOTS_WS_METHODS = {
  list: "loom.bots.list",
  save: "loom.bots.save",
  archive: "loom.bots.archive",
  delete: "loom.bots.delete",
  run: "loom.bots.run",
  cancel: "loom.bots.cancel",
  listRuns: "loom.bots.listRuns",
  watch: "loom.bots.watch",
  listStarters: "loom.bots.listStarters",
  restoreStarter: "loom.bots.restoreStarter",
} as const;

export const BOTS_MAX_PARAMETERS = 12;
export const BOTS_MAX_ACTIVE_RUNS = 20;
export const BOTS_RESULT_MAX_BYTES = 16 * 1024;
export const BOTS_LIST_RUNS_MAX_LIMIT = 50;

/** Every bot run thread id starts with this, which keeps runs out of thread lists. */
export const BOT_RUN_THREAD_PREFIX = "bot-run-";

export const botRunThreadId = (runId: string): ThreadId =>
  ThreadId.make(`${BOT_RUN_THREAD_PREFIX}${runId}`);

export const isBotRunThreadId = (threadId: string): boolean =>
  threadId.startsWith(BOT_RUN_THREAD_PREFIX);

export const BotId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
export type BotId = typeof BotId.Type;

export const BotParameterName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/),
);
export type BotParameterName = typeof BotParameterName.Type;

const shortText = (max: number) => Schema.String.check(Schema.isMaxLength(max));

export const BotParameterType = Schema.Literals(["string", "text", "number", "boolean", "choice"]);
export type BotParameterType = typeof BotParameterType.Type;

export const BotParameter = Schema.Struct({
  name: BotParameterName,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  description: Schema.optionalKey(shortText(500)),
  type: BotParameterType,
  required: Schema.Boolean,
  default: Schema.optionalKey(shortText(20_000)),
  choices: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(200))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20),
    ),
  ),
});
export type BotParameter = typeof BotParameter.Type;

export const BotCheckout = Schema.Literals(["root", "caller"]);
export type BotCheckout = typeof BotCheckout.Type;

export const BotWorkspace = Schema.Union([
  Schema.Struct({ type: Schema.Literal("scratch") }),
  Schema.Struct({
    type: Schema.Literal("project"),
    /** Null means the caller chooses the project when it runs the bot. */
    projectId: Schema.NullOr(ProjectId),
    worktree: Schema.Boolean,
    baseRef: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
    /**
     * `caller` runs in the checkout of the thread the work is in, such as an integration
     * worktree holding a conflict. Absent means `root`.
     */
    checkout: Schema.optionalKey(BotCheckout),
  }),
]);
export type BotWorkspace = typeof BotWorkspace.Type;

export const BotDefinitionInput = Schema.Struct({
  id: BotId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  description: shortText(1000),
  instructions: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)),
  parameters: Schema.Array(BotParameter).check(Schema.isMaxLength(BOTS_MAX_PARAMETERS)),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspace: BotWorkspace,
  timeoutMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120 })),
  maxConcurrentRuns: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: BOTS_MAX_ACTIVE_RUNS }),
  ),
  /** Null for a bot every project can use. */
  scopeProjectId: Schema.NullOr(ProjectId),
});
export type BotDefinitionInput = typeof BotDefinitionInput.Type;

export const BotCreator = Schema.Literals(["user", "agent"]);
export type BotCreator = typeof BotCreator.Type;

export const BotStarterId = Schema.Literals(["merge-conflict-resolver", "reviewer", "verifier"]);
export type BotStarterId = typeof BotStarterId.Type;

/** Where a bot came from. Only the server sets it; a save carries it forward. */
export const BotOrigin = Schema.Struct({
  kind: Schema.Literal("starter"),
  starterId: BotStarterId,
  revision: Schema.Int,
});
export type BotOrigin = typeof BotOrigin.Type;

export const BotDefinition = Schema.Struct({
  ...BotDefinitionInput.fields,
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  createdBy: BotCreator,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
  origin: Schema.optionalKey(BotOrigin),
});
export type BotDefinition = typeof BotDefinition.Type;

/**
 * `edited`: differs from the shipped text it came from. `outdated`: a newer shipped text exists.
 * `removed`: offered once, and no bot with its id carries the starter origin now.
 */
export const BotStarterState = Schema.Literals(["present", "edited", "outdated", "removed"]);
export type BotStarterState = typeof BotStarterState.Type;

export const BotStarterStatus = Schema.Struct({
  starterId: BotStarterId,
  revision: Schema.Int,
  name: Schema.String,
  description: Schema.String,
  state: BotStarterState,
});
export type BotStarterStatus = typeof BotStarterStatus.Type;

export const BotInputValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
export type BotInputValue = typeof BotInputValue.Type;

export const BotInputs = Schema.Record(Schema.String, BotInputValue);
export type BotInputs = typeof BotInputs.Type;

export const BotRunStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
export type BotRunStatus = typeof BotRunStatus.Type;

export const isTerminalBotRunStatus = (status: BotRunStatus): boolean =>
  status !== "queued" && status !== "running";

export const BotRunId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const BotRun = Schema.Struct({
  id: BotRunId,
  botId: BotId,
  botVersion: Schema.Int,
  botName: Schema.String,
  threadId: ThreadId,
  projectId: Schema.NullOr(ProjectId),
  inputs: BotInputs,
  status: BotRunStatus,
  startedBy: BotCreator,
  callerThreadId: Schema.NullOr(ThreadId),
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  finishedAt: Schema.NullOr(Schema.String),
  /** The run's final assistant reply, capped at {@link BOTS_RESULT_MAX_BYTES}. */
  result: Schema.NullOr(Schema.String),
  resultTruncated: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  /** Whether the result is posted to the calling thread when the run ends. Absent means no. */
  notify: Schema.optionalKey(Schema.Boolean),
});
export type BotRun = typeof BotRun.Type;

export const BotsChange = Schema.Union([
  Schema.TaggedStruct("bot", { bot: BotDefinition }),
  Schema.TaggedStruct("bot-deleted", { botId: BotId }),
  Schema.TaggedStruct("run", { run: BotRun }),
]);
export type BotsChange = typeof BotsChange.Type;

export class BotsError extends Schema.TaggedError<BotsError>()("BotsError", {
  reason: Schema.Literals(["not_found", "invalid", "archived", "permission", "storage", "launch"]),
  message: Schema.String,
}) {}

export const BotsSaveInput = Schema.Struct({
  ...BotDefinitionInput.fields,
  /** Rejects the save when the stored version differs; omit to create or overwrite. */
  expectedVersion: Schema.optionalKey(Schema.Int),
});
export type BotsSaveInput = typeof BotsSaveInput.Type;

export const BotsRunInput = Schema.Struct({
  botId: BotId,
  inputs: BotInputs,
  projectId: Schema.optionalKey(ProjectId),
  /** For a `caller` checkout bot: the thread whose checkout the run uses. */
  checkoutThreadId: Schema.optionalKey(ThreadId),
  /** The thread the run is started from. Agents are always their own thread; this is for people. */
  callerThreadId: Schema.optionalKey(ThreadId),
  /** Post the result to the calling thread when the run ends. */
  notify: Schema.optionalKey(Schema.Boolean),
});
export type BotsRunInput = typeof BotsRunInput.Type;

export const BotsListRunsInput = Schema.Struct({
  botId: Schema.optionalKey(BotId),
  /** Returns runs created strictly before this ISO timestamp. */
  before: Schema.optionalKey(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: BOTS_LIST_RUNS_MAX_LIMIT })),
});
export type BotsListRunsInput = typeof BotsListRunsInput.Type;

const errors = Schema.Union([BotsError, EnvironmentAuthorizationError]);
const M = BOTS_WS_METHODS;
const BotRef = Schema.Struct({ botId: BotId });

export const BotsRpcGroup = RpcGroup.make(
  Rpc.make(M.list, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ bots: Schema.Array(BotDefinition) }),
    error: errors,
  }),
  Rpc.make(M.save, { payload: BotsSaveInput, success: BotDefinition, error: errors }),
  Rpc.make(M.archive, {
    payload: Schema.Struct({ botId: BotId, archived: Schema.Boolean }),
    success: BotDefinition,
    error: errors,
  }),
  Rpc.make(M.delete, { payload: BotRef, success: Schema.Struct({}), error: errors }),
  Rpc.make(M.run, { payload: BotsRunInput, success: BotRun, error: errors }),
  Rpc.make(M.cancel, {
    payload: Schema.Struct({ runId: BotRunId }),
    success: BotRun,
    error: errors,
  }),
  Rpc.make(M.listRuns, {
    payload: BotsListRunsInput,
    success: Schema.Struct({ runs: Schema.Array(BotRun), hasMore: Schema.Boolean }),
    error: errors,
  }),
  Rpc.make(M.watch, {
    payload: Schema.Struct({}),
    success: BotsChange,
    error: errors,
    stream: true,
  }),
  Rpc.make(M.listStarters, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ starters: Schema.Array(BotStarterStatus) }),
    error: errors,
  }),
  Rpc.make(M.restoreStarter, {
    payload: Schema.Struct({ starterId: BotStarterId }),
    success: BotDefinition,
    error: errors,
  }),
);
