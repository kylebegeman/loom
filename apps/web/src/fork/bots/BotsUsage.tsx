import { useContext, useEffect, useEffectEvent, useRef, type ContextType } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import type {
  BotBudgetState,
  BotDefinition,
  BotId,
  BotUsageRow,
  BotsUsageResult,
  LibraryProjectColor,
} from "@t3tools/contracts/fork";
import { rollingBotsUsageWindow, type BotsUsageWindow } from "@t3tools/client-runtime/fork";
import { formatCount, formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { GaugeIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import {
  LibraryErrorNotice,
  LibraryGroupHeading,
  LibrarySpecSheet,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { LibraryBar, LibraryMeter } from "../project-library/LibraryData";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { useBotsNavigation } from "./navigation";
import { formatDuration } from "./runMetrics";
import { bots, useBotsAccess, useBotsHost } from "./state";
import {
  BOT_USAGE_DAYS,
  BUDGET_WARN_SHARE,
  DEFAULT_BOT_USAGE_DAYS,
  USAGE_REFETCH_INTERVAL_MS,
  advanceUsageWindow,
  budgetAlertText,
  budgetAlerts,
  budgetCaption,
  budgetMeterText,
  budgetStatus,
  budgetUseText,
  emptyUsageRow,
  finishedRunsSignature,
  nextBudgetRetryMs,
  outcomeText,
  planUsageRefetch,
  tokenShare,
  tokensText,
  type BotUsageDays,
  type UsageFetchLedger,
  usageClauseText,
  usageRate,
  usageWindowPhrase,
  usageWindowShort,
  verdictText,
} from "./usageWindow";

export type { BotUsageDays };

/** The Bots page's own ink, so a token bar reads the same inside any bot's colour scope. */
const BOTS_COLOR: LibraryProjectColor = "plum";

/** As long as a query lingers once nothing shows it, so a quick return reuses it. */
const USAGE_IDLE_TTL_MS = 5 * 60_000;

/** A limited bot's state clears just after its retry time, not a hair before it. */
const RETRY_SLACK_MS = 1_000;

/** Every view of the same window reads this one window, so they all share one usage query. */
const usageWindowAtom = Atom.family((days: BotUsageDays) =>
  Atom.writable(
    () => rollingBotsUsageWindow(days, Date.now()),
    (ctx, window: BotsUsageWindow) => ctx.setSelf(window),
  ).pipe(Atom.setIdleTTL(USAGE_IDLE_TTL_MS), Atom.withLabel(`loom:bots:usage-window:${days}`)),
);

interface UsageView {
  readonly usage: BotsUsageResult | null;
  readonly window: BotsUsageWindow;
  readonly error: string | null;
  readonly isPending: boolean;
}

const usageKey = (environmentId: EnvironmentId, days: BotUsageDays) => `${environmentId}|${days}`;

/**
 * One environment's usage over one window. Moving to the next minute's window starts a new
 * query; the last numbers stay up while it loads, so nothing blanks on a refetch.
 */
const usageViewAtom = Atom.family((key: string) => {
  const split = key.lastIndexOf("|");
  const environmentId = EnvironmentId.make(key.slice(0, split));
  const days =
    BOT_USAGE_DAYS.find((entry) => String(entry) === key.slice(split + 1)) ??
    DEFAULT_BOT_USAGE_DAYS;
  return Atom.make((get): UsageView | null => {
    const window = get(usageWindowAtom(days));
    const result = get(bots.usage({ environmentId, input: window }));
    const usage =
      Option.getOrNull(AsyncResult.value(result)) ??
      Option.match(get.self<UsageView | null>(), {
        onNone: () => null,
        onSome: (previous) => previous?.usage ?? null,
      });
    return {
      usage,
      window,
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
      isPending: result.waiting,
    };
  }).pipe(Atom.setIdleTTL(USAGE_IDLE_TTL_MS), Atom.withLabel(`loom:bots:usage-view:${key}`));
});
const NO_USAGE_VIEW = Atom.make<UsageView | null>(null);

const NO_FINISHED_RUNS = finishedRunsSignature([]);
/** Changes only when a run finishes, so a view re-renders on that and not on every run event. */
const finishedRunsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    Option.match(AsyncResult.value(get(bots.changes({ environmentId, input: {} }))), {
      onNone: () => NO_FINISHED_RUNS,
      onSome: (changes) => finishedRunsSignature(changes.runs.values()),
    }),
  ),
);
const IDLE_FINISHED_RUNS = Atom.make(NO_FINISHED_RUNS);

/** What each window's last fetch counted, shared by every view so only one of them refetches. */
const ledgers = new Map<string, UsageFetchLedger>();

type Registry = ContextType<typeof RegistryContext>;

/** Refetches the window ending now: the same query within the minute, the next one after it. */
function refetchUsage(
  registry: Registry,
  environmentId: EnvironmentId,
  days: BotUsageDays,
  signature: string,
) {
  const windowAtom = usageWindowAtom(days);
  const current = registry.get(windowAtom);
  const nowMs = Date.now();
  const next = advanceUsageWindow(current, days, nowMs);
  ledgers.set(usageKey(environmentId, days), { until: next.until, signature, fetchedAt: nowMs });
  if (next === current) registry.refresh(bots.usage({ environmentId, input: current }));
  else registry.set(windowAtom, next);
}

const USAGE_DAYS_KEY = "loom:bots:usage-days:v1";
const UsageDays = Schema.Literals(BOT_USAGE_DAYS);

/**
 * The usage window the Bots pages read, chosen once: the index's Display menu and a bot's Usage
 * aside set the same one, so a figure covers the same span wherever it appears.
 */
export function useBotUsageWindow() {
  return useLocalStorage(USAGE_DAYS_KEY, DEFAULT_BOT_USAGE_DAYS, UsageDays);
}

/**
 * The host's bot usage over the window ending now, shared by every view that asks for the same
 * window. Refetched as runs finish, at most once per interval, and when a limited bot may run
 * again. `rowOf` and `budgetOf` are undefined until the usage arrives.
 */
export function useBotUsage(days: BotUsageDays): {
  readonly usage: BotsUsageResult | null;
  readonly rowOf: (botId: BotId) => BotUsageRow | undefined;
  readonly budgetOf: (botId: BotId) => BotBudgetState | undefined;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const host = useBotsHost();
  const environmentId =
    host.environmentId !== null && host.supported && host.budgetsSupported
      ? host.environmentId
      : null;
  const key = environmentId === null ? null : usageKey(environmentId, days);
  const view = useAtomValue(key === null ? NO_USAGE_VIEW : usageViewAtom(key));
  const watching = environmentId !== null && host.connected;
  const signature = useAtomValue(watching ? finishedRunsAtom(environmentId) : IDLE_FINISHED_RUNS);
  const registry = useContext(RegistryContext);
  const until = view?.window.until ?? null;

  const refetch = useEffectEvent(() => {
    if (environmentId !== null) refetchUsage(registry, environmentId, days, signature);
  });

  const plan = useEffectEvent((key: string, until: string, signature: string) => {
    const next = planUsageRefetch(ledgers.get(key), until, signature, Date.now());
    if (next.kind === "adopt") ledgers.set(key, { until, signature, fetchedAt: Date.now() });
    if (next.kind === "now") refetch();
    return next;
  });

  // A finished run changes the numbers.
  useEffect(() => {
    if (!watching || key === null || until === null) return;
    const next = plan(key, until, signature);
    if (next.kind !== "wait") return;
    const timer = setTimeout(() => void plan(key, until, signature), next.ms);
    return () => clearTimeout(timer);
  }, [watching, key, until, signature]);

  // Runs may have finished while the host was away.
  const wasConnected = useRef(host.connected);
  const reconnected = useEffectEvent(() => {
    const ledger = key === null ? undefined : ledgers.get(key);
    if (ledger !== undefined && Date.now() - ledger.fetchedAt >= USAGE_REFETCH_INTERVAL_MS)
      refetch();
  });
  useEffect(() => {
    if (host.connected && !wasConnected.current) reconnected();
    wasConnected.current = host.connected;
  }, [host.connected]);

  // A bot at its limit may run again at its retry time; nothing else would refetch then.
  const budgets = view?.usage?.budgets;
  const retryReached = useEffectEvent((at: number) => {
    const ledger = key === null ? undefined : ledgers.get(key);
    if (ledger === undefined || ledger.fetchedAt < at) refetch();
  });
  useEffect(() => {
    if (!watching || budgets === undefined) return;
    const at = nextBudgetRetryMs(budgets, Date.now());
    if (at === null) return;
    const timer = setTimeout(() => retryReached(at), at - Date.now() + RETRY_SLACK_MS);
    return () => clearTimeout(timer);
  }, [watching, budgets]);

  const usage = view?.usage ?? null;
  const rows = new Map(usage?.rows.map((row) => [row.botId, row]));
  return {
    usage,
    rowOf: (botId) => (usage === null ? undefined : (rows.get(botId) ?? emptyUsageRow(botId))),
    budgetOf: (botId) => usage?.budgets[botId],
    isPending: view?.isPending ?? false,
    error: view?.error ?? null,
    refresh: () => {
      if (environmentId !== null) refetchUsage(registry, environmentId, days, signature);
    },
  };
}

/** Who is at or near a limit, by name, for the header badge's tooltip. */
function budgetAlertLines(usage: BotsUsageResult) {
  const names = new Map<string, string>(usage.rows.map((row) => [row.botId, row.botName]));
  return Object.entries(usage.budgets)
    .filter(([, state]) => budgetStatus(state).level !== "ok")
    .map(([botId, state]) => ({
      botId,
      text: `${names.get(botId) || "A bot"}: ${budgetCaption(state)}`,
    }));
}

/** The index header's usage clause, such as "142 runs in 7 days · at least 3.2M tokens". */
export function BotsUsageClause({ days }: { readonly days: BotUsageDays }) {
  const { usage, isPending, error, refresh } = useBotUsage(days);
  if (usage === null) {
    if (error)
      return (
        <span className="inline-flex items-center gap-1.5">
          Usage unavailable
          <Button shape="pill" size="micro" variant="ghost" onClick={refresh}>
            Try again
          </Button>
        </span>
      );
    // Holds the line's height so the header does not shift when the numbers arrive.
    return isPending ? <span aria-hidden className="inline-block h-5" /> : null;
  }
  const alert = budgetAlertText(budgetAlerts(usage.budgets));
  return (
    <span className="inline-flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="tabular-nums">{usageClauseText(usage.totals, days)}</span>
      {alert ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <LibraryStateBadge tone="warning" icon={GaugeIcon}>
              {alert}
            </LibraryStateBadge>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <ul className="flex flex-col gap-0.5">
              {budgetAlertLines(usage).map((line) => (
                <li key={line.botId}>{line.text}</li>
              ))}
            </ul>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** A bot's tokens in the window as a figure over a bar scaled to the largest, for the list view. */
export function BotTokensCell({
  row,
  max,
}: {
  readonly row: BotUsageRow | undefined;
  readonly max: number;
}) {
  const share = row === undefined ? 0 : tokenShare(row.tokens.total, max);
  return (
    <span
      style={projectColorStyle(BOTS_COLOR)}
      className="flex w-full min-w-16 flex-col items-end gap-1"
    >
      {row === undefined ? (
        // Static rather than shimmering: the row stays undefined when usage failed to load, too.
        <span className="h-5 w-10 rounded-sm bg-muted dark:bg-accent">
          <span className="sr-only">No token figure yet</span>
        </span>
      ) : (
        <span
          className={cn(
            "text-sm leading-5 tabular-nums",
            row.tokens.total === 0 && "text-muted-foreground",
          )}
        >
          {row.usageComplete ? null : (
            <>
              <span aria-hidden className="text-muted-foreground">
                ≥{" "}
              </span>
              <span className="sr-only">at least </span>
            </>
          )}
          {formatTokens(row.tokens.total)}
          <span className="sr-only"> tokens</span>
        </span>
      )}
      <span
        aria-hidden
        className="relative block h-1 w-full overflow-hidden rounded-full bg-muted dark:bg-accent"
      >
        {share > 0 ? (
          <span
            className="absolute inset-y-0 start-0 rounded-full bg-(--project-color)/70"
            style={{ width: `${share * 100}%` }}
          />
        ) : null}
      </span>
    </span>
  );
}

/** One limit's meter, labelled with the whole budget sentence for screen readers. */
function BudgetLimitMeter({
  state,
  limit,
  label,
}: {
  readonly state: BotBudgetState;
  readonly limit: "runs" | "tokens";
  readonly label: string;
}) {
  const value = limit === "runs" ? state.runsInWindow : state.tokensInWindow;
  const max = (limit === "runs" ? state.runsPerDay : state.tokensPerDay) ?? 0;
  const share = max > 0 ? value / max : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
        <span className="shrink-0 text-muted-foreground">{label}</span>
        <span
          className={cn(
            "min-w-0 truncate tabular-nums",
            share >= BUDGET_WARN_SHARE ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {budgetUseText(state, limit)}
        </span>
      </div>
      <LibraryMeter value={value} max={max} label={`${label}: ${budgetMeterText(state)}`} />
    </div>
  );
}

function MeterSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-1">
      <div className="flex justify-between">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton shape="pill" className="h-1.5 w-full" />
    </div>
  );
}

/**
 * A bot's use of its daily budget as a meter on its tighter limit; nothing for a bot without a
 * budget. Pass the page's usage window as `days` so the meter reads the page's query.
 */
export function BotBudgetMeter({
  botId,
  days = DEFAULT_BOT_USAGE_DAYS,
}: {
  readonly botId: BotId;
  readonly days?: BotUsageDays;
}) {
  const host = useBotsHost();
  const { usage, budgetOf } = useBotUsage(days);
  // The definition says whether a meter is coming, so a card keeps its height while usage loads.
  const list = useEnvironmentQuery(
    usage === null && host.environmentId !== null && host.supported
      ? bots.list({ environmentId: host.environmentId, input: {} })
      : null,
  );
  const state = budgetOf(botId);
  if (state === undefined) {
    const budgeted = list.data?.bots.some((bot) => bot.id === botId && bot.budget !== undefined);
    return usage === null && budgeted && host.budgetsSupported ? <MeterSkeleton /> : null;
  }
  const status = budgetStatus(state);
  if (status.limit === null) return null;
  const value = status.limit === "runs" ? state.runsInWindow : state.tokensInWindow;
  const max = (status.limit === "runs" ? state.runsPerDay : state.tokensPerDay) ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
        <span className="shrink-0 text-muted-foreground">Daily budget</span>
        <span
          className={cn(
            "min-w-0 truncate tabular-nums",
            status.level === "ok" ? "text-muted-foreground" : "font-medium text-foreground",
          )}
        >
          {budgetCaption(state)}
        </span>
      </div>
      <LibraryMeter value={value} max={max} label={budgetMeterText(state)} />
    </div>
  );
}

const ASIDE_SKELETON_ROWS = ["runs", "outcomes", "rate", "duration", "tokens"];

function UsageAsideSkeleton() {
  return (
    <div role="status" aria-label="Loading usage" className="flex flex-col divide-y divide-border">
      {ASIDE_SKELETON_ROWS.map((row) => (
        <div key={row} className="flex items-center justify-between gap-4 py-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function usageRows(row: BotUsageRow) {
  const rate = usageRate(row);
  const verdicts = verdictText(row);
  return [
    {
      label: "Runs",
      value: row.replays
        ? `${formatCount(row.runs)} · ${formatCount(row.replays)} ${row.replays === 1 ? "replay" : "replays"}`
        : formatCount(row.runs),
    },
    { label: "Outcomes", value: outcomeText(row) },
    ...(verdicts ? [{ label: "Verdicts", value: verdicts }] : []),
    ...(rate ? [{ label: rate.label, value: formatPercent(rate.share, 0) }] : []),
    ...(row.medianDurationMs === null
      ? []
      : [
          {
            label: "Duration",
            value:
              row.maxDurationMs === null
                ? `${formatDuration(row.medianDurationMs)} median`
                : `${formatDuration(row.medianDurationMs)} median · ${formatDuration(row.maxDurationMs)} max`,
          },
        ]),
    { label: "Tokens", value: tokensText(row.tokens.total, row.usageComplete) },
    {
      label: "Input",
      value: row.tokens.cachedInput
        ? `${formatTokens(row.tokens.input)} · ${formatTokens(row.tokens.cachedInput)} cached`
        : formatTokens(row.tokens.input),
    },
    { label: "Output", value: formatTokens(row.tokens.output) },
  ];
}

function ModelUsage({ row }: { readonly row: BotUsageRow }) {
  const busiest = Math.max(0, ...row.byModel.map((model) => model.totalTokens));
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">By model</h3>
      <ul className="flex flex-col gap-2">
        {row.byModel.map((model) => (
          <li
            key={`${model.assumed ? "assumed" : "recorded"}:${model.model}`}
            className="flex min-w-0 flex-col gap-1 text-xs"
          >
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-mono">
                {model.model}
                {model.assumed ? (
                  <span className="font-sans text-muted-foreground"> · assumed</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCount(model.runs)} {model.runs === 1 ? "run" : "runs"}
                {model.successRate === null ? "" : ` · ${formatPercent(model.successRate, 0)}`}
              </span>
            </span>
            <LibraryBar share={tokenShare(model.totalTokens, busiest)}>
              {formatTokens(model.totalTokens)}
            </LibraryBar>
          </li>
        ))}
      </ul>
      {row.byModel.some((model) => model.assumed) ? (
        <p className="text-xs text-muted-foreground">
          Older runs did not record their model; they count under the current one.
        </p>
      ) : null}
    </div>
  );
}

function BudgetBlock({
  bot,
  state,
  loading,
}: {
  readonly bot: BotDefinition;
  readonly state: BotBudgetState | undefined;
  readonly loading: boolean;
}) {
  const nav = useBotsNavigation();
  const { canSave } = useBotsAccess();
  const limits = state === undefined ? null : budgetStatus(state);
  const hasBudget = state !== undefined ? limits?.limit !== null : bot.budget !== undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Daily budget</h3>
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          disabled={!canSave}
          onClick={() => nav.open({ bot: bot.id, edit: true })}
        >
          {hasBudget ? "Edit budget" : "Set a budget"}
        </Button>
      </div>
      {state === undefined ? (
        loading && bot.budget !== undefined ? (
          <MeterSkeleton />
        ) : (
          <p className="text-xs text-muted-foreground">No daily limit.</p>
        )
      ) : limits?.limit === null ? (
        <p className="text-xs text-muted-foreground">No daily limit.</p>
      ) : (
        <>
          {state.runsPerDay === undefined ? null : (
            <BudgetLimitMeter state={state} limit="runs" label="Runs" />
          )}
          {state.tokensPerDay === undefined ? null : (
            <BudgetLimitMeter state={state} limit="tokens" label="Tokens" />
          )}
          <p className="text-xs text-muted-foreground">
            {limits?.level === "blocked" ? budgetCaption(state) : "Over the last 24 hours."}
          </p>
        </>
      )}
    </div>
  );
}

/** A bot's usage, for the aside of its Overview. */
export function BotUsageAside({ bot }: { readonly bot: BotDefinition }) {
  const host = useBotsHost();
  // The hero's vitals read this window too, so this toggle is the bot page's one window control.
  const [days, setDays] = useBotUsageWindow();
  const { usage, rowOf, budgetOf, error, refresh } = useBotUsage(days);
  if (!host.supported || !host.budgetsSupported) return null;
  const row = rowOf(bot.id);
  return (
    <section aria-label="Usage" className="flex flex-col gap-3">
      <LibraryGroupHeading
        title="Usage"
        action={
          <ToggleGroup
            shape="pill"
            variant="segmented"
            aria-label="Usage window"
            value={[String(days)]}
            onValueChange={(next) => {
              const choice = BOT_USAGE_DAYS.find((entry) => String(entry) === next[0]);
              if (choice) setDays(choice);
            }}
          >
            {BOT_USAGE_DAYS.map((entry) => (
              <ToggleGroupItem key={entry} value={String(entry)}>
                {usageWindowShort(entry)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <LibraryErrorNotice error={error} onRetry={refresh} />
      {row === undefined ? (
        error ? null : (
          <UsageAsideSkeleton />
        )
      ) : row.runs === 0 ? (
        <p className="text-xs text-muted-foreground">No runs {usageWindowPhrase(days)}.</p>
      ) : (
        <>
          <LibrarySpecSheet label={`Usage ${usageWindowPhrase(days)}`} rows={usageRows(row)} />
          {row.byModel.length > 0 ? <ModelUsage row={row} /> : null}
        </>
      )}
      <BudgetBlock bot={bot} state={budgetOf(bot.id)} loading={usage === null && !error} />
    </section>
  );
}
