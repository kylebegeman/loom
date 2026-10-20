import { BOTS_REPLAY_MAX_RUNS, isTerminalBotRunStatus, type BotRun } from "@t3tools/contracts/fork";

/** Runs a replay can repeat: finished runs of the bot that were not replays themselves. */
export const replayCandidates = (runs: ReadonlyArray<BotRun>, botId: string) =>
  runs.filter(
    (run) => run.botId === botId && run.replayId == null && isTerminalBotRunStatus(run.status),
  );

/** Rated runs first, since they say what good and bad look like; otherwise the newest few. */
export const defaultReplaySelection = (
  candidates: ReadonlyArray<BotRun>,
  fallback = 5,
): ReadonlyArray<string> => {
  const rated = candidates.filter((run) => run.rating != null);
  const picked = rated.length > 0 ? rated : candidates.slice(0, fallback);
  return picked.slice(0, BOTS_REPLAY_MAX_RUNS).map((run) => run.id);
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
