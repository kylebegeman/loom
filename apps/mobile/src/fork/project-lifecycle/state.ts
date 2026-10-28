import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { CHECKOUT_RESTORE_FEATURE } from "@t3tools/contracts/fork";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadCanArchive } from "../../features/home/threadArchive";
import { environmentServerConfigsAtom } from "../../state/server";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useAtomCommand } from "../../state/use-atom-command";
import * as Dialog from "../../components/ui/Dialog";
import { createProjectLifecycleAtoms } from "@t3tools/client-runtime/fork";
import { connectionAtomRuntime } from "../../connection/runtime";

export const lanes = createProjectLifecycleAtoms(connectionAtomRuntime);

export function useReleasedCheckoutIds() {
  return useAtomValue(releasedCheckoutIds);
}

const releasedCheckoutIds = Atom.make((get) => {
  const result = new Set<string>();
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    if (!supportsLoomFeature(config.environment.capabilities, CHECKOUT_RESTORE_FEATURE)) continue;
    const status = AsyncResult.getOrElse(
      get(lanes.status({ environmentId, input: {} })),
      () => null,
    );
    for (const threadId of status?.releasedCheckouts ?? [])
      result.add(scopedThreadKey(environmentId, threadId));
  }
  return result;
});

export function useRestoreThreadCheckout() {
  const restore = useAtomCommand(lanes.restoreCheckout, { reportFailure: false });
  return async (thread: EnvironmentThreadShell) => {
    if (!threadCanArchive(thread.runtime)) {
      Dialog.alert(
        "Could not restore checkout",
        "This thread is working. Wait for it to finish first.",
      );
      return false;
    }
    const result = await restore({
      environmentId: thread.environmentId,
      input: { threadId: thread.id },
    });
    if (result._tag === "Failure") {
      const error = Cause.squash(result.cause);
      Dialog.alert(
        "Could not restore checkout",
        error instanceof Error ? error.message : "The checkout could not be restored.",
      );
      return false;
    }
    Dialog.alert("Checkout restored");
    return true;
  };
}
