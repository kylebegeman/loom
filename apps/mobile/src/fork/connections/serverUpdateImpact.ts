import { collectRestartImpact, describeRestartImpact } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";

/**
 * Says which work a server restart stops, counted the way the desktop and web update dialogs
 * count it. Until the environment's threads have loaded it can only warn in general terms.
 */
export function describeServerUpdateImpact(
  environmentId: EnvironmentId,
  continuesThreads: boolean,
): string {
  const shell = appAtomRegistry.get(environmentShell.stateValueAtom(environmentId));
  if (shell.status !== "live" || Option.isNone(shell.snapshot)) {
    return "Running threads may be interrupted.";
  }
  return describeRestartImpact(
    collectRestartImpact([
      {
        continuesThreads,
        threads: appAtomRegistry.get(environmentThreadShells.environmentThreadsAtom(environmentId)),
      },
    ]),
  ).join(" ");
}
