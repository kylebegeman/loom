import { useEffect, useRef, useState } from "react";
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
import { applyBatchChanges, applyRunChanges, botColor } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  BotIcon,
  CloudOffIcon,
  GaugeIcon,
  HistoryIcon,
  InboxIcon,
  LayersIcon,
  LayoutGridIcon,
  MonitorIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  WorkflowIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
} from "../project-library/LibraryControls";
import { LibraryPageFrame } from "../project-library/LibraryPageFrame";
import { LibraryTabs, type LibraryTab } from "../project-library/LibraryTabs";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { useLibraryPermission } from "../project-library/state";
import { ActivityStrip } from "./BotActivity";
import { BotRemoteRunsSettings, BotSharingPanel } from "./BotAnywhere";
import { BatchList, BatchView } from "./BotBatches";
import { BotDetail } from "./BotDetail";
import { BotEditor } from "./BotEditor";
import { BotHistory } from "./BotHistory";
import { BotPipelines } from "./BotPipelines";
import { BotReplayDialog, type BotReplaySourceChoice } from "./BotReplay";
import { BotRunForm } from "./BotRunForm";
import { BotRowsSkeleton, BotRuns, VerdictFilter } from "./BotRuns";
import { BotTriggerEditor } from "./BotTriggerEditor";
import { BotTriggers } from "./BotTriggers";
import { BotsInbox } from "./BotsInbox";
import { BotsTable, RemovedStarters } from "./BotsOverview";
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
  | "bots"
  | "runs"
  | "history"
  | "batches"
  | "pipelines"
  | "triggers"
  | "inbox"
  | "usage"
  | "computers";

const TABS: Record<BotsTab, { readonly label: string; readonly icon: LucideIcon }> = {
  bots: { label: "Bots", icon: LayoutGridIcon },
  runs: { label: "Runs", icon: PlayIcon },
  history: { label: "History", icon: HistoryIcon },
  batches: { label: "Batches", icon: LayersIcon },
  pipelines: { label: "Pipelines", icon: WorkflowIcon },
  triggers: { label: "Triggers", icon: ZapIcon },
  inbox: { label: "Inbox", icon: InboxIcon },
  usage: { label: "Usage", icon: GaugeIcon },
  computers: { label: "Computers", icon: MonitorIcon },
};

/** The page's own ink while no bot is open; each bot then wears its own color. */
const BOTS_COLOR: LibraryProjectColor = "plum";

export function BotsPage() {
  const { host, live, changes, list, bots: allBots } = useBots();
  const search = useSearch({ from: "/loom/bots" });
  const navigate = useNavigate();
  const environmentId = host.environmentId;
  const selectedId = search.bot;
  const selected = selectedId === undefined ? null : allBots.find((bot) => bot.id === selectedId);
  const versionsLive = live && host.versionsSupported;
  const batchesLive = live && host.batchesSupported;
  const inboxLive = live && host.inboxSupported;
  const triggersLive = live && host.triggersSupported;
  const pipelinesLive = live && host.pipelinesSupported;
  // A bot's page holds what belongs to that bot; the index holds everything across bots.
  const tabs: BotsTab[] = selected
    ? [
        "runs",
        ...(versionsLive ? (["history"] as const) : []),
        ...(batchesLive ? (["batches"] as const) : []),
        ...(triggersLive ? (["triggers"] as const) : []),
      ]
    : [
        "bots",
        "runs",
        ...(inboxLive ? (["inbox"] as const) : []),
        ...(batchesLive ? (["batches"] as const) : []),
        ...(pipelinesLive ? (["pipelines"] as const) : []),
        ...(triggersLive ? (["triggers"] as const) : []),
        ...(live && host.budgetsSupported ? (["usage"] as const) : []),
        ...(live && host.anywhereSupported ? (["computers"] as const) : []),
      ];
  const tab = tabs.find((value) => value === search.tab) ?? tabs[0]!;
  const [verdictFilter, setVerdictFilter] = useState<BotVerdictValue | null>(null);
  // The filter narrows the Runs view only; the overview's activity always shows every run.
  const verdict =
    host.verdictsSupported && tab === "runs" ? (verdictFilter ?? undefined) : undefined;
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
  // Shares the runs query's atom whenever no filter is set, so it costs a request only then.
  const activityQuery = useEnvironmentQuery(
    environmentId && live && verdict !== undefined
      ? bots.listRuns({
          environmentId,
          input: {
            limit: BOTS_LIST_RUNS_MAX_LIMIT,
            ...(selectedId === undefined ? {} : { botId: selectedId }),
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
  const archive = useAtomCommand(bots.archive, { reportFailure: false });
  const remove = useAtomCommand(bots.delete, { reportFailure: false });
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });
  const { pipelines } = usePipelines(environmentId, pipelinesLive, host.connected);
  const triggerChanges = useBotTriggerChanges(environmentId, triggersLive && host.connected);
  const canOperateTriggers =
    useLibraryPermission(bots.saveTrigger, environmentId) && host.connected;
  const [editingTrigger, setEditingTrigger] = useState<BotTrigger | null>(null);
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
  useRefreshWhenBotsChangesPruned(changes, runsQuery.refresh);
  const runs = applyRunChanges(runsQuery.data?.runs ?? [], changes, {
    botId: selectedId,
    verdict,
    includeNew: true,
    limit: BOTS_LIST_RUNS_MAX_LIMIT,
  });
  // The record a bot's page and the overview show, never narrowed by the verdict filter.
  const activity =
    verdict === undefined
      ? runs
      : applyRunChanges(activityQuery.data?.runs ?? [], changes, {
          botId: selectedId,
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
  // Opening a bot is a step deeper, so Back returns to the index.
  const openBot = (bot: BotDefinition) =>
    void navigate({ to: "/loom/bots", search: { bot: bot.id } });

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
  const runsPending = runsQuery.isPending && !runsQuery.data;

  const runsView = (
    <section className="flex flex-col gap-3" aria-label="Runs">
      <LibraryErrorNotice error={runsQuery.error} onRetry={runsQuery.refresh} />
      {runsPending ? (
        <BotRowsSkeleton />
      ) : runsQuery.error && !runsQuery.data ? null : (
        <BotRuns
          environmentId={environmentId!}
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

  const overview = (
    <div className="flex flex-col gap-6">
      {allBots.length === 0 ? (
        <LibraryEmpty
          icon={BotIcon}
          title="Create your first bot"
          action={
            <Button
              shape="pill"
              disabled={!canSave || !live}
              onClick={() => setEditing({ bot: null })}
            >
              <PlusIcon />
              New bot
            </Button>
          }
        >
          A bot is a job you brief agents on again and again, such as a review or a release check.
          Its instructions, inputs and settings stay fixed, so every run starts from the same brief.
        </LibraryEmpty>
      ) : (
        <>
          {runsPending ? (
            <Skeleton shape="card" className="h-27 w-full" />
          ) : activity.length ? (
            <ActivityStrip runs={activity} />
          ) : null}
          <BotsTable
            bots={visibleBots}
            runs={activity}
            starterOf={starterOf}
            canRun={canRun}
            onOpen={openBot}
            onRun={(bot) => go({ run: bot.id })}
          />
        </>
      )}
      {environmentId && host.fromThreadSupported ? (
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
      {removedStarters.length ? (
        <RemovedStarters
          starters={removedStarters}
          canRestore={canSave}
          onRestore={(starter) => void restoreRemoved(starter)}
        />
      ) : null}
    </div>
  );

  const panel = !environmentId ? null : tab === "bots" ? (
    overview
  ) : tab === "history" && selected ? (
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
      onSelectRun={(pipelineRun) => go({ tab: "pipelines", pipelineRun })}
      onRun={(pipeline) => go({ tab: "pipelines", runPipeline: pipeline.id })}
      onOpenBatch={(batch) => go({ tab: "batches", batch })}
    />
  ) : tab === "batches" ? (
    <section className="flex flex-col gap-3" aria-label="Batches">
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
    runsView
  );

  const tabActions =
    tab === "runs" && host.verdictsSupported ? (
      <VerdictFilter value={verdictFilter} onChange={setVerdictFilter} />
    ) : tab === "bots" && archivedCount ? (
      <Button
        shape="pill"
        size="xs"
        variant={showArchived ? "secondary" : "ghost"}
        aria-pressed={showArchived}
        onClick={() => setShowArchived((on) => !on)}
      >
        <ArchiveIcon />
        Archived ({archivedCount})
      </Button>
    ) : null;

  const views = (
    <LibraryTabs
      label={selected ? `${selected.name} views` : "Bots views"}
      variant="underline"
      selected={tab}
      onSelect={(value) => go({ bot: search.bot, tab: value })}
      actions={tabActions}
      tabs={tabs.map((value): LibraryTab<BotsTab> => ({
        value,
        ...TABS[value],
        ...(value === "inbox" ? { count: attention, urgent: true } : {}),
        ...(value === "bots" && list.data ? { count: allBots.length - archivedCount } : {}),
      }))}
    >
      {panel}
    </LibraryTabs>
  );

  const notices = (
    <>
      {environmentId && !host.connected ? (
        <LibraryNotice icon={CloudOffIcon} tone="warning">
          {host.environment?.label ?? "Your server"} is offline. Bots and runs below may be out of
          date until it reconnects.
        </LibraryNotice>
      ) : null}
      <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
      <LibraryErrorNotice error={actionError} />
    </>
  );

  const body = !environmentId ? (
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
  ) : selected ? (
    <BotDetail
      bot={selected}
      starter={starterOf(selected)}
      runs={activity}
      canRun={canRun}
      canSave={canSave}
      runsOnMany={host.batchesSupported}
      onRun={() => go({ bot: selected.id, tab: search.tab, run: selected.id })}
      onRunOnMany={() => go({ bot: selected.id, tab: search.tab, many: selected.id })}
      onEdit={() => setEditing({ bot: selected })}
      onArchive={() => void setArchived(selected, selected.archivedAt === null)}
      onDelete={() => void deleteBot(selected)}
      aside={
        host.anywhereSupported ? (
          <BotSharingPanel
            key={selected.id}
            environmentId={environmentId}
            bot={selected}
            canChange={canShare}
          />
        ) : null
      }
    >
      {views}
    </BotDetail>
  ) : (
    <>
      {selectedId !== undefined ? (
        <LibraryNotice
          icon={BotIcon}
          action={
            <Button shape="pill" size="xs" variant="outline" onClick={() => go({})}>
              Dismiss
            </Button>
          }
        >
          This bot no longer exists. Its runs stay under Runs.
        </LibraryNotice>
      ) : null}
      {views}
    </>
  );

  return (
    <LibraryPageFrame
      section={{ label: "Bots", to: "/loom/bots" }}
      libraryStatus={false}
      style={projectColorStyle(selected ? botColor(selected) : BOTS_COLOR)}
      {...(selected ? { title: selected.name } : {})}
    >
      {selected ? null : (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h1 className="text-xl font-semibold tracking-tight">Bots</h1>
            <p className="text-sm text-muted-foreground">
              Reusable jobs with fixed instructions, inputs and settings. Every run gets the same
              brief, whoever starts it.
            </p>
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
      )}
      {notices}
      {body}

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
          onStarted={(run) => go({ tab: "pipelines", pipelineRun: run.id })}
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

const SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth"];

/** The index's own shape while the bot list loads, so nothing jumps when it arrives. */
function BotsSkeleton() {
  return (
    <div role="status" aria-label="Loading bots" className="flex flex-col gap-5">
      <div className="flex h-10 items-end gap-5 border-b border-border pb-3">
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-3.5 w-14" />
      </div>
      <Skeleton shape="card" className="h-27 w-full" />
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton shape="card" className="size-6" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40 max-w-full" />
              <Skeleton className="h-2.5 w-64 max-w-full" />
            </div>
            <Skeleton className="hidden h-4 w-32 sm:block" />
            <Skeleton shape="pill" className="h-6 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
