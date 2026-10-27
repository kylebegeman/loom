import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  isTerminalBotRunStatus,
  type BotDefinition,
  type BotId,
  type BotRun,
  type BotRunStatus,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import { BOT_VERDICT_STATES, applyRunChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  CloudOffIcon,
  HistoryIcon,
  ListFilterIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryFilterChip,
  LibraryGroupHeading,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { useLibraryPermission } from "../project-library/state";
import { ActivityStrip } from "./BotActivity";
import { BatchesView } from "./BotBatches";
import { BotTile, runTime, useMinuteNow } from "./BotIdentity";
import { NeedsYouView } from "./BotsInbox";
import { botsPageOf, useBotsNavigation, type BotsPageSearch } from "./navigation";
import { elapsedLabel, formatDuration, runDurationMs } from "./runMetrics";
import {
  firstLine,
  groupRunsByDay,
  loadOlderRuns,
  pagedRuns,
  rememberRuns,
  resolveRunsScope,
  runHeadline,
  runInputSummary,
  runLogRuns,
  runOrigin,
  runOutcome,
  runPagesFor,
  runsListInput,
  type RunOutcome,
  type RunPages,
  type RunsScope,
} from "./runLog";
import {
  bots,
  useBots,
  useBotsAccess,
  useBotsAttentionCount,
  useBotsHost,
  useRefreshWhenBotsChangesPruned,
  useWaitingBotRuns,
} from "./state";

/** The Runs view: every run on the index, or one bot's on its page, in the scope the search names. */
export function RunsView({ bot }: { readonly bot: BotDefinition | null }) {
  const nav = useBotsNavigation();
  const host = useBotsHost();
  const attention = useBotsAttentionCount();
  // Without the inbox, runs waiting on an answer are all Needs you holds.
  const waiting = useWaitingBotRuns(host.inboxSupported ? null : host.environmentId).length;
  const scope = resolveRunsScope(nav.search.scope, host);
  // The attention count covers every bot, so a bot's page leaves it off rather than overstate.
  const toolbarEnd = (
    <RunsScopeSwitch
      scope={scope}
      needsYou={host.inboxSupported || waiting > 0}
      attention={bot === null ? attention : null}
    />
  );
  switch (scope) {
    case "attention":
    case "dismissed":
      return <NeedsYouView bot={bot} dismissed={scope === "dismissed"} toolbarEnd={toolbarEnd} />;
    case "batches":
      return <BatchesView bot={bot} toolbarEnd={toolbarEnd} />;
    case "all":
      // Keyed so filters and loaded pages start over on another bot's page.
      return <RunLog key={bot?.id ?? "all"} bot={bot} toolbarEnd={toolbarEnd} />;
  }
}

function RunsScopeSwitch({
  scope,
  needsYou,
  attention,
}: {
  readonly scope: RunsScope;
  /** Whether Needs you has anything to list; the open scope always keeps its own item. */
  readonly needsYou: boolean;
  readonly attention: number | null;
}) {
  const nav = useBotsNavigation();
  const host = useBotsHost();
  // Dismissed runs are a corner of Needs you, reached from inside it.
  const value = scope === "dismissed" ? "attention" : scope;
  const showNeedsYou = needsYou || value === "attention";
  if (!showNeedsYou && !host.batchesSupported) return null;
  return (
    <ToggleGroup
      shape="pill"
      variant="segmented"
      aria-label="Which runs"
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked !== "all" && picked !== "attention" && picked !== "batches") return;
        if (picked === value) return;
        nav.show({ ...botsPageOf(nav.search), scope: picked === "all" ? undefined : picked });
      }}
    >
      <ToggleGroupItem value="all">All runs</ToggleGroupItem>
      {showNeedsYou ? (
        <ToggleGroupItem value="attention">
          Needs you
          {attention ? (
            <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-warning/16 px-1.5 text-2xs font-semibold tabular-nums text-warning-foreground">
              {attention}
            </span>
          ) : null}
        </ToggleGroupItem>
      ) : null}
      {host.batchesSupported ? <ToggleGroupItem value="batches">Batches</ToggleGroupItem> : null}
    </ToggleGroup>
  );
}

const NO_PAGES: RunPages = { base: "", loaded: [], cursor: null };
const VERDICTS: readonly BotVerdictValue[] = ["pass", "fail", "needs_attention"];
const noop = () => {};

/**
 * Every run, newest first: what is running now, then each day's finished runs. The first page is
 * the request the shell shares; older pages load on demand under it, and watched changes keep all
 * of it live.
 */
function RunLog({
  bot,
  toolbarEnd,
}: {
  readonly bot: BotDefinition | null;
  readonly toolbarEnd: ReactNode;
}) {
  const nav = useBotsNavigation();
  const { host, live, changes, bots: definitions } = useBots();
  const access = useBotsAccess();
  const now = useMinuteNow();
  const environmentId = live ? host.environmentId : null;
  // Filters live in the URL, so a narrowed log survives a reload, a shared link and Back.
  const verdict = nav.search.verdict ?? null;
  const filterBotId = nav.search.runBot ?? null;
  const setFilters = (filters: Pick<BotsPageSearch, "verdict" | "runBot">) =>
    nav.show({ ...botsPageOf(nav.search), ...filters });
  const setVerdict = (next: BotVerdictValue | null) => setFilters({ verdict: next ?? undefined });
  const setFilterBotId = (next: BotId | null) => setFilters({ runBot: next ?? undefined });
  const activeVerdict = host.verdictsSupported ? verdict : null;
  const pickedBot = bot === null ? filterBotId : null;
  const botId = bot?.id ?? pickedBot ?? undefined;
  const filtered = activeVerdict !== null || pickedBot !== null;
  const input = runsListInput({ botId, verdict: activeVerdict ?? undefined });
  const first = useEnvironmentQuery(environmentId ? bots.listRuns({ environmentId, input }) : null);
  // Unfiltered with the shared input, so it is the same request as the first page until a filter is set.
  const recent = useEnvironmentQuery(
    environmentId && bot === null
      ? bots.listRuns({ environmentId, input: runsListInput({}) })
      : null,
  );
  const [pageState, setPages] = useState<RunPages>(NO_PAGES);
  const pages = runPagesFor(pageState, `${JSON.stringify(input)}@${first.dataUpdatedAt}`);
  const older = useEnvironmentQuery(
    environmentId && pages.cursor !== null
      ? bots.listRuns({ environmentId, input: { ...input, before: pages.cursor } })
      : null,
  );
  const listed = pagedRuns(first.data?.runs ?? [], pages, older.data?.runs ?? null);
  const hasMore =
    pages.cursor === null ? (first.data?.hasMore ?? false) : (older.data?.hasMore ?? true);
  const runs = runLogRuns(listed, changes, {
    botId,
    verdict: activeVerdict ?? undefined,
    complete: first.data !== null && !hasMore,
  });
  const activity =
    bot === null
      ? applyRunChanges(recent.data?.runs ?? [], changes, {
          includeNew: true,
          limit: BOTS_LIST_RUNS_MAX_LIMIT,
        })
      : [];

  useEffect(() => {
    if (first.data) rememberRuns(first.data.runs);
  }, [first.data]);
  useEffect(() => {
    if (older.data) rememberRuns(older.data.runs);
  }, [older.data]);
  useEffect(() => {
    if (recent.data) rememberRuns(recent.data.runs);
  }, [recent.data]);

  const refreshFirst = first.refresh;
  const wasConnected = useRef(host.connected);
  useEffect(() => {
    // Changes missed while away never arrive, so the list starts over from the server.
    if (host.connected && !wasConnected.current) refreshFirst();
    wasConnected.current = host.connected;
  }, [host.connected, refreshFirst]);
  useRefreshWhenBotsChangesPruned(changes, refreshFirst);
  useRefreshWhenBotsChangesPruned(changes, filtered ? recent.refresh : noop);

  const clearFilters = () => setFilters({ verdict: undefined, runBot: undefined });
  const loadOlder = () => {
    const page = pages.cursor === null ? first.data?.runs : older.data?.runs;
    if (page) setPages(loadOlderRuns(pages, page));
  };
  const { active, days } = groupRunsByDay(runs, now);
  const choosableBots =
    bot === null ? definitions.toSorted((left, right) => left.name.localeCompare(right.name)) : [];
  const pickedName =
    pickedBot === null
      ? null
      : (definitions.find((definition) => definition.id === pickedBot)?.name ?? "Deleted bot");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <RunFilters
          verdicts={host.verdictsSupported}
          verdict={activeVerdict}
          onVerdict={setVerdict}
          bots={choosableBots.length > 1 || pickedBot !== null ? choosableBots : null}
          botId={pickedBot}
          onBot={setFilterBotId}
        />
        {activeVerdict ? (
          <LibraryFilterChip
            label={BOT_VERDICT_STATES[activeVerdict].label}
            marker={<LibraryStateDot tone={BOT_VERDICT_STATES[activeVerdict].tone} />}
            removeLabel="Show runs with any verdict"
            onRemove={() => setVerdict(null)}
          />
        ) : null}
        {pickedBot !== null ? (
          <LibraryFilterChip
            label={pickedName}
            marker={<BotTile bot={{ id: pickedBot }} size="sm" />}
            removeLabel="Show runs of every bot"
            onRemove={() => setFilterBotId(null)}
          />
        ) : null}
        {first.data && runs.length ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {runs.length}
            {hasMore ? "+" : ""} {runs.length === 1 ? "run" : "runs"}
          </p>
        ) : null}
        {host.connected ? null : (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CloudOffIcon aria-hidden className="size-3.5" />
            Offline, so these may be out of date
          </p>
        )}
        <div className="ms-auto flex items-center gap-1.5">{toolbarEnd}</div>
      </div>
      {bot === null && activity.length ? (
        <ActivityStrip
          runs={activity}
          now={now}
          onSelectRun={(run) => nav.overlay({ runId: run.id })}
        />
      ) : null}
      {first.data === null ? (
        first.error ? (
          <LibraryErrorNotice error={first.error} onRetry={first.refresh} />
        ) : (
          <RunLogSkeleton />
        )
      ) : (
        <>
          <LibraryErrorNotice error={first.error} onRetry={first.refresh} />
          {runs.length === 0 && filtered ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
              <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">
                {hasMore
                  ? "No runs match these filters in the newest runs."
                  : "No runs match these filters."}
              </p>
              <Button shape="pill" size="xs" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : runs.length === 0 && !hasMore ? (
            <RunsEmpty
              bot={bot}
              canRun={access.canRun}
              canSave={access.canSave}
              hasBots={definitions.length > 0}
            />
          ) : (
            <div className="flex flex-col gap-6">
              {active.length ? (
                <section aria-label="Running now" className="flex flex-col gap-2">
                  <LibraryGroupHeading
                    title="Running now"
                    count={active.length}
                    marker={<LibraryStateDot tone="active" />}
                  />
                  <RunRows runs={active} showBot={bot === null} time="clock" />
                </section>
              ) : null}
              {days.map((day, index) => (
                <section key={day.key} aria-label={day.label} className="flex flex-col gap-2">
                  <LibraryGroupHeading
                    title={day.label}
                    // The oldest day shown may continue on the next page, so its count would undercount.
                    count={hasMore && index === days.length - 1 ? undefined : day.runs.length}
                  />
                  <RunRows runs={day.runs} showBot={bot === null} time="clock" />
                </section>
              ))}
            </div>
          )}
          {hasMore ? (
            <div className="flex flex-col items-center gap-2">
              <LibraryErrorNotice error={older.error} onRetry={older.refresh} />
              <Button
                shape="pill"
                size="sm"
                variant="outline"
                disabled={older.isPending || (pages.cursor !== null && older.data === null)}
                onClick={loadOlder}
              >
                {older.isPending ? "Loading older runs…" : "Load older runs"}
              </Button>
            </div>
          ) : pages.cursor !== null && runs.length ? (
            <p className="text-center text-xs text-muted-foreground">That is every run.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

function RunFilters({
  verdicts,
  verdict,
  onVerdict,
  bots: choices,
  botId,
  onBot,
}: {
  readonly verdicts: boolean;
  readonly verdict: BotVerdictValue | null;
  readonly onVerdict: (verdict: BotVerdictValue | null) => void;
  /** Bots to narrow to, on the index; null leaves the choice out. */
  readonly bots: readonly BotDefinition[] | null;
  readonly botId: BotId | null;
  readonly onBot: (botId: BotId | null) => void;
}) {
  if (!verdicts && choices === null) return null;
  const active = (verdict ? 1 : 0) + (botId ? 1 : 0);
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="outline" />}>
        <ListFilterIcon />
        Filters
        {active ? (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {active}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        {verdicts ? (
          <MenuGroup>
            <MenuGroupLabel>Verdict</MenuGroupLabel>
            <MenuRadioGroup
              value={verdict ?? "any"}
              onValueChange={(value) =>
                onVerdict(VERDICTS.find((option) => option === value) ?? null)
              }
            >
              <MenuRadioItem value="any">Any verdict</MenuRadioItem>
              {VERDICTS.map((option) => (
                <MenuRadioItem key={option} value={option}>
                  <span className="flex items-center gap-2">
                    <LibraryStateDot tone={BOT_VERDICT_STATES[option].tone} />
                    {BOT_VERDICT_STATES[option].label}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ) : null}
        {verdicts && choices !== null ? <MenuSeparator /> : null}
        {choices !== null ? (
          <MenuGroup>
            <MenuGroupLabel>Bot</MenuGroupLabel>
            <MenuRadioGroup
              value={botId ?? "any"}
              onValueChange={(value) =>
                onBot(choices.find((choice) => choice.id === value)?.id ?? null)
              }
            >
              <MenuRadioItem value="any">Any bot</MenuRadioItem>
              {choices.map((choice) => (
                <MenuRadioItem key={choice.id} value={choice.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <BotTile bot={choice} size="sm" />
                    <span className="truncate">{choice.name}</span>
                    {choice.archivedAt === null ? null : (
                      <span className="text-xs text-muted-foreground">Archived</span>
                    )}
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function RunsEmpty({
  bot,
  canRun,
  canSave,
  hasBots,
}: {
  readonly bot: BotDefinition | null;
  readonly canRun: boolean;
  readonly canSave: boolean;
  readonly hasBots: boolean;
}) {
  const nav = useBotsNavigation();
  if (bot === null)
    return (
      <LibraryEmpty
        icon={HistoryIcon}
        title="No runs yet"
        action={
          hasBots ? (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              onClick={() => nav.show({ tab: "bots" })}
            >
              Choose a bot to run
            </Button>
          ) : (
            <Button
              shape="pill"
              size="sm"
              disabled={!canSave}
              onClick={() => nav.open({ newBot: true })}
            >
              <PlusIcon />
              New bot
            </Button>
          )
        }
      >
        Every bot's runs land here, newest first, with what each one found.
      </LibraryEmpty>
    );
  const archived = bot.archivedAt !== null;
  return (
    <LibraryEmpty
      icon={HistoryIcon}
      title={`${bot.name} has not run yet`}
      action={
        <Button
          shape="pill"
          size="sm"
          disabled={archived || !canRun}
          onClick={() => nav.overlay({ run: bot.id })}
        >
          <PlayIcon />
          Run {bot.name}
        </Button>
      }
    >
      {archived
        ? "It is archived. Restore it to run it."
        : canRun
          ? "Each run lands here with its outcome, findings and reply."
          : "This connection cannot run bots, so its runs will appear here once someone does."}
    </LibraryEmpty>
  );
}

const SKELETON_LOG_ROWS = ["first", "second", "third", "fourth", "fifth"];

function RunLogSkeleton() {
  return (
    <div role="status" aria-label="Loading runs" className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center">
        <Skeleton className="h-3.5 w-20" />
      </div>
      <div className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}>
        {SKELETON_LOG_ROWS.map((row) => (
          <div key={row} className="flex items-center gap-3 px-3 py-2">
            <Skeleton shape="card" className="size-6" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Columns appear as the list widens: outcome and time always, then duration, then origin.
const ROW_COLUMNS =
  "grid-cols-[minmax(0,1fr)_auto_4.5rem] @lg:grid-cols-[minmax(0,1fr)_7rem_3.5rem_4.5rem] @2xl:grid-cols-[minmax(0,1fr)_7rem_6rem_3.5rem_4.5rem]";
const ROW_COLUMNS_WITH_ACTION =
  "grid-cols-[minmax(0,1fr)_auto_4.5rem_6rem] @lg:grid-cols-[minmax(0,1fr)_7rem_3.5rem_4.5rem_6rem] @2xl:grid-cols-[minmax(0,1fr)_7rem_6rem_3.5rem_4.5rem_6rem]";

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const FALLBACK_TITLES: Record<BotRunStatus, string> = {
  queued: "Waiting to start",
  running: "Working",
  completed: "Finished without a reply",
  failed: "Failed without an error message",
  cancelled: "Cancelled",
  timed_out: "Ran out of time",
};

/**
 * Runs as compact rows, each opening the run sheet. `time` is a clock time under a day heading
 * and a relative time anywhere else, such as a bot's recent runs.
 */
export function RunRows({
  runs,
  showBot,
  time = "relative",
}: {
  readonly runs: readonly BotRun[];
  readonly showBot: boolean;
  readonly time?: "clock" | "relative";
}) {
  const nav = useBotsNavigation();
  const { environmentId, connected } = useBotsHost();
  const canCancel = useLibraryPermission(bots.cancel, environmentId) && connected;
  const now = useMinuteNow();
  if (runs.length === 0) return null;
  const page = botsPageOf(nav.search);
  const cancellable =
    environmentId !== null && canCancel && runs.some((run) => !isTerminalBotRunStatus(run.status));
  return (
    <div className="@container">
      <ul
        aria-label="Runs"
        className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}
      >
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            showBot={showBot}
            time={time}
            now={now}
            search={{ ...page, runId: run.id }}
            cancelIn={cancellable ? environmentId : null}
          />
        ))}
      </ul>
    </div>
  );
}

function RunRow({
  run,
  showBot,
  time,
  now,
  search,
  cancelIn,
}: {
  readonly run: BotRun;
  readonly showBot: boolean;
  readonly time: "clock" | "relative";
  readonly now: number;
  readonly search: BotsPageSearch & { readonly runId: BotRun["id"] };
  /** The environment to cancel in, when this list offers Cancel. */
  readonly cancelIn: EnvironmentId | null;
}) {
  const outcome = runOutcome(run);
  const active = !isTerminalBotRunStatus(run.status);
  const headline = runHeadline(run);
  const failure = firstLine(run.verdict?.summary) === null && firstLine(run.error) !== null;
  const inputs = runInputSummary(run);
  const origin = run.requestedBy ? run.requestedBy.label : runOrigin(run).label;
  const title = showBot ? run.botName : (headline ?? (inputs || FALLBACK_TITLES[run.status]));
  const detail = showBot ? (headline ?? FALLBACK_TITLES[run.status]) : headline ? inputs : "";
  const at = Date.parse(run.createdAt);
  const when = active
    ? elapsedLabel(run.startedAt ?? run.createdAt, now)
    : time === "clock" && Number.isFinite(at)
      ? CLOCK.format(at)
      : runTime(run.createdAt, now);
  const duration = runDurationMs(run);
  return (
    <li
      className={cn(
        "relative grid items-center gap-x-3 px-3 py-2 transition-colors duration-150 hover:bg-accent/50",
        cancelIn ? ROW_COLUMNS_WITH_ACTION : ROW_COLUMNS,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {showBot ? (
          <BotTile
            bot={{ id: run.botId }}
            size="sm"
            status={<LibraryStateDot tone={outcome.tone} className="size-1.5" />}
          />
        ) : (
          <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
            <LibraryStateDot tone={outcome.tone} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="truncate font-medium">{title}</span>
            {showBot && inputs ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{inputs}</span>
            ) : null}
            {run.rating === "up" ? (
              <ThumbsUpIcon
                aria-label="Rated good"
                className="size-3 shrink-0 self-center text-muted-foreground"
              />
            ) : run.rating === "down" ? (
              <ThumbsDownIcon
                aria-label="Rated bad"
                className="size-3 shrink-0 self-center text-muted-foreground"
              />
            ) : null}
          </p>
          {detail ? (
            <p
              className={cn(
                "truncate text-xs",
                showBot && failure ? "text-destructive-foreground" : "text-muted-foreground",
              )}
            >
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end @lg:justify-start">
        <RunOutcomeLabel outcome={outcome} />
      </div>
      <span className="hidden truncate text-xs text-muted-foreground @2xl:block">{origin}</span>
      <span className="hidden text-end text-xs tabular-nums text-muted-foreground @lg:block">
        {duration === null ? "" : formatDuration(duration)}
      </span>
      <span className="truncate text-end text-xs tabular-nums text-muted-foreground">{when}</span>
      {/* After the cells, so it sits over the positioned tile; Cancel follows it and stays on top. */}
      <Link
        to="/loom/bots"
        search={search}
        replace
        aria-label={[run.botName, outcome.label, inputs, when].filter(Boolean).join(", ")}
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />
      {cancelIn ? (
        <div className="relative flex justify-end">
          {active ? <CancelRunButton environmentId={cancelIn} run={run} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Exceptions and work in flight get a pill; a pass or a plain finish stays text. */
function RunOutcomeLabel({ outcome }: { readonly outcome: RunOutcome }) {
  switch (outcome.emphasis) {
    case "pill":
      return <LibraryStateBadge tone={outcome.tone}>{outcome.label}</LibraryStateBadge>;
    case "plain":
      return <span className="truncate text-xs text-muted-foreground">{outcome.label}</span>;
    case "quiet":
      return <span className="truncate text-xs text-muted-foreground/70">{outcome.label}</span>;
  }
}

function CancelRunButton({
  environmentId,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
}) {
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const stop = async () => {
    setBusy(true);
    const result = await cancel({ environmentId, input: { runId: run.id } });
    setBusy(false);
    if (result._tag === "Success") return;
    const cause = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: `Could not cancel the ${run.botName} run`,
      ...(cause instanceof Error ? { description: cause.message } : {}),
    });
  };
  return (
    <Button
      shape="pill"
      size="xs"
      variant="ghost"
      disabled={busy}
      aria-label={`Cancel the ${run.botName} run`}
      onClick={() => void stop()}
    >
      <SquareIcon />
      {busy ? "Cancelling…" : "Cancel"}
    </Button>
  );
}
