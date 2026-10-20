import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  applyBotChanges,
  createBotsAtoms,
  EMPTY_BOTS_CHANGES,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { BOTS_FEATURE, BOTS_STARTERS_FEATURE } from "@t3tools/contracts/fork";
import { connectionAtomRuntime } from "~/connection/runtime";
import { usePrimaryEnvironment } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";

export const bots = createBotsAtoms(connectionAtomRuntime);

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
