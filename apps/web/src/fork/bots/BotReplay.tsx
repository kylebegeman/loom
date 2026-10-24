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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { RawReply } from "./BotFindings";
import { runInputSummary } from "./BotRuns";
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

const COMPARISONS: Record<
  BotReplayComparison,
  {
    readonly label: string;
    readonly variant: "secondary" | "success" | "error" | "warning" | "info";
  }
> = {
  fixed: { label: "Fixed", variant: "success" },
  broke: { label: "Broke", variant: "error" },
  same: { label: "Same", variant: "secondary" },
  changed: { label: "Changed", variant: "info" },
  pending: { label: "Waiting", variant: "secondary" },
  failed: { label: "Failed", variant: "error" },
};

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
}: {
  readonly title: string;
  readonly run: BotRun | undefined;
  readonly missing: string;
}) {
  if (run === undefined)
    return (
      <div className="grid gap-1 rounded-md bg-muted p-2 text-xs">
        <span className="text-muted-foreground">{title}</span>
        <span className="text-muted-foreground">{missing}</span>
      </div>
    );
  return (
    <div className="grid min-w-0 content-start gap-2 rounded-md bg-muted p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground">{title}</span>
        <BotRunStatusBadge status={run.status} />
        {run.verdict ? <VerdictChip verdict={run.verdict.verdict} /> : null}
      </div>
      <p className="text-muted-foreground">
        {runDurationLabel(run)} · {runTokensLabel(run)}
      </p>
      <p className="line-clamp-4 whitespace-pre-wrap wrap-anywhere">
        {run.error ??
          run.verdict?.summary ??
          run.result ??
          (run.status === "queued" || run.status === "running"
            ? "Waiting for a reply…"
            : "The bot gave no reply.")}
      </p>
      {run.result ? (
        <details>
          <summary className="cursor-pointer">Full reply</summary>
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
  return (
    <>
      <p role="status" className="text-sm">
        {current.status === "running"
          ? "Replaying. "
          : current.status === "cancelled"
            ? "Cancelled. "
            : "Done. "}
        {formatReplaySummary(current.summary)}
      </p>
      <ul aria-label="Replay comparisons" className="grid gap-2">
        {current.items.map((item) => {
          const original = runById.get(item.originalRunId);
          const after = item.replayRunId === null ? undefined : runById.get(item.replayRunId);
          const comparison = COMPARISONS[item.comparison];
          const metrics = replayMetricChanges(original, after);
          return (
            <li
              key={item.originalRunId}
              className={`grid gap-2 rounded-lg border border-border p-3 ${item.comparison === "fixed" ? "bg-success/5" : item.comparison === "broke" ? "bg-destructive/5" : item.comparison === "changed" ? "bg-muted/50" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={comparison.variant}>{comparison.label}</Badge>
                <span className="min-w-0 text-xs text-muted-foreground wrap-anywhere">
                  {original ? runInputSummary(original) || "No inputs" : item.originalRunId}
                </span>
              </div>
              {item.reason ? (
                <p className="text-sm text-destructive-foreground">{item.reason}</p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <RunOutcome
                  title="Before"
                  run={original}
                  missing="Original run no longer available"
                />
                <RunOutcome
                  title="After"
                  run={after}
                  missing={
                    item.replayRunId !== null
                      ? "Replay run unavailable. Refresh to reload."
                      : item.comparison === "pending" && current.status === "running"
                        ? "Not started"
                        : "No replay run"
                  }
                />
              </div>
              {metrics.duration || metrics.tokens ? (
                <p className="text-xs text-muted-foreground">
                  {[metrics.duration, metrics.tokens].filter((value) => value !== null).join(" · ")}
                </p>
              ) : null}
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
                variant="outline"
                className="sm:me-auto"
                disabled={!canRun || busy}
                onClick={() => void stop()}
              >
                Cancel replay
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={replayQuery.isPending || runsQuery.isPending}
              onClick={() => {
                replayQuery.refresh();
                runsQuery.refresh();
              }}
            >
              Refresh
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
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
      <div className="grid gap-3">
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
                  className="flex items-center gap-2 text-sm text-destructive-foreground"
                >
                  <p>{versionQuery.error}</p>
                  <Button size="xs" variant="outline" onClick={versionQuery.refresh}>
                    Reload version
                  </Button>
                </div>
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading v{source.version}…
                </p>
              )
            ) : null}
            {checkoutWarning ? (
              <div className="grid gap-2 rounded-lg bg-warning/10 p-3 text-sm">
                <p className="font-medium">Replay can change the project checkout</p>
                <p>{checkoutWarning}</p>
                <label className="flex items-start gap-2">
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
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="xs"
                variant="outline"
                disabled={busy || visible.length === 0}
                onClick={() => setSelected(visible.slice(0, 5))}
              >
                Select newest 5
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || visible.length === 0}
                onClick={() => setSelected(visible.slice(0, BOTS_REPLAY_MAX_RUNS))}
              >
                Select shown
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || chosen.length === 0}
                onClick={() => setSelected([])}
              >
                Clear selection
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {chosen.length}/{BOTS_REPLAY_MAX_RUNS} selected. Selections stay when you change pages
              or filters.
            </p>
            {chosen.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Selected runs
                </summary>
                <ul className="mt-2 grid gap-1" aria-label="Selected runs">
                  {chosen.map((run) => (
                    <li key={run.id} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">
                        {runInputSummary(run) || "No inputs"} · {runTime(run.createdAt)}
                      </span>
                      <Button
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
                className="flex items-center gap-2 text-sm text-destructive-foreground"
              >
                <p>{runsQuery.error}</p>
                <Button
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
              <p role="status" className="text-sm text-muted-foreground">
                Loading runs…
              </p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {candidates.length === 0
                  ? "No finished runs on this page. Try an older page or run the bot first."
                  : "No runs match these filters on this page."}
              </p>
            ) : (
              <fieldset className="grid gap-2" disabled={busy}>
                <legend className="mb-1 text-sm text-muted-foreground">
                  Choose up to {BOTS_REPLAY_MAX_RUNS} runs, newest first. Rated runs are chosen
                  initially.
                </legend>
                {visible.map((run) => {
                  const checked = chosen.some((candidate) => candidate.id === run.id);
                  return (
                    <label key={run.id} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        disabled={busy || (!checked && chosen.length >= BOTS_REPLAY_MAX_RUNS)}
                        onCheckedChange={(on) =>
                          setSelected(toggleReplaySelection(chosen, run, on === true))
                        }
                      />
                      <span className="grid min-w-0 gap-0.5">
                        <span className="flex flex-wrap items-center gap-1">
                          <BotRunStatusBadge status={run.status} />
                          {run.verdict ? <VerdictChip verdict={run.verdict.verdict} /> : null}
                          {run.rating ? (
                            <Badge variant={run.rating === "up" ? "success" : "error"}>
                              {run.rating === "up" ? "Good" : "Bad"}
                            </Badge>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            v{run.botVersion} · {runTime(run.finishedAt ?? run.createdAt)}
                          </span>
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {runInputSummary(run) || "No inputs"}
                        </span>
                        {run.note ? (
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {run.note}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {before === undefined ? "Newest page" : `Page ${cursors.length + 1}`} ·{" "}
                {visible.length} matching runs
              </span>
              <div className="flex gap-1">
                {before !== undefined ? (
                  <Button
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
