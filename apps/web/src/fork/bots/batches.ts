import {
  BOTS_BATCH_MAX_ATTEMPTS,
  type BotBatch,
  type BotBatchCounts,
  type BotBatchItem,
  type BotBatchRetryInclude,
  type BotDefinition,
  type BotParameter,
  type BotsError,
  type BotTarget,
} from "@t3tools/contracts/fork";
import {
  BOT_BATCH_STATES,
  type BatchSourceType,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import { runInputErrors } from "./runForm";
import { runDurationMs, runTotalTokens } from "./runMetrics";

const plural = (count: number, noun: string, many = `${noun}s`) =>
  `${count} ${count === 1 ? noun : many}`;

// Index

/** The index's status switch: every batch, the ones still going, or the ones left with work to redo. */
export type BatchStatusFilter = "all" | "running" | "retry";

/** Items the plain retry reruns: failed and timed-out runs, and `fail` verdicts. */
export const failedCount = (counts: BotBatchCounts) =>
  counts.failed + counts.timedOut + counts.fail;

/**
 * A settled batch with items a retry would run again. Items past the attempt cap still count,
 * since the index has only the counts to go on; the batch's page says which are left out.
 */
export const batchNeedsRetry = (batch: BotBatch) =>
  batch.status !== "running" && failedCount(batch.counts) + batch.counts.needsAttention > 0;

export const matchesBatchStatus = (batch: BotBatch, filter: BatchStatusFilter) =>
  filter === "all"
    ? true
    : filter === "running"
      ? batch.status === "running"
      : batchNeedsRetry(batch);

/** Finds batches by their source or their bot, the two things a person remembers about one. */
export const matchesBatchSearch = (batch: BotBatch, query: string) => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [batch.sourceSummary, batch.botName, BATCH_SOURCE_LABELS[batch.sourceType]].some((text) =>
    text.toLowerCase().includes(needle),
  );
};

export const filterBatches = (
  batches: readonly BotBatch[],
  filter: { readonly status: BatchStatusFilter; readonly query: string },
) =>
  batches.filter(
    (batch) => matchesBatchStatus(batch, filter.status) && matchesBatchSearch(batch, filter.query),
  );

/** Work still going leads, apart from what has settled; each group keeps the list's newest-first order. */
export const groupBatches = (batches: readonly BotBatch[]) => ({
  running: batches.filter((batch) => batch.status === "running"),
  earlier: batches.filter((batch) => batch.status !== "running"),
});

export const batchStatusCounts = (batches: readonly BotBatch[]) => ({
  all: batches.length,
  running: batches.filter((batch) => batch.status === "running").length,
  retry: batches.filter(batchNeedsRetry).length,
});

/**
 * What cancelling stops, asked before it happens: skipped and cancelled items are never retried,
 * so the only way back is a new batch.
 */
export const cancelBatchMessage = (counts: BotBatchCounts) => {
  const inFlight = counts.running + counts.queued;
  const parts = [
    inFlight > 0
      ? `${plural(inFlight, "run")} in progress ${inFlight === 1 ? "stops" : "stop"}`
      : null,
    counts.pending > 0
      ? `${plural(counts.pending, "waiting item")} ${counts.pending === 1 ? "is" : "are"} skipped`
      : null,
  ].filter((part) => part !== null);
  return `Cancel this batch?${parts.length > 0 ? ` ${parts.join(" and ")}.` : ""} Cancelled and skipped items cannot be retried.`;
};

/** A running batch held back by its bot's budget reads as paused, not as stuck. */
export const batchState = (batch: Pick<BotBatch, "status" | "pausedUntil">) =>
  batch.status === "running" && batch.pausedUntil
    ? ({ label: "Paused", tone: "warning" } as const)
    : BOT_BATCH_STATES[batch.status];

export const settledCount = (batch: Pick<BotBatch, "total" | "counts">) =>
  batch.total - batch.counts.pending - batch.counts.queued - batch.counts.running;

export const BATCH_SOURCE_LABELS: Record<BotBatch["sourceType"], string> = {
  lines: "Pasted lines",
  glob: "Files matching a pattern",
  conflicts: "Merge conflicts",
  pullRequests: "Open pull requests",
  search: "Search results",
  inputs: "Listed inputs",
};

/** Who started a batch, as it reads after "Started". */
export const batchOrigin = (batch: Pick<BotBatch, "pipelineRunId" | "startedBy">) =>
  batch.pipelineRunId ? "by a pipeline" : batch.startedBy === "agent" ? "by an agent" : "by you";

// Progress

/** A state tone, plus the quieter fill of work that has not started yet. */
export type ProgressTone = LibraryWorkflowTone | "waiting";

export type ProgressSegment = {
  readonly key: string;
  readonly tone: ProgressTone;
  readonly count: number;
};

/**
 * A batch's counts as bar segments, toned as the batch's item ticks are: timed-out items warn
 * rather than fail, and skipped items are slots that never ran, so the bar and the board agree.
 */
export const batchSegments = (counts: BotBatchCounts): ReadonlyArray<ProgressSegment> => [
  { key: "passed", tone: "success", count: counts.completed - counts.fail - counts.needsAttention },
  { key: "attention", tone: "warning", count: counts.needsAttention + counts.timedOut },
  { key: "failed", tone: "danger", count: counts.fail + counts.failed },
  { key: "cancelled", tone: "neutral", count: counts.cancelled },
  { key: "running", tone: "active", count: counts.running },
  { key: "waiting", tone: "waiting", count: counts.pending + counts.queued + counts.skipped },
];

/** The settled outcomes of a batch worth a number in its row, in the order a person scans them. */
export const outcomeBreakdown = (
  counts: BotBatchCounts,
): ReadonlyArray<{
  readonly key: string;
  readonly tone: LibraryWorkflowTone;
  readonly label: string;
  readonly count: number;
}> =>
  (
    [
      {
        key: "passed",
        tone: "success",
        label: counts.pass + counts.fail + counts.needsAttention > 0 ? "passed" : "completed",
        count: counts.completed - counts.fail - counts.needsAttention,
      },
      { key: "failed", tone: "danger", label: "failed", count: counts.fail + counts.failed },
      { key: "timedOut", tone: "warning", label: "timed out", count: counts.timedOut },
      { key: "attention", tone: "warning", label: "need attention", count: counts.needsAttention },
      {
        key: "stopped",
        tone: "neutral",
        label: "stopped",
        count: counts.cancelled + counts.skipped,
      },
    ] as const
  ).filter((entry) => entry.count > 0);

// Items

export type BatchItemOutcome =
  | "failed"
  | "timedOut"
  | "attention"
  | "running"
  | "waiting"
  | "passed"
  | "cancelled"
  | "skipped"
  | "gone";

/** The order outcomes are listed and filtered in: what needs a person first. */
export const BATCH_ITEM_OUTCOMES: readonly BatchItemOutcome[] = [
  "failed",
  "timedOut",
  "attention",
  "running",
  "waiting",
  "passed",
  "cancelled",
  "skipped",
  "gone",
];

/**
 * Each outcome's tick tone. Null marks a slot with no run to open (waiting, skipped, or a run no
 * longer stored), drawn empty; every toned tick has a run behind it.
 */
export const OUTCOME_TONES: Record<BatchItemOutcome, LibraryWorkflowTone | null> = {
  failed: "danger",
  timedOut: "warning",
  attention: "warning",
  running: "active",
  waiting: null,
  passed: "success",
  cancelled: "neutral",
  skipped: null,
  gone: null,
};

/** The name of each outcome as a group, for legends and filters. */
export const outcomeGroupLabel = (outcome: BatchItemOutcome, verdicts: boolean) => {
  switch (outcome) {
    case "failed":
      return "Failed";
    case "timedOut":
      return "Timed out";
    case "attention":
      return "Needs attention";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "passed":
      return verdicts ? "Passed" : "Completed";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    case "gone":
      return "Not stored";
  }
};

/** Where one item stands, as its outcome group and the precise label for its row. */
export const itemOutcome = (
  item: Pick<BotBatchItem, "state" | "run">,
): { readonly key: BatchItemOutcome; readonly label: string } => {
  if (item.state === "pending") return { key: "waiting", label: "Waiting" };
  if (item.state === "skipped") return { key: "skipped", label: "Skipped" };
  const run = item.run;
  if (run === null) return { key: "gone", label: "Not stored" };
  switch (run.status) {
    case "queued":
      return { key: "waiting", label: "Queued" };
    case "running":
      return { key: "running", label: "Running" };
    case "failed":
      return { key: "failed", label: "Failed" };
    case "timed_out":
      return { key: "timedOut", label: "Timed out" };
    case "cancelled":
      return { key: "cancelled", label: "Cancelled" };
    case "completed": {
      const verdict = run.verdict?.verdict;
      if (verdict === "fail") return { key: "failed", label: "Fail" };
      if (verdict === "needs_attention") return { key: "attention", label: "Needs attention" };
      return { key: "passed", label: verdict === "pass" ? "Pass" : "Completed" };
    }
  }
};

export const itemTickTone = (item: Pick<BotBatchItem, "state" | "run">) =>
  OUTCOME_TONES[itemOutcome(item).key];

export const countOutcomes = (items: readonly Pick<BotBatchItem, "state" | "run">[]) => {
  const counts = new Map<BatchItemOutcome, number>();
  for (const item of items) {
    const { key } = itemOutcome(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

export type BatchItemFilter = "all" | BatchItemOutcome;

export const filterItems = <Item extends Pick<BotBatchItem, "state" | "run" | "label">>(
  items: readonly Item[],
  filter: { readonly outcome: BatchItemFilter; readonly query: string },
) => {
  const needle = filter.query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (filter.outcome === "all" || itemOutcome(item).key === filter.outcome) &&
      (needle === "" || item.label.toLowerCase().includes(needle)),
  );
};

/** How many times an item has run, counting the run it holds now. */
export const itemTries = (item: Pick<BotBatchItem, "previousRunIds" | "runId">) =>
  item.previousRunIds.length + (item.runId === null ? 0 : 1);

/** An item the server refuses to run again; it allows {@link BOTS_BATCH_MAX_ATTEMPTS} in all. */
export const isExhausted = (item: Pick<BotBatchItem, "previousRunIds">) =>
  item.previousRunIds.length + 1 >= BOTS_BATCH_MAX_ATTEMPTS;

/** Mirrors the server's choice of items to retry, so the button's count is the count it reruns. */
export const isRetryableItem = (
  item: Pick<BotBatchItem, "state" | "run">,
  includeAttention: boolean,
) => {
  const run = item.run;
  if (item.state !== "started" || run === null) return false;
  if (run.status === "failed" || run.status === "timed_out") return true;
  return (
    run.status === "completed" &&
    (run.verdict?.verdict === "fail" ||
      (includeAttention && run.verdict?.verdict === "needs_attention"))
  );
};

/** What Retry would do: items it reruns for failing, for needing attention, and those past the cap. */
export const retryPlan = (items: readonly BotBatchItem[]) => {
  let failed = 0;
  let attention = 0;
  const exhausted: string[] = [];
  for (const item of items) {
    if (!isRetryableItem(item, true)) continue;
    if (isExhausted(item)) exhausted.push(item.label);
    else if (isRetryableItem(item, false)) failed += 1;
    else attention += 1;
  }
  return { failed, attention, exhausted };
};

export type RetryPlan = ReturnType<typeof retryPlan>;

/**
 * The retry the button runs. With nothing failed, items needing attention are the only ones left,
 * so they are included whatever the option says.
 */
export const retryChoice = (
  plan: RetryPlan,
  includeAttention: boolean,
): { readonly include: BotBatchRetryInclude; readonly count: number; readonly label: string } => {
  const withAttention = (includeAttention || plan.failed === 0) && plan.attention > 0;
  const count = plan.failed + (withAttention ? plan.attention : 0);
  return {
    include: withAttention ? "failed_and_attention" : "failed",
    count,
    label:
      count === 0
        ? "Retry"
        : plan.failed === 0
          ? `Retry ${count} needing attention`
          : withAttention
            ? `Retry ${count}`
            : `Retry ${count} failed`,
  };
};

/** The figures along a batch's hero, from its items' runs. */
export const batchVitals = (items: readonly BotBatchItem[]) => {
  const spans: number[] = [];
  let tokens = 0;
  let tokensKnown = false;
  let retried = 0;
  let passed = 0;
  let judged = 0;
  for (const item of items) {
    if (item.previousRunIds.length > 0) retried += 1;
    const { key } = itemOutcome(item);
    if (key === "passed") passed += 1;
    if (key === "passed" || key === "failed" || key === "timedOut" || key === "attention")
      judged += 1;
    const run = item.run;
    if (run === null) continue;
    const span = runDurationMs(run);
    if (span !== null) spans.push(span);
    const used = runTotalTokens(run);
    if (used !== null) {
      tokens += used;
      tokensKnown = true;
    }
  }
  const sorted = spans.toSorted((left, right) => left - right);
  return {
    passed,
    judged,
    typicalMs: sorted.length === 0 ? null : (sorted[Math.floor(sorted.length / 2)] ?? null),
    slowestMs: sorted.at(-1) ?? null,
    tokens: tokensKnown ? tokens : null,
    retried,
  };
};

// Run on many

/** The `reason` of a bots RPC failure, or null for any other failure. */
export const botsErrorReason = (failure: unknown): BotsError["reason"] | null =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "BotsError" &&
  "reason" in failure &&
  typeof failure.reason === "string"
    ? (failure.reason as BotsError["reason"])
    : null;

/**
 * Why Run on many cannot start for this bot here, or null when it can. The bot's own reasons come
 * last, since reconnecting is the first thing to do whatever the bot.
 */
export const runOnManyBlocker = ({
  connected,
  permitted,
  bot,
}: {
  readonly connected: boolean;
  readonly permitted: boolean;
  readonly bot: Pick<BotDefinition, "name" | "archivedAt" | "parameters"> | null;
}) => {
  if (!connected) return "Offline. Reconnect to start a batch.";
  if (!permitted) return "This connection cannot start batches.";
  if (bot === null) return null;
  if (bot.archivedAt !== null) return `Restore ${bot.name} to run it.`;
  if (bot.parameters.length === 0) return `${bot.name} takes no inputs for items to fill.`;
  return null;
};

/** Items in pasted text as the server counts them: trimmed, non-empty and without repeats. */
export const countLines = (text: string) =>
  new Set(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  ).size;

/** What to fill in before a source can list anything; the other sources list items as soon as they have a project. */
export const SOURCE_PROMPTS: Record<"lines" | "glob" | "search", string> = {
  lines: "Paste one item per line to see them here.",
  glob: "Type a pattern, such as src/**/*.ts, to see the files it matches.",
  search: "Type some text to see the files that match.",
};

export const runOnManyLabel = (type: BatchSourceType, total: number) =>
  type === "conflicts"
    ? `Resolve ${total === 1 ? "the conflict" : `all ${total} conflicts`}`
    : `Run on ${plural(total, "item")}`;

/**
 * What stops each shared input from being sent, by parameter name. The input each item fills is
 * left out, since the items supply it.
 */
export const sharedInputErrors = (
  parameters: readonly BotParameter[],
  itemParameter: string,
  values: Readonly<Record<string, string>>,
) =>
  runInputErrors(
    parameters.filter((parameter) => parameter.name !== itemParameter),
    values,
  );

/** A warning when items fill an input that takes less than free text, since each item arrives as text. */
export const itemParameterNote = (parameter: BotParameter | undefined) => {
  if (parameter === undefined) return null;
  switch (parameter.type) {
    case "number":
      return `${parameter.label} takes a number, so items that are not numbers are refused.`;
    case "boolean":
      return `${parameter.label} takes true or false, so other items are refused.`;
    case "choice":
      return `${parameter.label} takes one of ${(parameter.choices ?? []).join(", ")}, so other items are refused.`;
    default:
      return null;
  }
};

const minutes = (count: number) => plural(count, "minute");

/** Where the runs go, as the plan says it; this computer goes unsaid. */
const targetPhrase = (target: BotTarget, label: string | null) =>
  target.type === "best"
    ? " on the best available computer"
    : target.type === "environment"
      ? ` on ${label ?? "another computer"}`
      : "";

/** One sentence saying what starting the batch will do, from the bot's own limits. */
export const batchPlanSentence = ({
  bot,
  total,
  type,
  target,
  targetLabel,
}: {
  readonly bot: Pick<BotDefinition, "name" | "version" | "maxConcurrentRuns" | "timeoutMinutes">;
  readonly total: number;
  readonly type: BatchSourceType;
  readonly target: BotTarget;
  readonly targetLabel: string | null;
}) => {
  const who = `${bot.name} v${bot.version}${targetPhrase(target, targetLabel)}`;
  const lead =
    type === "conflicts"
      ? `Resolves ${plural(total, "conflict")} with ${who}`
      : `${plural(total, "run")} of ${who}`;
  if (total <= 1) return `${lead}, stopped after ${minutes(bot.timeoutMinutes)}.`;
  // Runs sent elsewhere take whatever room each computer has, not this bot's own limit.
  const pace =
    target.type !== "here"
      ? "as slots free up"
      : bot.maxConcurrentRuns <= 1
        ? "one at a time"
        : total <= bot.maxConcurrentRuns
          ? "all at once"
          : `up to ${bot.maxConcurrentRuns} at a time`;
  return `${lead}, ${pace}, each stopped after ${minutes(bot.timeoutMinutes)}.`;
};

/** How the bot's daily budget bears on a batch of this size, when it has one. */
export const budgetNote = (bot: Pick<BotDefinition, "budget">, total: number) => {
  const budget = bot.budget;
  if (budget?.runsPerDay !== undefined && total > budget.runsPerDay)
    return `That is more than its budget of ${plural(budget.runsPerDay, "run")} a day, so the batch pauses until the budget recovers.`;
  if (budget?.runsPerDay !== undefined || budget?.tokensPerDay !== undefined)
    return "Its daily budget can pause the batch until the budget recovers.";
  return null;
};
