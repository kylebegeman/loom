import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
  isActiveBotPipelineRunStatus,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineId,
  type BotPipelineRun,
  type BotPipelineUsageRow,
} from "@t3tools/contracts/fork";
import {
  applyPipelineRunChanges,
  applyTriggerChanges,
  BOT_PIPELINE_RUN_STATES,
  libraryProjectColor,
  pipelineDraft,
  TRIGGER_KIND_LABELS,
  type LibraryWorkflowTone,
  type PipelineDraft,
  type PipelineStepDraft,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatTokens } from "@t3tools/shared/usageFormat";
import {
  EllipsisIcon,
  HistoryIcon,
  LayersIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  TextCursorInputIcon,
  Trash2Icon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_CARD,
  LIBRARY_CARD_GRID,
  LibraryHero,
  LibraryVital,
  LibraryVitals,
} from "../project-library/LibraryCollection";
import {
  LibraryEmpty,
  LibraryErrorNotice,
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
import { useLibraryPermission } from "../project-library/state";
import { ProjectWash } from "../project-library/ProjectCollection";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { BotTile, formatSpan, runDuration, runTime, VerdictChip } from "./BotIdentity";
import { useBotUsage } from "./BotsUsage";
import { useBotsNavigation } from "./navigation";
import {
  gateSummary,
  mappingSummary,
  pipelineRecord,
  pipelineRunsInput,
  pipelineRunTone,
  stepReaders,
} from "./pipelineDraft";
import {
  bots,
  useBotPipelineChanges,
  useBots,
  useBotsAccess,
  useBotsHost,
  useBotTriggerChanges,
  usePipelines,
} from "./state";

/** Above this many pipelines the index offers a search. */
const SEARCH_FROM = 6;
const CARD_TICKS = 12;
const PAGE_TICKS = 20;
const RECENT_RUNS_SHOWN = 8;
const USAGE_DAYS = 7;

/** A pipeline's stable color, from its id like a bot's, so its tile, page and runs match. */
export const pipelineColorStyle = (pipelineId: string) =>
  projectColorStyle(libraryProjectColor({ id: pipelineId }));

const TILE_SIZES = {
  sm: "size-6 rounded-md",
  md: "size-8 rounded-lg",
  lg: "size-11 rounded-xl",
  xl: "size-14 rounded-2xl",
  "2xl": "size-16 rounded-2xl",
} as const;
const TILE_ICON_SIZES = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
  xl: "size-6",
  "2xl": "size-7",
} as const;

/** A pipeline's mark. `neutral` is for a draft that has no id, and so no color, yet. */
export function PipelineTile({
  pipelineId,
  size = "md",
  neutral = false,
}: {
  readonly pipelineId: string;
  readonly size?: keyof typeof TILE_SIZES;
  readonly neutral?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={neutral ? undefined : pipelineColorStyle(pipelineId)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        neutral
          ? "bg-muted text-muted-foreground dark:bg-accent"
          : "bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
        TILE_SIZES[size],
      )}
    >
      <WorkflowIcon className={TILE_ICON_SIZES[size]} />
    </span>
  );
}

/**
 * A pipeline's steps in a row: each its bot's tile and step id, joined by a neutral rule. A
 * per-item step wears a stack and a loop says how far back it goes, so the shape reads at once.
 */
export function PipelineChain({
  steps,
  botName,
}: {
  readonly steps: BotPipeline["steps"];
  readonly botName: (botId: string) => string | undefined;
}) {
  return (
    <ol aria-label="Steps" className="flex min-w-0 flex-wrap items-center gap-y-1.5">
      {steps.map((step, index) => (
        <li key={step.id} className="flex min-w-0 items-center">
          {index === 0 ? null : <span aria-hidden className="mx-1.5 h-px w-3 bg-border" />}
          <span className="flex min-w-0 items-center gap-1.5">
            <BotTile bot={{ id: step.botId }} size="sm" />
            <span className="max-w-32 truncate font-mono text-xs text-muted-foreground">
              {step.id}
              <span className="sr-only">, {botName(step.botId) ?? step.botId}</span>
            </span>
            {step.forEach ? (
              <LayersIcon aria-label="Once per item" className="size-3 text-muted-foreground" />
            ) : null}
            {typeof step.onFail === "object" ? (
              <span className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground">
                <RotateCcwIcon aria-hidden className="size-3" />
                <span className="sr-only">Goes back to</span>
                {step.onFail.goTo}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Why an action is off: the host is away, or this connection may not take it. */
export const actionReason = (connected: boolean, allowed: boolean, action: string) =>
  allowed ? null : connected ? `This connection cannot ${action}.` : `Reconnect to ${action}.`;

/**
 * A disabled control with its reason on hover and focus. A disabled button takes no pointer or
 * focus, so the reason rides on a focusable wrapper around it.
 */
export function WithReason({
  reason,
  children,
}: {
  readonly reason: string | null;
  readonly children: ReactNode;
}) {
  if (reason === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={reason}
            className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  );
}

/** Changes missed while the host was away never arrive, so coming back refetches. */
export function useRefreshOnReconnect(connected: boolean, refresh: () => void) {
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected, refresh]);
}

/** A pipeline's newest runs, watched, from the request every view shares. */
export function usePipelineRuns(
  environmentId: EnvironmentId,
  connected: boolean,
  pipelineId?: BotPipelineId,
) {
  const changes = useBotPipelineChanges(environmentId, connected);
  const query = useEnvironmentQuery(
    bots.listPipelineRuns({ environmentId, input: pipelineRunsInput(pipelineId) }),
  );
  useRefreshOnReconnect(connected, query.refresh);
  const runs = applyPipelineRunChanges(query.data?.runs ?? [], changes, {
    pipelineId,
    includeNew: true,
  });
  return { query, runs, hasMore: query.data?.hasMore ?? false };
}

const runTicks = (runs: ReadonlyArray<BotPipelineRun>, slots: number) => {
  const shown = runs.slice(0, slots).toReversed();
  return [
    ...Array.from({ length: slots - shown.length }, (_, index) => ({
      key: `empty-${index}`,
      tone: null,
    })),
    ...shown.map((run) => ({
      key: run.id,
      tone: pipelineRunTone(run),
      label: `${BOT_PIPELINE_RUN_STATES[run.status].label}, ${runTime(run.createdAt) ?? ""}`,
    })),
  ];
};

const ticksLabel = (runs: ReadonlyArray<BotPipelineRun>) => {
  if (runs.length === 0) return "No runs yet";
  const record = pipelineRecord(runs);
  return `Last ${runs.length} ${runs.length === 1 ? "run" : "runs"}: ${record.passed} of ${record.finished} finished passed`;
};

export function PipelineRunStateBadge({ run }: { readonly run: BotPipelineRun }) {
  if (run.status === "completed" && run.finalVerdict !== null)
    return <VerdictChip verdict={run.finalVerdict} />;
  const state = BOT_PIPELINE_RUN_STATES[run.status];
  return <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>;
}

const runFacts = (run: BotPipelineRun) =>
  [
    `v${run.pipelineVersion}`,
    isActiveBotPipelineRunStatus(run.status) && run.cursorStepId !== null
      ? `at ${run.cursorStepId}`
      : null,
    run.startedBy === "agent" ? "by an agent" : null,
  ]
    .filter(Boolean)
    .join(" · ");

function PipelineRunRow({
  run,
  showPipeline,
}: {
  readonly run: BotPipelineRun;
  readonly showPipeline: boolean;
}) {
  const finished = !isActiveBotPipelineRunStatus(run.status);
  return (
    <tr className={LIBRARY_TABLE_ROW}>
      <td className={LIBRARY_CELL}>
        <Link
          to="/loom/bots"
          search={{ pipelineRun: run.id }}
          className={cn(LIBRARY_ROW_TARGET, "flex min-w-0 items-center gap-2.5")}
        >
          {showPipeline ? <PipelineTile pipelineId={run.pipelineId} size="sm" /> : null}
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {showPipeline ? run.pipelineName : runTime(run.createdAt)}
            </span>
            <span className="block truncate text-xs tabular-nums text-muted-foreground">
              {runFacts(run)}
            </span>
          </span>
        </Link>
      </td>
      <td className={LIBRARY_CELL}>
        <PipelineRunStateBadge run={run} />
      </td>
      <td
        className={cn(
          LIBRARY_CELL,
          "hidden text-end text-xs tabular-nums text-muted-foreground sm:table-cell",
        )}
      >
        {finished ? runDuration(run.createdAt, run.finishedAt) : null}
      </td>
      {showPipeline ? (
        <td
          className={cn(
            LIBRARY_CELL,
            "text-end text-xs tabular-nums whitespace-nowrap text-muted-foreground",
          )}
        >
          {runTime(run.createdAt)}
        </td>
      ) : null}
    </tr>
  );
}

function ShowMoreRow({
  span,
  label,
  onClick,
}: {
  readonly span: number;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <tr>
      <td colSpan={span} className="px-3 py-2">
        <Button shape="pill" size="xs" variant="ghost" onClick={onClick}>
          {label}
        </Button>
      </td>
    </tr>
  );
}

/** One older page of runs, fetched only once asked for; its own last row asks for the next. */
function OlderPipelineRuns({
  environmentId,
  pipelineId,
  before,
  showPipeline,
  span,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineId: BotPipelineId | undefined;
  readonly before: string;
  readonly showPipeline: boolean;
  readonly span: number;
}) {
  const query = useEnvironmentQuery(
    bots.listPipelineRuns({
      environmentId,
      input: {
        limit: BOTS_LIST_PIPELINE_RUNS_MAX_LIMIT,
        before,
        ...(pipelineId === undefined ? {} : { pipelineId }),
      },
    }),
  );
  const [next, setNext] = useState<string | null>(null);
  const runs = query.data?.runs ?? [];
  const last = runs.at(-1);
  if (query.error)
    return (
      <tr>
        <td colSpan={span} className="px-3">
          <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
        </td>
      </tr>
    );
  if (!query.data)
    return (
      <tr>
        <td colSpan={span} className="px-3 py-2.5">
          <Skeleton className="h-3 w-40" />
        </td>
      </tr>
    );
  return (
    <>
      {runs.map((run) => (
        <PipelineRunRow key={run.id} run={run} showPipeline={showPipeline} />
      ))}
      {next !== null ? (
        <OlderPipelineRuns
          environmentId={environmentId}
          pipelineId={pipelineId}
          before={next}
          showPipeline={showPipeline}
          span={span}
        />
      ) : query.data.hasMore && last !== undefined ? (
        <ShowMoreRow span={span} label="Show older" onClick={() => setNext(last.createdAt)} />
      ) : null}
    </>
  );
}

/** Pipeline runs as a table; each row opens the run's page. */
function PipelineRunsTable({
  environmentId,
  runs,
  hasMore,
  pipelineId,
  showPipeline,
}: {
  readonly environmentId: EnvironmentId;
  readonly runs: ReadonlyArray<BotPipelineRun>;
  readonly hasMore: boolean;
  readonly pipelineId: BotPipelineId | undefined;
  readonly showPipeline: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [older, setOlder] = useState<string | null>(null);
  const shown = expanded ? runs : runs.slice(0, RECENT_RUNS_SHOWN);
  const last = runs.at(-1);
  const span = showPipeline ? 4 : 3;
  return (
    <LibraryTable
      label={showPipeline ? "Recent pipeline runs" : "Runs of this pipeline"}
      columns={[
        { key: "run", label: showPipeline ? "Pipeline" : "Started" },
        { key: "state", label: "Outcome", className: "w-36" },
        { key: "took", label: "Took", align: "end", className: "hidden w-24 sm:table-cell" },
        ...(showPipeline
          ? [{ key: "started", label: "Started", align: "end" as const, className: "w-28" }]
          : []),
      ]}
    >
      {shown.map((run) => (
        <PipelineRunRow key={run.id} run={run} showPipeline={showPipeline} />
      ))}
      {!expanded && runs.length > RECENT_RUNS_SHOWN ? (
        <ShowMoreRow
          span={span}
          label={`Show all ${runs.length}${hasMore ? "+" : ""}`}
          onClick={() => setExpanded(true)}
        />
      ) : null}
      {expanded && older !== null ? (
        <OlderPipelineRuns
          environmentId={environmentId}
          pipelineId={pipelineId}
          before={older}
          showPipeline={showPipeline}
          span={span}
        />
      ) : expanded && hasMore && last !== undefined ? (
        <ShowMoreRow span={span} label="Show older" onClick={() => setOlder(last.createdAt)} />
      ) : null}
    </LibraryTable>
  );
}

/** Asks, then deletes. Resolves to whether the pipeline is gone. */
function useDeletePipeline(environmentId: EnvironmentId) {
  const remove = useAtomCommand(bots.deletePipeline, { reportFailure: false });
  return async (pipeline: Pick<BotPipeline, "id" | "name">) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete ${pipeline.name}? Triggers that start it are deleted too, with their webhook URLs. Its past runs stay listed. This cannot be undone.`,
    );
    if (!confirmed) return false;
    const result = await remove({ environmentId, input: { pipelineId: pipeline.id } });
    if (result._tag === "Success") return true;
    const cause = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: `Could not delete ${pipeline.name}`,
      ...(cause instanceof Error ? { description: cause.message } : {}),
    });
    return false;
  };
}

/** The pipeline's less frequent actions: a trigger that starts it, and deleting it. */
function PipelineMenu({
  environmentId,
  pipeline,
  connected,
  size,
  onDeleted,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline;
  readonly connected: boolean;
  readonly size: "icon-xs" | "icon-sm";
  readonly onDeleted?: () => void;
}) {
  const nav = useBotsNavigation();
  const host = useBotsHost();
  const access = useBotsAccess();
  const canDelete = useLibraryPermission(bots.deletePipeline, environmentId) && connected;
  const deletePipeline = useDeletePipeline(environmentId);
  const firstBot = pipeline.steps[0]?.botId;
  // Adding a trigger and deleting take different permissions, so the line names only what is off.
  const blockedActions = [
    host.triggersSupported && !access.canOperateTriggers ? "add triggers" : null,
    canDelete ? null : "delete pipelines",
  ].filter((action) => action !== null);
  const reason = blockedActions.length
    ? actionReason(connected, false, blockedActions.join(" or "))
    : null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            shape="pill"
            size={size}
            variant="ghost"
            aria-label={`More for ${pipeline.name}`}
            className="relative z-10"
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        {host.triggersSupported ? (
          <MenuItem
            disabled={!access.canOperateTriggers || firstBot === undefined}
            onClick={() => {
              if (firstBot !== undefined)
                nav.overlay({ newTrigger: firstBot, triggerPipeline: pipeline.id });
            }}
          >
            <ZapIcon />
            Add trigger
          </MenuItem>
        ) : null}
        {host.triggersSupported ? <MenuSeparator /> : null}
        <MenuItem
          variant="destructive"
          disabled={!canDelete}
          onClick={() =>
            void deletePipeline(pipeline).then((deleted) => {
              if (deleted) onDeleted?.();
            })
          }
        >
          <Trash2Icon />
          Delete pipeline…
        </MenuItem>
        {reason ? (
          <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">{reason}</p>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/** What a pipeline needs noticed first: a run going now, a step without its bot, a bad last run. */
function pipelineAttention(
  pipeline: BotPipeline,
  runs: ReadonlyArray<BotPipelineRun>,
  botOf: (botId: string) => BotDefinition | undefined,
  /** Whether the bot list loaded, so a bot it lacks is really gone. */
  botsLoaded: boolean,
): { readonly tone: LibraryWorkflowTone; readonly label: string } | null {
  const active = runs.find((run) => isActiveBotPipelineRunStatus(run.status));
  if (active) return BOT_PIPELINE_RUN_STATES[active.status];
  const stepBots = pipeline.steps.map((step) => botOf(step.botId));
  if (botsLoaded && stepBots.some((bot) => bot === undefined))
    return { tone: "warning", label: "Bot missing" };
  if (stepBots.some((bot) => bot?.archivedAt != null))
    return { tone: "warning", label: "Bot archived" };
  const last = runs[0];
  if (last && (last.status === "failed" || last.status === "stopped"))
    return BOT_PIPELINE_RUN_STATES[last.status];
  return null;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const usageText = (row: BotPipelineUsageRow | undefined) =>
  row === undefined || row.runs === 0
    ? null
    : `${plural(row.runs, "run")} · ${row.usageComplete ? "" : "at least "}${formatTokens(row.tokens.total)} tokens`;

function usePipelineUsage() {
  const { usage } = useBotUsage(USAGE_DAYS);
  const rows = usage?.pipelines;
  return (pipelineId: string) => rows?.find((row) => row.pipelineId === pipelineId);
}

/** The index's Pipelines view. */
export function PipelinesView() {
  const host = useBotsHost();
  return host.environmentId ? <PipelinesIndex environmentId={host.environmentId} /> : null;
}

const matches = (
  pipeline: BotPipeline,
  query: string,
  botName: (id: string) => string | undefined,
) => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [
    pipeline.name,
    pipeline.description,
    pipeline.id,
    ...pipeline.steps.flatMap((step) => [step.id, botName(step.botId) ?? ""]),
  ].some((text) => text.toLowerCase().includes(needle));
};

function PipelinesIndex({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const nav = useBotsNavigation();
  const { host, bots: allBots, list: botList } = useBots();
  const access = useBotsAccess();
  const { list, pipelines } = usePipelines(environmentId, true, host.connected);
  useRefreshOnReconnect(host.connected, list.refresh);
  const { query: runsQuery, runs, hasMore } = usePipelineRuns(environmentId, host.connected);
  const usageOf = usePipelineUsage();
  const [search, setSearch] = useState("");
  const botsById = useMemo(() => new Map(allBots.map((bot) => [bot.id, bot])), [allBots]);
  const botOf = (botId: string) => botsById.get(botId);
  const botName = (botId: string) => botsById.get(botId)?.name;
  const shown = pipelines.filter((pipeline) => matches(pipeline, search, botName));
  const running = runs.filter((run) => isActiveBotPipelineRunStatus(run.status)).length;
  const newReason = actionReason(host.connected, access.canSavePipelines, "make pipelines");
  const newButton = (
    <WithReason reason={newReason}>
      <Button
        shape="pill"
        size="sm"
        disabled={!access.canSavePipelines}
        onClick={() => nav.open({ newPipeline: true })}
      >
        <PlusIcon />
        New pipeline
      </Button>
    </WithReason>
  );

  if (list.error && !list.data)
    return <LibraryErrorNotice error={list.error} onRetry={list.refresh} />;
  if (!list.data) return <PipelineCardsSkeleton />;
  if (pipelines.length === 0)
    return (
      <LibraryEmpty
        icon={WorkflowIcon}
        title="No pipelines yet"
        action={
          botList.data && allBots.length === 0 ? (
            <WithReason reason={actionReason(host.connected, access.canSave, "make bots")}>
              <Button
                shape="pill"
                size="sm"
                disabled={!access.canSave}
                onClick={() => nav.open({ newBot: true })}
              >
                <PlusIcon />
                New bot
              </Button>
            </WithReason>
          ) : (
            newButton
          )
        }
      >
        {botList.data && allBots.length === 0
          ? "A pipeline runs bots one after another, each handed what the last one found. Make a bot first."
          : "A pipeline runs bots one after another, each handed what the last one found."}
      </LibraryEmpty>
    );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* A search still in force stays visible, or nothing on screen could clear it. */}
          {pipelines.length >= SEARCH_FROM || search !== "" ? (
            <LibrarySearch
              value={search}
              onChange={setSearch}
              placeholder="Search pipelines, steps and bots"
              label="Search pipelines"
            />
          ) : null}
          <p className="flex flex-wrap items-center gap-2 text-xs tabular-nums text-muted-foreground">
            {plural(pipelines.length, "pipeline")}
            {running ? (
              <LibraryStateBadge tone="active">{running} running</LibraryStateBadge>
            ) : null}
            {host.connected ? null : <span>Offline. Showing pipelines as last loaded.</span>}
          </p>
          <div className="ms-auto">{newButton}</div>
        </div>
        <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No pipeline matches “{search.trim()}”.
          </p>
        ) : (
          <ul aria-label="Pipelines" className={LIBRARY_CARD_GRID}>
            {shown.map((pipeline) => (
              <PipelineCard
                key={pipeline.id}
                environmentId={environmentId}
                pipeline={pipeline}
                runs={runs.filter((run) => run.pipelineId === pipeline.id)}
                usage={usageOf(pipeline.id)}
                botOf={botOf}
                botsLoaded={botList.data !== null}
                connected={host.connected}
              />
            ))}
          </ul>
        )}
      </div>
      <LibrarySection title="Recent runs" icon={HistoryIcon} count={runs.length || undefined}>
        <LibraryErrorNotice error={runsQuery.error} onRetry={runsQuery.refresh} />
        {runsQuery.error && !runsQuery.data ? null : !runsQuery.data ? (
          <RunRowsSkeleton />
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pipeline has run yet. Each run and the report it leaves collect here.
          </p>
        ) : (
          <PipelineRunsTable
            environmentId={environmentId}
            runs={runs}
            hasMore={hasMore}
            pipelineId={undefined}
            showPipeline
          />
        )}
      </LibrarySection>
    </div>
  );
}

function PipelineCard({
  environmentId,
  pipeline,
  runs,
  usage,
  botOf,
  botsLoaded,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline;
  /** Its runs among the newest of every pipeline, newest first. */
  readonly runs: ReadonlyArray<BotPipelineRun>;
  readonly usage: BotPipelineUsageRow | undefined;
  readonly botOf: (botId: string) => BotDefinition | undefined;
  readonly botsLoaded: boolean;
  readonly connected: boolean;
}) {
  const nav = useBotsNavigation();
  const access = useBotsAccess();
  const attention = pipelineAttention(pipeline, runs, botOf, botsLoaded);
  const last = runs[0];
  const editReason = actionReason(connected, access.canSavePipelines, "edit pipelines");
  const runReason = actionReason(connected, access.canRunPipelines, "run pipelines");
  return (
    <li style={pipelineColorStyle(pipeline.id)} className={LIBRARY_CARD}>
      <ProjectWash />
      <Link
        to="/loom/bots"
        search={{ pipeline: pipeline.id }}
        aria-label={pipeline.name}
        className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />
      <div className="flex items-start gap-3">
        <PipelineTile pipelineId={pipeline.id} size="lg" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="truncate text-sm leading-5 font-semibold tracking-tight">
            {pipeline.name}
          </h3>
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {[
              plural(pipeline.steps.length, "step"),
              pipeline.parameters.length ? plural(pipeline.parameters.length, "input") : null,
              `edited ${runTime(pipeline.updatedAt) ?? ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {attention ? (
          <LibraryStateBadge tone={attention.tone}>{attention.label}</LibraryStateBadge>
        ) : null}
        <PipelineMenu
          environmentId={environmentId}
          pipeline={pipeline}
          connected={connected}
          size="icon-xs"
        />
      </div>
      {pipeline.description.trim() ? (
        <p className="line-clamp-2 text-xs leading-4.5 text-muted-foreground">
          {pipeline.description}
        </p>
      ) : (
        <p className="text-xs leading-4.5 text-muted-foreground/60">No description</p>
      )}
      <PipelineChain steps={pipeline.steps} botName={(botId) => botOf(botId)?.name} />
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-3">
        <TickStrip ticks={runTicks(runs, CARD_TICKS)} label={ticksLabel(runs)} />
        <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">
          {[
            last ? `Ran ${runTime(last.createdAt) ?? ""}` : "Not run lately",
            usageText(usage) ? `${usageText(usage)} this week` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <div className="relative z-10 flex items-center gap-1">
          {editReason === null ? (
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              render={<Link to="/loom/bots" search={{ editPipeline: pipeline.id }} />}
            >
              <PencilIcon />
              Edit
            </Button>
          ) : (
            <WithReason reason={editReason}>
              <Button shape="pill" size="xs" variant="ghost" disabled>
                <PencilIcon />
                Edit
              </Button>
            </WithReason>
          )}
          <WithReason reason={runReason}>
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={!access.canRunPipelines}
              onClick={() => nav.overlay({ runPipeline: pipeline.id })}
            >
              <PlayIcon />
              Run
            </Button>
          </WithReason>
        </div>
      </div>
    </li>
  );
}

function PipelineCardsSkeleton() {
  return (
    <div role="status" aria-label="Loading pipelines" className={LIBRARY_CARD_GRID}>
      {["first", "second", "third"].map((key) => (
        <Skeleton key={key} shape="card" className="h-52" />
      ))}
    </div>
  );
}

function RunRowsSkeleton() {
  return (
    <div role="status" aria-label="Loading pipeline runs" className="flex flex-col gap-2">
      {["first", "second", "third"].map((key) => (
        <Skeleton key={key} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** One pipeline as its own page. */
export function PipelinePage({ pipelineId }: { readonly pipelineId: BotPipelineId }) {
  const host = useBotsHost();
  return host.environmentId ? (
    <PipelineDetail environmentId={host.environmentId} pipelineId={pipelineId} />
  ) : null;
}

const PIPELINES_TAB = { tab: "pipelines" } as const;

function PipelineDetail({
  environmentId,
  pipelineId,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineId: BotPipelineId;
}) {
  const host = useBotsHost();
  const { list, pipelines } = usePipelines(environmentId, true, host.connected);
  useRefreshOnReconnect(host.connected, list.refresh);
  const pipeline = pipelines.find((candidate) => candidate.id === pipelineId);
  const back = (
    <LibraryBackLink to="/loom/bots" search={PIPELINES_TAB}>
      Pipelines
    </LibraryBackLink>
  );
  if (pipeline === undefined) {
    if (list.error && !list.data)
      return (
        <div className="flex flex-col">
          {back}
          <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
        </div>
      );
    if (!list.data)
      return (
        <div role="status" aria-label="Loading the pipeline" className="flex flex-col gap-8">
          {back}
          <Skeleton shape="card" className="h-44 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    return (
      <div className="flex flex-col">
        {back}
        <LibraryEmpty
          icon={WorkflowIcon}
          title="This pipeline no longer exists"
          action={
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              render={<Link to="/loom/bots" search={PIPELINES_TAB} />}
            >
              Back to pipelines
            </Button>
          }
        >
          It was deleted, or the link names a pipeline this computer never had. Its past runs stay
          under Recent runs.
        </LibraryEmpty>
      </div>
    );
  }
  return <PipelineOverview environmentId={environmentId} pipeline={pipeline} back={back} />;
}

function PipelineOverview({
  environmentId,
  pipeline,
  back,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline;
  readonly back: ReactNode;
}) {
  const nav = useBotsNavigation();
  const { host, bots: allBots, list: botList } = useBots();
  const access = useBotsAccess();
  const {
    query: runsQuery,
    runs,
    hasMore,
  } = usePipelineRuns(environmentId, host.connected, pipeline.id);
  const usage = usePipelineUsage()(pipeline.id);
  const botsById = useMemo(() => new Map(allBots.map((bot) => [bot.id, bot])), [allBots]);
  const botOf = (botId: string) => botsById.get(botId);
  const botsLoaded = botList.data !== null;
  const draft = useMemo(() => pipelineDraft(pipeline), [pipeline]);
  const attention = pipelineAttention(pipeline, runs, botOf, botsLoaded);
  const record = pipelineRecord(runs);
  const last = runs[0];
  const editReason = actionReason(host.connected, access.canSavePipelines, "edit pipelines");
  const runReason = actionReason(host.connected, access.canRunPipelines, "run pipelines");
  return (
    <div style={pipelineColorStyle(pipeline.id)} className="flex flex-col gap-10">
      <div className="flex flex-col">
        {back}
        <LibraryHero
          tile={<PipelineTile pipelineId={pipeline.id} size="2xl" />}
          title={pipeline.name}
          meta={
            <>
              {attention ? (
                <LibraryStateBadge tone={attention.tone}>{attention.label}</LibraryStateBadge>
              ) : null}
              <span>{plural(pipeline.steps.length, "step")}</span>
              <span>
                {pipeline.parameters.length
                  ? plural(pipeline.parameters.length, "input")
                  : "No inputs"}
              </span>
              <span>v{pipeline.version}</span>
              {pipeline.createdBy === "agent" ? <span>Made by an agent</span> : null}
              <span>Edited {runTime(pipeline.updatedAt)}</span>
            </>
          }
          actions={
            <>
              {editReason === null ? (
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  render={<Link to="/loom/bots" search={{ editPipeline: pipeline.id }} />}
                >
                  <PencilIcon />
                  Edit
                </Button>
              ) : (
                <WithReason reason={editReason}>
                  <Button shape="pill" size="sm" variant="outline" disabled>
                    <PencilIcon />
                    Edit
                  </Button>
                </WithReason>
              )}
              <WithReason reason={runReason}>
                <Button
                  shape="pill"
                  size="sm"
                  disabled={!access.canRunPipelines}
                  onClick={() => nav.overlay({ runPipeline: pipeline.id })}
                >
                  <PlayIcon />
                  Run
                </Button>
              </WithReason>
              <PipelineMenu
                environmentId={environmentId}
                pipeline={pipeline}
                connected={host.connected}
                size="icon-sm"
                onDeleted={() => nav.show(PIPELINES_TAB)}
              />
            </>
          }
          footer={
            <LibraryVitals>
              <LibraryVital label="Recent runs">
                <TickStrip ticks={runTicks(runs, PAGE_TICKS)} label={ticksLabel(runs)} />
              </LibraryVital>
              <LibraryVital label="Passed">
                {record.finished ? `${record.passed} of ${record.finished}` : "No runs yet"}
              </LibraryVital>
              <LibraryVital label="Typical run">
                {record.typicalMs === null ? "Not yet" : formatSpan(record.typicalMs)}
              </LibraryVital>
              <LibraryVital label="Last run">
                {last ? (
                  <Link
                    to="/loom/bots"
                    search={{ pipelineRun: last.id }}
                    className="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    {runTime(last.createdAt)}
                  </Link>
                ) : (
                  "Never"
                )}
              </LibraryVital>
              {usageText(usage) ? (
                <LibraryVital label="This week">{usageText(usage)}</LibraryVital>
              ) : null}
            </LibraryVitals>
          }
        >
          {pipeline.description.trim() ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{pipeline.description}</p>
          ) : null}
        </LibraryHero>
      </div>
      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-10">
          <LibrarySection title="Steps" icon={WorkflowIcon} count={pipeline.steps.length}>
            {botList.data === null ? (
              <LibraryErrorNotice error={botList.error} onRetry={botList.refresh} />
            ) : null}
            <StepFlow steps={draft.steps} draft={draft} botOf={botOf} botsLoaded={botsLoaded} />
          </LibrarySection>
          <LibrarySection title="Runs" icon={HistoryIcon} count={runs.length || undefined}>
            <LibraryErrorNotice error={runsQuery.error} onRetry={runsQuery.refresh} />
            {runsQuery.error && !runsQuery.data ? null : !runsQuery.data ? (
              <RunRowsSkeleton />
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not run yet. Run it to see each step, its outcome and the report it leaves.
              </p>
            ) : (
              <PipelineRunsTable
                environmentId={environmentId}
                runs={runs}
                hasMore={hasMore}
                pipelineId={pipeline.id}
                showPipeline={false}
              />
            )}
          </LibrarySection>
        </div>
        <aside aria-label="Pipeline details" className="flex min-w-0 flex-col gap-4">
          <LibraryPanel
            title="Inputs"
            icon={TextCursorInputIcon}
            count={pipeline.parameters.length || undefined}
          >
            <div className="px-3 pb-2">
              {pipeline.parameters.length ? (
                <LibrarySpecSheet
                  label="Inputs"
                  rows={pipeline.parameters.map((parameter) => ({
                    label: parameter.label,
                    value: `${PARAMETER_TYPE_NAMES[parameter.type]}${parameter.required ? "" : ", optional"}`,
                  }))}
                />
              ) : (
                <p className="pb-1 text-xs text-muted-foreground">
                  Takes no inputs, so every run starts the same way.
                </p>
              )}
            </div>
          </LibraryPanel>
          {host.triggersSupported ? (
            <PipelineTriggers environmentId={environmentId} pipeline={pipeline} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

const PARAMETER_TYPE_NAMES = {
  string: "Short text",
  text: "Long text",
  number: "Number",
  boolean: "Yes or no",
  choice: "Choice",
} as const;

const STEP_FIELD_NAMES: Record<string, string> = {
  result: "reply",
  summary: "summary",
  verdict: "verdict",
  findings: "findings",
};

/** The saved steps top to bottom: what each gets, what it hands on and what ends it. */
function StepFlow({
  steps,
  draft,
  botOf,
  botsLoaded,
}: {
  readonly steps: ReadonlyArray<PipelineStepDraft>;
  readonly draft: PipelineDraft;
  readonly botOf: (botId: string) => BotDefinition | undefined;
  /** Whether the bot list loaded, so a bot it lacks is really gone. */
  readonly botsLoaded: boolean;
}) {
  return (
    <ol aria-label="Steps" className="flex flex-col">
      {steps.map((step, index) => {
        const bot = botOf(step.botId);
        const readers = stepReaders(draft, step.id);
        const mapping = mappingSummary(step);
        const gates = gateSummary(step, bot?.output === "verdict");
        const more = index < steps.length - 1;
        return (
          <li key={step.key} className="flex min-w-0 gap-3">
            <div aria-hidden className="flex w-8 shrink-0 flex-col items-center">
              <BotTile bot={{ id: step.botId }} size="md" />
              {more ? <span className="my-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className={cn("min-w-0 flex-1 pt-1", more ? "pb-7" : "pb-1")}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <h3 className="font-mono text-sm font-medium">{step.id}</h3>
                {bot === undefined && !botsLoaded ? (
                  <Skeleton className="h-3.5 w-24" />
                ) : (
                  <Link
                    to="/loom/bots"
                    search={{ bot: step.botId }}
                    className="truncate rounded-sm text-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    {bot?.name ?? step.botId}
                  </Link>
                )}
                {bot === undefined ? (
                  botsLoaded ? (
                    <LibraryStateBadge tone="warning">Bot missing</LibraryStateBadge>
                  ) : null
                ) : bot.archivedAt !== null ? (
                  <LibraryStateBadge tone="warning">Archived</LibraryStateBadge>
                ) : null}
                {step.forEach ? (
                  <LibraryStateBadge tone="neutral" icon={LayersIcon}>
                    Once per item
                  </LibraryStateBadge>
                ) : null}
                {step.version === "stable" ? (
                  <LibraryStateBadge tone="neutral">Stable version</LibraryStateBadge>
                ) : step.version === "number" ? (
                  <LibraryStateBadge tone="neutral">
                    Pinned to v{step.versionNumber}
                  </LibraryStateBadge>
                ) : null}
              </div>
              <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Gets</dt>
                <dd className="min-w-0 font-mono wrap-anywhere">
                  {mapping.length
                    ? mapping.map((entry) => `${entry.name} ← ${entry.from}`).join(", ")
                    : "Nothing"}
                </dd>
                {step.forEach ? (
                  <>
                    <dt className="text-muted-foreground">Runs over</dt>
                    <dd className="min-w-0 font-mono wrap-anywhere">{step.forEachFrom}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Hands on</dt>
                <dd className="min-w-0 wrap-anywhere">
                  {readers.length
                    ? readers
                        .map(
                          (reader) =>
                            `${reader.fields.map((field) => STEP_FIELD_NAMES[field] ?? field).join(" and ")} to ${reader.stepId}`,
                        )
                        .join(", ")
                    : "Its outcome to the report"}
                </dd>
                {gates.length ? (
                  <>
                    <dt className="text-muted-foreground">Then</dt>
                    <dd className="min-w-0 wrap-anywhere">{gates.join(". ")}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PipelineTriggers({
  environmentId,
  pipeline,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline;
}) {
  const nav = useBotsNavigation();
  const host = useBotsHost();
  const access = useBotsAccess();
  const changes = useBotTriggerChanges(environmentId, host.connected);
  const query = useEnvironmentQuery(bots.listTriggers({ environmentId, input: {} }));
  useRefreshOnReconnect(host.connected, query.refresh);
  const triggers = applyTriggerChanges(query.data?.triggers ?? [], changes).filter(
    (trigger) => trigger.pipelineId === pipeline.id,
  );
  const firstBot = pipeline.steps[0]?.botId;
  const reason = actionReason(host.connected, access.canOperateTriggers, "add triggers");
  return (
    <LibraryPanel
      title="Triggers"
      icon={ZapIcon}
      count={triggers.length || undefined}
      action={
        <WithReason reason={reason}>
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={!access.canOperateTriggers || firstBot === undefined}
            onClick={() => {
              if (firstBot !== undefined)
                nav.overlay({ newTrigger: firstBot, triggerPipeline: pipeline.id });
            }}
          >
            <PlusIcon />
            Add
          </Button>
        </WithReason>
      }
    >
      {query.error && !query.data ? (
        <div className="px-3 pb-2">
          <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
        </div>
      ) : !query.data ? (
        <div className="px-3 pb-3">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : triggers.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          Nothing starts it on its own yet. A trigger can run it on a schedule, a webhook or a pull
          request.
        </p>
      ) : (
        <ul className="flex flex-col px-1.5 pb-1.5">
          {triggers.map((trigger) => (
            <li key={trigger.id}>
              <button
                type="button"
                onClick={() => nav.overlay({ trigger: trigger.id })}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-start outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <LibraryStateDot tone={trigger.enabled ? "success" : "neutral"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{trigger.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      TRIGGER_KIND_LABELS[trigger.event.kind],
                      trigger.enabled ? null : "Off",
                      trigger.lastFiredAt ? `fired ${runTime(trigger.lastFiredAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </LibraryPanel>
  );
}

/** The pipelines a bot takes part in, for the aside of its Overview. Nothing when there are none. */
export function BotPipelinesAside({ bot }: { readonly bot: BotDefinition }) {
  const host = useBotsHost();
  const { pipelines } = usePipelines(host.environmentId, host.pipelinesSupported, host.connected);
  const using = pipelines.filter((pipeline) =>
    pipeline.steps.some((step) => step.botId === bot.id),
  );
  if (!host.pipelinesSupported || using.length === 0) return null;
  return (
    <LibraryPanel title="Pipelines" icon={WorkflowIcon} count={using.length}>
      <ul className="flex flex-col px-1.5 pb-1.5">
        {using.map((pipeline) => {
          const index = pipeline.steps.findIndex((step) => step.botId === bot.id);
          const others = pipeline.steps.filter((step) => step.botId === bot.id).length - 1;
          return (
            <li key={pipeline.id}>
              <Link
                to="/loom/bots"
                search={{ pipeline: pipeline.id }}
                className="flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <PipelineTile pipelineId={pipeline.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{pipeline.name}</span>
                  <span className="block truncate text-xs tabular-nums text-muted-foreground">
                    Step {index + 1} of {pipeline.steps.length}
                    {others > 0 ? ` and ${others} more` : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </LibraryPanel>
  );
}
