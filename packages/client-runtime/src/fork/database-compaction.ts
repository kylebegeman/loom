import {
  DATABASE_COMPACTION_WS_METHODS,
  type RestartCompactionState,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

export function createDatabaseCompactionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    setRequest: createEnvironmentRpcCommand(runtime, {
      label: "loom:database-compaction:set-request",
      tag: DATABASE_COMPACTION_WS_METHODS.setRequest,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
  };
}

/** What Settings tells the user the desktop app will do with its freed space. */
export function describeRestartCompaction(
  state: RestartCompactionState,
  label: string,
): { readonly plan: string; readonly lastAttempt: string | null } {
  const lastAttempt = state.lastAttempt?.outcome === "completed" ? null : state.lastAttempt;
  // The desktop never repeats a repair that failed or was stopped until asked again.
  const stopped = lastAttempt?.outcome === "failed" || lastAttempt?.outcome === "interrupted";
  return {
    plan: state.requested
      ? `Loom on ${label} returns it to disk the next time it starts.`
      : stopped
        ? "Loom will not try again on its own; choose Compact at next restart to retry."
        : `Loom on ${label} returns it to disk when it restarts for its next update, or at its next restart if you ask now.`,
    lastAttempt: lastAttempt === null ? null : `Last attempt: ${lastAttempt.detail}`,
  };
}
