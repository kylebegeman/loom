import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotBudgetState, BotUsageRow } from "@t3tools/contracts/fork";
import type { BotsChanges } from "@t3tools/client-runtime/fork";
import { formatCount, formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { bots } from "./state";
import { rollingWindow } from "./usageWindow";

const WINDOWS = [
  { days: 1, label: "24 hours", phrase: "in 24 hours" },
  { days: 7, label: "7 days", phrase: "this week" },
  { days: 30, label: "30 days", phrase: "in 30 days" },
] as const;
type WindowDays = (typeof WINDOWS)[number]["days"];

/** One refetch at most this often while runs keep finishing. */
const REFETCH_INTERVAL_MS = 5_000;

const windowEndingNow = (days: WindowDays) => rollingWindow(days, Date.now());

export const formatDuration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
};

const runsText = (count: number) => `${formatCount(count)} ${count === 1 ? "run" : "runs"}`;

/** The pass rate for bots that give verdicts, the completed share for the rest. */
const rateText = (
  row: Pick<BotUsageRow, "successRate"> & { readonly verdicts: boolean },
): string | null =>
  row.successRate === null
    ? null
    : `${formatPercent(row.successRate, 0)} ${row.verdicts ? "pass" : "completed"}`;

/** "38 of 50 runs in the last 24 hours", and when the next run may start once a limit is reached. */
export const budgetMeterText = (state: BotBudgetState) => {
  const parts = [
    ...(state.runsPerDay === undefined
      ? []
      : [`${formatCount(state.runsInWindow)} of ${runsText(state.runsPerDay)}`]),
    ...(state.tokensPerDay === undefined
      ? []
      : [`${formatTokens(state.tokensInWindow)} of ${formatTokens(state.tokensPerDay)} tokens`]),
  ];
  const used = `${parts.join(" and ")} in the last 24 hours.`;
  if (state.retryAt === undefined) return used;
  const at = new Date(state.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${used} The next run is possible at ${at}.`;
};

function UsageRow({
  row,
  share,
  phrase,
  atLeast,
  budget,
}: {
  readonly row: BotUsageRow;
  readonly share: number | null;
  readonly phrase: string;
  readonly atLeast: boolean;
  readonly budget: BotBudgetState | undefined;
}) {
  const verdicts = row.pass + row.fail + row.needsAttention > 0;
  const summary = [
    `${runsText(row.runs)} ${phrase}`,
    rateText({ successRate: row.successRate, verdicts }),
    row.medianDurationMs === null ? null : `${formatDuration(row.medianDurationMs)} median`,
    share === null ? null : `${atLeast ? "at least " : ""}${formatPercent(share, 0)} of bot tokens`,
  ].filter((part) => part !== null);
  return (
    <li className="rounded-lg border border-border">
      <details>
        <summary className="cursor-pointer p-3">
          <span className="font-medium">{row.botName}</span>
          <span className="text-sm text-muted-foreground">: {summary.join(", ")}</span>
        </summary>
        <div className="grid gap-2 px-3 pb-3 text-sm">
          <p className="text-muted-foreground">
            {formatCount(row.completed)} completed, {formatCount(row.failed)} failed,{" "}
            {formatCount(row.timedOut)} timed out, {formatCount(row.cancelled)} cancelled.
            {row.maxDurationMs === null
              ? ""
              : ` Slowest ${formatDuration(row.maxDurationMs)}.`}{" "}
            {row.usageComplete ? "" : "At least "}
            {formatTokens(row.tokens.total)} tokens ({formatTokens(row.tokens.input)} in,{" "}
            {formatTokens(row.tokens.output)} out).
            {row.replays
              ? row.replays === 1
                ? " One run was a replay."
                : ` ${formatCount(row.replays)} runs were replays.`
              : ""}
          </p>
          {budget ? (
            <p className="text-muted-foreground">Budget: {budgetMeterText(budget)}</p>
          ) : null}
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Model</th>
                <th className="py-1 font-normal">Runs</th>
                <th className="py-1 font-normal">{verdicts ? "Pass" : "Completed"}</th>
                <th className="py-1 font-normal">Median</th>
                <th className="py-1 font-normal">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {row.byModel.map((model) => (
                <tr key={`${model.assumed ? "assumed" : "recorded"}:${model.model}`}>
                  <td className="py-1">
                    {model.model}
                    {model.assumed ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        (current model, assumed)
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 tabular-nums">{formatCount(model.runs)}</td>
                  <td className="py-1 tabular-nums">
                    {model.successRate === null ? "-" : formatPercent(model.successRate, 0)}
                  </td>
                  <td className="py-1 tabular-nums">
                    {model.medianDurationMs === null ? "-" : formatDuration(model.medianDurationMs)}
                  </td>
                  <td className="py-1 tabular-nums">{formatTokens(model.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </li>
  );
}

/** Runs, outcomes, durations and tokens per bot over a rolling window. */
export function BotsUsage({
  environmentId,
  changes,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly changes: BotsChanges;
  readonly connected: boolean;
}) {
  const [days, setDays] = useState<WindowDays>(7);
  const [window, setWindow] = useState(() => windowEndingNow(7));
  const query = useEnvironmentQuery(bots.usage({ environmentId, input: window }));
  const choose = (next: WindowDays) => {
    setDays(next);
    setWindow(windowEndingNow(next));
  };

  const lastFetch = useRef(0);
  /** The same minute's window is the same query, so it is refetched rather than replaced. */
  const refetch = (nowMs: number) => {
    lastFetch.current = nowMs;
    const next = rollingWindow(days, nowMs);
    if (next.until === window.until) query.refresh();
    else setWindow(next);
  };
  const reload = useEffectEvent(refetch);

  // A run that finishes changes the numbers; refetch, at most once per interval.
  const finished = [...changes.runs.values()].filter((run) => run.finishedAt !== null).length;
  useEffect(() => {
    if (finished === 0 || !connected) return;
    const wait = lastFetch.current + REFETCH_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      reload(Date.now());
      return;
    }
    const timer = setTimeout(() => reload(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [finished, connected]);

  const phrase = WINDOWS.find((entry) => entry.days === days)?.phrase ?? "";
  const data = query.data;
  const total = data?.totals.tokens.total ?? 0;

  return (
    <section className="space-y-3" aria-label="Usage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Window">
          {WINDOWS.map((entry) => (
            <Button
              key={entry.days}
              size="xs"
              variant={days === entry.days ? "secondary" : "ghost"}
              aria-pressed={days === entry.days}
              onClick={() => choose(entry.days)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
        <Button
          size="xs"
          variant="ghost"
          disabled={!connected || query.isPending}
          onClick={() => refetch(Date.now())}
        >
          Refresh
        </Button>
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      ) : null}
      {data === null ? (
        query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading usage…
          </p>
        ) : null
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bot ran {phrase}.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {runsText(data.totals.runs)} {phrase}, {data.totals.usageComplete ? "" : "at least "}
            {formatTokens(total)} tokens.
            {data.totals.usageComplete
              ? ""
              : " Some runs did not report all their tokens, so token figures are lower bounds."}
          </p>
          <ul className="grid gap-2">
            {data.rows.map((row) => (
              <UsageRow
                key={row.botId}
                row={row}
                share={total > 0 ? row.tokens.total / total : null}
                phrase={phrase}
                atLeast={!data.totals.usageComplete}
                budget={data.budgets[row.botId]}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
