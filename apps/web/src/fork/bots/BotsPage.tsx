import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  BOTS_LIST_BATCHES_MAX_LIMIT,
  BOTS_LIST_RUNS_MAX_LIMIT,
  type BotDefinition,
  type BotStarterStatus,
  type BotTrigger,
  type BotVerdictValue,
  type LibraryProjectColor,
} from "@t3tools/contracts/fork";
import {
  applyBatchChanges,
  applyRunChanges,
  botColor,
  botVersionLabel,
  botDraft,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BotIcon,
  ChevronDownIcon,
  CloudOffIcon,
  EllipsisIcon,
  GaugeIcon,
  HistoryIcon,
  InboxIcon,
  LayersIcon,
  LayoutGridIcon,
  MonitorIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  Trash2Icon,
  WorkflowIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { ensureLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { LibraryPageFrame } from "../project-library/LibraryPageFrame";
import { LibraryTabs, type LibraryTab } from "../project-library/LibraryTabs";
import { HeroTexture, ProjectGlow, projectColorStyle } from "../project-library/ProjectIdentity";
import { useLibraryPermission } from "../project-library/state";
import { BotRemoteRunsSettings, BotSharingPanel } from "./BotAnywhere";
import { BatchList, BatchView } from "./BotBatches";
import { BotEditor, RUNTIME_MODE_LABELS, WORKSPACE_LABELS } from "./BotEditor";
import { BotHistory } from "./BotHistory";
import { BotTile, StarterBadge, starterLabel } from "./BotIdentity";
import { BotPipelines } from "./BotPipelines";
import { BotReplayDialog, type BotReplaySourceChoice } from "./BotReplay";
import { BotRunForm } from "./BotRunForm";
import { BotRowsSkeleton, BotRuns, VerdictFilter } from "./BotRuns";
import { BotTriggerEditor } from "./BotTriggerEditor";
import { BotTriggers } from "./BotTriggers";
import { BotsInbox } from "./BotsInbox";
import { BotsUsage } from "./BotsUsage";
import { BotFromThreadEditor } from "./fromThread/BotFromThreadEditor";
import { BotSuggestions } from "./fromThread/BotSuggestions";
import { PipelineRunForm } from "./PipelineRunView";
import { RunOnManyDialog } from "./RunOnManyDialog";
import {
  bots,
  useBotBatchChanges,
  useBots,
  useBotTriggerChanges,
  useBotsAttentionCount,
  usePipelines,
  useRefreshWhenBotsChangesPruned,
  useWaitingBotRuns,
} from "./state";

type Editing = { readonly bot: BotDefinition | null } | null;
type Replaying = { readonly bot: BotDefinition; readonly source: BotReplaySourceChoice } | null;

type BotsTab =
  | "runs"
  | "history"
  | "batches"
  | "pipelines"
  | "triggers"
  | "inbox"
  | "usage"
  | "computers";

const TABS: Record<BotsTab, { readonly label: string; readonly icon: LucideIcon }> = {
  runs: { label: "Runs", icon: PlayIcon },
  history: { label: "History", icon: HistoryIcon },
  batches: { label: "Batches", icon: LayersIcon },
  pipelines: { label: "Pipelines", icon: WorkflowIcon },
  triggers: { label: "Triggers", icon: ZapIcon },
  inbox: { label: "Inbox", icon: InboxIcon },
  usage: { label: "Usage", icon: GaugeIcon },
  computers: { label: "Computers", icon: MonitorIcon },
};

/** The page's own ink while no bot is chosen; each bot then wears its own color. */
const BOTS_COLOR: LibraryProjectColor = "plum";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * A bot's settings as a definition grid inside its hero, read across like a spec sheet rather
 * than boxed one by one.
 */
function BotSummary({ bot }: { readonly bot: BotDefinition }) {
  const projects = useProjects();
  const projectTitle = (id: string | null) =>
    id === null ? null : (projects.find((project) => project.id === id)?.title ?? id);
  const draft = botDraft(bot);
  const workspaceProject =
    bot.workspace.type === "project" ? projectTitle(bot.workspace.projectId) : null;
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Model", bot.modelSelection.model],
    ["Permissions", RUNTIME_MODE_LABELS[bot.runtimeMode]],
    ["Mode", bot.interactionMode === "plan" ? "Plan only" : "Do the work"],
    [
      "Runs in",
      `${WORKSPACE_LABELS[draft.workspace]}${
        bot.workspace.type === "project"
          ? `${draft.workspace === "checkout" ? ", in" : " of"} ${
              workspaceProject ?? "the project chosen at run time"
            }`
          : ""
      }`,
    ],
    ["Time limit", `${bot.timeoutMinutes} minutes`],
    ["Runs at once", String(bot.maxConcurrentRuns)],
    ["Available in", projectTitle(bot.scopeProjectId) ?? "Every project"],
    ["Inputs", bot.parameters.map((parameter) => parameter.label).join(", ") || "None"],
  ];
  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm font-medium wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BotsPage() {
  const { host, live, changes, list, bots: allBots } = useBots();
  const search = useSearch({ from: "/loom/bots" });
  const navigate = useNavigate();
  const environmentId = host.environmentId;
  const selectedId = search.bot;
  const [verdictFilter, setVerdictFilter] = useState<BotVerdictValue | null>(null);
  const verdict = host.verdictsSupported ? (verdictFilter ?? undefined) : undefined;
  const runsQuery = useEnvironmentQuery(
    environmentId && live
      ? bots.listRuns({
          environmentId,
          input: {
            limit: BOTS_LIST_RUNS_MAX_LIMIT,
            ...(selectedId === undefined ? {} : { botId: selectedId }),
            ...(verdict === undefined ? {} : { verdict }),
          },
        })
      : null,
  );
  const canSave = useLibraryPermission(bots.save, environmentId) && host.connected;
  const canRun = useLibraryPermission(bots.run, environmentId) && host.connected;
  const canCancel = useLibraryPermission(bots.cancel, environmentId) && host.connected;
  const canRate = useLibraryPermission(bots.rateRun, environmentId) && host.connected;
  const canReplay = useLibraryPermission(bots.replay, environmentId) && host.connected;
  const canRunPipelines = useLibraryPermission(bots.runPipeline, environmentId) && host.connected;
  const canShare = useLibraryPermission(bots.share, environmentId) && host.connected;
  const versionsLive = live && host.versionsSupported;
  const archive = useAtomCommand(bots.archive, { reportFailure: false });
  const remove = useAtomCommand(bots.delete, { reportFailure: false });
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });
  const batchesLive = live && host.batchesSupported;
  const inboxLive = live && host.inboxSupported;
  const triggersLive = live && host.triggersSupported;
  const pipelinesLive = live && host.pipelinesSupported;
  const { pipelines } = usePipelines(environmentId, pipelinesLive, host.connected);
  const triggerChanges = useBotTriggerChanges(environmentId, triggersLive && host.connected);
  const canOperateTriggers =
    useLibraryPermission(bots.saveTrigger, environmentId) && host.connected;
  const [editingTrigger, setEditingTrigger] = useState<BotTrigger | null>(null);
  const tabs: BotsTab[] = [
    "runs",
    ...(versionsLive && selectedId !== undefined ? (["history"] as const) : []),
    ...(batchesLive ? (["batches"] as const) : []),
    ...(pipelinesLive ? (["pipelines"] as const) : []),
    ...(triggersLive ? (["triggers"] as const) : []),
    ...(inboxLive ? (["inbox"] as const) : []),
    ...(live && host.budgetsSupported ? (["usage"] as const) : []),
    ...(live && host.anywhereSupported ? (["computers"] as const) : []),
  ];
  const tab = tabs.find((value) => value === search.tab) ?? "runs";
  const attention = useBotsAttentionCount();
  const waiting = useWaitingBotRuns(inboxLive ? environmentId : null);
  const canRetry = useLibraryPermission(bots.retry, environmentId) && host.connected;
  const batchChanges = useBotBatchChanges(environmentId, batchesLive);
  const batchesQuery = useEnvironmentQuery(
    environmentId && batchesLive && tab === "batches"
      ? bots.listBatches({
          environmentId,
          input: {
            limit: BOTS_LIST_BATCHES_MAX_LIMIT,
            ...(selectedId === undefined ? {} : { botId: selectedId }),
          },
        })
      : null,
  );
  const startersQuery = useEnvironmentQuery(
    environmentId && live && host.startersSupported
      ? bots.listStarters({ environmentId, input: {} })
      : null,
  );
  const starters = startersQuery.data?.starters ?? [];
  const starterOf = (bot: BotDefinition) =>
    bot.origin === undefined
      ? undefined
      : starters.find((starter) => starter.starterId === bot.origin?.starterId);
  const removedStarters = starters.filter((starter) => starter.state === "removed");
  const [editing, setEditing] = useState<Editing>(null);
  const [replaying, setReplaying] = useState<Replaying>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Changes missed while disconnected never arrive, so a reconnect refetches the lists.
  const wasConnected = useRef(host.connected);
  useEffect(() => {
    if (host.connected && !wasConnected.current) {
      list.refresh();
      runsQuery.refresh();
      batchesQuery.refresh();
      startersQuery.refresh();
    }
    wasConnected.current = host.connected;
  }, [host.connected, list, runsQuery, batchesQuery, startersQuery]);

  // Saving, deleting or restoring a bot can change its starter's state.
  const refreshStarters = startersQuery.refresh;
  const botChanges = changes.bots;
  const seenBotChanges = useRef(botChanges);
  useEffect(() => {
    if (seenBotChanges.current === botChanges) return;
    seenBotChanges.current = botChanges;
    refreshStarters();
  }, [botChanges, refreshStarters]);

  const visibleBots = allBots.filter((bot) => showArchived || bot.archivedAt === null);
  const archivedCount = allBots.filter((bot) => bot.archivedAt !== null).length;
  const selected = selectedId === undefined ? null : allBots.find((bot) => bot.id === selectedId);
  useRefreshWhenBotsChangesPruned(changes, runsQuery.refresh);
  const runs = applyRunChanges(runsQuery.data?.runs ?? [], changes, {
    botId: selectedId,
    verdict,
    includeNew: true,
    limit: BOTS_LIST_RUNS_MAX_LIMIT,
  });
  const batches = applyBatchChanges(batchesQuery.data?.batches ?? [], batchChanges, {
    botId: selectedId,
    includeNew: true,
  });
  const runTarget =
    search.run === undefined ? null : (allBots.find((bot) => bot.id === search.run) ?? null);
  const manyTarget =
    search.many === undefined || !host.batchesSupported
      ? null
      : (allBots.find((bot) => bot.id === search.many) ?? null);
  const newTriggerBot =
    search.newTrigger === undefined || !triggersLive
      ? null
      : (allBots.find((bot) => bot.id === search.newTrigger) ?? null);
  const editingTriggerBot =
    editingTrigger === null
      ? null
      : (allBots.find((bot) => bot.id === editingTrigger.botId) ?? null);
  const runPipelineTarget =
    search.runPipeline === undefined || !pipelinesLive
      ? null
      : (pipelines.find((pipeline) => pipeline.id === search.runPipeline) ?? null);
  const pipelinesStartingWith = (botId: string) =>
    pipelines.filter((pipeline) => pipeline.steps[0]?.botId === botId);
  const latestVersionOf = (botId: string) =>
    allBots.find((bot) => bot.id === botId && bot.archivedAt === null)?.version ?? null;

  const go = (next: typeof search) =>
    void navigate({ to: "/loom/bots", search: next, replace: true });

  const refresh = () => {
    list.refresh();
    runsQuery.refresh();
    batchesQuery.refresh();
    startersQuery.refresh();
  };

  const act = async (work: () => Promise<void>) => {
    setActionError(null);
    try {
      await work();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  };

  const setArchived = (bot: BotDefinition, archived: boolean) =>
    act(async () => {
      if (!environmentId) return;
      const result = await archive({ environmentId, input: { botId: bot.id, archived } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });

  const deleteBot = (bot: BotDefinition) =>
    act(async () => {
      if (!environmentId) return;
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete ${bot.name}? Its triggers, with their webhook URLs and secrets, are deleted too. Its run history stays on the Bots page; the bot itself cannot be restored.`,
      );
      if (!confirmed) return;
      const result = await remove({ environmentId, input: { botId: bot.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      go({});
    });

  const restoreRemoved = (starter: BotStarterStatus) =>
    act(async () => {
      if (!environmentId) return;
      const result = await restoreStarter({
        environmentId,
        input: { starterId: starter.starterId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      go({ bot: result.value.id });
    });

  const hostLabel = host.environment?.label ?? "your server";
  const newBot = (
    <Button shape="pill" disabled={!canSave || !live} onClick={() => setEditing({ bot: null })}>
      <PlusIcon />
      New bot
    </Button>
  );
  const removed =
    removedStarters.length > 0 ? (
      <RemovedStarters
        starters={removedStarters}
        canRestore={canSave}
        onRestore={(starter) => void restoreRemoved(starter)}
      />
    ) : null;

  const panel = !environmentId ? null : tab === "history" && selected ? (
    <BotHistory
      key={selected.id}
      environmentId={environmentId}
      bot={selected}
      connected={host.connected}
      canSave={canSave}
      canRun={canReplay}
      onReplay={(version) => setReplaying({ bot: selected, source: { kind: "version", version } })}
    />
  ) : tab === "computers" ? (
    <BotRemoteRunsSettings environmentId={environmentId} canChange={canShare} />
  ) : tab === "usage" ? (
    <BotsUsage environmentId={environmentId} changes={changes} connected={host.connected} />
  ) : tab === "inbox" ? (
    <BotsInbox
      environmentId={environmentId}
      changes={changes}
      waiting={waiting}
      connected={host.connected}
      canAct={canRetry}
    />
  ) : tab === "triggers" ? (
    <BotTriggers
      environmentId={environmentId}
      allBots={allBots}
      selected={selected ?? null}
      changes={triggerChanges}
      connected={host.connected}
      canOperate={canOperateTriggers}
      onNew={(bot) => go({ bot: bot.id, tab: "triggers", newTrigger: bot.id })}
      onEdit={setEditingTrigger}
    />
  ) : tab === "pipelines" ? (
    <BotPipelines
      environmentId={environmentId}
      allBots={allBots}
      connected={host.connected}
      selectedRunId={search.pipelineRun}
      onSelectRun={(pipelineRun) => go({ bot: search.bot, tab: "pipelines", pipelineRun })}
      onRun={(pipeline) => go({ bot: search.bot, tab: "pipelines", runPipeline: pipeline.id })}
      onOpenBatch={(batch) => go({ bot: search.bot, tab: "batches", batch })}
    />
  ) : tab === "batches" ? (
    <section className="flex flex-col gap-4" aria-label="Batches">
      {search.batch !== undefined ? (
        <BatchView
          key={search.batch}
          environmentId={environmentId}
          batchId={search.batch}
          changes={batchChanges}
          latestVersionOf={latestVersionOf}
          canRun={canRun}
          canCancel={canCancel}
          onClose={() => go({ bot: search.bot, tab: "batches" })}
        />
      ) : null}
      <LibraryErrorNotice error={batchesQuery.error} onRetry={batchesQuery.refresh} />
      {batchesQuery.isPending && !batchesQuery.data ? (
        <BotRowsSkeleton label="Loading batches" />
      ) : batchesQuery.error && !batchesQuery.data ? null : (
        <BatchList
          batches={batches}
          selectedId={search.batch}
          showBot={!selected}
          onSelect={(batch) => go({ bot: search.bot, tab: "batches", batch: batch.id })}
          emptyMessage={
            selected ? `${selected.name} has not run on many items yet.` : "No batch has run yet."
          }
        />
      )}
      {batchesQuery.data?.hasMore ? (
        <p className="text-xs text-muted-foreground">
          Showing the {BOTS_LIST_BATCHES_MAX_LIMIT} most recent batches.
        </p>
      ) : null}
    </section>
  ) : (
    <section className="flex flex-col gap-4" aria-label="Runs">
      {host.verdictsSupported ? (
        <VerdictFilter value={verdictFilter} onChange={setVerdictFilter} />
      ) : null}
      <LibraryErrorNotice error={runsQuery.error} onRetry={runsQuery.refresh} />
      {runsQuery.isPending && !runsQuery.data ? (
        <BotRowsSkeleton />
      ) : runsQuery.error && !runsQuery.data ? null : (
        <BotRuns
          environmentId={environmentId}
          runs={runs}
          showBot={!selected}
          canCancel={canCancel}
          canRate={host.versionsSupported && canRate}
          emptyMessage={
            verdict !== undefined
              ? "No run matches this verdict."
              : selected
                ? `${selected.name} has not run yet. Its runs, findings and replies collect here.`
                : "No bot has run yet. Every run, whoever starts it, collects here."
          }
          emptyAction={
            selected && verdict === undefined && selected.archivedAt === null ? (
              <Button
                shape="pill"
                size="sm"
                variant="outline"
                disabled={!canRun}
                onClick={() => go({ bot: selected.id, run: selected.id })}
              >
                <PlayIcon />
                Run {selected.name}
              </Button>
            ) : undefined
          }
        />
      )}
      {runsQuery.data?.hasMore || runs.length >= BOTS_LIST_RUNS_MAX_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          Showing the {BOTS_LIST_RUNS_MAX_LIMIT} most recent runs.
        </p>
      ) : null}
    </section>
  );

  return (
    <LibraryPageFrame
      section={{ label: "Bots", to: "/loom/bots" }}
      libraryStatus={false}
      style={projectColorStyle(BOTS_COLOR)}
      {...(selected ? { title: selected.name } : {})}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-3 gap-y-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
          {list.data && allBots.length ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
              {[
                plural(allBots.length - archivedCount, "bot"),
                archivedCount ? `${archivedCount} archived` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {inboxLive && attention > 0 ? (
                <button
                  type="button"
                  onClick={() => go({ tab: "inbox" })}
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <LibraryStateBadge tone="warning">
                    {attention} {attention === 1 ? "needs" : "need"} you
                  </LibraryStateBadge>
                </button>
              ) : null}
            </p>
          ) : (
            <p className="max-w-xl text-xs text-muted-foreground">
              Reusable jobs with fixed instructions, inputs and settings. Every run gets the same
              brief, whoever starts it.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            shape="pill"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh bots"
            disabled={!host.connected || !live || list.isPending}
            onClick={refresh}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            shape="pill"
            size="sm"
            disabled={!canSave || !live}
            onClick={() => setEditing({ bot: null })}
          >
            <PlusIcon />
            New bot
          </Button>
        </div>
      </header>

      {environmentId && !host.connected ? (
        <LibraryNotice icon={CloudOffIcon} tone="warning">
          {host.environment?.label ?? "Your server"} is offline. Bots and runs below may be out of
          date until it reconnects.
        </LibraryNotice>
      ) : null}
      <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
      <LibraryErrorNotice error={actionError} />

      {!environmentId ? (
        <LibraryEmpty icon={BotIcon} title="Connect to a Loom server">
          Bots run on the server this app connects to. Connect one to create bots and run them.
        </LibraryEmpty>
      ) : host.connected && !host.supported ? (
        <LibraryEmpty icon={CloudOffIcon} title="Bots need a newer server">
          Update {hostLabel} to create and run bots here.
        </LibraryEmpty>
      ) : !live ? null : !list.data ? (
        list.isPending ? (
          <BotsSkeleton />
        ) : null
      ) : (
        <>
          {host.fromThreadSupported ? (
            <BotSuggestions
              environmentId={environmentId}
              canChange={canSave}
              botChanges={botChanges}
              pendingSuggestionId={search.suggestion ?? null}
              onCreate={(suggestion) =>
                go({
                  bot: search.bot,
                  tab: search.tab,
                  fromThread: suggestion.threadIds[0],
                  suggestion: suggestion.id,
                })
              }
            />
          ) : null}
          {allBots.length === 0 ? (
            <>
              <LibraryEmpty icon={BotIcon} title="Create your first bot" action={newBot}>
                A bot is a job you brief agents on again and again, such as a review or a release
                check. Its instructions, inputs and settings stay fixed, so every run starts from
                the same brief.
              </LibraryEmpty>
              {removed}
            </>
          ) : (
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
              <nav aria-label="Bots" className="flex flex-col gap-5 lg:sticky lg:top-4">
                <ul className="flex flex-col gap-1">
                  <li>
                    <RailItem
                      current={selectedId === undefined}
                      tile={
                        <span
                          aria-hidden
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground dark:bg-accent"
                        >
                          <LayoutGridIcon className="size-4" />
                        </span>
                      }
                      title="All bots"
                      detail="Activity from every bot"
                      onSelect={() => go({ tab: search.tab })}
                    />
                  </li>
                  {visibleBots.map((bot) => (
                    <li key={bot.id}>
                      <RailItem
                        current={bot.id === selectedId}
                        tile={<BotTile bot={bot} />}
                        title={bot.name}
                        detail={railDetail(bot, starterLabel(starterOf(bot)))}
                        muted={bot.archivedAt !== null}
                        onSelect={() => go({ bot: bot.id, tab: search.tab })}
                      />
                    </li>
                  ))}
                </ul>
                {archivedCount ? (
                  <Button
                    shape="pill"
                    size="xs"
                    variant="ghost"
                    onClick={() => setShowArchived((on) => !on)}
                  >
                    <ArchiveIcon />
                    {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
                  </Button>
                ) : null}
                {removed}
              </nav>

              <div
                className="flex min-w-0 flex-col gap-8"
                style={selected ? projectColorStyle(botColor(selected)) : undefined}
              >
                {selectedId !== undefined && !selected ? (
                  <LibraryNotice
                    icon={BotIcon}
                    action={
                      <Button
                        shape="pill"
                        size="xs"
                        variant="outline"
                        onClick={() => go({ tab: search.tab })}
                      >
                        Show all bots
                      </Button>
                    }
                  >
                    This bot no longer exists. Its runs stay under All bots.
                  </LibraryNotice>
                ) : null}
                {selected ? (
                  <>
                    <BotHero
                      bot={selected}
                      starter={starterOf(selected)}
                      canRun={canRun}
                      canSave={canSave}
                      runsOnMany={host.batchesSupported}
                      onRun={() => go({ bot: selected.id, run: selected.id })}
                      onRunOnMany={() =>
                        go({ bot: selected.id, tab: search.tab, many: selected.id })
                      }
                      onEdit={() => setEditing({ bot: selected })}
                      onArchive={() => void setArchived(selected, selected.archivedAt === null)}
                      onDelete={() => void deleteBot(selected)}
                    />
                    <BotInstructions bot={selected} />
                    {host.anywhereSupported ? (
                      <BotSharingPanel
                        key={selected.id}
                        environmentId={environmentId}
                        bot={selected}
                        canChange={canShare}
                      />
                    ) : null}
                  </>
                ) : null}
                {tabs.length > 1 ? (
                  <LibraryTabs
                    label={selected ? `${selected.name} views` : "Bots views"}
                    selected={tab}
                    onSelect={(value) => go({ bot: search.bot, tab: value })}
                    tabs={tabs.map((value): LibraryTab<BotsTab> => ({
                      value,
                      ...TABS[value],
                      ...(value === "inbox" ? { count: attention } : {}),
                    }))}
                  >
                    {panel}
                  </LibraryTabs>
                ) : (
                  panel
                )}
              </div>
            </div>
          )}
        </>
      )}

      {editing && environmentId ? (
        <BotEditor
          environmentId={environmentId}
          bot={editing.bot}
          canSave={canSave}
          startersSupported={host.startersSupported}
          verdictsSupported={host.verdictsSupported}
          budgetsSupported={host.budgetsSupported}
          versionsSupported={host.versionsSupported}
          anywhereSupported={host.anywhereSupported}
          canReplay={canReplay}
          onReplay={(bot, draft) => setReplaying({ bot, source: { kind: "draft", draft } })}
          onClose={() => setEditing(null)}
          onSaved={(bot) => {
            setEditing(null);
            go({ bot: bot.id });
          }}
        />
      ) : null}
      {search.fromThread !== undefined && environmentId && live && host.fromThreadSupported ? (
        <BotFromThreadEditor
          key={search.fromThread}
          environmentId={environmentId}
          threadId={search.fromThread}
          suggestionId={search.suggestion ?? null}
          canSave={canSave}
          startersSupported={host.startersSupported}
          verdictsSupported={host.verdictsSupported}
          budgetsSupported={host.budgetsSupported}
          onClose={() => go({ bot: search.bot, tab: search.tab })}
          onSaved={(bot) => go({ bot: bot.id })}
        />
      ) : null}
      {runTarget && environmentId ? (
        <BotRunForm
          key={runTarget.id}
          environmentId={environmentId}
          bot={runTarget}
          canRun={canRun}
          onClose={() => go({ bot: search.bot })}
          onStarted={(run) => go({ bot: run.botId })}
        />
      ) : null}
      {newTriggerBot && environmentId ? (
        <BotTriggerEditor
          key={newTriggerBot.id}
          environmentId={environmentId}
          bot={newTriggerBot}
          trigger={null}
          canSave={canOperateTriggers}
          stableSupported={host.versionsSupported}
          pipelines={pipelinesStartingWith(newTriggerBot.id)}
          onClose={() => go({ bot: search.bot, tab: search.tab })}
          onSaved={(trigger) => go({ bot: trigger.botId, tab: "triggers" })}
        />
      ) : null}
      {editingTrigger && editingTriggerBot && environmentId ? (
        <BotTriggerEditor
          key={editingTrigger.id}
          environmentId={environmentId}
          bot={editingTriggerBot}
          trigger={editingTrigger}
          canSave={canOperateTriggers}
          stableSupported={host.versionsSupported}
          pipelines={pipelinesStartingWith(editingTriggerBot.id)}
          onClose={() => setEditingTrigger(null)}
          onSaved={() => setEditingTrigger(null)}
        />
      ) : null}
      {replaying && environmentId ? (
        <BotReplayDialog
          environmentId={environmentId}
          bot={replaying.bot}
          source={replaying.source}
          canRun={canReplay}
          onClose={() => setReplaying(null)}
        />
      ) : null}
      {runPipelineTarget && environmentId ? (
        <PipelineRunForm
          key={runPipelineTarget.id}
          environmentId={environmentId}
          pipeline={runPipelineTarget}
          allBots={allBots}
          canRun={canRunPipelines}
          onClose={() => go({ bot: search.bot, tab: search.tab })}
          onStarted={(run) => go({ bot: search.bot, tab: "pipelines", pipelineRun: run.id })}
        />
      ) : null}
      {manyTarget && environmentId ? (
        <RunOnManyDialog
          key={manyTarget.id}
          environmentId={environmentId}
          bot={manyTarget}
          canRun={canRun}
          onClose={() => go({ bot: search.bot, tab: search.tab })}
          onStarted={(batch) => go({ bot: batch.botId, tab: "batches", batch: batch.id })}
        />
      ) : null}
    </LibraryPageFrame>
  );
}

/** What sets a bot apart in the rail: where it came from, else the model it runs on. */
function railDetail(bot: BotDefinition, starter: string | null) {
  const origin = [
    bot.archivedAt ? "Archived" : null,
    starter,
    bot.library == null ? null : "From the Library",
  ].filter(Boolean);
  return [...(origin.length ? origin : [bot.modelSelection.model]), botVersionLabel(bot)].join(
    " · ",
  );
}

function RailItem({
  current,
  tile,
  title,
  detail,
  muted = false,
  onSelect,
}: {
  readonly current: boolean;
  readonly tile: ReactNode;
  readonly title: string;
  readonly detail: string;
  readonly muted?: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        current ? "bg-accent/70" : "hover:bg-accent/50",
        muted && "opacity-70",
      )}
    >
      {tile}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function BotHero({
  bot,
  starter,
  canRun,
  canSave,
  runsOnMany,
  onRun,
  onRunOnMany,
  onEdit,
  onArchive,
  onDelete,
}: {
  readonly bot: BotDefinition;
  readonly starter: BotStarterStatus | undefined;
  readonly canRun: boolean;
  readonly canSave: boolean;
  readonly runsOnMany: boolean;
  readonly onRun: () => void;
  readonly onRunOnMany: () => void;
  readonly onEdit: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}) {
  const archived = bot.archivedAt !== null;
  return (
    <header className="relative isolate overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-xs/5 sm:p-7">
      <ProjectGlow strength="strong" />
      <HeroTexture />
      <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <BotTile bot={bot} size="xl" />
        <div className="min-w-0 flex-1 basis-60 space-y-2 pt-0.5">
          <h2 className="wrap-anywhere text-3xl leading-tight font-semibold tracking-tight">
            {bot.name}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs tabular-nums text-muted-foreground">
            {archived ? (
              <LibraryStateBadge tone="neutral" icon={ArchiveIcon}>
                Archived
              </LibraryStateBadge>
            ) : null}
            <StarterBadge status={starter} />
            {bot.library == null ? null : (
              <LibraryStateBadge tone="neutral">From the Library</LibraryStateBadge>
            )}
            <span>{botVersionLabel(bot)}</span>
          </p>
          {bot.description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{bot.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
          <Button shape="pill" disabled={!canRun || archived} onClick={onRun}>
            <PlayIcon />
            Run
          </Button>
          {runsOnMany ? (
            <Button
              shape="pill"
              variant="outline"
              disabled={!canRun || archived}
              onClick={onRunOnMany}
            >
              <LayersIcon />
              Run on many
            </Button>
          ) : null}
          <Button shape="pill" variant="outline" disabled={!canSave} onClick={onEdit}>
            <PencilIcon />
            Edit
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  shape="pill"
                  size="icon"
                  variant="outline"
                  aria-label={`More actions for ${bot.name}`}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuItem disabled={!canSave} onClick={onArchive}>
                {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                {archived ? "Restore" : "Archive"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" disabled={!canSave} onClick={onDelete}>
                <Trash2Icon />
                Delete
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      <BotSummary bot={bot} />
    </header>
  );
}

/** The brief every run receives, folded by default since it can run to pages. */
function BotInstructions({ bot }: { readonly bot: BotDefinition }) {
  const lines = bot.instructions.split("\n").length;
  return (
    <details className={cn(LIBRARY_OUTLINE, "group")}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
        >
          <ScrollTextIcon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Instructions</span>
          <span className="block text-xs text-muted-foreground">
            The brief every run receives · {plural(lines, "line")}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <pre className="max-h-96 overflow-auto border-t border-border px-4 py-3 font-sans text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
        {bot.instructions}
      </pre>
    </details>
  );
}

function RemovedStarters({
  starters,
  canRestore,
  onRestore,
}: {
  readonly starters: readonly BotStarterStatus[];
  readonly canRestore: boolean;
  readonly onRestore: (starter: BotStarterStatus) => void;
}) {
  return (
    <section aria-label="Starters you removed" className="flex flex-col gap-2">
      <h3 className="px-2.5 text-xs font-medium text-muted-foreground">Starters you removed</h3>
      <ul className="flex flex-col gap-1">
        {starters.map((starter) => (
          <li key={starter.starterId} className="flex items-start gap-3 px-2.5 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{starter.name}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {starter.description}
              </span>
            </span>
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              disabled={!canRestore}
              onClick={() => onRestore(starter)}
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BotsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading bots"
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-1">
        {["first", "second", "third", "fourth"].map((row) => (
          <div key={row} className="flex items-center gap-3 px-2.5 py-2">
            <Skeleton shape="card" className="size-9" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-8">
        <Skeleton shape="pill" className="h-10 w-80 max-w-full" />
        <BotRowsSkeleton />
      </div>
    </div>
  );
}
