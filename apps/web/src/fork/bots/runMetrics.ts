import { isTerminalBotRunStatus, type BotRun } from "@t3tools/contracts/fork";

export const formatDuration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
};

/** Queue time is not runtime, and a run refused before launch has no duration. */
export const runDurationMs = (run: Pick<BotRun, "startedAt" | "finishedAt">): number | null => {
  if (run.startedAt === null || run.finishedAt === null) return null;
  const elapsed = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
};

export const runDurationLabel = (
  run: Pick<BotRun, "startedAt" | "finishedAt"> & Partial<Pick<BotRun, "status">>,
) => {
  const duration = runDurationMs(run);
  if (duration !== null) return `Ran for ${formatDuration(duration)}`;
  if (run.startedAt === null) {
    switch (run.status) {
      case "completed":
        return "Duration unavailable";
      case "queued":
        return "Not started";
      case "running":
        return "Starting";
      default:
        return "Did not start";
    }
  }
  return run.finishedAt === null &&
    (run.status === undefined || !isTerminalBotRunStatus(run.status))
    ? "In progress"
    : "Duration unavailable";
};

export const waitingAgeLabel = (since: string, now: number) => {
  const elapsed = Math.max(0, now - Date.parse(since));
  if (!Number.isFinite(elapsed)) return null;
  if (elapsed < 60_000) return "less than a minute";
  return formatDuration(Math.floor(elapsed / 60_000) * 60_000);
};

/** Cached input is already included in inputTokens. */
export const runTotalTokens = (run: Pick<BotRun, "usage">): number | null => {
  const usage = run.usage;
  return usage == null || usage.status === "unavailable"
    ? null
    : usage.inputTokens + usage.outputTokens;
};

export const runTokensLabel = (run: Pick<BotRun, "usage">) => {
  const total = runTotalTokens(run);
  return total === null
    ? "Tokens unavailable"
    : `${total.toLocaleString()} tokens${run.usage?.status === "partial" ? " (partial)" : ""}`;
};

/** How long a run waited for a slot before it started; null until it starts. */
export const runQueuedMs = (run: Pick<BotRun, "createdAt" | "startedAt">): number | null => {
  if (run.startedAt === null) return null;
  const waited = Date.parse(run.startedAt) - Date.parse(run.createdAt);
  return Number.isFinite(waited) && waited >= 0 ? waited : null;
};

/** Time since `since` to the minute, for a run still going, which only re-renders each minute. */
export const elapsedLabel = (since: string, now: number) => {
  const elapsed = now - Date.parse(since);
  if (!Number.isFinite(elapsed)) return null;
  return elapsed < 60_000 ? "<1m" : formatDuration(Math.floor(elapsed / 60_000) * 60_000);
};
