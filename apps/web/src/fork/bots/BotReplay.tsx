import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  BOTS_REPLAY_MAX_RUNS,
  type BotDefinition,
  type BotDefinitionInput,
  type BotReplay,
  type BotReplayComparison,
  type BotReplayItem,
  type BotRun,
} from "@t3tools/contracts/fork";
import { applyRunChanges, type LibraryWorkflowTone } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  BadgeCheckIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryDialog,
  LibraryErrorNotice,
  LibraryNotice,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { TickStrip } from "../project-library/LibraryData";
import { BotRunStatusBadge, VerdictChip, runTime } from "./BotIdentity";
import { botsRoute } from "./botsRoute";
import { botsPageOf, useBotsNavigation } from "./navigation";
import {
  ALL_REPLAY_FILTERS,
  currentReplay,
  defaultReplaySelection,
  filterReplayCandidates,
  replayCandidates,
  replayCheckoutWarning,
  replayHeadline,
  replayInputSummary,
  replayMetricChanges,
  replayRest,
  replayRunsById,
  replayTally,
  toggleReplaySelection,
  type ReplayFilters,
  type ReplayOutcomeFilter,
  type ReplayRatingFilter,
} from "./replay";
import { runDurationLabel, runTokensLabel } from "./runMetrics";
import { bots, useBots, useBotsAccess, useRefreshWhenBotsChangesPruned } from "./state";

export type BotReplaySourceChoice =
  | { readonly kind: "draft"; readonly draft: BotDefinitionInput }
  | { readonly kind: "version"; readonly version: number };

const failureText = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/** Asks before a change that replaces work or makes a new version. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button shape="pill" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            shape="pill"
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/**
 * What a replay started on this page knows that the server does not return: the original runs
 * as they were chosen, which the replay's own runs push off the newest page.
 */
interface ReplaySession {
  readonly replay: BotReplay;
  readonly originals: ReadonlyArray<BotRun>;
}
const REPLAY_SESSIONS_KEPT = 20;
const replaySessions = new Map<string, ReplaySession>();
const sessionListeners = new Set<() => void>();
const rememberReplay = (session: ReplaySession) => {
  replaySessions.delete(session.replay.id);
  replaySessions.set(session.replay.id, session);
  for (const id of replaySessions.keys()) {
    if (replaySessions.size <= REPLAY_SESSIONS_KEPT) break;
    replaySessions.delete(id);
  }
  for (const listener of sessionListeners) listener();
};
const subscribeToSessions = (listener: () => void) => {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
};
const latestReplayId = (botId: string): string | null => {
  let latest: string | null = null;
  for (const session of replaySessions.values())
    if (session.replay.botId === botId) latest = session.replay.id;
  return latest;
};

/** The newest replay of a bot started on this page, so its results can be opened again. */
export function useLatestReplayId(botId: string | null) {
  return useSyncExternalStore(subscribeToSessions, () =>
    botId === null ? null : latestReplayId(botId),
  );
}

/** Comparisons as the strip and the badges read them: good news, then bad, then open. */
const COMPARISONS: Record<
  BotReplayComparison,
  { readonly label: string; readonly tone: LibraryWorkflowTone | null }
> = {
  fixed: { label: "Better", tone: "success" },
  changed: { label: "Changed", tone: "active" },
  same: { label: "Same", tone: "neutral" },
  broke: { label: "Worse", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  pending: { label: "Waiting", tone: null },
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

function FilterSelect<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next)?.value;
        if (chosen !== undefined) onChange(chosen);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue>{options.find((option) => option.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const RUN_SKELETON_ROWS = ["first", "second", "third"];
const inputsText = (run: BotRun) => replayInputSummary(run) || "No inputs";

/**
 * Chooses past runs to try again with an unsaved edit or an older version. The replay then
 * opens as its own sheet, so its results survive closing this dialog and can be linked to.
 */
export function ReplayLaunchDialog({
  environmentId,
  bot,
  source,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly source: BotReplaySourceChoice;
  readonly onClose: () => void;
}) {
  const nav = useBotsNavigation();
  const { changes } = useBots();
  const { canReplay } = useBotsAccess();
  const [cursors, setCursors] = useState<ReadonlyArray<string>>([]);
  const before = cursors.at(-1);
  const runsQuery = useEnvironmentQuery(
    bots.listRuns({
      environmentId,
      input: {
        limit: BOTS_LIST_RUNS_MAX_LIMIT,
        botId: bot.id,
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
  const hidden = chosen.filter((run) => !visible.some((candidate) => candidate.id === run.id));
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
  // A confirmation covers one workspace and one set of checkouts; changing either asks again.
  const checkoutContext = definition
    ? JSON.stringify([
        definition.workspace,
        chosen.map((run) => [run.id, run.projectId, run.checkoutThreadId ?? null]),
      ])
    : null;
  const checkoutConfirmed = checkoutWarning === null || confirmedCheckout === checkoutContext;
  const replay = useAtomCommand(bots.replay, { reportFailure: false });
  const ready = canReplay && !busy && chosen.length > 0 && definition !== undefined;

  const start = async () => {
    if (!ready || !checkoutConfirmed) return;
    setBusy(true);
    setError(null);
    await replay({
      environmentId,
      input: {
        botId: bot.id,
        runIds: chosen.map((run) => run.id),
        ...(source.kind === "draft" ? { draft: source.draft } : { version: source.version }),
      },
    })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        rememberReplay({ replay: result.value, originals: chosen });
        onClose();
        nav.overlay({ replay: result.value.id });
      })
      .catch((cause: unknown) => {
        setError(failureText(cause, "Could not start the replay."));
        setBusy(false);
      });
  };

  const keepChoice = () => setSelected(chosen);
  const changePage = (next: ReadonlyArray<string>) => {
    keepChoice();
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
        if (!open && !busy) onClose();
      }}
      title={source.kind === "draft" ? "Try your edit on past runs" : `Replay v${source.version}`}
      description={`Runs earlier inputs again with ${sourceLabel} and compares each result with the original. Nothing is saved, and replays count toward the bot's budget.`}
      actions={
        <>
          <Button shape="pill" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button shape="pill" disabled={!ready || !checkoutConfirmed} onClick={() => void start()}>
            {busy
              ? "Starting…"
              : chosen.length === 1
                ? "Replay 1 run"
                : `Replay ${chosen.length} runs`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <LibraryErrorNotice error={error} />
        {!canReplay ? (
          <p className="text-sm text-muted-foreground">
            This connection cannot replay runs. Reconnect, or use a connection that can.
          </p>
        ) : null}
        {source.kind === "version" && !definition ? (
          versionQuery.error ? (
            <LibraryErrorNotice error={versionQuery.error} onRetry={versionQuery.refresh} />
          ) : (
            <div role="status" className="flex items-center gap-2">
              <span className="sr-only">Loading v{source.version}…</span>
              <Skeleton shape="pill" className="h-5 w-16" />
              <Skeleton className="h-3 w-48" />
            </div>
          )
        ) : null}
        {checkoutWarning ? (
          <div className="flex flex-col gap-2">
            <LibraryNotice icon={TriangleAlertIcon} tone="warning">
              {checkoutWarning}
            </LibraryNotice>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <FilterSelect
              label="Outcome"
              value={filters.outcome}
              options={OUTCOME_FILTERS}
              disabled={busy}
              onChange={(outcome) => {
                keepChoice();
                setFilters({ ...filters, outcome });
              }}
            />
          </div>
          <div className="w-36">
            <FilterSelect
              label="Rating"
              value={filters.rating}
              options={RATING_FILTERS}
              disabled={busy}
              onChange={(rating) => {
                keepChoice();
                setFilters({ ...filters, rating });
              }}
            />
          </div>
          <span className="ms-auto text-xs tabular-nums text-muted-foreground">
            {chosen.length}/{BOTS_REPLAY_MAX_RUNS} selected
          </span>
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
            Clear
          </Button>
        </div>
        {hidden.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              Also selected, from other pages or filters:
            </p>
            <ul aria-label="Selected runs" className="flex flex-wrap gap-1.5">
              {hidden.map((run) => (
                <li key={run.id}>
                  <Button
                    shape="pill"
                    size="xs"
                    variant="secondary"
                    disabled={busy}
                    aria-label={`Remove ${inputsText(run)} from the replay`}
                    onClick={() => setSelected(toggleReplaySelection(chosen, run, false))}
                  >
                    <span className="max-w-48 truncate">{inputsText(run)}</span>
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <LibraryErrorNotice error={runsQuery.error} onRetry={runsQuery.refresh} />
        {runsQuery.isPending && !runsQuery.data ? (
          <div
            role="status"
            aria-label="Loading runs"
            className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
          >
            {RUN_SKELETON_ROWS.map((row) => (
              <div key={row} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="size-4" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : runsQuery.error && !runsQuery.data ? null : visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {candidates.length === 0
              ? "No finished runs on this page. Try an older page, or run the bot first."
              : "No runs match these filters on this page."}
          </p>
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-2" disabled={busy}>
            <legend className="mb-2 text-xs text-muted-foreground">
              Up to {BOTS_REPLAY_MAX_RUNS} runs, newest first. Rated runs start selected, since they
              say what good and bad look like.
            </legend>
            <div className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}>
              {visible.map((run) => {
                const checked = chosen.some((candidate) => candidate.id === run.id);
                return (
                  <label
                    key={run.id}
                    className="flex min-w-0 cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-accent/40 has-data-checked:bg-accent/40"
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
                      <span className="truncate text-sm">{inputsText(run)}</span>
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
            {visible.length === 1 ? "1 matching run" : `${visible.length} matching runs`}
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
      </div>
    </LibraryDialog>
  );
}

/** Both replies as a line diff, rendered only once asked for since the diff is heavy. */
function ReplyDiff({ before, after }: { readonly before: string; readonly after: string }) {
  const { resolvedTheme } = useTheme();
  const diff = parseDiffFromFile(
    { name: "reply.md", contents: before },
    { name: "reply.md", contents: after },
  );
  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-border text-xs">
      <FileDiff
        fileDiff={diff}
        options={{
          diffStyle: "unified",
          theme: resolveDiffThemeName(resolvedTheme),
          overflow: "wrap",
        }}
      />
    </div>
  );
}

/** One side of a comparison: how the run ended, what it cost, and what it said. */
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
  const nav = useBotsNavigation();
  if (run === undefined)
    return (
      <div className={cn("flex min-w-0 flex-col gap-1 text-xs", className)}>
        <span className="font-medium text-muted-foreground">{title}</span>
        <span className="text-muted-foreground">{missing}</span>
      </div>
    );
  const reply =
    run.error ??
    run.verdict?.summary ??
    run.result ??
    (run.status === "queued" || run.status === "running"
      ? "Waiting for a reply…"
      : "The bot gave no reply.");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 text-xs", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-muted-foreground">{title}</span>
        <BotRunStatusBadge status={run.status} />
        {run.verdict ? <VerdictChip verdict={run.verdict.verdict} /> : null}
        <Link
          to="/loom/bots"
          search={{ ...botsPageOf(nav.search), runId: run.id }}
          replace
          className="ms-auto rounded-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          Open run
        </Link>
      </div>
      <p className="tabular-nums text-muted-foreground">
        {runDurationLabel(run)} · {runTokensLabel(run)}
      </p>
      <p className="line-clamp-4 text-sm whitespace-pre-wrap text-foreground/90 wrap-anywhere">
        {reply}
      </p>
      {run.result && run.result !== reply ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Full reply
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-border px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">
            {run.result}
            {run.resultTruncated ? "\n\n[Reply shortened. Open the run for the full text.]" : ""}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

/** A run the replay names but this page has not seen, fetched on its own. */
function useReplayRun(
  environmentId: EnvironmentId,
  runId: string | null,
  known: BotRun | undefined,
) {
  const query = useEnvironmentQuery(
    runId !== null && known === undefined ? bots.getRun({ environmentId, input: { runId } }) : null,
  );
  return {
    run: known ?? query.data?.run ?? undefined,
    gone: known === undefined && query.data !== null && query.data.run === null,
  };
}

function ComparisonRow({
  environmentId,
  item,
  index,
  replayRunning,
  runById,
}: {
  readonly environmentId: EnvironmentId;
  readonly item: BotReplayItem;
  readonly index: number;
  readonly replayRunning: boolean;
  readonly runById: ReadonlyMap<string, BotRun>;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const original = useReplayRun(environmentId, item.originalRunId, runById.get(item.originalRunId));
  const replayed = useReplayRun(
    environmentId,
    item.replayRunId,
    item.replayRunId === null ? undefined : runById.get(item.replayRunId),
  );
  const comparison = COMPARISONS[item.comparison];
  const metrics = replayMetricChanges(original.run, replayed.run);
  const before = original.run?.result ?? null;
  const after = replayed.run?.result ?? null;
  const canDiff = before !== null && after !== null && before !== after;
  return (
    <li id={`replay-item-${index}`} className="flex min-w-0 scroll-mt-4 flex-col gap-2.5 px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <LibraryStateBadge tone={comparison.tone ?? "neutral"}>
          {comparison.label}
        </LibraryStateBadge>
        <span className="min-w-0 flex-1 truncate text-sm">
          {original.run ? inputsText(original.run) : "Original run"}
        </span>
        {metrics.duration || metrics.tokens ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {[metrics.duration, metrics.tokens].filter((value) => value !== null).join(" · ")}
          </span>
        ) : null}
      </div>
      {item.reason ? <p className="text-sm text-destructive-foreground">{item.reason}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-border">
        <RunOutcome
          title="Before"
          run={original.run}
          className="sm:pe-4"
          missing={original.gone ? "The original run is no longer kept." : "Loading the original…"}
        />
        <RunOutcome
          title="After"
          run={replayed.run}
          className="sm:ps-4"
          missing={
            item.replayRunId === null
              ? item.comparison === "pending" && replayRunning
                ? "Not started yet."
                : "No replay run."
              : replayed.gone
                ? "The replay run is no longer kept."
                : "Loading the replay run…"
          }
        />
      </div>
      {canDiff ? (
        <div className="flex flex-col gap-2">
          <Button
            shape="pill"
            size="xs"
            variant="ghost-muted"
            aria-expanded={showDiff}
            onClick={() => setShowDiff((open) => !open)}
          >
            {showDiff ? "Hide the difference" : "Show what changed in the reply"}
          </Button>
          {showDiff ? <ReplyDiff before={before} after={after} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** What to do with the answer: keep the edit, or adopt the version that was tried. */
function ReplayDecision({
  environmentId,
  replay,
  bot,
}: {
  readonly environmentId: EnvironmentId;
  readonly replay: BotReplay;
  readonly bot: BotDefinition | null;
}) {
  const nav = useBotsNavigation();
  const access = useBotsAccess();
  const setStable = useAtomCommand(bots.setStable, { reportFailure: false });
  const restoreVersion = useAtomCommand(bots.restoreVersion, { reportFailure: false });
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (bot === null) return null;
  const archived = bot.archivedAt !== null;
  const running = replay.status === "running";

  if (replay.source.kind === "draft") {
    const editing = nav.search.edit === true && nav.search.bot === bot.id;
    return editing ? (
      <Button shape="pill" onClick={nav.close}>
        <PencilIcon />
        Back to editing
      </Button>
    ) : (
      <Button
        shape="pill"
        variant="outline"
        onClick={() => {
          // Closing first replaces the sheet's entry, so Back from the editor never reopens it.
          nav.close();
          nav.open({ bot: bot.id, edit: true });
        }}
      >
        <PencilIcon />
        Edit {bot.name}
      </Button>
    );
  }

  const version = replay.source.version;
  const act = async (work: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    await work()
      .catch((cause: unknown) => {
        setError(failureText(cause, failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const markStable = () =>
    act(async () => {
      const result = await setStable({ environmentId, input: { botId: bot.id, version } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    }, "Could not change the stable version.");
  const restore = () =>
    act(async () => {
      const result = await restoreVersion({
        environmentId,
        input: { botId: bot.id, version, expectedVersion: bot.version },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setConfirmRestore(false);
      // Closing first replaces the sheet's entry, so Back never reopens it. Over the bot's
      // Versions already, closing is all it takes; over any other page, Versions opens on top.
      const page = botsPageOf(nav.search);
      const route = botsRoute(page);
      nav.close();
      if (route.kind !== "bot" || route.botId !== bot.id || page.tab !== "versions")
        nav.open({ bot: bot.id, tab: "versions" });
    }, "Could not restore the version.");
  const blocked = !access.canSave || archived || busy || running;
  return (
    <>
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground sm:me-auto">
          {error}
        </p>
      ) : null}
      {bot.stableVersion === version ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BadgeCheckIcon aria-hidden className="size-3.5" />v{version} is stable
        </span>
      ) : (
        <Button shape="pill" variant="outline" disabled={blocked} onClick={() => void markStable()}>
          <BadgeCheckIcon />
          Mark v{version} stable
        </Button>
      )}
      {bot.version === version ? null : (
        <Button shape="pill" disabled={blocked} onClick={() => setConfirmRestore(true)}>
          <RotateCcwIcon />
          Restore v{version}…
        </Button>
      )}
      <ConfirmDialog
        open={confirmRestore}
        busy={busy}
        title={`Restore v${version} of ${bot.name}?`}
        description={`Its instructions and settings are saved again as v${bot.version + 1}, so every run uses them. Nothing in the version history is lost.`}
        confirmLabel={`Restore as v${bot.version + 1}`}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => void restore()}
      />
    </>
  );
}

function ReplaySheet({
  environmentId,
  replayId,
}: {
  readonly environmentId: EnvironmentId;
  readonly replayId: string;
}) {
  const nav = useBotsNavigation();
  const { changes, bots: allBots } = useBots();
  const access = useBotsAccess();
  const [session] = useState(() => replaySessions.get(replayId) ?? null);
  const [cancelled, setCancelled] = useState<BotReplay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const query = useEnvironmentQuery(bots.getReplay({ environmentId, input: { replayId } }));
  const replay = currentReplay(session?.replay ?? null, query.data, cancelled);
  const botId = replay?.botId ?? null;
  const bot = allBots.find((candidate) => candidate.id === botId) ?? null;
  const runsQuery = useEnvironmentQuery(
    botId === null
      ? null
      : bots.listRuns({ environmentId, input: { limit: BOTS_LIST_RUNS_MAX_LIMIT, botId } }),
  );
  useRefreshWhenBotsChangesPruned(changes, runsQuery.refresh);
  const listed =
    botId === null
      ? []
      : applyRunChanges(runsQuery.data?.runs ?? [], changes, {
          botId,
          includeNew: true,
          limit: BOTS_LIST_RUNS_MAX_LIMIT,
        });
  const runById = replayRunsById(session?.originals ?? [], listed, changes.runs.values());
  const cancel = useAtomCommand(bots.cancelReplay, { reportFailure: false });

  // The replay itself is not watched; its runs say when its comparisons may have moved.
  const progress = [...changes.runs.values()]
    .filter((run) => run.replayId === replayId)
    .map((run) => `${run.id}:${run.status}`)
    .join(",");
  const refreshReplay = query.refresh;
  const refreshRuns = runsQuery.refresh;
  const status = replay?.status;
  useEffect(() => {
    if (progress !== "") refreshReplay();
  }, [progress, refreshReplay]);
  // Once per status, recover results the watch missed, such as after a reconnect.
  useEffect(() => {
    if (status !== undefined && botId !== null) refreshRuns();
  }, [status, botId, refreshRuns]);

  const stop = async () => {
    if (!replay || busy || !access.canReplay) return;
    setBusy(true);
    setError(null);
    await cancel({ environmentId, input: { replayId: replay.id } })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setCancelled(result.value);
        refreshReplay();
      })
      .catch((cause: unknown) => {
        setError(failureText(cause, "Could not cancel the replay."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const title = !replay
    ? "Replay"
    : replay.source.kind === "draft"
      ? "Replay of your edit"
      : `Replay of v${replay.source.version}`;
  const started = replay ? runTime(replay.createdAt, now) : null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) nav.close();
      }}
    >
      <SheetPopup side="right" size="wide">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {replay
              ? `${bot?.name ?? replay.botId}. ${
                  replay.items.length === 1 ? "1 past run" : `${replay.items.length} past runs`
                } tried again and compared with ${
                  replay.items.length === 1 ? "its original result" : "their original results"
                }${started ? `. Started ${started}` : ""}.`
              : "Each past run tried again and compared with its original result."}
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          {!replay ? (
            query.error ? (
              <div className="flex flex-col gap-3">
                <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
                <p className="text-sm text-muted-foreground">
                  The replay may have been removed with its bot. Its runs stay in the bot's Runs.
                </p>
              </div>
            ) : (
              <div role="status" aria-label="Loading the replay" className="flex flex-col gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton shape="card" className="h-8" />
                <Skeleton shape="card" className="h-40" />
              </div>
            )
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p role="status" className="text-sm">
                  <span className="font-medium">{replayHeadline(replay)}</span>
                  {replayRest(replay) ? (
                    <span className="text-muted-foreground"> {replayRest(replay)}.</span>
                  ) : null}
                </p>
                {replay.items.length > 0 ? (
                  <TickStrip
                    size="fill"
                    label={`Comparisons: ${replayTally(replay.summary) || "none finished yet"}`}
                    ticks={replay.items.map((item, index) => ({
                      key: item.originalRunId,
                      tone: COMPARISONS[item.comparison].tone,
                      label: `Go to comparison ${index + 1}, ${COMPARISONS[item.comparison].label}`,
                    }))}
                    onSelectTick={(index) =>
                      document
                        .getElementById(`replay-item-${index}`)
                        ?.scrollIntoView({ block: "start" })
                    }
                  />
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {replay.source.kind === "draft"
                    ? `Compared with v${replay.baseVersion}, the version saved when it started.`
                    : `Better means it passed where the original did not; worse, the reverse. The bot is on v${bot?.version ?? replay.baseVersion}.`}
                </p>
              </div>
              <LibraryErrorNotice error={error ?? runsQuery.error} />
              {replay.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">This replay has no runs.</p>
              ) : (
                <ul
                  aria-label="Replay comparisons"
                  className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border")}
                >
                  {replay.items.map((item, index) => (
                    <ComparisonRow
                      key={item.originalRunId}
                      environmentId={environmentId}
                      item={item}
                      index={index}
                      replayRunning={replay.status === "running"}
                      runById={runById}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </SheetPanel>
        <SheetFooter>
          {replay?.status === "running" ? (
            <Button
              shape="pill"
              variant="outline"
              className="sm:me-auto"
              disabled={!access.canReplay || busy}
              onClick={() => void stop()}
            >
              <SquareIcon />
              Cancel replay
            </Button>
          ) : null}
          {/* Until the replay loads, the panel's own notice offers the retry. */}
          {replay ? (
            <>
              <Button
                shape="pill"
                variant="ghost"
                disabled={query.isPending || runsQuery.isPending}
                onClick={() => {
                  query.refresh();
                  runsQuery.refresh();
                }}
              >
                <RefreshCwIcon />
                Refresh
              </Button>
              <ReplayDecision environmentId={environmentId} replay={replay} bot={bot} />
            </>
          ) : null}
          <Button shape="pill" variant="ghost" onClick={nav.close}>
            Close
          </Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

/** The replay results sheet (`replay`), over whichever page is open. */
export function ReplayOverlays() {
  const nav = useBotsNavigation();
  const { host } = useBots();
  const replayId = nav.search.replay;
  if (!replayId || host.environmentId === null) return null;
  return <ReplaySheet key={replayId} environmentId={host.environmentId} replayId={replayId} />;
}
