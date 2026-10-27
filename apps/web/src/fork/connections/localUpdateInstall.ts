import { useAtomValue } from "@effect/atom-react";
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import { type RestartImpactThread, threadRestartImpact } from "@t3tools/client-runtime/fork";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { DesktopBridge, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { getDesktopUpdateActionError } from "~/components/desktopUpdate.logic";
import {
  clearSavedUpdateEverythingResult,
  saveUpdateEverythingResult,
} from "~/components/sidebar/updateEverythingRun";
import type { ReportLocalUpdateError } from "~/components/sidebar/useUpdateEverything";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { environmentCatalog } from "~/connection/catalog";
import { isElectron } from "~/env";
import { isLocalEnvironmentDisabled } from "~/localEnvironment";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentShell } from "~/state/shell";
import { environmentThreadShells } from "~/state/threads";
import { isLocalUpdateEnvironment } from "./updateScope";

/** How long local agents must stay idle before an armed update installs. */
export const INSTALL_WHEN_IDLE_QUIET_MS = 30_000;

const installPromptAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("local-update-install-prompt"),
);

/** Opens the one install dialog every install button shares. */
export function requestLocalUpdateInstall(): void {
  appAtomRegistry.set(installPromptAtom, true);
}

export function closeLocalUpdateInstall(): void {
  appAtomRegistry.set(installPromptAtom, false);
}

export function useLocalUpdateInstallPrompt(): boolean {
  return useAtomValue(installPromptAtom);
}

export interface LocalAgentsIdleInput {
  readonly catalog: EnvironmentCatalogState;
  readonly desktop: boolean;
  /** This app runs no backend of its own, so no primary ever registers. */
  readonly clientComputer: boolean;
  readonly shell: (environmentId: EnvironmentId) => EnvironmentShellState;
  readonly connection: (environmentId: EnvironmentId) => SupervisorConnectionState | null;
  readonly threads: (environmentId: EnvironmentId) => ReadonlyArray<RestartImpactThread>;
}

/**
 * True once every local backend the app install restarts has loaded its threads and none has
 * work the restart would stop. A backend that settled offline is running nothing, so it does not
 * hold the install back; one still connecting does, because its work is not known yet. The
 * persisted catalog can load before the primary backend registers, so that waits too.
 */
export function localAgentsIdle({
  catalog,
  desktop,
  clientComputer,
  shell,
  connection,
  threads,
}: LocalAgentsIdleInput): boolean {
  const entries = Array.from(catalog.entries);
  if (
    !catalog.isReady ||
    (!clientComputer &&
      !entries.some(([, entry]) => entry.target._tag === "PrimaryConnectionTarget"))
  ) {
    return false;
  }
  for (const [environmentId, entry] of entries) {
    if (
      !entry.enabled ||
      entry.unsupportedReason !== undefined ||
      !isLocalUpdateEnvironment(entry.target, desktop)
    ) {
      continue;
    }
    const state = shell(environmentId);
    if (state.status === "live" && Option.isSome(state.snapshot)) {
      if (threads(environmentId).some((thread) => threadRestartImpact(thread) !== null)) {
        return false;
      }
      continue;
    }
    const current = connection(environmentId);
    const settledOffline =
      current !== null &&
      (current.phase === "offline" ||
        current.phase === "blocked" ||
        (current.phase === "backoff" && current.attempt > 2));
    if (!settledOffline) return false;
  }
  return true;
}

const localAgentsIdleAtom = Atom.make((get) =>
  localAgentsIdle({
    catalog: get(environmentCatalog.catalogValueAtom),
    desktop: isElectron,
    clientComputer: isLocalEnvironmentDisabled(),
    shell: (environmentId) => get(environmentShell.stateValueAtom(environmentId)),
    connection: (environmentId) =>
      Option.getOrNull(AsyncResult.value(get(environmentCatalog.stateAtom(environmentId)))),
    threads: (environmentId) => get(environmentThreadShells.environmentThreadsAtom(environmentId)),
  }),
).pipe(Atom.withLabel("local-update-agents-idle"));

export function useLocalAgentsIdle(): boolean {
  return useAtomValue(localAgentsIdleAtom);
}

const toastUpdateError: ReportLocalUpdateError = (title, description) => {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "An unexpected error occurred.";

export function supportsInstallWhenIdle(bridge: DesktopBridge | undefined): boolean {
  return typeof bridge?.setInstallWhenIdle === "function";
}

export async function setLocalInstallWhenIdle(
  bridge: DesktopBridge,
  armed: boolean,
  reportError: ReportLocalUpdateError = toastUpdateError,
): Promise<boolean> {
  const title = armed ? "Could not schedule the update" : "Could not cancel the scheduled update";
  if (!bridge.setInstallWhenIdle) {
    reportError(title, "This version of the desktop app cannot wait for agents to finish.");
    return false;
  }
  try {
    const state = await bridge.setInstallWhenIdle(armed);
    if (armed && state.installWhenIdle !== true) {
      reportError(title, "The downloaded update is no longer ready to install.");
      return false;
    }
    return true;
  } catch (error) {
    reportError(title, errorMessage(error));
    return false;
  }
}

/**
 * Installs the armed download. The desktop drops the arm once it admits an install, so only a
 * refusal (another update action is running) is worth retrying; anything else is reported once.
 * The saved result tells the relaunched app that it updated without anyone pressing a button.
 */
export async function installArmedUpdate(
  bridge: DesktopBridge,
  version: string,
  reportError: ReportLocalUpdateError = toastUpdateError,
): Promise<"installing" | "refused" | "failed"> {
  saveUpdateEverythingResult({
    localVersion: version,
    updatedServers: 0,
    updatedProviders: 0,
    failures: [],
    restarting: [],
  });
  try {
    const result = await bridge.installUpdate();
    if (!result.accepted) {
      clearSavedUpdateEverythingResult();
      return "refused";
    }
    const actionError = getDesktopUpdateActionError(result);
    if (actionError === null) return "installing";
    clearSavedUpdateEverythingResult();
    reportError("Could not install update", actionError);
    return "failed";
  } catch (error) {
    clearSavedUpdateEverythingResult();
    reportError("Could not install update", errorMessage(error));
    await bridge.setInstallWhenIdle?.(false).catch(() => undefined);
    return "failed";
  }
}
