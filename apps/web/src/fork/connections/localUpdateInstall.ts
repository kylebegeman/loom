import { useAtomValue } from "@effect/atom-react";
import type { DesktopBridge } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { ReportLocalUpdateError } from "~/components/sidebar/useUpdateEverything";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { appAtomRegistry } from "~/rpc/atomRegistry";

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
