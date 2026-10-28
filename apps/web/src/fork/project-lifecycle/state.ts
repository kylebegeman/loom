import { createProjectLifecycleAtoms } from "@t3tools/client-runtime/fork";
import {
  type AtomCommand,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export const lanes = createProjectLifecycleAtoms(connectionAtomRuntime);

export const FEATURE = "project-lifecycle";

export async function runLaneCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}

const RELEASE_FAILED_TITLE = "Could not release checkout";

/** Thread menus release a landed checkout without confirming: the next message restores it. */
export async function releaseThreadCheckout(threadRef: ScopedThreadRef) {
  const result = await runAtomCommand(
    appAtomRegistry,
    lanes.releaseCheckout,
    { environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId } },
    { reportFailure: false },
  );
  if (result._tag === "Failure") {
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: RELEASE_FAILED_TITLE,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
    return;
  }
  const { outcome, reason } = result.value;
  toastManager.add(
    stackedThreadToast(
      outcome === "removed"
        ? {
            type: "success",
            title: "Checkout released",
            description: "Its next message restores the checkout.",
          }
        : outcome === "kept"
          ? { type: "info", title: "Checkout kept", description: reason }
          : { type: "error", title: RELEASE_FAILED_TITLE, description: reason },
    ),
  );
}

/** Decimal gigabytes, matching Finder and the server's caps. */
export const formatGb = (bytes: number | null) =>
  bytes === null ? "unknown" : `${(bytes / 1e9).toFixed(bytes < 10e9 ? 1 : 0)} GB`;

const openListeners = new Set<() => void>();

/** Lets pure palette items open the Storage settings through the mounted host. */
export function onOpenStorageSettings(callback: () => void) {
  openListeners.add(callback);
  return () => {
    openListeners.delete(callback);
  };
}

export function openStorageSettings() {
  for (const callback of openListeners) callback();
}
