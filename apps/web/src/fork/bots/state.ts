import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  applyBotChanges,
  applyInboxChanges,
  applyPipelineChanges,
  type BotsChanges,
  createBotsAtoms,
  EMPTY_BOT_BATCH_CHANGES,
  EMPTY_BOT_PIPELINE_CHANGES,
  EMPTY_BOT_TRIGGER_CHANGES,
  EMPTY_BOTS_CHANGES,
  makeWaitingBotRunsAtom,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_ANYWHERE_FEATURE,
  BOTS_BATCHES_FEATURE,
  BOTS_BUDGETS_FEATURE,
  BOTS_FEATURE,
  BOTS_FROM_THREAD_FEATURE,
  BOTS_INBOX_FEATURE,
  BOTS_INVOCATION_FEATURE,
  BOTS_PIPELINES_FEATURE,
  BOTS_LIST_RUNS_MAX_LIMIT,
  BOTS_STARTERS_FEATURE,
  BOTS_TRIGGERS_FEATURE,
  BOTS_VERDICTS_FEATURE,
  BOTS_VERSIONS_FEATURE,
  type BotDefinition,
  type BotRun,
} from "@t3tools/contracts/fork";
import { connectionAtomRuntime } from "~/connection/runtime";
import { usePrimaryEnvironment } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { environmentThreadShells } from "~/state/threads";
import { useLibraryPermission } from "../project-library/state";
import { triageItems, type TriageItem } from "./inboxWaiting";

export const bots = createBotsAtoms(connectionAtomRuntime);
const waitingBotRunsAtom = makeWaitingBotRunsAtom(environmentThreadShells.threadShellsAtom);

/** Bots live on the primary environment, which runs them. */
export function useBotsHost() {
  const environment = usePrimaryEnvironment();
  const capabilities = environment?.serverConfig?.environment.capabilities;
  return {
    environment,
    environmentId: environment?.environmentId ?? null,
    connected: environment?.connection.phase === "connected",
    supported: supportsLoomFeature(capabilities, BOTS_FEATURE),
    startersSupported: supportsLoomFeature(capabilities, BOTS_STARTERS_FEATURE),
    invocationSupported: supportsLoomFeature(capabilities, BOTS_INVOCATION_FEATURE),
    verdictsSupported: supportsLoomFeature(capabilities, BOTS_VERDICTS_FEATURE),
    batchesSupported: supportsLoomFeature(capabilities, BOTS_BATCHES_FEATURE),
    inboxSupported: supportsLoomFeature(capabilities, BOTS_INBOX_FEATURE),
    budgetsSupported: supportsLoomFeature(capabilities, BOTS_BUDGETS_FEATURE),
    fromThreadSupported: supportsLoomFeature(capabilities, BOTS_FROM_THREAD_FEATURE),
    triggersSupported: supportsLoomFeature(capabilities, BOTS_TRIGGERS_FEATURE),
    versionsSupported: supportsLoomFeature(capabilities, BOTS_VERSIONS_FEATURE),
    pipelinesSupported: supportsLoomFeature(capabilities, BOTS_PIPELINES_FEATURE),
    anywhereSupported: supportsLoomFeature(capabilities, BOTS_ANYWHERE_FEATURE),
  };
}

/**
 * What this client may do with the host's bots. Each is false while the host is away, so a control
 * never offers an action the server cannot take; the server still checks every call.
 */
export function useBotsAccess() {
  const { environmentId, connected } = useBotsHost();
  const canSave = useLibraryPermission(bots.save, environmentId);
  const canRun = useLibraryPermission(bots.run, environmentId);
  const canCancel = useLibraryPermission(bots.cancel, environmentId);
  const canRate = useLibraryPermission(bots.rateRun, environmentId);
  const canRetry = useLibraryPermission(bots.retry, environmentId);
  const canDismiss = useLibraryPermission(bots.dismiss, environmentId);
  const canReplay = useLibraryPermission(bots.replay, environmentId);
  const canRunPipelines = useLibraryPermission(bots.runPipeline, environmentId);
  const canSavePipelines = useLibraryPermission(bots.savePipeline, environmentId);
  const canOperateTriggers = useLibraryPermission(bots.saveTrigger, environmentId);
  const canShare = useLibraryPermission(bots.share, environmentId);
  return {
    canSave: canSave && connected,
    canRun: canRun && connected,
    canCancel: canCancel && connected,
    canRate: canRate && connected,
    canRetry: canRetry && connected,
    canDismiss: canDismiss && connected,
    canReplay: canReplay && connected,
    canRunPipelines: canRunPipelines && connected,
    canSavePipelines: canSavePipelines && connected,
    canOperateTriggers: canOperateTriggers && connected,
    canShare: canShare && connected,
  };
}

const NO_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOTS_CHANGES));

/** Changes watched while connected; lists fetched once are overlaid with them. */
export function useBotsChanges(environmentId: EnvironmentId | null, enabled: boolean) {
  const result = useAtomValue(
    environmentId && enabled ? bots.changes({ environmentId, input: {} }) : NO_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOTS_CHANGES);
}

// Run events keep `bots` the same map, so this changes only when a definition does.
const botDefinitionChanges = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    Option.match(AsyncResult.value(get(bots.changes({ environmentId, input: {} }))), {
      onNone: () => EMPTY_BOTS_CHANGES.bots,
      onSome: (changes) => changes.bots,
    }),
  ),
);
const NO_DEFINITION_CHANGES = Atom.make(EMPTY_BOTS_CHANGES.bots);

/** Watched bot definition changes, for a view that does not show runs. */
export function useBotDefinitionChanges(environmentId: EnvironmentId | null, enabled: boolean) {
  return {
    bots: useAtomValue(
      environmentId && enabled ? botDefinitionChanges(environmentId) : NO_DEFINITION_CHANGES,
    ),
  };
}

/** Refetches a list fetched once when its host comes back, since the watch missed what changed meanwhile. */
export function useRefreshOnReconnect(connected: boolean, refresh: () => void) {
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected, refresh]);
}

/** Refetches a list overlaid with watched changes once the watch dropped some of them. */
export function useRefreshWhenBotsChangesPruned(
  changes: Pick<BotsChanges, "pruned">,
  refresh: () => void,
) {
  const { pruned } = changes;
  const seen = useRef(pruned);
  useEffect(() => {
    if (seen.current === pruned) return;
    seen.current = pruned;
    refresh();
  }, [pruned, refresh]);
}

const NO_BATCH_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOT_BATCH_CHANGES));

/** Batch progress watched while connected, overlaid on batches fetched once. */
export function useBotBatchChanges(environmentId: EnvironmentId | null, enabled: boolean) {
  const result = useAtomValue(
    environmentId && enabled ? bots.batchChanges({ environmentId, input: {} }) : NO_BATCH_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOT_BATCH_CHANGES);
}

const NO_TRIGGER_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOT_TRIGGER_CHANGES));

/** Trigger edits and firings watched while connected, overlaid on lists fetched once. */
export function useBotTriggerChanges(environmentId: EnvironmentId | null, enabled: boolean) {
  const result = useAtomValue(
    environmentId && enabled
      ? bots.triggerChanges({ environmentId, input: {} })
      : NO_TRIGGER_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOT_TRIGGER_CHANGES);
}

const NO_PIPELINE_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOT_PIPELINE_CHANGES));

/** Pipeline edits and run progress watched while connected, overlaid on lists fetched once. */
export function useBotPipelineChanges(environmentId: EnvironmentId | null, enabled: boolean) {
  const result = useAtomValue(
    environmentId && enabled
      ? bots.pipelineChanges({ environmentId, input: {} })
      : NO_PIPELINE_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOT_PIPELINE_CHANGES);
}

/** The host's pipelines with watched changes applied, while it supports them. */
export function usePipelines(
  environmentId: EnvironmentId | null,
  live: boolean,
  connected: boolean,
) {
  const changes = useBotPipelineChanges(environmentId, live && connected);
  const list = useEnvironmentQuery(
    environmentId && live ? bots.listPipelines({ environmentId, input: {} }) : null,
  );
  return { changes, list, pipelines: applyPipelineChanges(list.data?.pipelines ?? [], changes) };
}

/**
 * Bots this client just saved, until the list or the watch catches up. A save's reply can beat
 * its change event, and the page it opens would otherwise say the bot does not exist.
 */
const savedBots = new Map<string, BotDefinition>();

export function rememberSavedBot(bot: BotDefinition) {
  savedBots.set(bot.id, bot);
}

function withSavedBots(
  known: ReadonlyArray<BotDefinition>,
  changes: Pick<BotsChanges, "bots">,
): ReadonlyArray<BotDefinition> {
  if (savedBots.size === 0) return known;
  const byId = new Map(known.map((bot) => [bot.id, bot]));
  let added = false;
  for (const [id, saved] of savedBots) {
    const current = byId.get(id);
    // A delete the watch saw, or a version at least as new, supersedes the remembered save.
    if (
      changes.bots.get(id) === null ||
      (current !== undefined && current.version >= saved.version)
    ) {
      savedBots.delete(id);
      continue;
    }
    byId.set(id, saved);
    added = true;
  }
  return added
    ? [...byId.values()].sort((left, right) => left.name.localeCompare(right.name))
    : known;
}

/** The host, its watched changes, and its bots with those changes applied. */
export function useBots() {
  const host = useBotsHost();
  const live = Boolean(host.environmentId && host.supported);
  const changes = useBotsChanges(host.environmentId, live && host.connected);
  const list = useEnvironmentQuery(
    host.environmentId && live ? bots.list({ environmentId: host.environmentId, input: {} }) : null,
  );
  return {
    host,
    live,
    changes,
    list,
    bots: withSavedBots(applyBotChanges(list.data?.bots ?? [], changes), changes),
  };
}

/** The first inbox page; the footer count and the Inbox tab share this one query. */
export const inboxQueryInput = (dismissed: boolean) => ({
  limit: BOTS_LIST_RUNS_MAX_LIMIT,
  ...(dismissed ? { dismissed: true } : {}),
});

/** Bot runs waiting on an answer from the bots host. */
export function useWaitingBotRuns(environmentId: EnvironmentId | null) {
  const waiting = useAtomValue(waitingBotRunsAtom);
  return environmentId === null
    ? []
    : waiting.filter((thread) => thread.environmentId === environmentId);
}

/**
 * The Needs you queue as the band lists it: inbox runs plus runs paused on an approval or a
 * question, across every bot or for one. `runs` are runs the caller already holds, which name a
 * waiting run's bot without a request of their own.
 */
export function useNeedsYouItems(
  bot: Pick<BotDefinition, "id" | "name"> | null,
  runs: readonly BotRun[],
): TriageItem[] {
  const { host, live, changes } = useBots();
  const inbox = useEnvironmentQuery(
    host.environmentId && live && host.inboxSupported
      ? bots.inbox({ environmentId: host.environmentId, input: inboxQueryInput(false) })
      : null,
  );
  const waiting = useWaitingBotRuns(live ? host.environmentId : null);
  const page = inbox.data ? applyInboxChanges(inbox.data, changes, { dismissed: false }) : null;
  return triageItems({
    runs: page?.runs ?? [],
    waiting,
    findRun: (runId) => changes.runs.get(runId) ?? runs.find((run) => run.id === runId),
    bot,
  });
}

const noRun = () => undefined;

/** Runs that need a person: the inbox total plus runs waiting on an answer. */
export function useBotsAttentionCount() {
  const host = useBotsHost();
  const live = Boolean(host.environmentId && host.supported);
  const inboxLive = live && host.inboxSupported;
  const changes = useBotsChanges(host.environmentId, inboxLive && host.connected);
  const inbox = useEnvironmentQuery(
    host.environmentId && inboxLive
      ? bots.inbox({ environmentId: host.environmentId, input: inboxQueryInput(false) })
      : null,
  );
  // Waiting runs come from this client's thread shells, so no server feature gates them.
  const waiting = useWaitingBotRuns(live ? host.environmentId : null);
  const refresh = inbox.refresh;
  useRefreshOnReconnect(host.connected, refresh);
  useRefreshWhenBotsChangesPruned(changes, refresh);
  const page = inbox.data ? applyInboxChanges(inbox.data, changes, { dismissed: false }) : null;
  // A waiting run already in the inbox counts once; the total covers inbox runs not loaded yet.
  const waitingOnly = triageItems({
    runs: page?.runs ?? [],
    waiting,
    findRun: noRun,
    bot: null,
  }).filter((item) => item.kind === "waiting").length;
  return (page?.total ?? 0) + waitingOnly;
}
