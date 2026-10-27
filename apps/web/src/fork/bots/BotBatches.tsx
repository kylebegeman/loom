import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_BATCH_MAX_ATTEMPTS,
  BOTS_LIST_BATCHES_MAX_LIMIT,
  batchCountsLine,
  type BotBatch,
  type BotBatchItem,
  type BotDefinition,
} from "@t3tools/contracts/fork";
import {
  applyBatchChanges,
  applyBatchItemChanges,
  botColor,
  type BotBatchChanges,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  FileTextIcon,
  InfoIcon,
  LayersIcon,
  ListChecksIcon,
  LockIcon,
  PauseIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  WifiOffIcon,
} from "lucide-react";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Group, GroupSeparator } from "~/components/ui/group";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryHero, LibraryVital, LibraryVitals } from "../project-library/LibraryCollection";
import {
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryFilterChip,
  LibraryGroupHeading,
  LibraryNotice,
  LibraryPanel,
  LibrarySearch,
  LibrarySection,
  LibrarySpecSheet,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import {
  LIBRARY_CELL,
  LIBRARY_ROW_TARGET,
  LIBRARY_TABLE_ROW,
  LibraryTable,
  TickStrip,
} from "../project-library/LibraryData";
import { LibraryBackLink } from "../project-library/LibraryPageFrame";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { useLibraryPermission } from "../project-library/state";
import {
  BATCH_ITEM_OUTCOMES,
  BATCH_SOURCE_LABELS,
  OUTCOME_TONES,
  batchOrigin,
  batchSegments,
  batchState,
  batchStatusCounts,
  batchVitals,
  botsErrorReason,
  cancelBatchMessage,
  countOutcomes,
  filterBatches,
  filterItems,
  groupBatches,
  itemOutcome,
  itemTickTone,
  itemTries,
  outcomeBreakdown,
  outcomeGroupLabel,
  retryChoice,
  retryPlan,
  runOnManyBlocker,
  settledCount,
  type BatchItemFilter,
  type BatchStatusFilter,
  type ProgressSegment,
  type ProgressTone,
  type RetryPlan,
} from "./batches";
import { BotTile, formatSpan, runDuration, runTime, useMinuteNow } from "./BotIdentity";
import { botsPageOf, useBotsNavigation, type BotsPageSearch } from "./navigation";
import { rememberRuns, runHeadline } from "./runLog";
import { elapsedLabel } from "./runMetrics";
import {
  bots,
  useBotBatchChanges,
  useBots,
  useBotsAccess,
  useBotsHost,
  useRefreshOnReconnect,
} from "./state";

export type { ProgressSegment, ProgressTone } from "./batches";

const PROGRESS_FILL: Record<ProgressTone, string> = {
  waiting: "bg-muted-foreground/15",
  neutral: "bg-muted-foreground/40",
  active: "bg-(--project-color)",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/**
 * Where a batch or pipeline stands, as one calm bar of state-toned segments sized by their counts.
 * The caller prints the counts beside it, so the bar never has to carry a legend.
 */
function ProgressBar({
  segments,
  label,
  className,
}: {
  readonly segments: ReadonlyArray<ProgressSegment>;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <div role="img" aria-label={label} className={cn("flex h-1.5 min-w-0 gap-0.5", className)}>
      {segments
        .filter((segment) => segment.count > 0)
        .map((segment) => (
          <span
            key={segment.key}
            className={cn("min-w-0.5 basis-0 rounded-full", PROGRESS_FILL[segment.tone])}
            style={{ flexGrow: segment.count }}
          />
        ))}
    </div>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

const INLINE_LINK =
  "rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

// The index

const BATCH_COLUMNS = [
  { key: "batch", label: "Batch", className: "w-full max-w-0" },
  { key: "progress", label: "Progress", className: "hidden w-36 sm:table-cell" },
  { key: "outcome", label: "Outcome", className: "hidden w-52 md:table-cell" },
  { key: "started", label: "Started", className: "hidden w-28 sm:table-cell" },
  { key: "took", label: "Took", className: "hidden w-24 lg:table-cell", align: "end" },
] as const;

const SKELETON_ROWS = ["first", "second", "third", "fourth"] as const;

/** The batches of the index, or of one bot on its page, for the Runs view's Batches scope. */
export function BatchesView({
  bot,
  toolbarEnd,
}: {
  readonly bot: BotDefinition | null;
  /** The Runs scope switch, kept at the end of this view's one toolbar row. */
  readonly toolbarEnd?: ReactNode;
}) {
  const runBot = useBotsNavigation().search.runBot;
  // Keyed so filters and loaded pages start over on another bot's page, or another bot filter.
  return <BatchesList key={bot?.id ?? `all:${runBot ?? ""}`} bot={bot} toolbarEnd={toolbarEnd} />;
}

function BatchesList({
  bot,
  toolbarEnd,
}: {
  readonly bot: BotDefinition | null;
  readonly toolbarEnd: ReactNode;
}) {
  const { host, bots: allBots, list: botList } = useBots();
  const { canSave } = useBotsAccess();
  const environmentId = host.environmentId;
  const now = useMinuteNow();
  const canStart = useLibraryPermission(bots.runBatch, environmentId) && host.connected;
  const nav = useBotsNavigation();
  const [query, setQuery] = useState("");
  // The status filter lives in the URL, so a narrowed list survives a reload and Back.
  const status: BatchStatusFilter = nav.search.batchStatus ?? "all";
  const setStatus = (next: BatchStatusFilter) =>
    nav.show({ ...botsPageOf(nav.search), batchStatus: next === "all" ? undefined : next });
  // The Runs log's bot filter, so narrowing to a bot holds when switching to Batches.
  const pickedBot = bot === null ? (nav.search.runBot ?? null) : null;
  const botId = bot?.id ?? pickedBot ?? undefined;
  const clearPickedBot = () => nav.show({ ...botsPageOf(nav.search), runBot: undefined });
  const [showOlder, setShowOlder] = useState(false);
  const live = environmentId !== null && host.batchesSupported;
  const changes = useBotBatchChanges(environmentId, live && host.connected);
  const list = useEnvironmentQuery(
    environmentId !== null && live
      ? bots.listBatches({
          environmentId,
          input: { limit: BOTS_LIST_BATCHES_MAX_LIMIT, ...(botId ? { botId } : {}) },
        })
      : null,
  );
  useRefreshOnReconnect(host.connected, list.refresh);

  const runOnMany = (emphasis: "toolbar" | "empty") => (
    <RunOnManyAction
      bot={bot}
      choices={allBots}
      loading={botList.data === null && botList.error === null}
      connected={host.connected}
      permitted={canStart}
      emphasis={emphasis}
    />
  );
  const toolbar = (controls: ReactNode) => (
    <div className="flex flex-wrap items-center gap-2">
      {controls}
      {toolbarEnd ? <div className="ms-auto flex items-center">{toolbarEnd}</div> : null}
    </div>
  );

  if (environmentId === null || !host.batchesSupported)
    return (
      <div className="flex flex-col gap-4">
        {toolbar(null)}
        <LibraryNotice icon={InfoIcon}>
          Batches need a newer server. Update {host.environment?.label ?? "the bots host"} to run a
          bot on many items.
        </LibraryNotice>
      </div>
    );

  const listed = list.data;
  const batches = listed
    ? applyBatchChanges(listed.batches, changes, { botId, includeNew: true })
    : [];
  const counts = batchStatusCounts(batches);
  const narrowed = status !== "all" || query.trim() !== "" || pickedBot !== null;
  const { running, earlier } = groupBatches(filterBatches(batches, { status, query }));
  // Nothing older is still running, so the Running filter never pages back.
  const canPageBack = (listed?.hasMore ?? false) && status !== "running";
  const cursor = listed?.batches.at(-1)?.createdAt ?? null;
  const showEarlier = earlier.length > 0 || canPageBack;
  const headed = running.length > 0 && showEarlier;
  const emptyList = listed !== null && batches.length === 0 && pickedBot === null;
  const clearFilters = () => {
    setQuery("");
    nav.show({ ...botsPageOf(nav.search), batchStatus: undefined, runBot: undefined });
  };
  const pickedName =
    pickedBot === null
      ? null
      : (allBots.find((candidate) => candidate.id === pickedBot)?.name ?? "Deleted bot");
  const botsById = new Map(allBots.map((candidate) => [candidate.id, candidate]));
  const rowProps = { showBot: bot === null, botsById, botSearch: bot?.id, now };

  let body: ReactNode;
  if (listed === null)
    body = list.error ? (
      <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
    ) : (
      <BatchesSkeleton />
    );
  else if (emptyList)
    body = <BatchesEmpty bot={bot} canSave={canSave} action={runOnMany("empty")} />;
  else if (running.length === 0 && earlier.length === 0 && !(showOlder && canPageBack))
    body = (
      <div className="rounded-xl border border-dashed border-border">
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>No batches match</EmptyTitle>
            <EmptyDescription>
              {status === "retry"
                ? "No settled batch has failed items or items needing attention."
                : status === "running"
                  ? "Nothing is running right now."
                  : pickedName !== null && query.trim() === ""
                    ? `${pickedName} has not run on many items.`
                    : "Search looks at each batch's source and bot."}
              {canPageBack ? " Older batches are searched once you load them." : ""}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            {canPageBack ? (
              <Button shape="pill" size="sm" variant="secondary" onClick={() => setShowOlder(true)}>
                Search older batches
              </Button>
            ) : null}
            <Button shape="pill" size="sm" variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  else
    body = (
      <div className="flex flex-col gap-6">
        {list.error ? <LibraryErrorNotice error={list.error} onRetry={list.refresh} /> : null}
        {running.length > 0 ? (
          <section aria-label="Running batches" className="flex flex-col gap-2">
            {headed ? (
              <LibraryGroupHeading
                title="Running"
                count={running.length}
                marker={<LibraryStateDot tone="active" />}
              />
            ) : null}
            <LibraryTable label="Running batches" columns={BATCH_COLUMNS}>
              {running.map((batch) => (
                <BatchRow key={batch.id} batch={batch} {...rowProps} />
              ))}
            </LibraryTable>
          </section>
        ) : null}
        {showEarlier ? (
          <section aria-label="Earlier batches" className="flex flex-col gap-2">
            {headed ? <LibraryGroupHeading title="Earlier" count={earlier.length} /> : null}
            <LibraryTable label="Earlier batches" columns={BATCH_COLUMNS}>
              {earlier.map((batch) => (
                <BatchRow key={batch.id} batch={batch} {...rowProps} />
              ))}
              {canPageBack && cursor !== null ? (
                showOlder ? (
                  <OlderBatches
                    environmentId={environmentId}
                    botId={botId}
                    before={cursor}
                    status={status}
                    query={query}
                    changes={changes}
                    {...rowProps}
                  />
                ) : (
                  <LoadOlderRow onLoad={() => setShowOlder(true)} />
                )
              ) : null}
            </LibraryTable>
          </section>
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {toolbar(
        <>
          {batches.length > 0 || narrowed ? (
            <>
              <LibrarySearch
                value={query}
                onChange={setQuery}
                placeholder="Search batches"
                label="Search batches"
              />
              <ToggleGroup
                shape="pill"
                variant="segmented"
                aria-label="Which batches"
                value={[status]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "all" || next === "running" || next === "retry") setStatus(next);
                }}
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="running">
                  Running
                  <span className="tabular-nums opacity-60">{counts.running}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="retry">
                  Needs retry
                  <span className="tabular-nums opacity-60">{counts.retry}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </>
          ) : null}
          {pickedBot !== null && pickedName !== null ? (
            <LibraryFilterChip
              label={pickedName}
              marker={<BotTile bot={{ id: pickedBot }} size="sm" />}
              removeLabel="Show batches of every bot"
              onRemove={clearPickedBot}
            />
          ) : null}
          {/* The empty state carries the one way to start, so the toolbar does not repeat it. */}
          {emptyList ? null : runOnMany("toolbar")}
        </>,
      )}
      {!host.connected ? (
        <p role="status" className="-mt-1 text-xs text-muted-foreground">
          Offline. These batches may be out of date until {host.environment?.label ?? "the host"}{" "}
          reconnects.
        </p>
      ) : null}
      {body}
    </div>
  );
}

/**
 * Starts a batch. On a bot's page it opens that bot's wizard; on the index it asks which bot first,
 * and a bot without inputs stays in the list, disabled, so its absence is explained.
 */
function RunOnManyAction({
  bot,
  choices,
  loading,
  connected,
  permitted,
  emphasis,
}: {
  readonly bot: BotDefinition | null;
  readonly choices: readonly BotDefinition[];
  readonly loading: boolean;
  readonly connected: boolean;
  readonly permitted: boolean;
  readonly emphasis: "toolbar" | "empty";
}) {
  const nav = useBotsNavigation();
  const blocker = runOnManyBlocker({ connected, permitted, bot });
  const variant = emphasis === "empty" ? "default" : "outline";
  if (bot !== null || blocker !== null) {
    const button = (
      <Button
        shape="pill"
        size="sm"
        variant={variant}
        disabled={blocker !== null}
        onClick={() => {
          if (bot) nav.overlay({ many: bot.id });
        }}
      >
        <LayersIcon />
        Run on many
      </Button>
    );
    if (blocker === null) return button;
    return (
      <Tooltip>
        {/* A disabled button takes no pointer events, so its wrapper carries the reason. */}
        <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
        <TooltipPopup>{blocker}</TooltipPopup>
      </Tooltip>
    );
  }
  const active = choices
    .filter((choice) => choice.archivedAt === null)
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant={variant} />}>
        <LayersIcon />
        Run on many
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start" className="w-64">
        <MenuGroup>
          <MenuGroupLabel>Run which bot?</MenuGroupLabel>
          {active.length === 0 ? (
            loading ? (
              <MenuItem disabled>Loading bots…</MenuItem>
            ) : (
              <MenuItem render={<Link to="/loom/bots" search={{ newBot: true }} />}>
                <PlusIcon />
                New bot
              </MenuItem>
            )
          ) : null}
          {active.map((choice) => (
            <MenuItem
              key={choice.id}
              disabled={choice.parameters.length === 0}
              onClick={() => nav.overlay({ many: choice.id })}
            >
              <BotTile bot={choice} size="sm" />
              <span className="min-w-0 flex-1 truncate">{choice.name}</span>
              {choice.parameters.length === 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground">Takes no inputs</span>
              ) : null}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function BatchesEmpty({
  bot,
  canSave,
  action,
}: {
  readonly bot: BotDefinition | null;
  readonly canSave: boolean;
  readonly action: ReactNode;
}) {
  if (bot !== null && bot.archivedAt !== null)
    return (
      <LibraryEmpty icon={ArchiveIcon} title="No batches">
        {bot.name} is archived. Restore it to run it on many items.
      </LibraryEmpty>
    );
  if (bot !== null && bot.parameters.length === 0)
    return (
      <LibraryEmpty
        icon={LayersIcon}
        title="This bot takes no inputs"
        action={
          canSave ? (
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              render={<Link to="/loom/bots" search={{ bot: bot.id, edit: true }} />}
            >
              Edit {bot.name}
            </Button>
          ) : null
        }
      >
        A batch runs a bot once per item, with each item filling one of its inputs. Add an input to
        run {bot.name} on many items.
      </LibraryEmpty>
    );
  return (
    <LibraryEmpty
      icon={LayersIcon}
      title={bot ? `Run ${bot.name} on many items` : "Run a bot on many items"}
      action={action}
    >
      Point {bot ? bot.name : "a bot"} at pasted lines, files matching a pattern, search results,
      merge conflicts or open pull requests. It runs once per item, and the batch shows up here.
    </LibraryEmpty>
  );
}

function BatchesSkeleton() {
  return (
    <div role="status" aria-label="Loading batches">
      <LibraryTable label="Batches" columns={BATCH_COLUMNS}>
        {SKELETON_ROWS.map((key) => (
          <tr key={key}>
            <td className={cn(LIBRARY_CELL, "max-w-0")}>
              <div className="flex items-center gap-3">
                <Skeleton shape="card" className="size-6" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-2.5 w-1/4" />
                </div>
              </div>
            </td>
            <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
              <Skeleton shape="pill" className="h-1.5 w-full" />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden md:table-cell")}>
              <Skeleton className="h-2.5 w-3/4" />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
              <Skeleton className="h-2.5 w-16" />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden lg:table-cell")}>
              <Skeleton className="ms-auto h-2.5 w-10" />
            </td>
          </tr>
        ))}
      </LibraryTable>
    </div>
  );
}

function BatchRow({
  batch,
  showBot,
  botsById,
  botSearch,
  now,
}: {
  readonly batch: BotBatch;
  readonly showBot: boolean;
  /** The listed bots, so a row's tile wears its bot's own glyph. */
  readonly botsById: ReadonlyMap<string, BotDefinition>;
  /** The bot page the row was opened from, kept so the batch page leads back to it. */
  readonly botSearch: string | undefined;
  readonly now: number;
}) {
  const state = batchState(batch);
  const breakdown = outcomeBreakdown(batch.counts);
  return (
    <tr style={projectColorStyle(botColor({ id: batch.botId }))} className={LIBRARY_TABLE_ROW}>
      <td className={cn(LIBRARY_CELL, "max-w-0")}>
        <div className="flex min-w-0 items-center gap-3">
          {showBot ? (
            <BotTile
              bot={botsById.get(batch.botId) ?? { id: batch.botId }}
              size="sm"
              status={<LibraryStateDot tone={state.tone} className="size-1.5" />}
            />
          ) : (
            <LibraryStateDot tone={state.tone} className="mx-1.5" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                to="/loom/bots"
                search={{ batch: batch.id, ...(botSearch ? { bot: botSearch } : {}) }}
                className={cn(LIBRARY_ROW_TARGET, "truncate font-medium")}
              >
                {batch.sourceSummary}
              </Link>
              {state.label === "Paused" || batch.status === "cancelled" ? (
                <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              <span className="sr-only">{state.label}. </span>
              {[
                showBot ? batch.botName : null,
                `v${batch.botVersion}`,
                `started ${batchOrigin(batch)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </td>
      <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
        <div className="flex flex-col gap-1">
          <ProgressBar
            segments={batchSegments(batch.counts)}
            label={batchCountsLine(batch.counts)}
          />
          <span className="text-2xs tabular-nums text-muted-foreground">
            {settledCount(batch)} of {batch.total}
          </span>
        </div>
      </td>
      <td className={cn(LIBRARY_CELL, "hidden md:table-cell")}>
        {breakdown.length > 0 ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
            {breakdown.map((entry) => (
              <li key={entry.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <LibraryStateDot tone={entry.tone} className="size-1.5" />
                {entry.count}
                <span className="text-muted-foreground">{entry.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-muted-foreground">
            {batch.status === "running" ? "None settled yet" : "No items"}
          </span>
        )}
      </td>
      <td
        className={cn(
          LIBRARY_CELL,
          "hidden text-xs whitespace-nowrap tabular-nums text-muted-foreground sm:table-cell",
        )}
      >
        {runTime(batch.createdAt, now)}
      </td>
      <td
        className={cn(
          LIBRARY_CELL,
          "hidden text-end text-xs whitespace-nowrap tabular-nums lg:table-cell",
        )}
      >
        {batch.finishedAt ? (
          runDuration(batch.createdAt, batch.finishedAt, now)
        ) : (
          <span className="text-muted-foreground">{elapsedLabel(batch.createdAt, now)} so far</span>
        )}
      </td>
    </tr>
  );
}

function TableNoteRow({ children }: { readonly children: ReactNode }) {
  return (
    <tr>
      <td
        colSpan={BATCH_COLUMNS.length}
        className={cn(LIBRARY_CELL, "py-1.5 text-xs text-muted-foreground")}
      >
        {children}
      </td>
    </tr>
  );
}

function LoadOlderRow({ onLoad }: { readonly onLoad: () => void }) {
  return (
    <TableNoteRow>
      <Button shape="pill" size="xs" variant="ghost" onClick={onLoad}>
        Load older batches
      </Button>
    </TableNoteRow>
  );
}

/**
 * One older page of batches as table rows, then the way to the page before it. Each page keeps its
 * own query, so loading further back never refetches what is already shown.
 */
function OlderBatches({
  environmentId,
  botId,
  before,
  status,
  query,
  changes,
  showBot,
  botsById,
  botSearch,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly botId: string | undefined;
  readonly before: string;
  readonly status: BatchStatusFilter;
  readonly query: string;
  readonly changes: BotBatchChanges;
  readonly showBot: boolean;
  readonly botsById: ReadonlyMap<string, BotDefinition>;
  readonly botSearch: string | undefined;
  readonly now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const page = useEnvironmentQuery(
    bots.listBatches({
      environmentId,
      input: { limit: BOTS_LIST_BATCHES_MAX_LIMIT, ...(botId ? { botId } : {}), before },
    }),
  );
  if (page.data === null)
    return (
      <TableNoteRow>
        {page.error ? (
          <LibraryErrorNotice error={page.error} onRetry={page.refresh} />
        ) : (
          <div role="status" aria-label="Loading older batches" className="py-1">
            <Skeleton className="h-3 w-1/3" />
          </div>
        )}
      </TableNoteRow>
    );
  const batches = applyBatchChanges(page.data.batches, changes, { botId, includeNew: false });
  const shown = filterBatches(batches, { status, query });
  const last = page.data.batches.at(-1);
  return (
    <>
      {shown.map((batch) => (
        <BatchRow
          key={batch.id}
          batch={batch}
          showBot={showBot}
          botsById={botsById}
          botSearch={botSearch}
          now={now}
        />
      ))}
      {shown.length === 0 && batches.length > 0 ? (
        <TableNoteRow>No matches among {plural(batches.length, "older batch")}.</TableNoteRow>
      ) : null}
      {page.data.hasMore && last ? (
        expanded ? (
          <OlderBatches
            environmentId={environmentId}
            botId={botId}
            before={last.createdAt}
            status={status}
            query={query}
            changes={changes}
            showBot={showBot}
            botsById={botsById}
            botSearch={botSearch}
            now={now}
          />
        ) : (
          <LoadOlderRow onLoad={() => setExpanded(true)} />
        )
      ) : null}
    </>
  );
}

// One batch

/** One batch as its own page. */
export function BatchPage({ batchId }: { readonly batchId: string }) {
  const host = useBotsHost();
  const nav = useBotsNavigation();
  const fromBot = nav.search.bot;
  const back = (
    <LibraryBackLink
      to="/loom/bots"
      search={{ tab: "runs", scope: "batches", ...(fromBot ? { bot: fromBot } : {}) }}
    >
      Batches
    </LibraryBackLink>
  );
  if (host.environmentId === null || !host.batchesSupported)
    return (
      <div className="flex flex-col">
        {back}
        <LibraryNotice icon={InfoIcon}>
          Batches need a newer server. Update {host.environment?.label ?? "the bots host"} to see
          this batch.
        </LibraryNotice>
      </div>
    );
  return (
    <BatchPageContent
      key={batchId}
      environmentId={host.environmentId}
      batchId={batchId}
      back={back}
    />
  );
}

function BatchPageContent({
  environmentId,
  batchId,
  back,
}: {
  readonly environmentId: EnvironmentId;
  readonly batchId: string;
  readonly back: ReactNode;
}) {
  const host = useBotsHost();
  const changes = useBotBatchChanges(environmentId, host.connected);
  const query = useEnvironmentQuery(bots.getBatch({ environmentId, input: { batchId } }));
  useRefreshOnReconnect(host.connected, query.refresh);
  const fetched = query.data;
  // A server that cannot look a run up opens one only from runs a list has shown.
  useEffect(() => {
    if (fetched) rememberRuns(fetched.items.flatMap((item) => (item.run ? [item.run] : [])));
  }, [fetched]);
  if (fetched === null)
    return (
      <div className="flex flex-col">
        {back}
        {query.error === null ? (
          <BatchPageSkeleton />
        ) : botsErrorReason(query.failure) === "not_found" ? (
          <LibraryEmpty
            icon={LayersIcon}
            title="This batch is no longer stored"
            action={
              <Button
                shape="pill"
                size="sm"
                variant="outline"
                render={<Link to="/loom/bots" search={{ tab: "runs", scope: "all" }} />}
              >
                Open Runs
              </Button>
            }
          >
            Bots keep each bot's newest 50 batches. The runs this one started are still under Runs.
          </LibraryEmpty>
        ) : (
          <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
        )}
      </div>
    );
  const { batch, items } = applyBatchItemChanges(fetched, changes);
  return (
    <BatchDetail
      environmentId={environmentId}
      batch={batch}
      items={items}
      back={back}
      refresh={query.refresh}
      staleError={query.error}
    />
  );
}

const PAGE_SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth"] as const;

/** The page's shape while it loads, so the hero and items do not jump when they arrive. */
function BatchPageSkeleton() {
  return (
    <div role="status" aria-label="Loading the batch" className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 rounded-3xl border border-border p-5 sm:p-6">
        <div className="flex items-center gap-5">
          <Skeleton shape="card" className="size-11" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="flex flex-col gap-2">
        {PAGE_SKELETON_ROWS.map((key) => (
          <Skeleton key={key} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

function BatchDetail({
  environmentId,
  batch,
  items,
  back,
  refresh,
  staleError,
}: {
  readonly environmentId: EnvironmentId;
  readonly batch: BotBatch;
  readonly items: ReadonlyArray<BotBatchItem>;
  readonly back: ReactNode;
  readonly refresh: () => void;
  /** A failed refetch over data already shown. */
  readonly staleError: string | null;
}) {
  const { host, bots: allBots, list: botList } = useBots();
  const nav = useBotsNavigation();
  const now = useMinuteNow();
  const canCancel = useLibraryPermission(bots.cancelBatch, environmentId) && host.connected;
  const canRetry = useLibraryPermission(bots.retryBatch, environmentId) && host.connected;
  const canStart = useLibraryPermission(bots.runBatch, environmentId) && host.connected;
  const cancelCommand = useAtomCommand(bots.cancelBatch, { reportFailure: false });
  const retryCommand = useAtomCommand(bots.retryBatch, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeAttention, setIncludeAttention] = useState(false);
  const [useLatest, setUseLatest] = useState(false);

  const bot = allBots.find((candidate) => candidate.id === batch.botId) ?? null;
  const botGone = bot === null && botList.data !== null;
  const archived = bot !== null && bot.archivedAt !== null;
  const newerVersion =
    bot !== null && !archived && bot.version !== batch.botVersion ? bot.version : null;
  const running = batch.status === "running";
  const state = batchState(batch);
  const plan = retryPlan(items);
  const choice = retryChoice(plan, includeAttention);
  const retryable = !running && plan.failed + plan.attention > 0;
  const startable =
    bot !== null && runOnManyBlocker({ connected: true, permitted: true, bot }) === null;
  const openRun = (runId: string) => nav.overlay({ runId });

  const act = async (work: () => Promise<string | null>, fallback: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    await work()
      .then((next) => {
        setMessage(next);
      })
      .catch((cause: unknown) => {
        setError(errorText(cause, fallback));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const cancel = () =>
    act(async () => {
      const confirmed = await ensureLocalApi().dialogs.confirm(cancelBatchMessage(batch.counts), {
        variant: "destructive",
      });
      if (!confirmed) return null;
      const result = await cancelCommand({ environmentId, input: { batchId: batch.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return "Batch cancelled.";
    }, "Could not cancel the batch.");
  const retry = () =>
    act(async () => {
      const result = await retryCommand({
        environmentId,
        input: {
          batchId: batch.id,
          include: choice.include,
          ...(useLatest && newerVersion !== null ? { useLatest: true } : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      refresh();
      const { retried, exhausted } = result.value;
      const left =
        exhausted.length === 0
          ? ""
          : ` ${plural(exhausted.length, "item")} already ran ${BOTS_BATCH_MAX_ATTEMPTS} times and ${exhausted.length === 1 ? "was" : "were"} left out.`;
      return `Retrying ${plural(retried, "item")}.${left}`;
    }, "Could not retry the batch.");

  const pausedAt = batch.pausedUntil ? Date.parse(batch.pausedUntil) : Number.NaN;
  const accessNotice = !host.connected ? (
    <LibraryNotice icon={WifiOffIcon} tone="warning">
      Offline. This batch may be out of date, and Cancel and Retry wait for{" "}
      {host.environment?.label ?? "the bots host"} to reconnect.
    </LibraryNotice>
  ) : (running && !canCancel) || (retryable && !canRetry) ? (
    <LibraryNotice icon={LockIcon}>
      This connection cannot {running ? "cancel" : "retry"} batches.
    </LibraryNotice>
  ) : null;

  return (
    <div style={projectColorStyle(botColor({ id: batch.botId }))} className="flex flex-col gap-6">
      <div className="flex flex-col">
        {back}
        <LibraryHero
          tile={<BotTile bot={bot ?? { id: batch.botId }} size="lg" />}
          title={batch.sourceSummary}
          meta={
            <>
              <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
              <span>
                {bot ? (
                  <Link to="/loom/bots" search={{ bot: bot.id }} className={INLINE_LINK}>
                    {batch.botName}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{batch.botName}</span>
                )}{" "}
                v{batch.botVersion}
                {newerVersion !== null ? `, v${newerVersion} saved since` : ""}
              </span>
              <span>
                Started {runTime(batch.createdAt, now)} {batchOrigin(batch)}
              </span>
              <span>{BATCH_SOURCE_LABELS[batch.sourceType]}</span>
            </>
          }
          actions={
            <>
              {running ? (
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  disabled={!canCancel || busy}
                  onClick={() => void cancel()}
                >
                  <SquareIcon />
                  Cancel batch
                </Button>
              ) : null}
              {retryable ? (
                <RetryControl
                  plan={plan}
                  label={choice.label}
                  count={choice.count}
                  includeAttention={includeAttention || plan.failed === 0}
                  onIncludeAttention={setIncludeAttention}
                  newerVersion={newerVersion}
                  useLatest={useLatest}
                  onUseLatest={setUseLatest}
                  disabled={!canRetry || busy || botGone || archived}
                  onRetry={() => void retry()}
                />
              ) : null}
              <BatchMoreMenu
                batch={batch}
                bot={bot}
                startable={startable}
                canStart={canStart}
                onRefresh={refresh}
              />
            </>
          }
          footer={<BatchBoard batch={batch} items={items} now={now} onOpenRun={openRun} />}
        />
      </div>
      <div className="flex flex-col gap-2 empty:hidden">
        {accessNotice}
        {running && batch.pausedUntil ? (
          <LibraryNotice icon={PauseIcon} tone="warning">
            Waiting on {batch.botName}'s daily budget.{" "}
            {pausedAt > now
              ? `The next item starts ${runTime(batch.pausedUntil, now)}.`
              : "The next item starts soon."}
          </LibraryNotice>
        ) : null}
        {batch.note ? <LibraryNotice icon={InfoIcon}>{batch.note}</LibraryNotice> : null}
        {batch.status === "cancelled" ? (
          <LibraryNotice
            icon={SquareIcon}
            action={
              startable ? (
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  disabled={!canStart}
                  onClick={() => nav.overlay({ many: batch.botId })}
                >
                  <LayersIcon />
                  Run on many again
                </Button>
              ) : null
            }
          >
            Cancelled{batch.finishedAt ? ` ${runTime(batch.finishedAt, now)}` : ""}. Skipped and
            cancelled items are not retried; start a new batch to run them.
          </LibraryNotice>
        ) : null}
        {retryable && botGone ? (
          <LibraryNotice icon={InfoIcon}>
            {batch.botName} was deleted, so these items cannot be retried.
          </LibraryNotice>
        ) : null}
        {retryable && archived && bot ? (
          <LibraryNotice
            icon={ArchiveIcon}
            action={
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                render={<Link to="/loom/bots" search={{ bot: bot.id }} />}
              >
                Open {bot.name}
              </Button>
            }
          >
            {bot.name} is archived. Restore it to retry these items.
          </LibraryNotice>
        ) : null}
        {!running && !retryable && plan.exhausted.length > 0 ? (
          <LibraryNotice icon={InfoIcon}>
            {plural(plan.exhausted.length, "failed item")} already ran {BOTS_BATCH_MAX_ATTEMPTS}{" "}
            times, the most a batch allows, so nothing is left to retry.
          </LibraryNotice>
        ) : null}
        {message ? (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
        <LibraryErrorNotice error={staleError} onRetry={refresh} />
      </div>
      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <BatchItems
          batch={batch}
          items={items}
          now={now}
          page={botsPageOf(nav.search)}
          onOpenRun={openRun}
        />
        <aside aria-label="About this batch" className="flex min-w-0 flex-col gap-4">
          <BatchFacts
            environmentId={environmentId}
            batch={batch}
            items={items}
            bot={bot}
            now={now}
          />
          <BatchReport environmentId={environmentId} batch={batch} />
        </aside>
      </div>
    </div>
  );
}

/**
 * Retry as one control: the button reruns what the menu describes. The menu appears only when
 * there is a choice to make or a limit to explain.
 */
function RetryControl({
  plan,
  label,
  count,
  includeAttention,
  onIncludeAttention,
  newerVersion,
  useLatest,
  onUseLatest,
  disabled,
  onRetry,
}: {
  readonly plan: RetryPlan;
  readonly label: string;
  readonly count: number;
  readonly includeAttention: boolean;
  readonly onIncludeAttention: (include: boolean) => void;
  readonly newerVersion: number | null;
  readonly useLatest: boolean;
  readonly onUseLatest: (useLatest: boolean) => void;
  readonly disabled: boolean;
  readonly onRetry: () => void;
}) {
  const primary = (
    <Button
      shape="pill"
      size="sm"
      variant="outline"
      disabled={disabled || count === 0}
      onClick={onRetry}
    >
      <RotateCcwIcon />
      {label}
    </Button>
  );
  const options =
    (plan.failed > 0 && plan.attention > 0) || newerVersion !== null || plan.exhausted.length > 0;
  if (!options) return primary;
  return (
    <Group aria-label="Retry">
      {primary}
      <GroupSeparator />
      <Menu>
        <MenuTrigger
          render={
            <Button
              shape="pill"
              size="icon-sm"
              variant="outline"
              aria-label="Retry options"
              disabled={disabled}
            />
          }
        >
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>Retry options</MenuGroupLabel>
            {plan.attention > 0 ? (
              <MenuCheckboxItem
                checked={includeAttention}
                disabled={plan.failed === 0}
                onCheckedChange={(checked) => onIncludeAttention(checked)}
              >
                Include {plan.attention} needing attention
              </MenuCheckboxItem>
            ) : null}
            {newerVersion !== null ? (
              <MenuCheckboxItem
                checked={useLatest}
                onCheckedChange={(checked) => onUseLatest(checked)}
              >
                Use v{newerVersion}, saved since
              </MenuCheckboxItem>
            ) : null}
          </MenuGroup>
          {plan.exhausted.length > 0 ? (
            <>
              <MenuSeparator />
              <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">
                {plural(plan.exhausted.length, "item")} already ran {BOTS_BATCH_MAX_ATTEMPTS} times,
                the most a batch allows, and {plan.exhausted.length === 1 ? "is" : "are"} left out.
              </p>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </Group>
  );
}

function BatchMoreMenu({
  batch,
  bot,
  startable,
  canStart,
  onRefresh,
}: {
  readonly batch: BotBatch;
  readonly bot: BotDefinition | null;
  readonly startable: boolean;
  readonly canStart: boolean;
  readonly onRefresh: () => void;
}) {
  const nav = useBotsNavigation();
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button shape="pill" size="icon-sm" variant="ghost" aria-label="More batch actions" />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {bot ? (
          <MenuItem render={<Link to="/loom/bots" search={{ bot: bot.id }} />}>
            <BotIcon />
            Open {bot.name}
          </MenuItem>
        ) : null}
        {startable ? (
          <MenuItem disabled={!canStart} onClick={() => nav.overlay({ many: batch.botId })}>
            <LayersIcon />
            Run on many again
          </MenuItem>
        ) : null}
        <MenuItem onClick={onRefresh}>
          <RefreshCwIcon />
          Refresh
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** A legend mark drawn as its tick is: toned, or an empty slot for items with no run. */
function OutcomeSwatch({ tone }: { readonly tone: LibraryWorkflowTone | null }) {
  return tone === null ? (
    <span aria-hidden className="size-2 shrink-0 rounded-xs bg-muted dark:bg-accent/60" />
  ) : (
    <LibraryStateDot tone={tone} className="rounded-xs" />
  );
}

const itemReadout = (item: BotBatchItem, now: number) => {
  const run = item.run;
  const time =
    run === null || run.startedAt === null
      ? null
      : run.finishedAt
        ? runDuration(run.startedAt, run.finishedAt, now)
        : `${elapsedLabel(run.startedAt, now)} so far`;
  const tries = itemTries(item);
  return [itemOutcome(item).label, time, tries > 1 ? `try ${tries}` : null]
    .filter(Boolean)
    .join(" · ");
};

/**
 * Every item as one tick in source order, toned by outcome, over the batch's vitals. Pointing at a
 * tick reads it out; choosing one opens its run.
 */
function BatchBoard({
  batch,
  items,
  now,
  onOpenRun,
}: {
  readonly batch: BotBatch;
  readonly items: ReadonlyArray<BotBatchItem>;
  readonly now: number;
  readonly onOpenRun: (runId: string) => void;
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const current = focused === null ? null : (items[focused] ?? null);
  const counts = countOutcomes(items);
  const verdicts = batch.counts.pass + batch.counts.fail + batch.counts.needsAttention > 0;
  const present = BATCH_ITEM_OUTCOMES.filter((key) => (counts.get(key) ?? 0) > 0);
  const vitals = batchVitals(items);
  const running = batch.status === "running";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p
          aria-live="polite"
          className="min-w-0 truncate text-xs tabular-nums text-muted-foreground"
        >
          {current ? (
            <>
              <span className="font-medium text-foreground">{current.label}</span>
              {` · ${itemReadout(current, now)}`}
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">
                {settledCount(batch)} of {batch.total} done
              </span>
              , in source order
            </>
          )}
        </p>
        <ul
          aria-label="Outcomes"
          className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground"
        >
          {present.map((key) => (
            <li key={key} className="flex items-center gap-1.5">
              <OutcomeSwatch tone={OUTCOME_TONES[key]} />
              {outcomeGroupLabel(key, verdicts)}
              <span className="font-medium tabular-nums text-foreground">{counts.get(key)}</span>
            </li>
          ))}
        </ul>
      </div>
      <TickStrip
        size="grid"
        label={`${plural(batch.total, "item")}: ${batchCountsLine(batch.counts)}`}
        ticks={items.map((item) => ({
          key: String(item.index),
          tone: itemTickTone(item),
          label: `${item.label}, ${itemOutcome(item).label}`,
        }))}
        focused={focused}
        onFocusTick={setFocused}
        onSelectTick={(index) => {
          const run = items[index]?.run;
          if (run) onOpenRun(run.id);
        }}
      />
      <div className="border-t border-border/70 pt-3">
        <LibraryVitals>
          <LibraryVital label={verdicts ? "Passed" : "Completed"}>
            {vitals.judged === 0
              ? "None yet"
              : `${Math.round((vitals.passed / vitals.judged) * 100)}% of ${vitals.judged}`}
          </LibraryVital>
          <LibraryVital label="Typical item">
            {vitals.typicalMs === null ? "None yet" : formatSpan(vitals.typicalMs)}
          </LibraryVital>
          <LibraryVital label="Slowest">
            {vitals.slowestMs === null ? "None yet" : formatSpan(vitals.slowestMs)}
          </LibraryVital>
          <LibraryVital label="Tokens">
            {vitals.tokens === null ? "Unavailable" : vitals.tokens.toLocaleString()}
          </LibraryVital>
          <LibraryVital label="Retried">
            {vitals.retried === 0 ? "None" : plural(vitals.retried, "item")}
          </LibraryVital>
          <LibraryVital label={running ? "Running for" : "Took"}>
            {running
              ? elapsedLabel(batch.createdAt, now)
              : runDuration(batch.createdAt, batch.finishedAt, now)}
          </LibraryVital>
        </LibraryVitals>
      </div>
    </div>
  );
}

const ITEM_COLUMNS = [
  { key: "item", label: "Item", className: "w-1/2 max-w-0" },
  { key: "outcome", label: "Outcome", className: "w-32" },
  { key: "summary", label: "Summary", className: "hidden w-1/2 max-w-0 md:table-cell" },
  { key: "time", label: "Time", className: "hidden w-20 sm:table-cell", align: "end" },
  { key: "tries", label: "Tries", className: "hidden w-24 sm:table-cell", align: "end" },
  { key: "open", label: "Open run", hideLabel: true, className: "w-10" },
] as const;

/** Enough rows to scan without making a 200-item batch one long scroll by default. */
const ITEMS_PAGE = 50;

function BatchItems({
  batch,
  items,
  now,
  page,
  onOpenRun,
}: {
  readonly batch: BotBatch;
  readonly items: ReadonlyArray<BotBatchItem>;
  readonly now: number;
  /** The page under the run sheet each row opens. */
  readonly page: BotsPageSearch;
  readonly onOpenRun: (runId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<BatchItemFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const counts = countOutcomes(items);
  const verdicts = batch.counts.pass + batch.counts.fail + batch.counts.needsAttention > 0;
  const present = BATCH_ITEM_OUTCOMES.filter((key) => (counts.get(key) ?? 0) > 0);
  // An outcome that empties as items move on falls back to all, not to a filter hiding everything.
  const active = outcome !== "all" && (counts.get(outcome) ?? 0) === 0 ? "all" : outcome;
  const shown = filterItems(items, { outcome: active, query });
  const visible = showAll ? shown : shown.slice(0, ITEMS_PAGE);
  return (
    <LibrarySection title="Items" icon={ListChecksIcon} count={items.length}>
      <div className="flex flex-wrap items-center gap-2">
        <LibrarySearch
          value={query}
          onChange={setQuery}
          placeholder="Find an item"
          label="Find an item"
        />
        {present.length > 1 ? (
          <ToggleGroup
            shape="pill"
            variant="segmented"
            aria-label="Show items"
            value={[active]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "all") setOutcome("all");
              else {
                const key = BATCH_ITEM_OUTCOMES.find((candidate) => candidate === next);
                if (key) setOutcome(key);
              }
            }}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            {present.map((key) => (
              <ToggleGroupItem key={key} value={key}>
                {outcomeGroupLabel(key, verdicts)}
                <span className="tabular-nums opacity-60">{counts.get(key)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border">
          <Empty size="compact">
            <EmptyHeader>
              <EmptyTitle>No items match</EmptyTitle>
              <EmptyDescription>Search looks at each item's label.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              <Button
                shape="pill"
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setOutcome("all");
                }}
              >
                Clear filters
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <LibraryTable label="Items" columns={ITEM_COLUMNS}>
          {visible.map((item) => (
            <ItemRow key={item.index} item={item} now={now} page={page} onOpenRun={onOpenRun} />
          ))}
          {visible.length < shown.length ? (
            <tr>
              <td colSpan={ITEM_COLUMNS.length} className={cn(LIBRARY_CELL, "py-1.5")}>
                <Button shape="pill" size="xs" variant="ghost" onClick={() => setShowAll(true)}>
                  Show all {shown.length}
                </Button>
              </td>
            </tr>
          ) : null}
        </LibraryTable>
      )}
    </LibrarySection>
  );
}

function ItemRow({
  item,
  now,
  page,
  onOpenRun,
}: {
  readonly item: BotBatchItem;
  readonly now: number;
  readonly page: BotsPageSearch;
  readonly onOpenRun: (runId: string) => void;
}) {
  const outcome = itemOutcome(item);
  const run = item.run;
  const summary = run ? runHeadline(run) : null;
  const time =
    run === null || run.startedAt === null
      ? null
      : run.finishedAt
        ? runDuration(run.startedAt, run.finishedAt, now)
        : elapsedLabel(run.startedAt, now);
  const tries = itemTries(item);
  return (
    <tr className={LIBRARY_TABLE_ROW}>
      <td className={cn(LIBRARY_CELL, "max-w-0")}>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {item.index + 1}
          </span>
          {run ? (
            <Link
              to="/loom/bots"
              search={{ ...page, runId: run.id }}
              replace
              className={cn(LIBRARY_ROW_TARGET, "min-w-0 truncate font-mono text-xs")}
            >
              {item.label}
            </Link>
          ) : (
            <span className="min-w-0 truncate font-mono text-xs">{item.label}</span>
          )}
        </div>
      </td>
      <td className={LIBRARY_CELL}>
        <LibraryStateBadge tone={OUTCOME_TONES[outcome.key] ?? "neutral"}>
          {outcome.label}
        </LibraryStateBadge>
      </td>
      <td className={cn(LIBRARY_CELL, "hidden max-w-0 md:table-cell")}>
        {summary ? <p className="truncate text-xs text-muted-foreground">{summary}</p> : null}
      </td>
      <td
        className={cn(
          LIBRARY_CELL,
          "hidden text-end text-xs whitespace-nowrap tabular-nums text-muted-foreground sm:table-cell",
        )}
      >
        {time}
      </td>
      <td className={cn(LIBRARY_CELL, "hidden py-1.5 text-end sm:table-cell")}>
        {tries > 1 ? (
          // Raised over the row's stretched target so it stays its own control.
          <span className="relative">
            <TriesMenu item={item} onOpenRun={onOpenRun} />
          </span>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {tries === 0 ? "None" : "1"}
          </span>
        )}
      </td>
      <td className={cn(LIBRARY_CELL, "text-end")}>
        {run ? (
          <ChevronRightIcon aria-hidden className="ms-auto size-4 text-muted-foreground" />
        ) : null}
      </td>
    </tr>
  );
}

/** Every run an item has had, so an earlier attempt's answer is one choice away. */
function TriesMenu({
  item,
  onOpenRun,
}: {
  readonly item: BotBatchItem;
  readonly onOpenRun: (runId: string) => void;
}) {
  const runIds = [...item.previousRunIds, ...(item.runId === null ? [] : [item.runId])];
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            aria-label={`${item.label}: ${runIds.length} tries`}
          />
        }
      >
        <span className="tabular-nums">
          {runIds.length} of {BOTS_BATCH_MAX_ATTEMPTS}
        </span>
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Every try</MenuGroupLabel>
          {runIds.map((runId, index) => (
            <MenuItem key={runId} onClick={() => onOpenRun(runId)}>
              Try {index + 1}
              {index === runIds.length - 1 && item.runId !== null ? ", the latest" : ""}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function BatchFacts({
  environmentId,
  batch,
  items,
  bot,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly batch: BotBatch;
  readonly items: ReadonlyArray<BotBatchItem>;
  readonly bot: BotDefinition | null;
  readonly now: number;
}) {
  const projects = useProjects();
  const project =
    batch.projectId === null
      ? null
      : projects.find(
          (candidate) =>
            candidate.environmentId === environmentId && candidate.id === batch.projectId,
        );
  const inputLabel = (name: string) =>
    bot?.parameters.find((parameter) => parameter.name === name)?.label ?? name;
  const ranOn = [
    ...new Set(items.flatMap((item) => (item.run?.ranOn ? [item.run.ranOn.label] : []))),
  ];
  const shared = Object.entries(batch.sharedInputs);
  const rows = [
    { label: "Source", value: BATCH_SOURCE_LABELS[batch.sourceType] },
    { label: "Items", value: String(batch.total) },
    ...(batch.itemParameter
      ? [{ label: "Each item fills", value: inputLabel(batch.itemParameter) }]
      : []),
    {
      label: "Project",
      value: batch.projectId === null ? "None" : (project?.title ?? "Not on this computer"),
    },
    { label: "Version", value: `v${batch.botVersion}` },
    {
      label: "Started by",
      value: batch.pipelineRunId ? "A pipeline" : batch.startedBy === "agent" ? "An agent" : "You",
    },
    ...(batch.pipelineRunId
      ? [
          {
            label: "Pipeline run",
            value: (
              <Link
                to="/loom/bots"
                search={{ pipelineRun: batch.pipelineRunId }}
                className={INLINE_LINK}
              >
                Open the run
              </Link>
            ),
          },
        ]
      : []),
    ...(batch.callerThreadId
      ? [
          {
            label: "Started from",
            value: (
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: batch.callerThreadId }}
                className={INLINE_LINK}
              >
                Open the thread
              </Link>
            ),
          },
        ]
      : []),
    { label: "Started", value: runTime(batch.createdAt, now) ?? "Unknown" },
    {
      label: batch.status === "cancelled" ? "Cancelled" : "Finished",
      value: batch.finishedAt ? (runTime(batch.finishedAt, now) ?? "Unknown") : "Still running",
    },
    ...(ranOn.length > 0 ? [{ label: "Ran on", value: ranOn.join(", ") }] : []),
  ];
  return (
    <LibraryPanel title="How it ran" icon={SlidersHorizontalIcon}>
      <div className="flex flex-col gap-3 px-4 pb-3">
        <LibrarySpecSheet label="How it ran" rows={rows} />
        {shared.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">Shared by every item</h3>
            <LibrarySpecSheet
              label="Shared inputs"
              rows={shared.map(([name, value]) => ({
                label: inputLabel(name),
                value: String(value),
              }))}
            />
          </div>
        ) : null}
      </div>
    </LibraryPanel>
  );
}

const REPORT_SKELETON_LINES = ["w-1/3", "w-5/6", "w-2/3", "w-3/4"] as const;

/**
 * The batch's Markdown report. It is rebuilt only when the batch settles or a person asks, since
 * refetching on every finished item would rebuild the whole report hundreds of times.
 */
function BatchReport({
  environmentId,
  batch,
}: {
  readonly environmentId: EnvironmentId;
  readonly batch: BotBatch;
}) {
  const report = useEnvironmentQuery(
    bots.batchReport({ environmentId, input: { batchId: batch.id } }),
  );
  const refresh = report.refresh;
  const status = batch.status;
  const seenStatus = useRef(status);
  useEffect(() => {
    if (seenStatus.current === status) return;
    seenStatus.current = status;
    refresh();
  }, [status, refresh]);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copy = useCopyToClipboard<void>({
    target: "batch report",
    onError: (cause) => setCopyError(cause.message),
  });
  const data = report.data;
  const notes = [
    status === "running" ? "Rebuilt when the batch settles." : null,
    data?.truncated ? "Shortened to fit; the Items table has every item." : null,
  ].filter(Boolean);
  return (
    <LibraryPanel
      title="Report"
      icon={FileTextIcon}
      action={
        <div className="flex items-center gap-0.5">
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={data === null}
            onClick={() => {
              setCopyError(null);
              copy.copyToClipboard(data?.markdown ?? "", undefined);
            }}
          >
            <CopyIcon />
            {copy.isCopied ? "Copied" : "Copy"}
          </Button>
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh the report"
            disabled={report.isPending}
            onClick={refresh}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 px-4 pb-4">
        {data ? (
          <>
            <p className="text-xs text-muted-foreground">
              {notes.length > 0 ? notes.join(" ") : "Every item's outcome, as Markdown."}
            </p>
            <div className="max-h-96 min-w-0 overflow-y-auto text-sm">
              <ChatMarkdown text={data.markdown} cwd={undefined} />
            </div>
          </>
        ) : report.error ? null : (
          <div role="status" aria-label="Loading the report" className="flex flex-col gap-2">
            {REPORT_SKELETON_LINES.map((width) => (
              <div key={width} className={width}>
                <Skeleton className="h-3" />
              </div>
            ))}
          </div>
        )}
        <LibraryErrorNotice error={report.error} onRetry={refresh} />
        <LibraryErrorNotice error={copyError} />
      </div>
    </LibraryPanel>
  );
}
