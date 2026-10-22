import type { BotRun } from "@t3tools/contracts/fork";

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

export const runDurationLabel = (run: Pick<BotRun, "startedAt" | "finishedAt">) => {
  const duration = runDurationMs(run);
  return duration === null
    ? run.startedAt === null
      ? "Did not start"
      : run.finishedAt === null
        ? "In progress"
        : "Duration unavailable"
    : `Ran for ${formatDuration(duration)}`;
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
