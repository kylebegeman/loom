import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { CONNECTION_STALL_MS, connectionStallAt } from "@t3tools/client-runtime/fork";
import { useEffect, useState } from "react";

export interface ConnectionStall {
  /** When the computer started failing. */
  readonly since: number;
  /** When the stall was noticed, the clock its "since" text is read against. */
  readonly at: number;
}

/**
 * A computer that has failed to connect for longer than the stall window. A single timeout flips
 * it, so an outage of any length costs one render.
 */
export function useConnectionStall(
  connection: Pick<EnvironmentConnectionPresentation, "phase" | "failingSince"> | null,
): ConnectionStall | null {
  const stallAt = connection === null ? null : connectionStallAt(connection);
  const [reached, setReached] = useState<{ readonly stallAt: number; readonly at: number } | null>(
    null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that marks the connection stalled when the stall deadline passes
  useEffect(() => {
    if (stallAt === null) return;
    const timer = setTimeout(
      () => setReached({ stallAt, at: Date.now() }),
      Math.max(0, stallAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [stallAt]);
  return stallAt !== null && reached?.stallAt === stallAt
    ? { since: stallAt - CONNECTION_STALL_MS, at: reached.at }
    : null;
}
