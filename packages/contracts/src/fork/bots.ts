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
export const BOTS_VERDICTS_FEATURE = "bots-verdicts";
export const BOTS_BATCHES_FEATURE = "bots-batches";
export const BOTS_INBOX_FEATURE = "bots-inbox";
export const BOTS_BUDGETS_FEATURE = "bots-budgets";
export const BOTS_FROM_THREAD_FEATURE = "bots-from-thread";

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
  inbox: "loom.bots.inbox",
  retry: "loom.bots.retry",
  dismiss: "loom.bots.dismiss",
  promote: "loom.bots.promote",
  usage: "loom.bots.usage",
} as const;

export const BOTS_BATCH_WS_METHODS = {
  previewBatch: "loom.bots.previewBatch",
  runBatch: "loom.bots.runBatch",
  listBatches: "loom.bots.listBatches",
  getBatch: "loom.bots.getBatch",
  cancelBatch: "loom.bots.cancelBatch",
  retryBatch: "loom.bots.retryBatch",
  batchReport: "loom.bots.batchReport",
  watchBatches: "loom.bots.watchBatches",
} as const;

export const BOTS_MAX_PARAMETERS = 12;
export const BOTS_MAX_ACTIVE_RUNS = 20;
export const BOTS_RESULT_MAX_BYTES = 16 * 1024;
export const BOTS_LIST_RUNS_MAX_LIMIT = 50;
export const BOTS_DISMISS_MAX_RUNS = 50;
export const BOTS_VERDICT_MAX_FINDINGS = 50;
export const BOTS_VERDICT_SUMMARY_MAX = 2000;
export const BOTS_FINDING_TITLE_MAX = 200;
export const BOTS_FINDING_DETAIL_MAX = 4000;
export const BOTS_FINDING_PATH_MAX = 1000;

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

/** `verdict` asks for a pass, fail or needs-attention answer that Loom decodes and stores. */
export const BotOutput = Schema.Literals(["text", "verdict"]);
export type BotOutput = typeof BotOutput.Type;

/** Rolling 24 hour limits; an absent limit is unlimited. */
export const BotBudget = Schema.Struct({
  runsPerDay: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  ),
  tokensPerDay: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 10_000_000_000 })),
  ),
});
export type BotBudget = typeof BotBudget.Type;

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
  /** Absent means `text`. */
  output: Schema.optionalKey(BotOutput),
  /** Absent means unlimited. */
  budget: Schema.optionalKey(BotBudget),
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
export const BotBatchId = BotRunId;

export const BotVerdictValue = Schema.Literals(["pass", "fail", "needs_attention"]);
export type BotVerdictValue = typeof BotVerdictValue.Type;

export const BotFinding = Schema.Struct({
  title: shortText(BOTS_FINDING_TITLE_MAX),
  detail: shortText(BOTS_FINDING_DETAIL_MAX),
  path: Schema.optionalKey(shortText(BOTS_FINDING_PATH_MAX)),
  line: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});
export type BotFinding = typeof BotFinding.Type;

export const BotVerdict = Schema.Struct({
  verdict: BotVerdictValue,
  summary: shortText(BOTS_VERDICT_SUMMARY_MAX),
  findings: Schema.Array(BotFinding).check(Schema.isMaxLength(BOTS_VERDICT_MAX_FINDINGS)),
  /** More findings were given than are kept. */
  findingsTruncated: Schema.Boolean,
  /** `invalid`: the reply was not a verdict, so the run needs a person and keeps the raw reply. */
  source: Schema.Literals(["decoded", "invalid"]),
});
export type BotVerdict = typeof BotVerdict.Type;

/**
 * Tokens the run's thread reported, summed over its turns. Input includes cache reads and writes
 * and output includes reasoning, as `TurnTokenUsage` counts them. `partial` when some turns
 * reported none or the run used subagents, whose tokens are not included.
 */
export const BotRunUsage = Schema.Struct({
  inputTokens: Schema.Int,
  cachedInputTokens: Schema.Int,
  outputTokens: Schema.Int,
  status: Schema.Literals(["complete", "partial", "unavailable"]),
});
export type BotRunUsage = typeof BotRunUsage.Type;

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
  /** Set for a completed run of a verdict bot. */
  verdict: Schema.optionalKey(Schema.NullOr(BotVerdict)),
  /** The batch that started the run. Absent for a run started on its own. */
  batchId: Schema.optionalKey(Schema.NullOr(BotBatchId)),
  /** Set while the run is dismissed from the inbox. */
  dismissedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** The run this one retried. */
  retryOf: Schema.optionalKey(Schema.NullOr(BotRunId)),
  /** The run that retried this one; a retried run leaves the inbox. */
  retriedBy: Schema.optionalKey(Schema.NullOr(BotRunId)),
  /** The ordinary thread the run was opened as. */
  promotedThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  /** The model the run used. Absent for runs recorded before Loom kept it. */
  modelSelection: Schema.optionalKey(ModelSelection),
  /** The thread whose checkout a `caller` checkout bot ran in. */
  checkoutThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  /** Null until the run ends, and when its usage could not be read. */
  usage: Schema.optionalKey(Schema.NullOr(BotRunUsage)),
});
export type BotRun = typeof BotRun.Type;

/**
 * A finished run a person should look at, dismissed or not: it failed, timed out, or could not
 * decide, and no newer run retried it. A `fail` verdict is an answer, and a cancelled run was a
 * choice, so neither counts.
 */
export const needsBotAttention = (run: BotRun): boolean =>
  run.retriedBy == null &&
  (run.status === "failed" ||
    run.status === "timed_out" ||
    (run.status === "completed" && run.verdict?.verdict === "needs_attention"));

/** The server's inbox query selects the same runs in SQL; keep the two in step. */
export const isBotInboxRun = (run: BotRun): boolean =>
  run.dismissedAt == null && needsBotAttention(run);

export const BotsChange = Schema.Union([
  Schema.TaggedStruct("bot", { bot: BotDefinition }),
  Schema.TaggedStruct("bot-deleted", { botId: BotId }),
  Schema.TaggedStruct("run", { run: BotRun }),
]);
export type BotsChange = typeof BotsChange.Type;

export class BotsError extends Schema.TaggedError<BotsError>()("BotsError", {
  reason: Schema.Literals(["not_found", "invalid", "archived", "permission", "storage", "launch"]),
  message: Schema.String,
  /**
   * When a budget refusal stops applying. A field rather than a reason, so clients built before
   * budgets still decode the error and show its message.
   */
  retryAt: Schema.optionalKey(Schema.String),
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
  verdict: Schema.optionalKey(BotVerdictValue),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: BOTS_LIST_RUNS_MAX_LIMIT })),
});
export type BotsListRunsInput = typeof BotsListRunsInput.Type;

export const BotsInboxInput = Schema.Struct({
  /** Lists dismissed runs instead, so one can be restored. */
  dismissed: Schema.optionalKey(Schema.Boolean),
  /** Returns runs created strictly before this ISO timestamp. */
  before: Schema.optionalKey(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: BOTS_LIST_RUNS_MAX_LIMIT })),
});
export type BotsInboxInput = typeof BotsInboxInput.Type;

export const BotsInboxPage = Schema.Struct({
  runs: Schema.Array(BotRun),
  /** Every matching run, not only this page. */
  total: Schema.Int,
  hasMore: Schema.Boolean,
});
export type BotsInboxPage = typeof BotsInboxPage.Type;

export const BotsRetryInput = Schema.Struct({
  runId: BotRunId,
  /** Runs this retry on another model; the bot keeps its own. */
  modelSelection: Schema.optionalKey(ModelSelection),
});
export type BotsRetryInput = typeof BotsRetryInput.Type;

export const BotsDismissInput = Schema.Struct({
  runIds: Schema.Array(BotRunId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(BOTS_DISMISS_MAX_RUNS),
  ),
  /** False restores the runs to the inbox. */
  dismissed: Schema.Boolean,
});
export type BotsDismissInput = typeof BotsDismissInput.Type;

export const BotsPromoteResult = Schema.Struct({
  threadId: ThreadId,
  /** False when the run was already open as this thread. */
  created: Schema.Boolean,
});
export type BotsPromoteResult = typeof BotsPromoteResult.Type;

export const BOTS_USAGE_MAX_DAYS = 92;

export const BotsUsageInput = Schema.Struct({
  since: Schema.String,
  until: Schema.String,
  botId: Schema.optionalKey(BotId),
});
export type BotsUsageInput = typeof BotsUsageInput.Type;

export const BotUsageTokens = Schema.Struct({
  input: Schema.Int,
  cachedInput: Schema.Int,
  output: Schema.Int,
  /** Input plus output; cached input is part of input. */
  total: Schema.Int,
});
export type BotUsageTokens = typeof BotUsageTokens.Type;

export const BotModelUsage = Schema.Struct({
  model: Schema.String,
  /** True for runs recorded before runs kept their model, grouped under the bot's current one. */
  assumed: Schema.Boolean,
  runs: Schema.Int,
  successRate: Schema.NullOr(Schema.Number),
  medianDurationMs: Schema.NullOr(Schema.Int),
  totalTokens: Schema.Int,
});
export type BotModelUsage = typeof BotModelUsage.Type;

export const BotUsageRow = Schema.Struct({
  botId: BotId,
  botName: Schema.String,
  runs: Schema.Int,
  completed: Schema.Int,
  failed: Schema.Int,
  timedOut: Schema.Int,
  cancelled: Schema.Int,
  pass: Schema.Int,
  fail: Schema.Int,
  needsAttention: Schema.Int,
  /** Pass rate for a bot with verdicts in the window, else completion rate; null with nothing finished. */
  successRate: Schema.NullOr(Schema.Number),
  medianDurationMs: Schema.NullOr(Schema.Int),
  maxDurationMs: Schema.NullOr(Schema.Int),
  tokens: BotUsageTokens,
  /** False when any run reported partial or no usage, so the tokens are a floor. */
  usageComplete: Schema.Boolean,
  byModel: Schema.Array(BotModelUsage),
});
export type BotUsageRow = typeof BotUsageRow.Type;

/** A bot's use of its budget over the rolling 24 hours ending now. */
export const BotBudgetState = Schema.Struct({
  runsInWindow: Schema.Int,
  tokensInWindow: Schema.Int,
  runsPerDay: Schema.optionalKey(Schema.Int),
  tokensPerDay: Schema.optionalKey(Schema.Int),
  /** Set while a limit is reached: when the next run may start. */
  retryAt: Schema.optionalKey(Schema.String),
});
export type BotBudgetState = typeof BotBudgetState.Type;

export const BotsUsageResult = Schema.Struct({
  rows: Schema.Array(BotUsageRow),
  totals: Schema.Struct({
    runs: Schema.Int,
    tokens: BotUsageTokens,
    usageComplete: Schema.Boolean,
  }),
  budgets: Schema.Record(BotId, BotBudgetState),
});
export type BotsUsageResult = typeof BotsUsageResult.Type;

const errors = Schema.Union([BotsError, EnvironmentAuthorizationError]);
const M = BOTS_WS_METHODS;
const BB = BOTS_BATCH_WS_METHODS;
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
  Rpc.make(M.inbox, { payload: BotsInboxInput, success: BotsInboxPage, error: errors }),
  Rpc.make(M.retry, { payload: BotsRetryInput, success: BotRun, error: errors }),
  Rpc.make(M.dismiss, {
    payload: BotsDismissInput,
    success: Schema.Struct({ runs: Schema.Array(BotRun) }),
    error: errors,
  }),
  Rpc.make(M.promote, {
    payload: Schema.Struct({ runId: BotRunId }),
    success: BotsPromoteResult,
    error: errors,
  }),
  Rpc.make(M.usage, { payload: BotsUsageInput, success: BotsUsageResult, error: errors }),
);

export const BOTS_BATCH_MAX_ITEMS = 200;
export const BOTS_BATCH_LINES_MAX_BYTES = 64 * 1024;
export const BOTS_LIST_BATCHES_MAX_LIMIT = 50;
/** A failed item is run at most this many times in all. */
export const BOTS_BATCH_MAX_ATTEMPTS = 5;

export const BotBatchSource = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("lines"),
    text: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(BOTS_BATCH_LINES_MAX_BYTES),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("glob"),
    pattern: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
    checkoutThreadId: Schema.optionalKey(ThreadId),
  }),
  Schema.Struct({
    type: Schema.Literal("conflicts"),
    checkoutThreadId: Schema.optionalKey(ThreadId),
  }),
  Schema.Struct({
    type: Schema.Literal("pullRequests"),
    query: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  }),
  Schema.Struct({
    type: Schema.Literal("search"),
    mode: Schema.Literals(["files", "contents"]),
    query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    caseSensitive: Schema.optionalKey(Schema.Boolean),
    useRegex: Schema.optionalKey(Schema.Boolean),
    checkoutThreadId: Schema.optionalKey(ThreadId),
  }),
  Schema.Struct({
    type: Schema.Literal("inputs"),
    items: Schema.Array(BotInputs).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(BOTS_BATCH_MAX_ITEMS),
    ),
  }),
]);
export type BotBatchSource = typeof BotBatchSource.Type;
export type BotBatchSourceType = BotBatchSource["type"];

/** `started` items have a run; their outcome is that run's, never a copy of it. */
export const BotBatchItemState = Schema.Literals(["pending", "started", "skipped"]);
export type BotBatchItemState = typeof BotBatchItemState.Type;

export const BotBatchItem = Schema.Struct({
  index: Schema.Int,
  label: Schema.String,
  inputs: BotInputs,
  state: BotBatchItemState,
  runId: Schema.NullOr(BotRunId),
  previousRunIds: Schema.Array(BotRunId),
  /** Null for a pending or skipped item, and for a run no longer stored. */
  run: Schema.NullOr(BotRun),
});
export type BotBatchItem = typeof BotBatchItem.Type;

export const BotBatchCounts = Schema.Struct({
  pending: Schema.Int,
  queued: Schema.Int,
  running: Schema.Int,
  completed: Schema.Int,
  failed: Schema.Int,
  timedOut: Schema.Int,
  cancelled: Schema.Int,
  skipped: Schema.Int,
  pass: Schema.Int,
  fail: Schema.Int,
  needsAttention: Schema.Int,
});
export type BotBatchCounts = typeof BotBatchCounts.Type;

/** "26 pass, 3 fail, 1 needs attention" for verdict bots, "28 completed, 2 failed" otherwise. */
export const batchCountsLine = (counts: BotBatchCounts): string => {
  const verdicts = counts.pass + counts.fail + counts.needsAttention > 0;
  const parts: ReadonlyArray<readonly [number, string]> = [
    ...(verdicts
      ? ([
          [counts.pass, "pass"],
          [counts.fail, "fail"],
          [counts.needsAttention, "needs attention"],
        ] as const)
      : ([[counts.completed, "completed"]] as const)),
    [counts.failed, "failed"],
    [counts.timedOut, "timed out"],
    [counts.cancelled, "cancelled"],
    [counts.skipped, "skipped"],
    [counts.running, "running"],
    [counts.pending + counts.queued, "waiting"],
  ];
  const shown = parts.filter(([count]) => count > 0);
  return shown.length === 0
    ? "No items."
    : shown.map(([count, label]) => `${count} ${label}`).join(", ");
};

export const BotBatchStatus = Schema.Literals(["running", "finished", "cancelled"]);
export type BotBatchStatus = typeof BotBatchStatus.Type;

export const BotBatch = Schema.Struct({
  id: BotBatchId,
  botId: BotId,
  botVersion: Schema.Int,
  botName: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  sourceType: Schema.Literals(["lines", "glob", "conflicts", "pullRequests", "search", "inputs"]),
  /** For example "apps/web/src/**\/*.tsx, 31 files". */
  sourceSummary: Schema.String,
  itemParameter: Schema.NullOr(BotParameterName),
  sharedInputs: BotInputs,
  status: BotBatchStatus,
  /** Why a batch stopped early, such as its bot being archived. */
  note: Schema.NullOr(Schema.String),
  total: Schema.Int,
  counts: BotBatchCounts,
  startedBy: BotCreator,
  callerThreadId: Schema.NullOr(ThreadId),
  createdAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  /** Set while the bot's budget holds the batch back: when it tries the next item again. */
  pausedUntil: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type BotBatch = typeof BotBatch.Type;

/** Its own stream, since an older client fails to decode a tag added to {@link BotsChange}. */
export const BotBatchChange = Schema.Union([
  Schema.TaggedStruct("batch", { batch: BotBatch }),
  Schema.TaggedStruct("batch-item", { batchId: BotBatchId, item: BotBatchItem }),
]);
export type BotBatchChange = typeof BotBatchChange.Type;

export const BotsBatchInput = Schema.Struct({
  botId: BotId,
  projectId: Schema.optionalKey(ProjectId),
  source: BotBatchSource,
  /** The input each item fills. Required for every source except `inputs`. */
  itemParameter: Schema.optionalKey(BotParameterName),
  /** Inputs every item shares. */
  sharedInputs: Schema.optionalKey(BotInputs),
  /** The thread the batch is started from, for people; agents are always their own thread. */
  callerThreadId: Schema.optionalKey(ThreadId),
});
export type BotsBatchInput = typeof BotsBatchInput.Type;

export const BotBatchPreviewItem = Schema.Struct({ label: Schema.String, inputs: BotInputs });
export type BotBatchPreviewItem = typeof BotBatchPreviewItem.Type;

export const BotBatchPreview = Schema.Struct({
  total: Schema.Int,
  /** The first items, at most 20. */
  items: Schema.Array(BotBatchPreviewItem),
  /** The first invalid items, at most 5; a batch with any refuses to start. */
  invalid: Schema.Array(Schema.Struct({ label: Schema.String, message: Schema.String })),
  sourceSummary: Schema.String,
  /** Something worth knowing before starting, such as a capped search. */
  note: Schema.NullOr(Schema.String),
});
export type BotBatchPreview = typeof BotBatchPreview.Type;

export const BotsListBatchesInput = Schema.Struct({
  botId: Schema.optionalKey(BotId),
  before: Schema.optionalKey(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: BOTS_LIST_BATCHES_MAX_LIMIT })),
});
export type BotsListBatchesInput = typeof BotsListBatchesInput.Type;

export const BotBatchRetryInclude = Schema.Literals(["failed", "failed_and_attention"]);
export type BotBatchRetryInclude = typeof BotBatchRetryInclude.Type;

export const BotsRetryBatchInput = Schema.Struct({
  batchId: BotBatchId,
  include: BotBatchRetryInclude,
  /** Rerun with the bot as it is saved now instead of the version the batch started with. */
  useLatest: Schema.optionalKey(Schema.Boolean),
});
export type BotsRetryBatchInput = typeof BotsRetryBatchInput.Type;

export const BotBatchRetryResult = Schema.Struct({
  batch: BotBatch,
  retried: Schema.Int,
  /** Labels of items left out because they reached the attempt limit. */
  exhausted: Schema.Array(Schema.String),
});
export type BotBatchRetryResult = typeof BotBatchRetryResult.Type;

export const BotBatchReport = Schema.Struct({ markdown: Schema.String, truncated: Schema.Boolean });
export type BotBatchReport = typeof BotBatchReport.Type;

const BatchRef = Schema.Struct({ batchId: BotBatchId });

export const BotBatchesRpcGroup = RpcGroup.make(
  Rpc.make(BB.previewBatch, { payload: BotsBatchInput, success: BotBatchPreview, error: errors }),
  Rpc.make(BB.runBatch, { payload: BotsBatchInput, success: BotBatch, error: errors }),
  Rpc.make(BB.listBatches, {
    payload: BotsListBatchesInput,
    success: Schema.Struct({ batches: Schema.Array(BotBatch), hasMore: Schema.Boolean }),
    error: errors,
  }),
  Rpc.make(BB.getBatch, {
    payload: BatchRef,
    success: Schema.Struct({ batch: BotBatch, items: Schema.Array(BotBatchItem) }),
    error: errors,
  }),
  Rpc.make(BB.cancelBatch, { payload: BatchRef, success: BotBatch, error: errors }),
  Rpc.make(BB.retryBatch, {
    payload: BotsRetryBatchInput,
    success: BotBatchRetryResult,
    error: errors,
  }),
  Rpc.make(BB.batchReport, { payload: BatchRef, success: BotBatchReport, error: errors }),
  Rpc.make(BB.watchBatches, {
    payload: Schema.Struct({}),
    success: BotBatchChange,
    error: errors,
    stream: true,
  }),
);

export const BOTS_DRAFT_WS_METHODS = {
  draftFromThread: "loom.bots.draftFromThread",
  refineDraft: "loom.bots.refineDraft",
  suggestions: "loom.bots.suggestions",
  dismissSuggestion: "loom.bots.dismissSuggestion",
} as const;

/** A brief's shape, with inputs replaced, is cut to this many characters. */
export const BOTS_SUGGESTION_SHAPE_MAX = 400;
/** Threads named by one suggestion, newest first. */
export const BOTS_SUGGESTION_MAX_THREADS = 10;

/** The bot id a name suggests. Shared so a server draft and a typed name give the same id. */
export const slugFromName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");

/** An unsaved bot drawn from a thread, with what the editor should say about it. */
export const BotDraftResult = Schema.Struct({
  draft: BotDefinitionInput,
  sourceThreadId: ThreadId,
  notes: Schema.Array(Schema.String),
});
export type BotDraftResult = typeof BotDraftResult.Type;

export const BotSuggestionId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

/** Threads that opened with the same kind of brief, offered as a bot to make. */
export const BotSuggestion = Schema.Struct({
  id: BotSuggestionId,
  /** The brief with its inputs replaced by placeholders. */
  shape: Schema.String,
  threadIds: Schema.Array(ThreadId),
  /** Threads with this shape in the last 14 days. */
  count: Schema.Int,
  firstSeenAt: Schema.String,
  lastSeenAt: Schema.String,
  startedBy: BotCreator,
  dismissedAt: Schema.NullOr(Schema.String),
});
export type BotSuggestion = typeof BotSuggestion.Type;

export const BotsDraftFromThreadInput = Schema.Struct({ threadId: ThreadId });
export type BotsDraftFromThreadInput = typeof BotsDraftFromThreadInput.Type;

export const BotsRefineDraftInput = Schema.Struct({
  threadId: ThreadId,
  draft: BotDefinitionInput,
});
export type BotsRefineDraftInput = typeof BotsRefineDraftInput.Type;

export const BotsSuggestionsInput = Schema.Struct({
  /** Dismissed suggestions instead of open ones. */
  dismissed: Schema.optionalKey(Schema.Boolean),
});
export type BotsSuggestionsInput = typeof BotsSuggestionsInput.Type;

export const BotsDismissSuggestionInput = Schema.Struct({
  suggestionId: BotSuggestionId,
  dismissed: Schema.Boolean,
});
export type BotsDismissSuggestionInput = typeof BotsDismissSuggestionInput.Type;

const BD = BOTS_DRAFT_WS_METHODS;

export const BotDraftsRpcGroup = RpcGroup.make(
  Rpc.make(BD.draftFromThread, {
    payload: BotsDraftFromThreadInput,
    success: BotDraftResult,
    error: errors,
  }),
  Rpc.make(BD.refineDraft, {
    payload: BotsRefineDraftInput,
    success: BotDraftResult,
    error: errors,
  }),
  Rpc.make(BD.suggestions, {
    payload: BotsSuggestionsInput,
    success: Schema.Struct({ suggestions: Schema.Array(BotSuggestion) }),
    error: errors,
  }),
  Rpc.make(BD.dismissSuggestion, {
    payload: BotsDismissSuggestionInput,
    success: BotSuggestion,
    error: errors,
  }),
);
