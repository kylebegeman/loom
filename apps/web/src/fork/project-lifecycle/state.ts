import { createProjectLifecycleAtoms } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export const lanes = createProjectLifecycleAtoms(connectionAtomRuntime);

export const FEATURE = "project-lifecycle";
/** Anchor of the Storage section on the Loom settings page. */
export const SETTINGS_HASH = `loom-${FEATURE}`;

export async function runLaneCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
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
