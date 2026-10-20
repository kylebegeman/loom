import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  applyBotChanges,
  applyInboxChanges,
  applyPipelineChanges,
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
} from "@t3tools/contracts/fork";
import { connectionAtomRuntime } from "~/connection/runtime";
import { usePrimaryEnvironment } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { environmentThreadShells } from "~/state/threads";

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
    bots: applyBotChanges(list.data?.bots ?? [], changes),
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

/** Runs that need a person: the inbox total plus runs waiting on an answer. */
export function useBotsAttentionCount() {
  const host = useBotsHost();
  const live = Boolean(host.environmentId && host.supported && host.inboxSupported);
  const changes = useBotsChanges(host.environmentId, live && host.connected);
  const inbox = useEnvironmentQuery(
    host.environmentId && live
      ? bots.inbox({ environmentId: host.environmentId, input: inboxQueryInput(false) })
      : null,
  );
  const waiting = useWaitingBotRuns(live ? host.environmentId : null);
  const refresh = inbox.refresh;
  const wasConnected = useRef(host.connected);
  useEffect(() => {
    if (host.connected && !wasConnected.current) refresh();
    wasConnected.current = host.connected;
  }, [host.connected, refresh]);
  const total = inbox.data ? applyInboxChanges(inbox.data, changes, { dismissed: false }).total : 0;
  return total + waiting.length;
}
