import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  applyBotChanges,
  createBotsAtoms,
  EMPTY_BOT_BATCH_CHANGES,
  EMPTY_BOT_PIPELINE_CHANGES,
  EMPTY_BOT_TRIGGER_CHANGES,
  EMPTY_BOTS_CHANGES,
  makeWaitingBotRunsAtom,
  supportsLoomFeature,
  type BotsChanges,
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
  BOTS_RUN_DETAILS_FEATURE,
  BOTS_STARTERS_FEATURE,
  BOTS_TRIGGERS_FEATURE,
  BOTS_VERDICTS_FEATURE,
  BOTS_VERSIONS_FEATURE,
} from "@t3tools/contracts/fork";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { environmentThreadShells } from "../../state/threads";

export const bots = createBotsAtoms(connectionAtomRuntime);
const waitingRuns = makeWaitingBotRunsAtom(environmentThreadShells.threadShellsAtom);

export function useBotsCapabilities(environmentId: EnvironmentId | null) {
  const config = useEnvironmentServerConfig(environmentId);
  const { presentation } = useEnvironmentPresentation(environmentId);
  const capabilities = config?.environment.capabilities;
  return {
    environmentId,
    label: presentation?.entry.target.label ?? "Computer",
    connected:
      presentation?.entry.enabled === true && presentation.connection.phase === "connected",
    supported: supportsLoomFeature(capabilities, BOTS_FEATURE),
    runDetailsSupported: supportsLoomFeature(capabilities, BOTS_RUN_DETAILS_FEATURE),
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

const NO_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOTS_CHANGES));
const NO_BATCH_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOT_BATCH_CHANGES));
const NO_TRIGGER_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOT_TRIGGER_CHANGES));
const NO_PIPELINE_CHANGES = Atom.make(AsyncResult.success(EMPTY_BOT_PIPELINE_CHANGES));

export function useBotsChanges(environmentId: EnvironmentId | null, enabled = true) {
  const result = useAtomValue(
    environmentId && enabled ? bots.changes({ environmentId, input: {} }) : NO_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOTS_CHANGES);
}

export function useBotBatchChanges(environmentId: EnvironmentId | null, enabled = true) {
  const result = useAtomValue(
    environmentId && enabled ? bots.batchChanges({ environmentId, input: {} }) : NO_BATCH_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOT_BATCH_CHANGES);
}

export function useBotTriggerChanges(environmentId: EnvironmentId | null, enabled = true) {
  const result = useAtomValue(
    environmentId && enabled
      ? bots.triggerChanges({ environmentId, input: {} })
      : NO_TRIGGER_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOT_TRIGGER_CHANGES);
}

export function useBotPipelineChanges(environmentId: EnvironmentId | null, enabled = true) {
  const result = useAtomValue(
    environmentId && enabled
      ? bots.pipelineChanges({ environmentId, input: {} })
      : NO_PIPELINE_CHANGES,
  );
  return Option.getOrElse(AsyncResult.value(result), () => EMPTY_BOT_PIPELINE_CHANGES);
}

export function useRefreshWhenBotsChangesPruned(
  changes: Pick<BotsChanges, "pruned">,
  refresh: () => void,
) {
  const seen = useRef(changes.pruned);
  useEffect(() => {
    if (seen.current === changes.pruned) return;
    seen.current = changes.pruned;
    refresh();
  }, [changes.pruned, refresh]);
}

export function useBotsReconnect(connected: boolean, refresh: () => void) {
  const previous = useRef(connected);
  useEffect(() => {
    if (connected && !previous.current) refresh();
    previous.current = connected;
  }, [connected, refresh]);
}

export function useBotsCollection(environmentId: EnvironmentId | null) {
  const capabilities = useBotsCapabilities(environmentId);
  const changes = useBotsChanges(environmentId, capabilities.supported && capabilities.connected);
  const query = useEnvironmentQuery(
    environmentId && capabilities.supported ? bots.list({ environmentId, input: {} }) : null,
  );
  useBotsReconnect(capabilities.connected, query.refresh);
  useRefreshWhenBotsChangesPruned(changes, query.refresh);
  return {
    bots: applyBotChanges(query.data?.bots ?? [], changes),
    changes,
    query,
    refresh: query.refresh,
  };
}

export function useWaitingBotRuns(environmentId: EnvironmentId | null) {
  const waiting = useAtomValue(waitingRuns);
  return environmentId ? waiting.filter((thread) => thread.environmentId === environmentId) : [];
}
