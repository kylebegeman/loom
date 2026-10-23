import {
  BOTS_REPLAY_MAX_RUNS,
  isTerminalBotRunStatus,
  type BotBudgetState,
  type BotRun,
  type BotTargetReadiness,
} from "@t3tools/contracts/fork";

export const replayCandidates = (runs: ReadonlyArray<BotRun>, botId: string) =>
  runs.filter(
    (run) => run.botId === botId && run.replayId == null && isTerminalBotRunStatus(run.status),
  );

export const defaultReplaySelection = (candidates: ReadonlyArray<BotRun>) => {
  const rated = candidates.filter((run) => run.rating != null);
  return (rated.length ? rated : candidates.slice(0, 5))
    .slice(0, BOTS_REPLAY_MAX_RUNS)
    .map((run) => run.id);
};

export const replayRunsById = (
  retained: ReadonlyArray<BotRun>,
  listed: ReadonlyArray<BotRun>,
  changes: Iterable<BotRun>,
) => new Map([...retained, ...listed, ...changes].map((run) => [run.id, run]));

/** Limits are checked independently; reaching either one blocks the next run. */
export function budgetStatus(state: BotBudgetState): "blocked" | "approaching" | "available" {
  const fractions = [
    ...(state.runsPerDay === undefined ? [] : [state.runsInWindow / state.runsPerDay]),
    ...(state.tokensPerDay === undefined ? [] : [state.tokensInWindow / state.tokensPerDay]),
  ];
  if (state.retryAt !== undefined || fractions.some((fraction) => fraction >= 1)) return "blocked";
  return fractions.some((fraction) => fraction >= 0.8) ? "approaching" : "available";
}

export const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
};

export const targetReadinessText = (target: BotTargetReadiness): string =>
  target.ready
    ? `Ready, ${target.freeSlots} free ${target.freeSlots === 1 ? "slot" : "slots"}`
    : target.reasons.join(" ") || (target.online ? "Not ready" : "Offline");
