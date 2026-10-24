import {
  BOTS_REPLAY_MAX_RUNS,
  isTerminalBotRunStatus,
  type BotDefinitionInput,
  type BotReplay,
  type BotRun,
  type BotRunRating,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import { formatDuration, runDurationMs, runTotalTokens } from "./runMetrics";

export type ReplayOutcomeFilter = "all" | "failed" | BotVerdictValue;
export type ReplayRatingFilter = "all" | "rated" | "unrated" | BotRunRating;
export interface ReplayFilters {
  readonly outcome: ReplayOutcomeFilter;
  readonly rating: ReplayRatingFilter;
}
export const ALL_REPLAY_FILTERS: ReplayFilters = { outcome: "all", rating: "all" };

/** Runs a replay can repeat: finished runs of the bot that were not replays themselves. */
export const replayCandidates = (runs: ReadonlyArray<BotRun>, botId: string) =>
  runs
    .filter(
      (run) => run.botId === botId && run.replayId == null && isTerminalBotRunStatus(run.status),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

export const filterReplayCandidates = (candidates: ReadonlyArray<BotRun>, filters: ReplayFilters) =>
  candidates.filter((run) => {
    const matchesOutcome =
      filters.outcome === "all" ||
      (filters.outcome === "failed"
        ? run.status === "failed" || run.status === "timed_out"
        : run.verdict?.verdict === filters.outcome);
    const matchesRating =
      filters.rating === "all" ||
      (filters.rating === "rated"
        ? run.rating != null
        : filters.rating === "unrated"
          ? run.rating == null
          : run.rating === filters.rating);
    return matchesOutcome && matchesRating;
  });

/** Rated runs first, since they say what good and bad look like; otherwise the newest few. */
export const defaultReplaySelection = (
  candidates: ReadonlyArray<BotRun>,
  fallback = 5,
): ReadonlyArray<string> => {
  const rated = candidates.filter((run) => run.rating != null);
  const picked = rated.length > 0 ? rated : candidates.slice(0, fallback);
  return picked.slice(0, BOTS_REPLAY_MAX_RUNS).map((run) => run.id);
};

/** Keep the selected runs themselves so paging cannot lose their inputs or original results. */
export const toggleReplaySelection = (
  selected: ReadonlyArray<BotRun>,
  run: BotRun,
  on: boolean,
): ReadonlyArray<BotRun> => {
  if (!on) return selected.filter((candidate) => candidate.id !== run.id);
  if (
    selected.some((candidate) => candidate.id === run.id) ||
    selected.length >= BOTS_REPLAY_MAX_RUNS
  )
    return selected;
  return [...selected, run];
};

/**
 * The runs a replay's rows show, by id. The originals are kept as chosen, since the replay's own
 * runs push them off the capped list; any run seen since is newer than both.
 */
export const replayRunsById = (
  originals: ReadonlyArray<BotRun>,
  listed: ReadonlyArray<BotRun>,
  changed: Iterable<BotRun>,
) => new Map([...originals, ...listed, ...changed].map((run) => [run.id, run]));

export const replayCheckoutWarning = (definition: Pick<BotDefinitionInput, "workspace">) => {
  const workspace = definition.workspace;
  if (workspace.type !== "project" || workspace.worktree) return null;
  return workspace.checkout === "caller"
    ? "These replays run directly in the original runs' recorded checkouts. They can change files and repeat side effects from the original runs."
    : "These replays run directly in the project checkout. They can change files and repeat side effects from the original runs.";
};

const percentChange = (before: number, after: number) => {
  if (before === 0) return "";
  const percent = Math.abs(((after - before) / before) * 100);
  return ` (${percent < 1 ? "<1" : Math.round(percent)}%)`;
};

/** Only compare complete token totals; partial usage is not evidence of a cheaper run. */
export const replayMetricChanges = (before: BotRun | undefined, after: BotRun | undefined) => {
  if (before === undefined || after === undefined) return { duration: null, tokens: null };
  const beforeMs = runDurationMs(before);
  const afterMs = runDurationMs(after);
  const elapsed = beforeMs === null || afterMs === null ? null : afterMs - beforeMs;
  const beforeTokens = runTotalTokens(before);
  const afterTokens = runTotalTokens(after);
  const tokens =
    before.usage?.status !== "complete" ||
    after.usage?.status !== "complete" ||
    beforeTokens === null ||
    afterTokens === null
      ? null
      : afterTokens - beforeTokens;
  return {
    duration:
      elapsed === null
        ? null
        : elapsed === 0
          ? "Same duration"
          : `${Math.abs(elapsed) < 1000 ? "Less than 1s" : formatDuration(Math.abs(elapsed))} ${elapsed > 0 ? "slower" : "faster"}${percentChange(beforeMs!, afterMs!)}`,
    tokens:
      tokens === null
        ? null
        : tokens === 0
          ? "Same token use"
          : `${Math.abs(tokens).toLocaleString()} ${tokens > 0 ? "more" : "fewer"} tokens${percentChange(beforeTokens!, afterTokens!)}`,
  };
};

/** A run's inputs on one line, such as "pr: 94, depth: 2"; empty without inputs. */
export const replayInputSummary = (run: Pick<BotRun, "inputs">) =>
  Object.entries(run.inputs)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");

/**
 * The replay to show. A finished fetch wins; while the fetch still says running, the answer to a
 * cancel is newer, and before any fetch the replay as started stands in.
 */
export const currentReplay = (
  started: BotReplay | null,
  fetched: BotReplay | null,
  cancelled: BotReplay | null,
): BotReplay | null =>
  fetched !== null && fetched.status !== "running" ? fetched : (cancelled ?? fetched ?? started);

const runCount = (count: number) => (count === 1 ? "1 run" : `${count} runs`);

/** Whether the replayed definition did better or worse, in one sentence. */
export const replayHeadline = (replay: Pick<BotReplay, "status" | "items" | "summary">) => {
  const total = replay.items.length;
  const settled = replay.items.filter((item) => item.comparison !== "pending").length;
  if (replay.status === "running") return `Replaying. ${settled} of ${runCount(total)} done.`;
  const { fixed, broke, same, changed, failed } = replay.summary;
  const prefix = replay.status === "cancelled" ? "Cancelled. " : "Done. ";
  if (settled === 0) return `${prefix}No run finished.`;
  if (broke > 0 && fixed > 0)
    return `${prefix}Better on ${runCount(fixed)}, worse on ${runCount(broke)}.`;
  if (broke > 0) return `${prefix}Worse on ${runCount(broke)}, better on none.`;
  if (fixed > 0) return `${prefix}Better on ${runCount(fixed)}, worse on none.`;
  if (same + changed > 0)
    return `${prefix}No better or worse${changed > 0 ? `; ${runCount(changed)} answered differently` : ""}.`;
  return `${prefix}${runCount(failed)} could not be replayed.`;
};

type ReplayCount = keyof BotReplay["summary"];

/** Each count in the words of the comparison badges, in the order the badges rank them. */
const TALLY_WORDS: ReadonlyArray<readonly [ReplayCount, string]> = [
  ["fixed", "better"],
  ["broke", "worse"],
  ["changed", "changed"],
  ["same", "same"],
  ["failed", "failed"],
];

/** Every count above zero, such as "2 better, 8 same"; empty while nothing has settled. */
export const replayTally = (
  summary: BotReplay["summary"],
  omit: ReadonlySet<ReplayCount> = new Set(),
) =>
  TALLY_WORDS.filter(([key]) => summary[key] > 0 && !omit.has(key))
    .map(([key, word]) => `${summary[key]} ${word}`)
    .join(", ");

/**
 * The counts {@link replayHeadline} leaves out, so the status line never names a count twice
 * under two words. Empty when the headline already says everything.
 */
export const replayRest = (replay: Pick<BotReplay, "status" | "items" | "summary">) => {
  if (replay.status === "running") return replayTally(replay.summary);
  if (replay.items.every((item) => item.comparison === "pending")) return "";
  const { fixed, broke, same, changed } = replay.summary;
  if (fixed > 0 || broke > 0) return replayTally(replay.summary, new Set(["fixed", "broke"]));
  if (same + changed > 0) return replayTally(replay.summary, new Set(["changed"]));
  return "";
};
