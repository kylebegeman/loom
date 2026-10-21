import { BotsError, type BotBudget, type BotBudgetState } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";

export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What a bot used in the rolling window, oldest first. */
export interface BudgetWindow {
  /** Creation times of the runs that count: those that started or are waiting to. */
  readonly runs: ReadonlyArray<string>;
  /** Runs that finished in the window, with their input plus output tokens. */
  readonly finished: ReadonlyArray<{ readonly finishedAt: string; readonly tokens: number }>;
}

export const isoAt = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

const plusWindow = (iso: string) => isoAt(Date.parse(iso) + BUDGET_WINDOW_MS);

/**
 * When enough of the oldest entries leave the window for the rest to fall below `limit`. Entries
 * are oldest first; `weight` is what each contributes.
 */
const retryAfter = <A>(
  entries: ReadonlyArray<A>,
  limit: number,
  at: (entry: A) => string,
  weight: (entry: A) => number,
): string | undefined => {
  let used = entries.reduce((sum, entry) => sum + weight(entry), 0);
  if (used < limit) return undefined;
  for (const entry of entries) {
    used -= weight(entry);
    if (used < limit) return plusWindow(at(entry));
  }
  return undefined;
};

export const budgetState = (
  budget: BotBudget | undefined,
  window: BudgetWindow,
): BotBudgetState => {
  const runsAt =
    budget?.runsPerDay === undefined
      ? undefined
      : retryAfter(
          window.runs,
          budget.runsPerDay,
          (at) => at,
          () => 1,
        );
  const tokensAt =
    budget?.tokensPerDay === undefined
      ? undefined
      : retryAfter(
          window.finished,
          budget.tokensPerDay,
          (run) => run.finishedAt,
          (run) => run.tokens,
        );
  // Both limits must allow the run, so the later time is the one that matters.
  const retryAt = [runsAt, tokensAt]
    .filter((at) => at !== undefined)
    .toSorted()
    .at(-1);
  return {
    runsInWindow: window.runs.length,
    tokensInWindow: window.finished.reduce((sum, run) => sum + run.tokens, 0),
    ...(budget?.runsPerDay === undefined ? {} : { runsPerDay: budget.runsPerDay }),
    ...(budget?.tokensPerDay === undefined ? {} : { tokensPerDay: budget.tokensPerDay }),
    ...(retryAt === undefined ? {} : { retryAt }),
  };
};

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/**
 * Relative rather than a clock time: the server cannot know the time zone of the client or agent
 * reading the message. `retryAt` carries the exact instant.
 */
export const waitText = (ms: number): string => {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return plural(minutes, "minute");
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
};

const formatCount = (value: number) => value.toLocaleString("en-US");

/** The refusal for a run that would pass a limit, or null when the run may start. */
export const budgetRefusal = (
  botName: string,
  state: BotBudgetState,
  nowMs: number,
): BotsError | null => {
  if (state.retryAt === undefined) return null;
  const runsReached = state.runsPerDay !== undefined && state.runsInWindow >= state.runsPerDay;
  const limit = runsReached
    ? `${formatCount(state.runsPerDay!)} runs`
    : `${formatCount(state.tokensPerDay ?? 0)} tokens`;
  return new BotsError({
    reason: "invalid",
    message: `${botName} reached its budget of ${limit} per 24 hours. The next run is possible in ${waitText(Date.parse(state.retryAt) - nowMs)}.`,
    retryAt: state.retryAt,
  });
};
