import { useEffect, useRef } from "react";
import { BOTS_LIST_BATCHES_MAX_LIMIT, BOTS_LIST_RUNS_MAX_LIMIT } from "@t3tools/contracts/fork";
import { botColor } from "@t3tools/client-runtime/fork";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BotIcon,
  CloudOffIcon,
  LockIcon,
  PlusIcon,
  RefreshCwIcon,
  WorkflowIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useEnvironmentQueryRefresh } from "~/state/query";
import {
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
} from "../project-library/LibraryControls";
import type { LibraryLayout } from "../project-library/LibraryCollection";
import { LibraryPageFrame } from "../project-library/LibraryPageFrame";
import { LibraryTabs, type LibraryTab } from "../project-library/LibraryTabs";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { ComputersButton, ComputersOverlay } from "./BotAnywhere";
import { BatchPage } from "./BotBatches";
import { BotPage } from "./BotDetail";
import { BOTS_COLOR } from "./BotIdentity";
import { BotEditorPage } from "./BotEditor";
import { PipelinePage, PipelinesView } from "./BotPipelines";
import { ReplayOverlays } from "./BotReplay";
import { RunsView } from "./BotRuns";
import { TriggersOverlays, TriggersView } from "./BotTriggers";
import {
  BotsCollection,
  BotsCollectionSkeleton,
  useBotsCollectionPreferences,
} from "./BotsOverview";
import { BotsUsageClause, useBotUsage, useBotUsageWindow } from "./BotsUsage";
import {
  botsRoute,
  indexTabs,
  routeFeature,
  selectedTab,
  type BotsFeature,
  type BotsIndexTab,
  type BotsRoute,
} from "./botsRoute";
import { BotFromThreadPage } from "./fromThread/BotFromThreadEditor";
import { useBotsNavigation } from "./navigation";
import { PipelineBuilderPage } from "./PipelineEditor";
import { pipelineRunsInput } from "./pipelineDraft";
import { PipelineRunPage, PipelinesOverlays } from "./PipelineRunView";
import { BatchesOverlays } from "./RunOnManyDialog";
import { RunsOverlays } from "./RunSheet";
import {
  bots,
  inboxQueryInput,
  useBots,
  useBotsAccess,
  useBotsAttentionCount,
  usePipelines,
} from "./state";

/** The routes drawn from the bot list, which the shell holds back until the list arrives. */
const usesBotList = (route: BotsRoute) =>
  route.kind === "index" || route.kind === "bot" || route.kind === "editBot";

/** These open on a hero that carries the page's h1; the rest take it from the breadcrumb. */
const HERO_ROUTES: ReadonlySet<BotsRoute["kind"]> = new Set([
  "bot",
  "pipeline",
  "pipelineRun",
  "batch",
]);

function routeTitle(
  route: BotsRoute,
  botName: string | undefined,
  pipelineName: string | undefined,
): string | undefined {
  switch (route.kind) {
    case "fromThread":
      return "New bot from a thread";
    case "newBot":
      return "New bot";
    case "editBot":
      return botName === undefined ? undefined : `Edit ${botName}`;
    case "bot":
      return botName;
    case "newPipeline":
      return "New pipeline";
    case "editPipeline":
      return pipelineName === undefined ? "Edit pipeline" : `Edit ${pipelineName}`;
    case "pipeline":
      return pipelineName ?? "Pipeline";
    case "pipelineRun":
      return "Pipeline run";
    case "batch":
      return "Batch";
    case "index":
      return undefined;
  }
}

/**
 * The search names one page, and optionally one dialog or sheet over it. The shell decides which
 * page that is, frames it once and hosts every overlay once; each page and overlay owns its layout
 * and navigates itself.
 */
export function BotsPage() {
  const { host, live, changes, list, bots: allBots } = useBots();
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const route = botsRoute(nav.search);
  const environmentId = host.environmentId;
  const selectedId = route.kind === "bot" || route.kind === "editBot" ? route.botId : null;
  const selected =
    selectedId === null ? null : (allBots.find((bot) => bot.id === selectedId) ?? null);
  const pipelineId =
    route.kind === "pipeline" || route.kind === "editPipeline" ? route.pipelineId : null;
  const { pipelines } = usePipelines(
    environmentId,
    live && host.pipelinesSupported && pipelineId !== null,
    host.connected,
  );
  const listRoute = usesBotList(route);
  // The same inputs the collection and the bot page read, so these refresh their atoms.
  const starters = useEnvironmentQueryRefresh(
    environmentId && live && listRoute && host.startersSupported
      ? bots.listStarters({ environmentId, input: {} })
      : null,
  );
  const newestRuns = useEnvironmentQueryRefresh(
    environmentId && live && listRoute
      ? bots.listRuns({
          environmentId,
          input: { limit: BOTS_LIST_RUNS_MAX_LIMIT, ...(selectedId ? { botId: selectedId } : {}) },
        })
      : null,
  );

  // Changes missed while disconnected never arrive, so a reconnect refetches what the page holds.
  const refreshList = list.refresh;
  const refreshStarters = starters.refresh;
  const refreshRuns = newestRuns.refresh;
  const wasConnected = useRef(host.connected);
  useEffect(() => {
    if (host.connected && !wasConnected.current) {
      refreshList();
      refreshStarters();
      refreshRuns();
    }
    wasConnected.current = host.connected;
  }, [host.connected, refreshList, refreshStarters, refreshRuns]);

  // Saving, deleting or restoring a bot can change its starter's state.
  const botChanges = changes.bots;
  const seenBotChanges = useRef(botChanges);
  useEffect(() => {
    if (seenBotChanges.current === botChanges) return;
    seenBotChanges.current = botChanges;
    refreshStarters();
  }, [botChanges, refreshStarters]);

  const hostLabel = host.environment?.label ?? "Your server";
  const pipelineName =
    pipelineId === null
      ? undefined
      : pipelines.find((pipeline) => pipeline.id === pipelineId)?.name;
  const title = routeTitle(route, selected?.name, pipelineName);
  const ready = Boolean(environmentId && live);
  // A list route with nothing loaded says it is offline itself, in place of the page.
  const offlineInPlace = listRoute && !list.data;

  const body = !environmentId ? (
    <LibraryEmpty icon={BotIcon} title="Connect to a Loom server">
      Bots run on the server this app connects to. Connect one to create bots and run them.
    </LibraryEmpty>
  ) : !host.environment?.serverConfig ? (
    host.connected ? (
      <RouteSkeleton route={route} />
    ) : (
      <OfflineEmpty hostLabel={hostLabel} />
    )
  ) : !host.supported ? (
    <LibraryEmpty icon={CloudOffIcon} title="Bots need a newer server">
      Update {hostLabel} to create and run bots here.
    </LibraryEmpty>
  ) : (
    <RouteView route={route} hostLabel={hostLabel} />
  );

  return (
    <LibraryPageFrame
      section={{ label: "Bots", to: "/loom/bots" }}
      libraryStatus={false}
      heading={!HERO_ROUTES.has(route.kind)}
      style={projectColorStyle(selected ? botColor(selected) : BOTS_COLOR)}
      {...(title ? { title } : {})}
    >
      {ready && !host.connected && !offlineInPlace ? (
        <LibraryNotice icon={CloudOffIcon} tone="warning">
          {hostLabel} is offline. What you see here may be out of date, and nothing can run or
          change until it reconnects.
        </LibraryNotice>
      ) : null}
      {ready && host.connected && list.data && !access.canSave && !access.canRun ? (
        <LibraryNotice icon={LockIcon}>
          This connection can look at bots but cannot run or change them.
        </LibraryNotice>
      ) : null}
      {body}
      {ready ? (
        <>
          <RunsOverlays />
          <BatchesOverlays />
          <PipelinesOverlays />
          <TriggersOverlays />
          <ComputersOverlay />
          <ReplayOverlays />
        </>
      ) : null}
    </LibraryPageFrame>
  );
}

const FEATURE_COPY: Record<BotsFeature, { readonly title: string; readonly need: string }> = {
  fromThread: {
    title: "Saving a thread as a bot needs a newer server",
    need: "to draft a bot from a thread. You can still write one from scratch.",
  },
  pipelines: {
    title: "Pipelines need a newer server",
    need: "to chain bots into pipelines.",
  },
  batches: {
    title: "Running on many needs a newer server",
    need: "to run a bot over many items at once.",
  },
};

/** One page of the route, once the host is known to run bots. */
function RouteView({
  route,
  hostLabel,
}: {
  readonly route: BotsRoute;
  readonly hostLabel: string;
}) {
  const { host, list, bots: allBots } = useBots();
  const nav = useBotsNavigation();
  const feature = routeFeature(route);
  const supported =
    feature === null ||
    (feature === "fromThread" && host.fromThreadSupported) ||
    (feature === "pipelines" && host.pipelinesSupported) ||
    (feature === "batches" && host.batchesSupported);
  if (feature !== null && !supported)
    return (
      <LibraryEmpty
        icon={CloudOffIcon}
        title={FEATURE_COPY[feature].title}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button shape="pill" size="sm" variant="outline" onClick={() => nav.show({})}>
              <ArrowLeftIcon />
              Back to Bots
            </Button>
            {feature === "fromThread" ? (
              <Button shape="pill" size="sm" onClick={() => nav.show({ newBot: true })}>
                <PlusIcon />
                New bot
              </Button>
            ) : null}
          </div>
        }
      >
        Update {hostLabel} {FEATURE_COPY[feature].need}
      </LibraryEmpty>
    );

  switch (route.kind) {
    case "index":
      return <BotsIndex hostLabel={hostLabel} />;
    case "bot":
    case "editBot": {
      if (!list.data)
        return list.error ? (
          <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
        ) : host.connected ? (
          <BotPageSkeleton />
        ) : (
          <OfflineEmpty hostLabel={hostLabel} />
        );
      const bot = allBots.find((entry) => entry.id === route.botId);
      if (!bot) return <MissingBot />;
      return route.kind === "bot" ? (
        <BotPage key={bot.id} bot={bot} />
      ) : (
        <BotEditorPage key={bot.id} bot={bot} />
      );
    }
    case "newBot":
      return <BotEditorPage key="new" bot={null} />;
    case "fromThread":
      return (
        <BotFromThreadPage
          key={`${route.threadId}:${route.suggestionId ?? ""}`}
          threadId={route.threadId}
          suggestionId={route.suggestionId}
        />
      );
    case "newPipeline":
      return <PipelineBuilderPage key="new" pipelineId={null} />;
    case "editPipeline":
      return <PipelineBuilderPage key={route.pipelineId} pipelineId={route.pipelineId} />;
    case "pipelineRun":
      return <PipelineRunPage key={route.runId} runId={route.runId} />;
    case "pipeline":
      return <PipelinePage key={route.pipelineId} pipelineId={route.pipelineId} />;
    case "batch":
      return <BatchPage key={route.batchId} batchId={route.batchId} />;
  }
}

const INDEX_TABS: Record<BotsIndexTab, { readonly label: string; readonly icon: LucideIcon }> = {
  bots: { label: "Bots", icon: BotIcon },
  runs: { label: "Runs", icon: ActivityIcon },
  pipelines: { label: "Pipelines", icon: WorkflowIcon },
  triggers: { label: "Triggers", icon: ZapIcon },
};

/** The index: every bot, every run, every pipeline and every trigger, one view each. */
function BotsIndex({ hostLabel }: { readonly hostLabel: string }) {
  const { host, live, list, bots: allBots } = useBots();
  const access = useBotsAccess();
  const nav = useBotsNavigation();
  const [preferences] = useBotsCollectionPreferences();
  const [days] = useBotUsageWindow();
  const attention = useBotsAttentionCount();
  const environmentId = host.environmentId;
  const pipelinesLive = live && host.pipelinesSupported;
  const { list: pipelineList, pipelines } = usePipelines(
    environmentId,
    pipelinesLive,
    host.connected,
  );
  const usage = useBotUsage(days);
  const starters = useEnvironmentQueryRefresh(
    environmentId && live && host.startersSupported
      ? bots.listStarters({ environmentId, input: {} })
      : null,
  );
  const newest = useEnvironmentQueryRefresh(
    environmentId && live
      ? bots.listRuns({ environmentId, input: { limit: BOTS_LIST_RUNS_MAX_LIMIT } })
      : null,
  );
  const inbox = useEnvironmentQueryRefresh(
    environmentId && live && host.inboxSupported
      ? bots.inbox({ environmentId, input: inboxQueryInput(false) })
      : null,
  );
  // The inputs the Triggers, Pipelines and Runs > Batches views and the suggestions ask with, so
  // Refresh reloads whichever of them is open. A query no view shows is not fetched by a refresh.
  const triggers = useEnvironmentQueryRefresh(
    environmentId && live && host.triggersSupported
      ? bots.listTriggers({ environmentId, input: {} })
      : null,
  );
  const suggestions = useEnvironmentQueryRefresh(
    environmentId && live && host.fromThreadSupported
      ? bots.suggestions({ environmentId, input: {} })
      : null,
  );
  const pipelineRuns = useEnvironmentQueryRefresh(
    environmentId && pipelinesLive
      ? bots.listPipelineRuns({ environmentId, input: pipelineRunsInput() })
      : null,
  );
  const batches = useEnvironmentQueryRefresh(
    environmentId && live && host.batchesSupported
      ? bots.listBatches({ environmentId, input: { limit: BOTS_LIST_BATCHES_MAX_LIMIT } })
      : null,
  );
  const tabs = indexTabs(host);
  const tab = selectedTab(tabs, nav.search.tab);
  const current = allBots.filter((bot) => bot.archivedAt === null).length;
  const refresh = () => {
    list.refresh();
    starters.refresh();
    newest.refresh();
    inbox.refresh();
    usage.refresh();
    triggers.refresh();
    suggestions.refresh();
    pipelineRuns.refresh();
    batches.refresh();
    if (pipelinesLive) pipelineList.refresh();
  };

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-4">
        <div className="flex min-h-5 max-w-2xl min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {host.budgetsSupported && allBots.length ? (
            <BotsUsageClause days={days} />
          ) : (
            "Reusable jobs with a fixed brief. Every run starts from the same instructions, inputs and settings."
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ComputersButton />
          <Button
            shape="pill"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh bots"
            disabled={!host.connected || list.isPending}
            onClick={refresh}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            shape="pill"
            size="sm"
            disabled={!access.canSave}
            onClick={() => nav.open({ newBot: true })}
          >
            <PlusIcon />
            New bot
          </Button>
        </div>
      </header>
      {list.data ? (
        <LibraryTabs
          label="Bots views"
          selected={tab}
          onSelect={(value) => nav.show(value === "bots" ? {} : { tab: value })}
          tabs={tabs.map((value): LibraryTab<BotsIndexTab> => ({
            value,
            ...INDEX_TABS[value],
            ...(value === "bots" ? { count: current } : {}),
            ...(value === "runs" ? { count: attention, urgent: true } : {}),
            ...(value === "pipelines" ? { count: pipelines.length } : {}),
          }))}
        >
          {tab === "runs" ? (
            <RunsView bot={null} />
          ) : tab === "pipelines" ? (
            <PipelinesView />
          ) : tab === "triggers" ? (
            <TriggersView />
          ) : (
            <BotsCollection />
          )}
        </LibraryTabs>
      ) : list.error ? (
        <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
      ) : host.connected ? (
        <IndexSkeleton tab={tab} view={preferences.view} />
      ) : (
        <OfflineEmpty hostLabel={hostLabel} />
      )}
    </>
  );
}

/** Nothing has loaded and the server is away: say so, rather than a skeleton that never resolves. */
function OfflineEmpty({ hostLabel }: { readonly hostLabel: string }) {
  return (
    <LibraryEmpty icon={CloudOffIcon} title={`${hostLabel} is offline`}>
      Bots load when it reconnects.
    </LibraryEmpty>
  );
}

function MissingBot() {
  const nav = useBotsNavigation();
  return (
    <LibraryEmpty
      icon={BotIcon}
      title="This bot no longer exists"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            shape="pill"
            size="sm"
            variant="outline"
            onClick={() => nav.show({ tab: "runs" })}
          >
            <ActivityIcon />
            Open Runs
          </Button>
          <Button shape="pill" size="sm" onClick={() => nav.show({})}>
            <ArrowLeftIcon />
            Back to Bots
          </Button>
        </div>
      }
    >
      It was deleted, or the link points at another server. Its past runs stay under Runs.
    </LibraryEmpty>
  );
}

/** The skeleton for whichever page is on its way while the server describes itself. */
function RouteSkeleton({ route }: { readonly route: BotsRoute }) {
  const [preferences] = useBotsCollectionPreferences();
  if (route.kind === "index")
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-3.5 w-72 max-w-full" />
          <Skeleton shape="pill" className="h-8 w-24" />
        </div>
        <IndexSkeleton tab="bots" view={preferences.view} />
      </div>
    );
  if (route.kind === "bot") return <BotPageSkeleton />;
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Skeleton shape="card" className="size-8" />
        <Skeleton className="h-3.5 w-64 max-w-full" />
      </div>
      <Skeleton shape="card" className="h-64 w-full" />
    </div>
  );
}

const TAB_SKELETONS = ["first", "second", "third", "fourth"];
const ROW_SKELETONS = ["first", "second", "third", "fourth", "fifth"];

function TabsSkeleton() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-full bg-muted p-1 dark:bg-accent">
      {TAB_SKELETONS.map((key) => (
        <Skeleton key={key} shape="pill" className="h-8 w-22" />
      ))}
    </div>
  );
}

/** The index's own shape while the bot list loads, so nothing jumps when it arrives. */
function IndexSkeleton({
  tab,
  view,
}: {
  readonly tab: BotsIndexTab;
  readonly view: LibraryLayout;
}) {
  return (
    <div role="status" aria-label="Loading bots" className="flex flex-col gap-6">
      <TabsSkeleton />
      {tab === "bots" ? (
        <BotsCollectionSkeleton view={view} />
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {ROW_SKELETONS.map((row) => (
            <div key={row} className="flex items-center gap-3 px-3.5 py-2.5">
              <Skeleton shape="card" className="size-6" />
              <Skeleton className="h-3.5 w-1/4" />
              <Skeleton className="ms-auto h-3 w-1/5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A bot page's shape: the hero with its vitals, the views, and the overview's two columns. */
function BotPageSkeleton() {
  return (
    <div role="status" aria-label="Loading bot" className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-5">
          <Skeleton shape="card" className="size-16" />
          <div className="flex flex-1 flex-col gap-2.5 pt-1">
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <div className="hidden items-center gap-1.5 sm:flex">
            <Skeleton shape="pill" className="h-8 w-18" />
            <Skeleton shape="pill" className="h-8 w-18" />
          </div>
        </div>
        <div className="flex flex-wrap gap-8 border-t border-border pt-4">
          {TAB_SKELETONS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
      <TabsSkeleton />
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton shape="card" className="h-48 w-full" />
        <Skeleton shape="card" className="h-32 w-full" />
      </div>
    </div>
  );
}
