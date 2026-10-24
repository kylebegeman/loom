import type { BotBudgetState, BotDefinition, BotRun, BotUsageRow } from "@t3tools/contracts/fork";
import { BOT_RUN_STATES, BOT_VERDICT_STATES } from "@t3tools/client-runtime/fork";
import type { BotUsageDays } from "./BotsUsage";

export const BOT_SORTS = ["activity", "name", "tokens"] as const;
export type BotSort = (typeof BOT_SORTS)[number];
export const BOT_SORT_LABELS: Record<BotSort, string> = {
  activity: "Recent activity",
  name: "Name",
  tokens: "Most tokens",
};

/** The usage windows, with the labels the Usage page gives them. */
export const BOT_USAGE_WINDOWS = [1, 7, 30, 90] as const satisfies readonly BotUsageDays[];
export const BOT_USAGE_WINDOW_LABELS: Record<BotUsageDays, string> = {
  1: "Past 24h",
  7: "7 days",
  30: "30 days",
  90: "90 days",
};
/** The same windows where a label has a few characters, such as "Runs · 7d". */
export const BOT_USAGE_WINDOW_SHORT: Record<BotUsageDays, string> = {
  1: "24h",
  7: "7d",
  30: "30d",
  90: "90d",
};

export const BOT_STATE_FILTERS = ["failing", "attention", "budget"] as const;
export type BotStateFilter = (typeof BOT_STATE_FILTERS)[number];
export const BOT_STATE_FILTER_LABELS: Record<BotStateFilter, string> = {
  failing: "Has failures",
  attention: "Needs you",
  budget: "At or near its budget",
};

export const BOT_ORIGIN_FILTERS = ["starter", "custom"] as const;
export type BotOriginFilter = (typeof BOT_ORIGIN_FILTERS)[number];
export const BOT_ORIGIN_FILTER_LABELS: Record<BotOriginFilter, string> = {
  starter: "Starters",
  custom: "Your own",
};

/** What the collection knows about one bot beyond its definition. */
export interface BotFacts {
  /** The bot's runs among the newest runs across every bot, newest first. */
  readonly recent: readonly BotRun[];
  /** Its usage in the chosen window; undefined while usage loads or the server has none. */
  readonly row: BotUsageRow | undefined;
  readonly budget: BotBudgetState | undefined;
  /** Its runs on the first page of Needs you. */
  readonly needsYou: number;
}

export interface BotFilters {
  readonly query: string;
  readonly states: ReadonlySet<BotStateFilter>;
  readonly origins: ReadonlySet<BotOriginFilter>;
}

/** Runs grouped by bot, each group newest first like the list they came from. */
export function runsByBot(runs: readonly BotRun[]): ReadonlyMap<string, readonly BotRun[]> {
  const grouped = new Map<string, BotRun[]>();
  for (const run of runs) {
    const own = grouped.get(run.botId);
    if (own) own.push(run);
    else grouped.set(run.botId, [run]);
  }
  return grouped;
}

export function countByBot(runs: readonly BotRun[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run.botId, (counts.get(run.botId) ?? 0) + 1);
  return counts;
}

/** Every word must appear in the bot's name, description, id or one of its inputs. */
export function matchesBotSearch(bot: BotDefinition, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    bot.name,
    bot.description,
    bot.id,
    ...bot.parameters.flatMap((parameter) => [parameter.label, parameter.name]),
  ]
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

const failedRun = (run: BotRun) =>
  run.status === "failed" ||
  run.status === "timed_out" ||
  (run.status === "completed" && run.verdict?.verdict === "fail");

/**
 * Whether the bot failed lately. Usage covers the whole window; without it, only the newest runs
 * can answer.
 */
export function hasFailures({ row, recent }: Pick<BotFacts, "row" | "recent">) {
  return row ? row.failed + row.timedOut + row.fail > 0 : recent.some(failedRun);
}

/** How close a budget-limited bot is to running out; `near` from this share of a limit. */
export const BUDGET_NEAR_SHARE = 0.8;
export type BudgetLevel = "at" | "near" | "clear";

/** Null for a bot without a budget. */
export function budgetLevel(budget: BotBudgetState | undefined): BudgetLevel | null {
  if (!budget || (budget.runsPerDay === undefined && budget.tokensPerDay === undefined))
    return null;
  const shares = [
    budget.runsPerDay === undefined ? 0 : budget.runsInWindow / budget.runsPerDay,
    budget.tokensPerDay === undefined ? 0 : budget.tokensInWindow / budget.tokensPerDay,
  ];
  const share = Math.max(...shares);
  if (budget.retryAt !== undefined || share >= 1) return "at";
  return share >= BUDGET_NEAR_SHARE ? "near" : "clear";
}

const isStarter = (bot: BotDefinition) => bot.origin?.kind === "starter";

export function matchesBotFilters(bot: BotDefinition, facts: BotFacts, filters: BotFilters) {
  if (!matchesBotSearch(bot, filters.query)) return false;
  if (filters.origins.size && !filters.origins.has(isStarter(bot) ? "starter" : "custom"))
    return false;
  // States narrow by any of those chosen, the way a "show me trouble" filter reads.
  if (filters.states.size === 0) return true;
  return (
    (filters.states.has("failing") && hasFailures(facts)) ||
    (filters.states.has("attention") && facts.needsYou > 0) ||
    (filters.states.has("budget") && (budgetLevel(facts.budget) ?? "clear") !== "clear")
  );
}

const timeOf = (value: string | null | undefined) => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
};

/** The bot's latest sign of life: its newest run, or the last change to its definition. */
export const lastActivityAt = (bot: BotDefinition, recent: readonly BotRun[]) =>
  Math.max(timeOf(recent[0]?.createdAt), timeOf(bot.updatedAt));

const byName = (left: BotDefinition, right: BotDefinition) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
  left.id.localeCompare(right.id);

export function sortBots(
  bots: readonly BotDefinition[],
  sort: BotSort,
  factsOf: (bot: BotDefinition) => BotFacts,
): BotDefinition[] {
  switch (sort) {
    case "name":
      return bots.toSorted(byName);
    case "tokens":
      return bots.toSorted(
        (left, right) =>
          (factsOf(right).row?.tokens.total ?? -1) - (factsOf(left).row?.tokens.total ?? -1) ||
          byName(left, right),
      );
    case "activity":
      return bots.toSorted(
        (left, right) =>
          lastActivityAt(right, factsOf(right).recent) -
            lastActivityAt(left, factsOf(left).recent) || byName(left, right),
      );
  }
}

/**
 * A bot's success in the window: its pass rate once it returns verdicts, else how many finished
 * runs completed. The detail counts the same runs as the rate, so the two always agree.
 */
export function successFigure(row: BotUsageRow | undefined) {
  if (!row) return null;
  const judged = row.pass + row.fail + row.needsAttention;
  if (judged > 0)
    return { label: "Passed", share: row.pass / judged, detail: `${row.pass} of ${judged}` };
  const finished = row.completed + row.failed + row.timedOut;
  if (finished === 0) return null;
  return {
    label: "Completed",
    share: row.completed / finished,
    detail: `${row.completed} of ${finished}`,
  };
}

/** A run's outcome in a word or two: its verdict once it has one, else its status. */
export const runOutcomeLabel = (run: BotRun) =>
  run.status === "completed" && run.verdict
    ? BOT_VERDICT_STATES[run.verdict.verdict].label
    : BOT_RUN_STATES[run.status].label;

/**
 * What the collection can truthfully say about a bot's last run from the newest runs across every
 * bot. A full list can leave out a bot that ran before them, so its absence proves nothing.
 */
export type LastRunState =
  | { readonly kind: "run"; readonly run: BotRun }
  | { readonly kind: "none" }
  | { readonly kind: "older" };

export function lastRunState(recent: readonly BotRun[], listFull: boolean): LastRunState {
  const [run] = recent;
  if (run) return { kind: "run", run };
  return listFull ? { kind: "older" } : { kind: "none" };
}

export const activeRuns = (recent: readonly BotRun[]) =>
  recent.filter((run) => run.status === "queued" || run.status === "running").length;
