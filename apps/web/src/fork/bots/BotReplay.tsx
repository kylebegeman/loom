import { useEffect, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  BOTS_REPLAY_MAX_RUNS,
  type BotDefinition,
  type BotDefinitionInput,
  type BotReplay,
  type BotReplayComparison,
  type BotRun,
} from "@t3tools/contracts/fork";
import { applyRunChanges, formatReplaySummary } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { HistoryIcon, RefreshCwIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryDialog,
  LibraryField,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { ProgressBar, type ProgressTone } from "./BotBatches";
import { RawReply } from "./BotFindings";
import { BotsEmptyList, runInputSummary } from "./BotRuns";
import { BotRunStatusBadge, VerdictChip, runTime } from "./BotIdentity";
import {
  ALL_REPLAY_FILTERS,
  defaultReplaySelection,
  filterReplayCandidates,
  replayCandidates,
  replayCheckoutWarning,
  replayMetricChanges,
  replayRunsById,
  toggleReplaySelection,
  type ReplayFilters,
  type ReplayOutcomeFilter,
  type ReplayRatingFilter,
} from "./replay";
import { runDurationLabel, runTokensLabel } from "./runMetrics";
import { bots, useBotsChanges, useRefreshWhenBotsChangesPruned } from "./state";

export type BotReplaySourceChoice =
  | { readonly kind: "draft"; readonly draft: BotDefinitionInput }
  | { readonly kind: "version"; readonly version: number };

/** Comparisons in the order the bar and the summary read them: good news, then bad, then open. */
const COMPARISONS: Record<
  BotReplayComparison,
  { readonly label: string; readonly tone: ProgressTone }
> = {
  fixed: { label: "Fixed", tone: "success" },
  changed: { label: "Changed", tone: "active" },
  same: { label: "Same", tone: "neutral" },
  broke: { label: "Broke", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  pending: { label: "Waiting", tone: "waiting" },
};
const COMPARISON_ORDER = Object.keys(COMPARISONS) as ReadonlyArray<BotReplayComparison>;

const RUN_SKELETON_ROWS = ["first", "second", "third"];

const OUTCOME_FILTERS: ReadonlyArray<{
  readonly value: ReplayOutcomeFilter;
  readonly label: string;
}> = [
  { value: "all", label: "Any outcome" },
  { value: "pass", label: "Pass verdict" },
  { value: "fail", label: "Fail verdict" },
  { value: "needs_attention", label: "Needs attention verdict" },
  { value: "failed", label: "Failed or timed out" },
];
const RATING_FILTERS: ReadonlyArray<{
  readonly value: ReplayRatingFilter;
  readonly label: string;
}> = [
  { value: "all", label: "Any rating" },
  { value: "rated", label: "Rated" },
  { value: "up", label: "Good" },
  { value: "down", label: "Bad" },
  { value: "unrated", label: "Unrated" },
];

function ReplayRunFilters({
  value,
  onChange,
  disabled,
}: {
  readonly value: ReplayFilters;
  readonly onChange: (filters: ReplayFilters) => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <LibraryField label="Outcome">
        <Select
          value={value.outcome}
          disabled={disabled}
          onValueChange={(next) => {
            const outcome = OUTCOME_FILTERS.find((option) => option.value === next)?.value;
            if (outcome !== undefined) onChange({ ...value, outcome });
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {OUTCOME_FILTERS.find((option) => option.value === value.outcome)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {OUTCOME_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LibraryField>
      <LibraryField label="Rating">
        <Select
          value={value.rating}
          disabled={disabled}
          onValueChange={(next) => {
            const rating = RATING_FILTERS.find((option) => option.value === next)?.value;
            if (rating !== undefined) onChange({ ...value, rating });
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue>
              {RATING_FILTERS.find((option) => option.value === value.rating)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {RATING_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </LibraryField>
    </div>
  );
}

function RunOutcome({
  title,
  run,
  missing,
  className,
}: {
  readonly title: string;
  readonly run: BotRun | undefined;
  readonly missing: string;
  readonly className?: string;
}) {
  if (run === undefined)
    return (
      <div className={cn("flex min-w-0 flex-col gap-1 text-xs", className)}>
        <span className="font-medium text-muted-foreground">{title}</span>
        <span className="text-muted-foreground">{missing}</span>
      </div>
    );
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 text-xs", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-muted-foreground">{title}</span>
        <BotRunStatusBadge status={run.status} />
        {run.verdict ? <VerdictChip verdict={run.verdict.verdict} /> : null}
      </div>
      <p className="tabular-nums text-muted-foreground">
        {runDurationLabel(run)} · {runTokensLabel(run)}
      </p>
      <p className="line-clamp-4 text-sm whitespace-pre-wrap text-foreground/90 wrap-anywhere">
        {run.error ??
          run.verdict?.summary ??
          run.result ??
          (run.status === "queued" || run.status === "running"
            ? "Waiting for a reply…"
            : "The bot gave no reply.")}
      </p>
      {run.result ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Full reply
          </summary>
          <div className="mt-2">
            <RawReply run={run} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ReplayResults({
  current,
  runById,
}: {
  readonly current: BotReplay;
  readonly runById: ReadonlyMap<string, BotRun>;
}) {
  const counted = COMPARISON_ORDER.map((comparison) => ({
    key: comparison,
    tone: COMPARISONS[comparison].tone,
    count: current.items.filter((item) => item.comparison === comparison).length,
  }));
  return (
    <>
      <div className="flex flex-col gap-2">
        <p role="status" className="text-sm">
          <span className="font-medium">
            {current.status === "running"
              ? "Replaying. "
              : current.status === "cancelled"
                ? "Cancelled. "
                : "Done. "}
          </span>
          <span className="text-muted-foreground">{formatReplaySummary(current.summary)}</span>
        </p>
        <ProgressBar segments={counted} label={formatReplaySummary(current.summary)} />
      </div>
      <ul
        aria-label="Replay comparisons"
        className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}
      >
        {current.items.map((item) => {
          const original = runById.get(item.originalRunId);
          const after = item.replayRunId === null ? undefined : runById.get(item.replayRunId);
          const comparison = COMPARISONS[item.comparison];
          const metrics = replayMetricChanges(original, after);
          return (
            <li key={item.originalRunId} className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <LibraryStateBadge
                  tone={comparison.tone === "waiting" ? "neutral" : comparison.tone}
                >
                  {comparison.label}
                </LibraryStateBadge>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground wrap-anywhere">
                  {original ? runInputSummary(original) || "No inputs" : item.originalRunId}
                </span>
                {metrics.duration || metrics.tokens ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {[metrics.duration, metrics.tokens]
                      .filter((value) => value !== null)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
              {item.reason ? (
                <p className="text-sm text-destructive-foreground">{item.reason}</p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-border">
                <RunOutcome
                  title="Before"
                  run={original}
                  missing="Original run no longer available"
                  className="sm:pe-4"
                />
                <RunOutcome
                  title="After"
                  run={after}
                  className="sm:ps-4"
                  missing={
                    item.replayRunId !== null
                      ? "Replay run unavailable. Refresh to reload."
                      : item.comparison === "pending" && current.status === "running"
                        ? "Not started"
                        : "No replay run"
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Replays use the selected definition without saving it or changing the bot's settings. */
export function BotReplayDialog({
  environmentId,
  bot,
  source,
  canRun,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly source: BotReplaySourceChoice;
  readonly canRun: boolean;
  readonly onClose: () => void;
}) {
  const changes = useBotsChanges(environmentId, true);
  const [cursors, setCursors] = useState<ReadonlyArray<string>>([]);
  const before = cursors.at(-1);
  const runsQuery = useEnvironmentQuery(
    bots.listRuns({
      environmentId,
      input: {
        botId: bot.id,
        limit: BOTS_LIST_RUNS_MAX_LIMIT,
        ...(before === undefined ? {} : { before }),
      },
    }),
  );
  useRefreshWhenBotsChangesPruned(changes, runsQuery.refresh);
  const runs = applyRunChanges(runsQuery.data?.runs ?? [], changes, {
    botId: bot.id,
    includeNew: before === undefined,
    limit: BOTS_LIST_RUNS_MAX_LIMIT,
  });
  const candidates = replayCandidates(runs, bot.id);
  const [filters, setFilters] = useState<ReplayFilters>(ALL_REPLAY_FILTERS);
  const visible = filterReplayCandidates(candidates, filters);
  const [selected, setSelected] = useState<ReadonlyArray<BotRun> | null>(null);
  const defaultIds = defaultReplaySelection(candidates);
  const chosen =
    selected ?? (runsQuery.data ? candidates.filter((run) => defaultIds.includes(run.id)) : []);
  const [started, setStarted] = useState<BotReplay | null>(null);
  const [originals, setOriginals] = useState<ReadonlyArray<BotRun>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedCheckout, setConfirmedCheckout] = useState<string | null>(null);
  const versionQuery = useEnvironmentQuery(
    source.kind === "version"
      ? bots.version({ environmentId, input: { botId: bot.id, version: source.version } })
      : null,
  );
  const definition = source.kind === "draft" ? source.draft : versionQuery.data?.definition;
  const checkoutWarning = definition ? replayCheckoutWarning(definition) : null;
  const checkoutContext = definition
    ? JSON.stringify([
        definition.workspace,
        chosen.map((run) => [run.id, run.projectId, run.checkoutThreadId ?? null]),
      ])
    : null;
  const checkoutConfirmed = checkoutWarning === null || confirmedCheckout === checkoutContext;
  const replay = useAtomCommand(bots.replay, { reportFailure: false });
  const cancel = useAtomCommand(bots.cancelReplay, { reportFailure: false });
  const replayQuery = useEnvironmentQuery(
    started ? bots.getReplay({ environmentId, input: { replayId: started.id } }) : null,
  );
  const current = started && started.status !== "running" ? started : (replayQuery.data ?? started);
  const runById = replayRunsById(originals, runs, changes.runs.values());

  // The replay itself is not watched; its runs notify us when their comparisons have changed.
  const replayId = started?.id;
  const progress = [...changes.runs.values()]
    .filter((run) => replayId !== undefined && run.replayId === replayId)
    .map((run) => `${run.id}:${run.status}`)
    .join(",");
  const refreshReplay = replayQuery.refresh;
  const refreshRuns = runsQuery.refresh;
  const replayStatus = current?.status;
  // Refresh twice at most per replay to recover results missed by the watch, even after paging.
  useEffect(() => {
    if (replayId !== undefined && replayStatus !== undefined && before === undefined) refreshRuns();
  }, [replayId, replayStatus, before, refreshRuns]);
  useEffect(() => {
    if (progress !== "") refreshReplay();
  }, [progress, refreshReplay]);

  const start = async () => {
    if (!canRun || busy || chosen.length === 0 || !definition || !checkoutConfirmed) return;
    setBusy(true);
    setError(null);
    const result = await replay({
      environmentId,
      input: {
        botId: bot.id,
        runIds: chosen.map((run) => run.id),
        ...(source.kind === "draft" ? { draft: source.draft } : { version: source.version }),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not start the replay.");
      return;
    }
    setOriginals(chosen);
    setCursors([]);
    setStarted(result.value);
  };

  const stop = async () => {
    if (!canRun || !current || busy) return;
    setBusy(true);
    setError(null);
    const result = await cancel({ environmentId, input: { replayId: current.id } });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not cancel the replay.");
      return;
    }
    setStarted(result.value);
    replayQuery.refresh();
  };

  const changePage = (next: ReadonlyArray<string>) => {
    setSelected(chosen);
    setCursors(next);
  };
  const oldest = runs.at(-1)?.createdAt;
  const listedOldest = runsQuery.data?.runs.at(-1)?.createdAt;
  // A watched run can displace the fetched page's last row; it belongs on the next page.
  const hasOlderRuns =
    runsQuery.data?.hasMore ||
    (oldest !== undefined && listedOldest !== undefined && oldest > listedOldest);
  const sourceLabel =
    source.kind === "draft" ? "your unsaved edit" : `v${source.version} of ${bot.name}`;

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Replay ${bot.name}`}
      description={`Runs earlier inputs again with ${sourceLabel} and compares each result with the original. Replays count toward the bot's budget.`}
      actions={
        current ? (
          <>
            {current.status === "running" ? (
              <Button
                shape="pill"
                variant="outline"
                className="sm:me-auto"
                disabled={!canRun || busy}
                onClick={() => void stop()}
              >
                <SquareIcon />
                Cancel replay
              </Button>
            ) : null}
            <Button
              shape="pill"
              variant="ghost"
              disabled={replayQuery.isPending || runsQuery.isPending}
              onClick={() => {
                replayQuery.refresh();
                runsQuery.refresh();
              }}
            >
              <RefreshCwIcon />
              Refresh
            </Button>
            <Button shape="pill" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button shape="pill" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              shape="pill"
              disabled={!canRun || busy || chosen.length === 0 || !definition || !checkoutConfirmed}
              onClick={() => void start()}
            >
              {busy
                ? "Starting…"
                : chosen.length === 1
                  ? "Replay 1 run"
                  : `Replay ${chosen.length} runs`}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error || replayQuery.error || (current && runsQuery.error) ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error ?? replayQuery.error ?? runsQuery.error}
          </p>
        ) : null}
        {current ? (
          <ReplayResults current={current} runById={runById} />
        ) : (
          <>
            {source.kind === "version" && !definition ? (
              versionQuery.error ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 text-sm text-destructive-foreground"
                >
                  <p>{versionQuery.error}</p>
                  <Button shape="pill" size="xs" variant="outline" onClick={versionQuery.refresh}>
                    Reload version
                  </Button>
                </div>
              ) : (
                <div role="status" className="flex items-center gap-2">
                  <span className="sr-only">Loading v{source.version}…</span>
                  <Skeleton shape="pill" className="h-5 w-16" />
                  <Skeleton className="h-3 w-48" />
                </div>
              )
            ) : null}
            {checkoutWarning ? (
              <div className="flex flex-col gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
                <p className="flex items-center gap-2 font-medium">
                  <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
                  Replay can change the project checkout
                </p>
                <p className="text-foreground/90">{checkoutWarning}</p>
                <label className="flex cursor-pointer items-start gap-2.5 text-foreground">
                  <Checkbox
                    checked={checkoutConfirmed}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setConfirmedCheckout(checked === true ? checkoutContext : null)
                    }
                  />
                  <span>I understand that replaying can change files and repeat side effects.</span>
                </label>
              </div>
            ) : null}
            <ReplayRunFilters
              value={filters}
              onChange={(next) => {
                setSelected(chosen);
                setFilters(next);
              }}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  disabled={busy || visible.length === 0}
                  onClick={() => setSelected(visible.slice(0, 5))}
                >
                  Select newest 5
                </Button>
                <Button
                  shape="pill"
                  size="xs"
                  variant="ghost"
                  disabled={busy || visible.length === 0}
                  onClick={() => setSelected(visible.slice(0, BOTS_REPLAY_MAX_RUNS))}
                >
                  Select shown
                </Button>
                <Button
                  shape="pill"
                  size="xs"
                  variant="ghost"
                  disabled={busy || chosen.length === 0}
                  onClick={() => setSelected([])}
                >
                  Clear selection
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {chosen.length}/{BOTS_REPLAY_MAX_RUNS} selected.
                </span>{" "}
                Selections stay when you change pages or filters.
              </p>
            </div>
            {chosen.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Selected runs
                </summary>
                <ul
                  className="mt-2 flex flex-col divide-y divide-border rounded-xl border border-border"
                  aria-label="Selected runs"
                >
                  {chosen.map((run) => (
                    <li key={run.id} className="flex items-center gap-2 py-1 ps-3.5 pe-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">
                        {runInputSummary(run) || "No inputs"} · {runTime(run.createdAt)}
                      </span>
                      <Button
                        shape="pill"
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Remove run ${runInputSummary(run) || run.id}`}
                        onClick={() => setSelected(toggleReplaySelection(chosen, run, false))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {runsQuery.error ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 text-sm text-destructive-foreground"
              >
                <p>{runsQuery.error}</p>
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  disabled={runsQuery.isPending}
                  onClick={runsQuery.refresh}
                >
                  Reload runs
                </Button>
              </div>
            ) : null}
            {runsQuery.isPending && !runsQuery.data ? (
              <div
                role="status"
                aria-label="Loading runs"
                className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
              >
                {RUN_SKELETON_ROWS.map((row) => (
                  <div key={row} className="flex items-center gap-3 px-3.5 py-3">
                    <Skeleton shape="block" className="size-4" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3 w-1/3" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <BotsEmptyList
                icon={HistoryIcon}
                message={
                  candidates.length === 0
                    ? "No finished runs on this page. Try an older page or run the bot first."
                    : "No runs match these filters on this page."
                }
              />
            ) : (
              <fieldset className="flex min-w-0 flex-col gap-2" disabled={busy}>
                <legend className="mb-2 text-sm text-muted-foreground">
                  Choose up to {BOTS_REPLAY_MAX_RUNS} runs, newest first. Rated runs are chosen
                  initially.
                </legend>
                <div
                  className={cn(
                    LIBRARY_OUTLINE,
                    "flex max-h-80 flex-col divide-y divide-border overflow-y-auto",
                  )}
                >
                  {visible.map((run) => {
                    const checked = chosen.some((candidate) => candidate.id === run.id);
                    return (
                      <label
                        key={run.id}
                        className={cn(
                          "flex min-w-0 cursor-pointer items-start gap-3 px-3.5 py-2.5 transition-colors duration-150",
                          checked ? "bg-accent/50" : "hover:bg-accent/40",
                        )}
                      >
                        <span className="pt-0.5">
                          <Checkbox
                            checked={checked}
                            disabled={busy || (!checked && chosen.length >= BOTS_REPLAY_MAX_RUNS)}
                            onCheckedChange={(on) =>
                              setSelected(toggleReplaySelection(chosen, run, on === true))
                            }
                          />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm">
                            {runInputSummary(run) || "No inputs"}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            v{run.botVersion} · {runTime(run.finishedAt ?? run.createdAt)}
                          </span>
                          {run.note ? (
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                              {run.note}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {run.rating ? (
                            <LibraryStateBadge tone={run.rating === "up" ? "success" : "danger"}>
                              {run.rating === "up" ? "Good" : "Bad"}
                            </LibraryStateBadge>
                          ) : null}
                          {run.verdict ? <VerdictChip verdict={run.verdict.verdict} /> : null}
                          <BotRunStatusBadge status={run.status} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {before === undefined ? "Newest page" : `Page ${cursors.length + 1}`} ·{" "}
                {visible.length} matching runs
              </span>
              <div className="flex gap-1">
                {before !== undefined ? (
                  <Button
                    shape="pill"
                    size="xs"
                    variant="ghost"
                    disabled={busy || runsQuery.isPending}
                    onClick={() => changePage(cursors.slice(0, -1))}
                  >
                    Newer runs
                  </Button>
                ) : null}
                {hasOlderRuns && oldest !== undefined && oldest !== before ? (
                  <Button
                    shape="pill"
                    size="xs"
                    variant="outline"
                    disabled={busy || runsQuery.isPending}
                    onClick={() => changePage([...cursors, oldest])}
                  >
                    Older runs
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </LibraryDialog>
  );
}

// STUB(bots-redesign): replaced by the owning area's implementation.
/** The replay results sheet (`replay`), over whichever page is open. */
export function ReplayOverlays() {
  return null;
}
