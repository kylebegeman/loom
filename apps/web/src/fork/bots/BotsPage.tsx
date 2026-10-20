import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  BOTS_LIST_BATCHES_MAX_LIMIT,
  BOTS_LIST_RUNS_MAX_LIMIT,
  type BotDefinition,
  type BotStarterState,
  type BotStarterStatus,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import { applyBatchChanges, applyRunChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { isElectron } from "~/env";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLibraryPermission } from "../project-library/state";
import { BatchList, BatchView } from "./BotBatches";
import { BotEditor, RUNTIME_MODE_LABELS, WORKSPACE_LABELS } from "./BotEditor";
import { BotRunForm } from "./BotRunForm";
import { BotRuns, VerdictFilter } from "./BotRuns";
import { BotsInbox } from "./BotsInbox";
import { BotsUsage } from "./BotsUsage";
import { botDraft } from "./draft";
import { RunOnManyDialog } from "./RunOnManyDialog";
import {
  bots,
  useBotBatchChanges,
  useBots,
  useBotsAttentionCount,
  useWaitingBotRuns,
} from "./state";

type Editing = { readonly bot: BotDefinition | null } | null;

const TAB_LABELS = { runs: "Runs", batches: "Batches", inbox: "Inbox", usage: "Usage" } as const;

const STARTER_LABELS: Record<Exclude<BotStarterState, "removed">, string> = {
  present: "Starter",
  edited: "Starter, edited",
  outdated: "Newer starter available",
};

function StarterBadge({ status }: { readonly status: BotStarterStatus | undefined }) {
  if (status === undefined || status.state === "removed") return null;
  return <Badge variant="secondary">{STARTER_LABELS[status.state]}</Badge>;
}

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
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate">{value}</dd>
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
  const archive = useAtomCommand(bots.archive, { reportFailure: false });
  const remove = useAtomCommand(bots.delete, { reportFailure: false });
  const restoreStarter = useAtomCommand(bots.restoreStarter, { reportFailure: false });
  const batchesLive = live && host.batchesSupported;
  const inboxLive = live && host.inboxSupported;
  const tabs = [
    "runs" as const,
    ...(batchesLive ? (["batches"] as const) : []),
    ...(inboxLive ? (["inbox"] as const) : []),
    ...(live && host.budgetsSupported ? (["usage"] as const) : []),
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
  const selected = selectedId === undefined ? null : allBots.find((bot) => bot.id === selectedId);
  const runs = applyRunChanges(runsQuery.data?.runs ?? [], changes, {
    botId: selectedId,
    verdict,
    includeNew: true,
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
  const latestVersionOf = (botId: string) =>
    allBots.find((bot) => bot.id === botId && bot.archivedAt === null)?.version ?? null;

  const go = (next: typeof search) =>
    void navigate({ to: "/loom/bots", search: next, replace: true });

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
        `Delete ${bot.name}? Its run history stays on the Bots page; the bot itself cannot be restored.`,
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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <span className="text-sm font-medium">Bots</span>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Bots</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Reusable jobs with fixed instructions, inputs and settings. Every run gets the same
                brief, whoever starts it.
              </p>
            </div>
            <Button
              size="sm"
              disabled={!canSave || !live}
              onClick={() => setEditing({ bot: null })}
            >
              New bot
            </Button>
          </div>
          {!environmentId ? (
            <p role="status">Connect to a Loom server to use bots.</p>
          ) : !host.connected ? (
            <p role="status">
              {host.environment?.label ?? "Your server"} is offline. Bots and runs below may be out
              of date.
            </p>
          ) : !host.supported ? (
            <p role="status">Update {host.environment?.label ?? "your server"} to use bots.</p>
          ) : null}
          {list.error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {list.error}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {actionError}
            </p>
          ) : null}
          {live && environmentId ? (
            <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
              <nav aria-label="Bots" className="flex flex-col gap-1">
                <Button
                  variant={selectedId === undefined ? "secondary" : "ghost"}
                  aria-pressed={selectedId === undefined}
                  onClick={() => go({ tab: search.tab })}
                >
                  {tab === "batches" ? "All batches" : "All runs"}
                </Button>
                {list.isPending && !list.data ? (
                  <p role="status" className="px-2 text-sm text-muted-foreground">
                    Loading bots…
                  </p>
                ) : null}
                {visibleBots.map((bot) => (
                  <Button
                    key={bot.id}
                    variant={bot.id === selectedId ? "secondary" : "ghost"}
                    aria-pressed={bot.id === selectedId}
                    onClick={() => go({ bot: bot.id, tab: search.tab })}
                  >
                    <span className="truncate">{bot.name}</span>
                    {bot.archivedAt ? " (archived)" : ""}
                    <StarterBadge status={starterOf(bot)} />
                  </Button>
                ))}
                {list.data && allBots.some((bot) => bot.archivedAt !== null) ? (
                  <Button size="xs" variant="ghost" onClick={() => setShowArchived((on) => !on)}>
                    {showArchived ? "Hide archived" : "Show archived"}
                  </Button>
                ) : null}
                {removedStarters.length > 0 ? (
                  <section aria-label="Starters you removed" className="mt-4 space-y-2 px-2">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      Starters you removed
                    </h3>
                    {removedStarters.map((starter) => (
                      <div key={starter.starterId} className="flex items-start gap-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{starter.name}</p>
                          <p className="text-xs text-muted-foreground">{starter.description}</p>
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!canSave}
                          onClick={() => void restoreRemoved(starter)}
                        >
                          Restore
                        </Button>
                      </div>
                    ))}
                  </section>
                ) : null}
                {list.data && allBots.length === 0 ? (
                  <p className="px-2 text-sm text-muted-foreground">
                    No bots yet. Create one for a job you brief agents on again and again.
                  </p>
                ) : null}
              </nav>
              <section className="min-w-0 space-y-6" aria-label={selected?.name ?? "All runs"}>
                {selectedId !== undefined && !selected && list.data ? (
                  <p role="status">This bot no longer exists.</p>
                ) : null}
                {selected ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold">{selected.name}</h2>
                          {selected.archivedAt ? <Badge variant="secondary">Archived</Badge> : null}
                          <StarterBadge status={starterOf(selected)} />
                          <span className="text-xs text-muted-foreground">
                            Version {selected.version}
                          </span>
                        </div>
                        {selected.description ? (
                          <p className="text-sm text-muted-foreground">{selected.description}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={!canRun || selected.archivedAt !== null}
                          onClick={() => go({ bot: selected.id, run: selected.id })}
                        >
                          Run
                        </Button>
                        {host.batchesSupported ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canRun || selected.archivedAt !== null}
                            onClick={() =>
                              go({ bot: selected.id, tab: search.tab, many: selected.id })
                            }
                          >
                            Run on many
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canSave}
                          onClick={() => setEditing({ bot: selected })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canSave}
                          onClick={() => void setArchived(selected, selected.archivedAt === null)}
                        >
                          {selected.archivedAt ? "Restore" : "Archive"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive-outline"
                          disabled={!canSave}
                          onClick={() => void deleteBot(selected)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <BotSummary bot={selected} />
                    <details className="rounded-lg border border-border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">Instructions</summary>
                      <pre className="mt-2 whitespace-pre-wrap font-sans">
                        {selected.instructions}
                      </pre>
                    </details>
                  </div>
                ) : null}
                {tabs.length > 1 ? (
                  <div className="flex gap-1" role="group" aria-label="Show">
                    {tabs.map((value) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={tab === value ? "secondary" : "ghost"}
                        aria-pressed={tab === value}
                        onClick={() => go({ bot: search.bot, tab: value })}
                      >
                        {TAB_LABELS[value]}
                        {value === "inbox" && attention > 0 ? (
                          <Badge variant="warning">{attention}</Badge>
                        ) : null}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {tab === "usage" ? (
                  <BotsUsage
                    environmentId={environmentId}
                    changes={changes}
                    connected={host.connected}
                  />
                ) : tab === "inbox" ? (
                  <BotsInbox
                    environmentId={environmentId}
                    changes={changes}
                    waiting={waiting}
                    connected={host.connected}
                    canAct={canRetry}
                  />
                ) : tab === "batches" ? (
                  <section className="space-y-3" aria-label="Batches">
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
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-medium">{selected ? "Batches" : "Recent batches"}</h3>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!host.connected || batchesQuery.isPending}
                        onClick={batchesQuery.refresh}
                      >
                        Refresh
                      </Button>
                    </div>
                    {batchesQuery.error ? (
                      <p role="alert" className="text-sm text-destructive-foreground">
                        {batchesQuery.error}
                      </p>
                    ) : batchesQuery.isPending && !batchesQuery.data ? (
                      <p role="status" className="text-sm text-muted-foreground">
                        Loading batches…
                      </p>
                    ) : (
                      <BatchList
                        batches={batches}
                        selectedId={search.batch}
                        showBot={selected === null || selected === undefined}
                        onSelect={(batch) =>
                          go({ bot: search.bot, tab: "batches", batch: batch.id })
                        }
                        emptyMessage={
                          selected
                            ? `${selected.name} has not run on many items yet.`
                            : "No batch has run yet."
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
                  <section className="space-y-3" aria-label="Runs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-medium">{selected ? "Runs" : "Recent runs"}</h3>
                      {host.verdictsSupported ? (
                        <VerdictFilter value={verdictFilter} onChange={setVerdictFilter} />
                      ) : null}
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!host.connected || runsQuery.isPending}
                        onClick={() => {
                          list.refresh();
                          runsQuery.refresh();
                        }}
                      >
                        Refresh
                      </Button>
                    </div>
                    {runsQuery.error ? (
                      <p role="alert" className="text-sm text-destructive-foreground">
                        {runsQuery.error}
                      </p>
                    ) : null}
                    {runsQuery.isPending && !runsQuery.data ? (
                      <p role="status" className="text-sm text-muted-foreground">
                        Loading runs…
                      </p>
                    ) : (
                      <BotRuns
                        environmentId={environmentId}
                        runs={runs}
                        showBot={selected === null || selected === undefined}
                        canCancel={canCancel}
                        emptyMessage={
                          verdict !== undefined
                            ? "No run matches this verdict."
                            : selected
                              ? `${selected.name} has not run yet.`
                              : "No bot has run yet."
                        }
                      />
                    )}
                    {runsQuery.data?.hasMore ? (
                      <p className="text-xs text-muted-foreground">
                        Showing the {BOTS_LIST_RUNS_MAX_LIMIT} most recent runs.
                      </p>
                    ) : null}
                  </section>
                )}
              </section>
            </div>
          ) : null}
        </WorkspacePageContainer>
      </main>
      {editing && environmentId ? (
        <BotEditor
          environmentId={environmentId}
          bot={editing.bot}
          canSave={canSave}
          startersSupported={host.startersSupported}
          verdictsSupported={host.verdictsSupported}
          budgetsSupported={host.budgetsSupported}
          onClose={() => setEditing(null)}
          onSaved={(bot) => {
            setEditing(null);
            go({ bot: bot.id });
          }}
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
    </SidebarInset>
  );
}
