import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotBudgetState, BotUsageRow } from "@t3tools/contracts/fork";
import { rollingBotsUsageWindow, type BotsChanges } from "@t3tools/client-runtime/fork";
import { formatCount, formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { ChartColumnIcon, ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibraryFigure,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { BotTile } from "./BotIdentity";
import { BotRowsSkeleton, BotsEmptyList } from "./BotRuns";
import { bots } from "./state";
import { formatDuration } from "./runMetrics";
import type {
  BotDefinition as StubBot,
  BotId as StubBotId,
  BotsUsageResult as StubUsage,
} from "@t3tools/contracts/fork";

export { formatDuration } from "./runMetrics";

const WINDOWS = [
  { days: 1, label: "24 hours", phrase: "in 24 hours" },
  { days: 7, label: "7 days", phrase: "this week" },
  { days: 30, label: "30 days", phrase: "in 30 days" },
] as const;
type WindowDays = (typeof WINDOWS)[number]["days"];

/** One refetch at most this often while runs keep finishing. */
const REFETCH_INTERVAL_MS = 5_000;

const windowEndingNow = (days: WindowDays) => rollingBotsUsageWindow(days, Date.now());

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
  barWidth,
  phrase,
  atLeast,
  budget,
}: {
  readonly row: BotUsageRow;
  readonly share: number | null;
  /** The row's tokens against the busiest bot's, so the ranking reads at a glance. */
  readonly barWidth: number;
  readonly phrase: string;
  readonly atLeast: boolean;
  readonly budget: BotBudgetState | undefined;
}) {
  const [open, setOpen] = useState(false);
  const verdicts = row.pass + row.fail + row.needsAttention > 0;
  const summary = [
    `${runsText(row.runs)} ${phrase}`,
    rateText({ successRate: row.successRate, verdicts }),
    row.medianDurationMs === null ? null : `${formatDuration(row.medianDurationMs)} median`,
  ].filter((part) => part !== null);
  const detailId = `bot-usage-${row.botId}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-start outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <BotTile bot={{ id: row.botId }} />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{row.botName}</span>
            {budget?.retryAt !== undefined ? (
              <LibraryStateBadge tone="warning">At its limit</LibraryStateBadge>
            ) : null}
          </span>
          <span className="truncate text-xs tabular-nums text-muted-foreground">
            {summary.join(" · ")}
          </span>
          <span
            aria-hidden
            className="block h-1 overflow-hidden rounded-full bg-muted dark:bg-accent"
          >
            <span
              className="block h-full rounded-full bg-(--project-color)"
              style={{ width: `${barWidth * 100}%` }}
            />
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
          <span className="text-sm font-medium">
            {row.usageComplete ? "" : "at least "}
            {formatTokens(row.tokens.total)}
          </span>
          <span className="text-xs text-muted-foreground">
            {share === null
              ? "tokens"
              : `${atLeast ? "at least " : ""}${formatPercent(share, 0)} of bot tokens`}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div id={detailId} className="flex flex-col gap-3 px-3 pb-3 sm:ps-14">
          <p className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">Budget: {budgetMeterText(budget)}</p>
          ) : null}
          <table className="w-full text-start text-sm">
            <caption className="sr-only">{row.botName} by model</caption>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 text-start font-normal">
                  Model
                </th>
                <th scope="col" className="py-1.5 text-end font-normal">
                  Runs
                </th>
                <th scope="col" className="py-1.5 text-end font-normal">
                  {verdicts ? "Pass" : "Completed"}
                </th>
                <th scope="col" className="py-1.5 text-end font-normal">
                  Median
                </th>
                <th scope="col" className="py-1.5 text-end font-normal">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {row.byModel.map((model) => (
                <tr key={`${model.assumed ? "assumed" : "recorded"}:${model.model}`}>
                  <td className="py-1.5 pe-3">
                    <span className="font-mono text-xs">{model.model}</span>
                    {model.assumed ? (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        (current model, assumed)
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-end tabular-nums">{formatCount(model.runs)}</td>
                  <td className="py-1.5 text-end tabular-nums">
                    {model.successRate === null ? "-" : formatPercent(model.successRate, 0)}
                  </td>
                  <td className="py-1.5 text-end tabular-nums">
                    {model.medianDurationMs === null ? "-" : formatDuration(model.medianDurationMs)}
                  </td>
                  <td className="py-1.5 text-end tabular-nums">
                    {formatTokens(model.totalTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}

/** The usage panel's shape while its numbers load, so nothing jumps when they arrive. */
function UsageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div aria-hidden className="flex gap-5">
        {["runs", "tokens", "bots"].map((figure) => (
          <div key={figure} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <BotRowsSkeleton label="Loading usage" />
    </div>
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
    const next = rollingBotsUsageWindow(days, nowMs);
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
  const busiest = Math.max(1, ...(data?.rows ?? []).map((row) => row.tokens.total));
  const unfinished = (data?.rows ?? []).reduce((sum, row) => sum + row.failed + row.timedOut, 0);

  return (
    <section className="flex flex-col gap-6" aria-label="Usage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
          Runs, outcomes, durations and tokens per bot.
        </p>
        <div className="flex items-center gap-1.5">
          <ToggleGroup
            shape="pill"
            variant="segmented"
            aria-label="Window"
            value={[String(days)]}
            onValueChange={(next) => {
              const entry = WINDOWS.find((option) => String(option.days) === next[0]);
              if (entry) choose(entry.days);
            }}
          >
            {WINDOWS.map((entry) => (
              <ToggleGroupItem key={entry.days} value={String(entry.days)}>
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            shape="pill"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh usage"
            disabled={!connected || query.isPending}
            onClick={() => refetch(Date.now())}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </div>
      <LibraryErrorNotice error={query.error} onRetry={() => refetch(Date.now())} />
      {data === null ? (
        query.isPending ? (
          <UsageSkeleton />
        ) : null
      ) : data.rows.length === 0 ? (
        <BotsEmptyList icon={ChartColumnIcon} message={`No bot ran ${phrase}.`} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-3">
              <LibraryFigure
                label="Runs"
                value={formatCount(data.totals.runs)}
                detail={unfinished > 0 ? `${formatCount(unfinished)} failed or timed out` : phrase}
              />
              <LibraryFigure
                label="Tokens"
                value={formatTokens(total)}
                detail={data.totals.usageComplete ? "Input and output" : "A lower bound"}
              />
              <LibraryFigure
                label="Bots"
                value={formatCount(data.rows.length)}
                detail={`ran ${phrase}`}
              />
            </dl>
            {data.totals.usageComplete ? null : (
              <p className="text-xs text-muted-foreground">
                Some runs did not report all their tokens, so token figures are lower bounds.
              </p>
            )}
          </div>
          <ul
            className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}
          >
            {data.rows.map((row) => (
              <UsageRow
                key={row.botId}
                row={row}
                share={total > 0 ? row.tokens.total / total : null}
                barWidth={row.tokens.total / busiest}
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

// STUB(bots-redesign): replaced by the owning area's implementation.
/** The usage windows the Bots page offers, in days back from now. */
export type BotUsageDays = 1 | 7 | 30 | 90;

/**
 * The host's bot usage over the window ending now, shared by every view that asks for the same
 * window. Refetched as runs finish. `rowOf` and `budgetOf` are undefined until the usage arrives.
 */
export function useBotUsage(_days: BotUsageDays): {
  readonly usage: StubUsage | null;
  readonly rowOf: (botId: StubBotId) => BotUsageRow | undefined;
  readonly budgetOf: (botId: StubBotId) => BotBudgetState | undefined;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  return {
    usage: null,
    rowOf: () => undefined,
    budgetOf: () => undefined,
    isPending: false,
    error: null,
    refresh: () => {},
  };
}

/** The index header's usage clause, such as "142 runs in 7 days · at least 3.2M tokens". */
export function BotsUsageClause(_props: { readonly days: BotUsageDays }) {
  return null;
}

/** A bot's tokens in the window as a figure over a bar scaled to the largest, for the list view. */
export function BotTokensCell(_props: {
  readonly row: BotUsageRow | undefined;
  readonly max: number;
}) {
  return null;
}

/** A bot's use of its daily budget as a meter; nothing for a bot without a budget. */
export function BotBudgetMeter(_props: { readonly botId: StubBotId }) {
  return null;
}

/** A bot's usage, for the aside of its Overview. */
export function BotUsageAside(_props: { readonly bot: StubBot }) {
  return null;
}
