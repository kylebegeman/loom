import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  type BotDefinition,
  type BotRun,
  type BotStarterStatus,
  type BotUsageRow,
} from "@t3tools/contracts/fork";
import { applyInboxChanges, applyRunChanges, botColor } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatModelSlugName } from "@t3tools/shared/model";
import { formatPercent } from "@t3tools/shared/usageFormat";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisIcon,
  GaugeIcon,
  HandIcon,
  LayersIcon,
  ListFilterIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  LIBRARY_CARD,
  LIBRARY_CARD_GRID,
  LibraryCardTarget,
  LibraryLayoutToggle,
  type LibraryLayout,
} from "../project-library/LibraryCollection";
import {
  LIBRARY_OUTLINE,
  LibraryErrorNotice,
  LibraryFilterChip,
  LibraryGroupHeading,
  LibrarySearch,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import {
  LIBRARY_CELL,
  LIBRARY_ROW_TARGET,
  LIBRARY_TABLE_ROW,
  LibraryTable,
  TickStrip,
  type LibraryTick,
} from "../project-library/LibraryData";
import { ProjectWash } from "../project-library/ProjectCollection";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { botRecord, chronological, runTone } from "./BotActivity";
import { BotTile, StarterBadge, runTime } from "./BotIdentity";
import { NeedsYouBand } from "./BotsInbox";
import { BotBudgetMeter, BotTokensCell, useBotUsage, type BotUsageDays } from "./BotsUsage";
import {
  activeRuns,
  BOT_ORIGIN_FILTER_LABELS,
  BOT_ORIGIN_FILTERS,
  BOT_SORT_LABELS,
  BOT_SORTS,
  BOT_STATE_FILTER_LABELS,
  BOT_STATE_FILTERS,
  BOT_USAGE_WINDOW_LABELS,
  BOT_USAGE_WINDOW_SHORT,
  BOT_USAGE_WINDOWS,
  budgetLevel,
  countByBot,
  lastRunState,
  matchesBotFilters,
  runOutcomeLabel,
  runsByBot,
  sortBots,
  successFigure,
  type BotFacts,
  type BotOriginFilter,
  type BotSort,
  type BotStateFilter,
} from "./botsCollection";
import { BotSuggestionsSection } from "./fromThread/BotSuggestions";
import { useBotsNavigation } from "./navigation";
import {
  bots,
  inboxQueryInput,
  useBots,
  useBotsAccess,
  useBotsHost,
  useRefreshWhenBotsChangesPruned,
} from "./state";

const PREFERENCES_KEY = "loom:bots:collection-view:v1";
const BotsPreferences = Schema.Struct({
  view: Schema.Literals(["cards", "list"]),
  sort: Schema.Literals(BOT_SORTS),
  days: Schema.Literals(BOT_USAGE_WINDOWS),
});
type BotsPreferences = typeof BotsPreferences.Type;
const DEFAULT_PREFERENCES: BotsPreferences = { view: "cards", sort: "activity", days: 7 };

/**
 * How the collection is laid out and which usage window it reads. The index header and a bot's
 * vitals read the same window, so a figure means the same span wherever it appears.
 */
export function useBotsCollectionPreferences() {
  return useLocalStorage(PREFERENCES_KEY, DEFAULT_PREFERENCES, BotsPreferences);
}

/**
 * The newest runs across every bot, or one bot's, with watched progress applied. The input is the
 * one the Runs view asks for unfiltered, so the collection, a bot's page and its Runs share it.
 */
export function useNewestRuns(botId: string | null) {
  const { host, live, changes } = useBots();
  const query = useEnvironmentQuery(
    host.environmentId && live
      ? bots.listRuns({
          environmentId: host.environmentId,
          input: { limit: BOTS_LIST_RUNS_MAX_LIMIT, ...(botId ? { botId } : {}) },
        })
      : null,
  );
  useRefreshWhenBotsChangesPruned(changes, query.refresh);
  const runs = applyRunChanges(query.data?.runs ?? [], changes, {
    botId: botId ?? undefined,
    includeNew: true,
    limit: BOTS_LIST_RUNS_MAX_LIMIT,
  });
  return {
    query,
    runs,
    /** A full list may leave out older runs, so a bot missing from it may still have run. */
    full: Boolean(query.data?.hasMore) || runs.length >= BOTS_LIST_RUNS_MAX_LIMIT,
    loading: query.isPending && !query.data,
    unavailable: query.error !== null && !query.data,
  };
}

/** The shipped starters and how each bot that came from one has drifted from it. */
export function useBotStarters() {
  const { host, live } = useBots();
  const query = useEnvironmentQuery(
    host.environmentId && live && host.startersSupported
      ? bots.listStarters({ environmentId: host.environmentId, input: {} })
      : null,
  );
  const starters = query.data?.starters ?? [];
  return {
    query,
    starterOf: (bot: BotDefinition) =>
      bot.origin === undefined
        ? undefined
        : starters.find((starter) => starter.starterId === bot.origin?.starterId),
    removed: starters.filter((starter) => starter.state === "removed"),
  };
}

const failureDescription = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error ? { description: cause.message } : {};
};

/** Archiving, deleting and restoring bots, with the same confirmations and toasts everywhere. */
export function useBotLifecycle() {
  const host = useBotsHost();
  const archive = useAtomCommand(bots.archive, { reportFailure: false });
  const remove = useAtomCommand(bots.delete, { reportFailure: false });
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });
  const environmentId = host.environmentId;

  const setArchived = async (
    bot: BotDefinition,
    archived: boolean,
    undoable = true,
  ): Promise<boolean> => {
    if (!environmentId) return false;
    const result = await archive({ environmentId, input: { botId: bot.id, archived } });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: archived ? `Could not archive ${bot.name}` : `Could not restore ${bot.name}`,
        ...failureDescription(result),
      });
      return false;
    }
    if (undoable)
      toastManager.add({
        type: "success",
        title: archived ? `Archived ${bot.name}` : `Restored ${bot.name}`,
        description: archived
          ? "Its runs stay readable. Restore it from Archived to run it again."
          : "It can run again.",
        actionProps: {
          children: "Undo",
          onClick: () => void setArchived(bot, !archived, false),
        },
      });
    return true;
  };

  const deleteBot = async (bot: BotDefinition): Promise<boolean> => {
    if (!environmentId) return false;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete ${bot.name}? Its triggers, with their webhook URLs and secrets, are deleted too. Its past runs stay under Runs; the bot itself cannot be restored.`,
    );
    if (!confirmed) return false;
    const result = await remove({ environmentId, input: { botId: bot.id } });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: `Could not delete ${bot.name}`,
        ...failureDescription(result),
      });
      return false;
    }
    toastManager.add({
      type: "success",
      title: `Deleted ${bot.name}`,
      description: "Its past runs stay under Runs.",
    });
    return true;
  };

  /** Brings back a removed starter, or resets a bot to its starter after `confirm`. */
  const restore = async (
    starter: Pick<BotStarterStatus, "starterId" | "name">,
    confirm?: string,
  ): Promise<BotDefinition | null> => {
    if (!environmentId) return null;
    if (confirm !== undefined && !(await ensureLocalApi().dialogs.confirm(confirm))) return null;
    const result = await restoreStarter({
      environmentId,
      input: { starterId: starter.starterId },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: `Could not restore ${starter.name}`,
        ...failureDescription(result),
      });
      return null;
    }
    return result.value;
  };

  return { setArchived, deleteBot, restore };
}

/** The quick moves on a bot that don't need its page. */
export function BotActionsMenu({ bot }: { readonly bot: BotDefinition }) {
  const host = useBotsHost();
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const lifecycle = useBotLifecycle();
  const archived = bot.archivedAt !== null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Actions for ${bot.name}`}
            className="relative z-10 -me-1"
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        {archived ? (
          <MenuItem
            disabled={!access.canSave}
            onClick={() => void lifecycle.setArchived(bot, false)}
          >
            <ArchiveRestoreIcon />
            Restore
          </MenuItem>
        ) : (
          <>
            <MenuItem disabled={!access.canRun} onClick={() => nav.overlay({ run: bot.id })}>
              <PlayIcon />
              Run
            </MenuItem>
            {host.batchesSupported && bot.parameters.length ? (
              <MenuItem disabled={!access.canRun} onClick={() => nav.overlay({ many: bot.id })}>
                <LayersIcon />
                Run on many
              </MenuItem>
            ) : null}
          </>
        )}
        <MenuItem disabled={!access.canSave} onClick={() => nav.open({ bot: bot.id, edit: true })}>
          <PencilIcon />
          Edit
        </MenuItem>
        {host.triggersSupported && !archived ? (
          <MenuItem
            disabled={!access.canOperateTriggers}
            onClick={() => nav.overlay({ newTrigger: bot.id })}
          >
            <ZapIcon />
            Add trigger
          </MenuItem>
        ) : null}
        <MenuSeparator />
        {archived ? (
          <MenuItem
            variant="destructive"
            disabled={!access.canSave}
            onClick={() => void lifecycle.deleteBot(bot)}
          >
            <Trash2Icon />
            Delete
          </MenuItem>
        ) : (
          <MenuItem
            disabled={!access.canSave}
            onClick={() => void lifecycle.setArchived(bot, true)}
          >
            <ArchiveIcon />
            Archive
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}

const MAX_TICKS = 24;
const EMPTY_TICKS: readonly LibraryTick[] = Array.from({ length: MAX_TICKS }, (_, slot) => ({
  key: `empty-${slot}`,
  tone: null,
}));

/** A bot's latest runs as ticks, oldest first, padded so a short history reads as a full track. */
export function runTicks(runs: readonly BotRun[], slots: number): LibraryTick[] {
  const shown = chronological(runs, Math.min(slots, MAX_TICKS));
  return [
    ...EMPTY_TICKS.slice(0, Math.min(slots, MAX_TICKS) - shown.length),
    ...shown.map((run) => ({
      key: run.id,
      tone: runTone(run),
      label: `${runOutcomeLabel(run)}, ${runTime(run.finishedAt ?? run.startedAt ?? run.createdAt) ?? "time unknown"}`,
    })),
  ];
}

const runAt = (run: BotRun) => run.finishedAt ?? run.startedAt ?? run.createdAt;

/** The newest runs are a window; what a bot's last run was depends on whether it fits in it. */
function BotLastRun({
  recent,
  full,
  loading,
  unavailable,
}: {
  readonly recent: readonly BotRun[];
  readonly full: boolean;
  readonly loading: boolean;
  readonly unavailable: boolean;
}) {
  if (loading) return <Skeleton className="h-3 w-14" />;
  if (unavailable) return <span className="text-muted-foreground/70">Unavailable</span>;
  const state = lastRunState(recent, full);
  if (state.kind === "run")
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <LibraryStateDot tone={runTone(state.run)} className="size-1.5" />
        {runTime(runAt(state.run))}
      </span>
    );
  if (state.kind === "none") return <span className="text-muted-foreground/70">No runs yet</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="relative cursor-default whitespace-nowrap text-muted-foreground/70" />
        }
      >
        Not recent
      </TooltipTrigger>
      <TooltipPopup side="top">
        Not among the latest {BOTS_LIST_RUNS_MAX_LIMIT} runs across your bots
      </TooltipPopup>
    </Tooltip>
  );
}

type UsageReading = {
  readonly supported: boolean;
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly days: BotUsageDays;
};

/**
 * How often the bot succeeds: from usage over the window, or, on a server without usage, from its
 * runs among the newest. Either way the tooltip says what the figure counts.
 */
function BotSuccess({
  row,
  recent,
  usage,
}: {
  readonly row: BotUsageRow | undefined;
  readonly recent: readonly BotRun[];
  readonly usage: UsageReading;
}) {
  if (usage.supported) {
    if (usage.loading) return <Skeleton className="h-3 w-10" />;
    if (usage.unavailable) return <span className="text-muted-foreground/70">Unavailable</span>;
    const figure = successFigure(row);
    if (!figure)
      return (
        <span className="whitespace-nowrap text-muted-foreground/70">
          No runs in {BOT_USAGE_WINDOW_SHORT[usage.days]}
        </span>
      );
    return (
      <SuccessReading
        share={figure.share}
        label={figure.label}
        detail={`${figure.label} ${figure.detail} finished runs, ${BOT_USAGE_WINDOW_LABELS[usage.days].toLowerCase()}`}
      />
    );
  }
  const record = botRecord(recent);
  if (!record.finished) return <span className="text-muted-foreground/70">No finished runs</span>;
  return (
    <SuccessReading
      share={record.passed / record.finished}
      label="Passed"
      detail={`Passed ${record.passed} of its latest ${record.finished} finished runs`}
    />
  );
}

function SuccessReading({
  share,
  label,
  detail,
}: {
  readonly share: number;
  readonly label: string;
  readonly detail: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="relative cursor-default whitespace-nowrap" />}>
        <span className="font-medium text-foreground">{formatPercent(share, 0)}</span>{" "}
        {label.toLowerCase()}
      </TooltipTrigger>
      <TooltipPopup side="top">{detail}</TooltipPopup>
    </Tooltip>
  );
}

/** What a bot is waiting on or doing right now, as the badges a card or row leads with. */
function BotSignals({
  bot,
  facts,
  starter,
}: {
  readonly bot: BotDefinition;
  readonly facts: BotFacts;
  readonly starter: BotStarterStatus | undefined;
}) {
  const running = activeRuns(facts.recent);
  const atLimit = budgetLevel(facts.budget) === "at";
  if (!facts.needsYou && !running && !atLimit && !starter && bot.library == null) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="State">
      {facts.needsYou ? (
        <li>
          <LibraryStateBadge tone="warning" icon={HandIcon}>
            {facts.needsYou} {facts.needsYou === 1 ? "needs" : "need"} you
          </LibraryStateBadge>
        </li>
      ) : null}
      {running ? (
        <li>
          <LibraryStateBadge tone="active">
            {running === 1 ? "Running" : `${running} running`}
          </LibraryStateBadge>
        </li>
      ) : null}
      {atLimit ? (
        <li>
          <LibraryStateBadge tone="warning" icon={GaugeIcon}>
            At its daily limit
          </LibraryStateBadge>
        </li>
      ) : null}
      {starter ? (
        <li>
          <StarterBadge status={starter} />
        </li>
      ) : null}
      {bot.library == null ? null : (
        <li>
          <LibraryStateBadge tone="neutral">In the Library</LibraryStateBadge>
        </li>
      )}
    </ul>
  );
}

type CollectionItem = {
  readonly bot: BotDefinition;
  readonly facts: BotFacts;
  readonly starter: BotStarterStatus | undefined;
};

type CollectionContext = {
  readonly usage: UsageReading;
  readonly runs: {
    readonly full: boolean;
    readonly loading: boolean;
    readonly unavailable: boolean;
  };
};

const CARD_TICKS = 20;

function BotCard({
  item,
  context,
}: {
  readonly item: CollectionItem;
  readonly context: CollectionContext;
}) {
  const { bot, facts, starter } = item;
  const nav = useBotsNavigation();
  return (
    <li style={projectColorStyle(botColor(bot))} className={cn(LIBRARY_CARD, "min-h-44")}>
      <ProjectWash />
      <LibraryCardTarget label={bot.name} onOpen={() => nav.open({ bot: bot.id })} />
      <div className="flex items-start gap-3">
        <BotTile bot={bot} size="lg" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="truncate text-sm font-semibold leading-5 tracking-tight">{bot.name}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {formatModelSlugName(bot.modelSelection.model)}
          </p>
        </div>
        <BotActionsMenu bot={bot} />
      </div>
      {bot.description.trim() ? (
        <p className="line-clamp-2 text-xs leading-4.5 text-muted-foreground">{bot.description}</p>
      ) : (
        <p className="text-xs leading-4.5 text-muted-foreground/60">No description yet</p>
      )}
      <BotSignals bot={bot} facts={facts} starter={starter} />
      <div className="mt-auto flex items-center gap-3 border-t border-border/70 pt-3">
        {context.runs.loading ? (
          <Skeleton className="h-4 w-28" />
        ) : (
          <TickStrip
            label={`${bot.name}'s latest runs`}
            ticks={runTicks(facts.recent, CARD_TICKS)}
          />
        )}
        <div className="ms-auto flex min-w-0 items-center gap-2.5 text-xs tabular-nums text-muted-foreground">
          <BotSuccess row={facts.row} recent={facts.recent} usage={context.usage} />
          <BotLastRun recent={facts.recent} {...context.runs} />
        </div>
      </div>
    </li>
  );
}

/** Archived bots keep a face, a smaller one, so they stay easy to find without crowding. */
function ArchivedBotCard({ bot }: { readonly bot: BotDefinition }) {
  const nav = useBotsNavigation();
  return (
    <li
      style={projectColorStyle(botColor(bot))}
      className={cn(LIBRARY_CARD, "flex-row items-center gap-2.5 py-2 ps-2.5 pe-2")}
    >
      <ProjectWash />
      <LibraryCardTarget label={bot.name} onOpen={() => nav.open({ bot: bot.id })} />
      <span className="opacity-70 grayscale transition-[filter,opacity] duration-200 group-hover/card:opacity-100 group-hover/card:grayscale-0">
        <BotTile bot={bot} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium leading-5">{bot.name}</h3>
        <p className="truncate text-xs tabular-nums text-muted-foreground">
          Archived {bot.archivedAt ? formatRelativeTimeLabel(bot.archivedAt) : ""}
        </p>
      </div>
      <BotActionsMenu bot={bot} />
    </li>
  );
}

const ROW_TICKS = 16;

function BotRows({
  items,
  context,
  showBudget,
}: {
  readonly items: readonly CollectionItem[];
  readonly context: CollectionContext;
  readonly showBudget: boolean;
}) {
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const short = BOT_USAGE_WINDOW_SHORT[context.usage.days];
  const maxTokens = Math.max(0, ...items.map(({ facts }) => facts.row?.tokens.total ?? 0));
  const columns = [
    { key: "bot", label: "Bot" },
    { key: "recent", label: "Recent runs", className: "hidden w-36 sm:table-cell" },
    {
      key: "success",
      label: context.usage.supported ? `Success · ${short}` : "Success · latest",
      className: "hidden w-32 md:table-cell",
    },
    ...(context.usage.supported
      ? [{ key: "tokens", label: `Tokens · ${short}`, className: "hidden w-36 lg:table-cell" }]
      : []),
    ...(showBudget
      ? [{ key: "budget", label: "Budget", className: "hidden w-32 xl:table-cell" }]
      : []),
    { key: "last", label: "Last run", className: "hidden w-28 md:table-cell" },
    { key: "actions", label: "Actions", hideLabel: true, className: "w-20" },
  ];
  return (
    <LibraryTable label="Bots" columns={columns}>
      {items.map(({ bot, facts, starter }) => {
        const archived = bot.archivedAt !== null;
        return (
          <tr
            key={bot.id}
            style={projectColorStyle(botColor(bot))}
            className={cn(LIBRARY_TABLE_ROW, archived && "text-muted-foreground")}
          >
            <td className={LIBRARY_CELL}>
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn(archived && "opacity-70 grayscale")}>
                  <BotTile bot={bot} size="sm" />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      to="/loom/bots"
                      search={{ bot: bot.id }}
                      className={cn(LIBRARY_ROW_TARGET, "truncate font-medium")}
                    >
                      {bot.name}
                    </Link>
                    {archived ? (
                      <LibraryStateBadge tone="neutral" icon={ArchiveIcon}>
                        Archived
                      </LibraryStateBadge>
                    ) : null}
                    {facts.needsYou ? (
                      <LibraryStateBadge tone="warning" icon={HandIcon}>
                        {facts.needsYou}
                        <span className="sr-only"> need you</span>
                      </LibraryStateBadge>
                    ) : null}
                    {starter?.state === "outdated" ? <StarterBadge status={starter} /> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {bot.description.trim() || formatModelSlugName(bot.modelSelection.model)}
                  </p>
                </div>
              </div>
            </td>
            <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
              {context.runs.loading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <TickStrip
                  label={`${bot.name}'s latest runs`}
                  ticks={runTicks(facts.recent, ROW_TICKS)}
                />
              )}
            </td>
            <td className={cn(LIBRARY_CELL, "hidden text-xs tabular-nums md:table-cell")}>
              <BotSuccess row={facts.row} recent={facts.recent} usage={context.usage} />
            </td>
            {context.usage.supported ? (
              <td className={cn(LIBRARY_CELL, "hidden lg:table-cell")}>
                {context.usage.loading ? (
                  <Skeleton className="h-3 w-16" />
                ) : (
                  <BotTokensCell row={facts.row} max={maxTokens} />
                )}
              </td>
            ) : null}
            {showBudget ? (
              <td className={cn(LIBRARY_CELL, "hidden xl:table-cell")}>
                <BotBudgetMeter botId={bot.id} />
              </td>
            ) : null}
            <td className={cn(LIBRARY_CELL, "hidden text-xs tabular-nums md:table-cell")}>
              <BotLastRun recent={facts.recent} {...context.runs} />
            </td>
            <td className={cn(LIBRARY_CELL, "py-1.5 text-end")}>
              {/* Raised over the row's stretched target so each stays its own button. */}
              <span className="relative inline-flex items-center gap-0.5">
                {archived ? null : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          shape="pill"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Run ${bot.name}`}
                          disabled={!access.canRun}
                          onClick={() => nav.overlay({ run: bot.id })}
                        />
                      }
                    >
                      <PlayIcon />
                    </TooltipTrigger>
                    <TooltipPopup side="top">Run</TooltipPopup>
                  </Tooltip>
                )}
                <BotActionsMenu bot={bot} />
              </span>
            </td>
          </tr>
        );
      })}
    </LibraryTable>
  );
}

const toggled = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

/**
 * Every bot on the server, Cards or List like Projects: what needs a person first, then the bots
 * with how they have been doing, then ways to start a new one.
 */
export function BotsCollection() {
  const { host, live, changes, list, bots: allBots } = useBots();
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const [preferences, setPreferences] = useBotsCollectionPreferences();
  const [query, setQuery] = useState("");
  const [states, setStates] = useState<ReadonlySet<BotStateFilter>>(new Set());
  const [origins, setOrigins] = useState<ReadonlySet<BotOriginFilter>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const newest = useNewestRuns(null);
  const usage = useBotUsage(preferences.days);
  const starters = useBotStarters();
  const lifecycle = useBotLifecycle();
  const inbox = useEnvironmentQuery(
    host.environmentId && live && host.inboxSupported
      ? bots.inbox({ environmentId: host.environmentId, input: inboxQueryInput(false) })
      : null,
  );
  const needsYou = countByBot(
    inbox.data ? applyInboxChanges(inbox.data, changes, { dismissed: false }).runs : [],
  );
  const recentByBot = runsByBot(newest.runs);
  const factsOf = (bot: BotDefinition): BotFacts => ({
    recent: recentByBot.get(bot.id) ?? [],
    row: usage.rowOf(bot.id),
    budget: usage.budgetOf(bot.id),
    needsYou: needsYou.get(bot.id) ?? 0,
  });
  const usageSupported = host.budgetsSupported;
  const sort: BotSort =
    preferences.sort === "tokens" && !usageSupported ? "activity" : preferences.sort;
  const current = allBots.filter((bot) => bot.archivedAt === null);
  const archived = allBots.filter((bot) => bot.archivedAt !== null);
  const viewBots = showArchived ? archived : current;
  const filters = { query, states, origins };
  const matching = (pool: readonly BotDefinition[]) =>
    pool.filter((bot) => matchesBotFilters(bot, factsOf(bot), filters));
  const shown = sortBots(matching(viewBots), sort, factsOf);
  const otherMatches = matching(showArchived ? current : archived).length;
  const narrowed = query.trim() !== "" || states.size > 0 || origins.size > 0;
  const clearFilters = () => {
    setQuery("");
    setStates(new Set());
    setOrigins(new Set());
  };
  const items = shown.map((bot) => ({
    bot,
    facts: factsOf(bot),
    starter: starters.starterOf(bot),
  }));
  const context: CollectionContext = {
    usage: {
      supported: usageSupported,
      loading: usageSupported && usage.isPending && !usage.usage,
      unavailable: usageSupported && usage.error !== null && !usage.usage,
      days: preferences.days,
    },
    runs: { full: newest.full, loading: newest.loading, unavailable: newest.unavailable },
  };
  const stateOptions = BOT_STATE_FILTERS.filter(
    (state) =>
      (state !== "attention" || host.inboxSupported) && (state !== "budget" || usageSupported),
  );
  // Each option counts the bots in view it would keep alongside the search and other filters.
  const stateCounts = new Map(
    stateOptions.map((state) => [
      state,
      viewBots.filter((bot) =>
        matchesBotFilters(bot, factsOf(bot), { query, states: new Set([state]), origins }),
      ).length,
    ]),
  );
  const originCounts = new Map(
    BOT_ORIGIN_FILTERS.map((origin) => [
      origin,
      viewBots.filter((bot) => (bot.origin === undefined ? "custom" : "starter") === origin).length,
    ]),
  );
  const showBudget =
    usageSupported &&
    allBots.some(
      (bot) => bot.budget?.runsPerDay !== undefined || bot.budget?.tokensPerDay !== undefined,
    );
  const restoreRemoved = async (starter: BotStarterStatus) => {
    const restored = await lifecycle.restore(starter);
    if (restored) nav.open({ bot: restored.id });
  };

  return (
    <div className="flex flex-col gap-6">
      <NeedsYouBand bot={null} />
      {allBots.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <LibrarySearch
            value={query}
            onChange={setQuery}
            placeholder="Search names, descriptions, inputs"
            label="Search bots"
          />
          <BotFilterMenu
            stateOptions={stateOptions}
            stateCounts={stateCounts}
            originCounts={originCounts}
            states={states}
            origins={origins}
            onToggleState={(state) => setStates((selected) => toggled(selected, state))}
            onToggleOrigin={(origin) => setOrigins((selected) => toggled(selected, origin))}
          />
          {[...states].map((state) => (
            <LibraryFilterChip
              key={state}
              label={BOT_STATE_FILTER_LABELS[state]}
              removeLabel={`Stop showing only bots that ${STATE_REMOVE_LABELS[state]}`}
              onRemove={() => setStates((selected) => toggled(selected, state))}
            />
          ))}
          {[...origins].map((origin) => (
            <LibraryFilterChip
              key={origin}
              label={BOT_ORIGIN_FILTER_LABELS[origin]}
              removeLabel={`Stop showing only ${origin === "starter" ? "starters" : "your own bots"}`}
              onRemove={() => setOrigins((selected) => toggled(selected, origin))}
            />
          ))}
          <div className="ms-auto flex items-center gap-1.5">
            {archived.length || showArchived ? (
              <ToggleGroup
                shape="pill"
                aria-label="Which bots"
                variant="segmented"
                value={[showArchived ? "archived" : "current"]}
                onValueChange={(value) => {
                  if (value[0] === "current" || value[0] === "archived")
                    setShowArchived(value[0] === "archived");
                }}
              >
                <ToggleGroupItem value="current">
                  Current
                  <span className="tabular-nums opacity-60">{current.length}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="archived">
                  Archived
                  <span className="tabular-nums opacity-60">{archived.length}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            <BotDisplayMenu
              preferences={{ ...preferences, sort }}
              usageSupported={usageSupported}
              onChange={setPreferences}
            />
            <LibraryLayoutToggle
              value={preferences.view}
              onChange={(view) => setPreferences({ ...preferences, view })}
            />
          </div>
        </div>
      ) : null}
      <LibraryErrorNotice
        error={newest.unavailable ? newest.query.error : null}
        onRetry={newest.query.refresh}
      />
      <LibraryErrorNotice
        error={context.usage.unavailable ? usage.error : null}
        onRetry={usage.refresh}
      />
      {showArchived && shown.length ? (
        <p className="-mt-2 max-w-2xl text-xs text-muted-foreground">
          Set aside. Their runs stay readable, and they stay out of Run menus and triggers until you
          restore them.
        </p>
      ) : null}
      {shown.length ? (
        preferences.view === "list" ? (
          <BotRows items={items} context={context} showBudget={showBudget} />
        ) : showArchived ? (
          <ul
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
            aria-label="Archived bots"
          >
            {shown.map((bot) => (
              <ArchivedBotCard key={bot.id} bot={bot} />
            ))}
          </ul>
        ) : (
          <ul className={LIBRARY_CARD_GRID} aria-label="Bots">
            {items.map((item) => (
              <BotCard key={item.bot.id} item={item} context={context} />
            ))}
          </ul>
        )
      ) : list.error && !list.data ? null : narrowed ? (
        <CollectionEmpty
          title={`No ${showArchived ? "archived " : ""}bots match`}
          description="Search looks at names, descriptions and inputs."
        >
          {otherMatches ? (
            <Button
              shape="pill"
              size="sm"
              variant="secondary"
              onClick={() => setShowArchived(!showArchived)}
            >
              Show {otherMatches} {showArchived ? "current" : "archived"}
            </Button>
          ) : null}
          <Button shape="pill" size="sm" variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        </CollectionEmpty>
      ) : showArchived ? (
        <CollectionEmpty
          title="No archived bots"
          description="Archiving keeps a bot's runs readable and takes it out of Run menus. Restore it whenever you need it."
        />
      ) : archived.length ? (
        <CollectionEmpty
          title="Everything is archived"
          description="Open Archived to restore a bot, or create a new one."
        >
          <Button
            shape="pill"
            size="sm"
            disabled={!access.canSave}
            onClick={() => nav.open({ newBot: true })}
          >
            <PlusIcon />
            New bot
          </Button>
        </CollectionEmpty>
      ) : (
        <FirstBotEmpty
          removed={starters.removed}
          canSave={access.canSave}
          fromThread={host.fromThreadSupported}
          onRestore={(starter) => void restoreRemoved(starter)}
        />
      )}
      {host.fromThreadSupported ? <BotSuggestionsSection /> : null}
      {starters.removed.length && allBots.length ? (
        <section aria-label="Starters you removed" className="flex flex-col gap-2">
          <LibraryGroupHeading
            title="Starters you removed"
            count={starters.removed.length}
            hint="Each comes back with its original brief."
          />
          <ul className={cn(LIBRARY_OUTLINE, "divide-y divide-border")}>
            {starters.removed.map((starter) => (
              <li key={starter.starterId} className="flex items-center gap-3 px-3 py-2">
                <BotTile
                  bot={{
                    id: starter.starterId,
                    origin: {
                      kind: "starter",
                      starterId: starter.starterId,
                      revision: starter.revision,
                    },
                  }}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{starter.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {starter.description}
                  </span>
                </span>
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  disabled={!access.canSave}
                  onClick={() => void restoreRemoved(starter)}
                >
                  <ArchiveRestoreIcon />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const STATE_REMOVE_LABELS: Record<BotStateFilter, string> = {
  failing: "failed lately",
  attention: "need you",
  budget: "are at or near their budget",
};

function CollectionEmpty({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border">
      <Empty size="compact">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {children ? (
          <EmptyContent className="flex-row justify-center">{children}</EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}

const STARTER_TILES = [
  { id: "reviewer", offset: "-rotate-6 translate-y-1" },
  { id: "verifier", offset: "z-10 -translate-y-1" },
  { id: "merge-conflict-resolver", offset: "rotate-6 translate-y-1" },
] as const;

/** The first-run state: what a bot is, the one way to make one, and the starters to come back to. */
function FirstBotEmpty({
  removed,
  canSave,
  fromThread,
  onRestore,
}: {
  readonly removed: readonly BotStarterStatus[];
  readonly canSave: boolean;
  readonly fromThread: boolean;
  readonly onRestore: (starter: BotStarterStatus) => void;
}) {
  const nav = useBotsNavigation();
  return (
    <div className="rounded-xl border border-dashed border-border">
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <div aria-hidden className="flex items-center -space-x-2">
              {STARTER_TILES.map(({ id, offset }) => (
                <span
                  key={id}
                  className={cn("rounded-2xl bg-background ring-4 ring-background", offset)}
                >
                  <BotTile
                    bot={{ id, origin: { kind: "starter", starterId: id, revision: 1 } }}
                    size="xl"
                  />
                </span>
              ))}
            </div>
          </EmptyMedia>
          <EmptyTitle>Create your first bot</EmptyTitle>
          <EmptyDescription>
            A bot is a job you hand to agents again and again, such as a review or a release check.
            Its instructions, inputs and settings stay fixed, so every run starts from the same
            brief.
            {fromThread
              ? " You can also save a thread you would repeat as a bot from its menu."
              : ""}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button shape="pill" disabled={!canSave} onClick={() => nav.open({ newBot: true })}>
            <PlusIcon />
            New bot
          </Button>
          {removed.length ? (
            <Menu>
              <MenuTrigger disabled={!canSave} render={<Button shape="pill" variant="outline" />}>
                Start from a starter
              </MenuTrigger>
              <MenuPopup side="bottom" align="center">
                {removed.map((starter) => (
                  <MenuItem key={starter.starterId} onClick={() => onRestore(starter)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{starter.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {starter.description}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : null}
        </EmptyContent>
      </Empty>
    </div>
  );
}

/**
 * Narrowing behind one control, as Projects does it, so a handful of filters never turns into a
 * row of toggles. Each option shows how many bots in view it would keep.
 */
function BotFilterMenu({
  stateOptions,
  stateCounts,
  originCounts,
  states,
  origins,
  onToggleState,
  onToggleOrigin,
}: {
  readonly stateOptions: readonly BotStateFilter[];
  readonly stateCounts: ReadonlyMap<BotStateFilter, number>;
  readonly originCounts: ReadonlyMap<BotOriginFilter, number>;
  readonly states: ReadonlySet<BotStateFilter>;
  readonly origins: ReadonlySet<BotOriginFilter>;
  readonly onToggleState: (state: BotStateFilter) => void;
  readonly onToggleOrigin: (origin: BotOriginFilter) => void;
}) {
  // Telling starters apart only helps once there are both kinds.
  const showOrigins =
    origins.size > 0 || BOT_ORIGIN_FILTERS.every((origin) => (originCounts.get(origin) ?? 0) > 0);
  const active = states.size + origins.size;
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
        <MenuGroup>
          <MenuGroupLabel>State</MenuGroupLabel>
          {stateOptions.map((state) => (
            <MenuCheckboxItem
              key={state}
              checked={states.has(state)}
              onCheckedChange={() => onToggleState(state)}
            >
              <span className="flex w-full items-center gap-2">
                <span className="flex-1">{BOT_STATE_FILTER_LABELS[state]}</span>
                <span className="ps-4 text-xs tabular-nums text-muted-foreground">
                  {stateCounts.get(state) ?? 0}
                </span>
              </span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {showOrigins ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Made by</MenuGroupLabel>
              {BOT_ORIGIN_FILTERS.map((origin) => (
                <MenuCheckboxItem
                  key={origin}
                  checked={origins.has(origin)}
                  onCheckedChange={() => onToggleOrigin(origin)}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="flex-1">{BOT_ORIGIN_FILTER_LABELS[origin]}</span>
                    <span className="ps-4 text-xs tabular-nums text-muted-foreground">
                      {originCounts.get(origin) ?? 0}
                    </span>
                  </span>
                </MenuCheckboxItem>
              ))}
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function BotDisplayMenu({
  preferences,
  usageSupported,
  onChange,
}: {
  readonly preferences: BotsPreferences;
  readonly usageSupported: boolean;
  readonly onChange: (preferences: BotsPreferences) => void;
}) {
  const sorts = BOT_SORTS.filter((sort) => sort !== "tokens" || usageSupported);
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="ghost" />}>
        <SlidersHorizontalIcon />
        Display
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuGroup>
          <MenuGroupLabel>Sort by</MenuGroupLabel>
          <MenuRadioGroup
            value={preferences.sort}
            onValueChange={(value) => {
              const sort = sorts.find((entry) => entry === value);
              if (sort) onChange({ ...preferences, sort });
            }}
          >
            {sorts.map((sort) => (
              <MenuRadioItem key={sort} value={sort}>
                {BOT_SORT_LABELS[sort]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {usageSupported ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Usage over</MenuGroupLabel>
              <MenuRadioGroup
                value={String(preferences.days)}
                onValueChange={(value) => {
                  const days = BOT_USAGE_WINDOWS.find((entry) => String(entry) === value);
                  if (days) onChange({ ...preferences, days });
                }}
              >
                {BOT_USAGE_WINDOWS.map((days) => (
                  <MenuRadioItem key={days} value={String(days)}>
                    {BOT_USAGE_WINDOW_LABELS[days]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

const SKELETON_CARDS = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** The collection's own shape while bots load, in the layout last chosen. */
export function BotsCollectionSkeleton({ view }: { readonly view: LibraryLayout }) {
  return (
    <div role="status" aria-label="Loading bots" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton shape="pill" className="h-8 w-full sm:w-72" />
        <Skeleton shape="pill" className="h-8 w-22" />
        <div className="ms-auto flex items-center gap-1.5">
          <Skeleton shape="pill" className="h-8 w-22" />
          <Skeleton shape="pill" className="h-8 w-18" />
        </div>
      </div>
      {view === "cards" ? (
        <div className={LIBRARY_CARD_GRID}>
          {SKELETON_CARDS.map((card) => (
            <div
              key={card}
              className="flex min-h-44 flex-col gap-3 rounded-xl border border-border p-3.5"
            >
              <div className="flex items-center gap-3">
                <Skeleton shape="card" className="size-11" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <div className="mt-auto flex items-center gap-3 border-t border-border/70 pt-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="ms-auto h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {SKELETON_CARDS.slice(0, 5).map((row) => (
            <div key={row} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton shape="card" className="size-6" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-40 max-w-full" />
                <Skeleton className="h-2.5 w-64 max-w-full" />
              </div>
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="hidden h-3 w-16 md:block" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
