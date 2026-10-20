import type { TurnTokenUsage } from "@t3tools/contracts";
import type {
  BotDefinition,
  BotModelUsage,
  BotRun,
  BotRunUsage,
  BotUsageRow,
  BotUsageTokens,
  BotsUsageResult,
} from "@t3tools/contracts/fork";

/**
 * Sums a run thread's turns. A run thread holds one bot request, so its turns are the run's cost.
 * Subagent tokens are not in `turnTokenUsage`, so a turn that used them makes the run `partial`.
 */
export const summarizeRunUsage = (
  turns: ReadonlyArray<{ readonly turnTokenUsage?: TurnTokenUsage | undefined }>,
): BotRunUsage => {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reported = 0;
  let complete = 0;
  for (const { turnTokenUsage: usage } of turns) {
    if (usage === undefined) continue;
    if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) reported += 1;
    if (usage.usageStatus === "complete" && !usage.hasSubagents) complete += 1;
    inputTokens += usage.inputTokens ?? 0;
    cachedInputTokens += usage.cachedInputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
  }
  const status =
    reported === 0 ? "unavailable" : complete === turns.length ? "complete" : "partial";
  return { inputTokens, cachedInputTokens, outputTokens, status };
};

const runTokens = (run: BotRun) =>
  run.usage == null ? 0 : run.usage.inputTokens + run.usage.outputTokens;

/** A run that did provider work but whose tokens are not all known. */
const lacksUsage = (run: BotRun) =>
  run.startedAt !== null && run.finishedAt !== null && run.usage?.status !== "complete";

const median = (values: ReadonlyArray<number>): number | null => {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

const durationMs = (run: BotRun): number | null =>
  run.startedAt === null || run.finishedAt === null
    ? null
    : Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));

const verdictCounts = (runs: ReadonlyArray<BotRun>) => {
  let pass = 0;
  let fail = 0;
  let needsAttention = 0;
  for (const run of runs) {
    const verdict = run.status === "completed" ? run.verdict?.verdict : undefined;
    if (verdict === "pass") pass += 1;
    else if (verdict === "fail") fail += 1;
    else if (verdict === "needs_attention") needsAttention += 1;
  }
  return { pass, fail, needsAttention };
};

/**
 * The pass rate when the runs include verdicts, else the share that completed. Cancelled runs are
 * left out of both, and null means nothing finished to judge.
 */
const successRate = (runs: ReadonlyArray<BotRun>): number | null => {
  const { pass, fail, needsAttention } = verdictCounts(runs);
  const decided = pass + fail + needsAttention;
  if (decided > 0) return pass / decided;
  const completed = runs.filter((run) => run.status === "completed").length;
  const ended = runs.filter(
    (run) => run.status === "completed" || run.status === "failed" || run.status === "timed_out",
  ).length;
  return ended === 0 ? null : completed / ended;
};

const sumTokens = (runs: ReadonlyArray<BotRun>): BotUsageTokens => {
  let input = 0;
  let cachedInput = 0;
  let output = 0;
  for (const run of runs) {
    input += run.usage?.inputTokens ?? 0;
    cachedInput += run.usage?.cachedInputTokens ?? 0;
    output += run.usage?.outputTokens ?? 0;
  }
  return { input, cachedInput, output, total: input + output };
};

const durations = (runs: ReadonlyArray<BotRun>) =>
  runs.flatMap((run) => {
    const duration = durationMs(run);
    return duration === null ? [] : [duration];
  });

/**
 * Groups by the model each run recorded. Runs from before runs kept their model count under the
 * bot's current model, marked as assumed.
 */
const byModel = (
  runs: ReadonlyArray<BotRun>,
  bot: BotDefinition | undefined,
): Array<BotModelUsage> => {
  const groups = new Map<string, { model: string; assumed: boolean; runs: Array<BotRun> }>();
  for (const run of runs) {
    const recorded = run.modelSelection;
    const model = recorded?.model ?? bot?.modelSelection.model ?? "unknown";
    const assumed = recorded === undefined;
    const key = `${assumed ? "assumed" : "recorded"}:${model}`;
    const group = groups.get(key) ?? { model, assumed, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      model: group.model,
      assumed: group.assumed,
      runs: group.runs.length,
      successRate: successRate(group.runs),
      medianDurationMs: median(durations(group.runs)),
      totalTokens: group.runs.reduce((sum, run) => sum + runTokens(run), 0),
    }))
    .toSorted((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));
};

const usageRow = (runs: ReadonlyArray<BotRun>, bot: BotDefinition | undefined): BotUsageRow => {
  const count = (status: BotRun["status"]) => runs.filter((run) => run.status === status).length;
  const times = durations(runs);
  const replays = runs.filter((run) => run.replayId != null).length;
  return {
    botId: runs[0]!.botId,
    botName: bot?.name ?? runs[0]!.botName,
    runs: runs.length,
    completed: count("completed"),
    failed: count("failed"),
    timedOut: count("timed_out"),
    cancelled: count("cancelled"),
    ...verdictCounts(runs),
    successRate: successRate(runs),
    medianDurationMs: median(times),
    maxDurationMs: times.length === 0 ? null : Math.max(...times),
    tokens: sumTokens(runs),
    usageComplete: !runs.some(lacksUsage),
    byModel: byModel(runs, bot),
    ...(replays === 0 ? {} : { replays }),
  };
};

/** One row per bot with runs in the window, most tokens first. */
export const summarizeUsage = (
  runs: ReadonlyArray<BotRun>,
  bots: ReadonlyArray<BotDefinition>,
): Pick<BotsUsageResult, "rows" | "totals"> => {
  const byBot = new Map<string, Array<BotRun>>();
  for (const run of runs) {
    const list = byBot.get(run.botId) ?? [];
    list.push(run);
    byBot.set(run.botId, list);
  }
  const definitions = new Map(bots.map((bot) => [bot.id, bot]));
  const rows = [...byBot.entries()]
    .map(([botId, botRuns]) => usageRow(botRuns, definitions.get(botId)))
    .toSorted(
      (a, b) =>
        b.tokens.total - a.tokens.total || b.runs - a.runs || a.botName.localeCompare(b.botName),
    );
  return {
    rows,
    totals: {
      runs: runs.length,
      tokens: sumTokens(runs),
      usageComplete: !runs.some(lacksUsage),
    },
  };
};
