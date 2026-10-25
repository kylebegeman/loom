import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { connectionStallAt } from "@t3tools/client-runtime/fork";
import { useEffect, useState } from "react";

/**
 * Whether a computer has failed to connect for longer than the stall window. A single timeout
 * flips it, so an outage of any length costs one render.
 */
export function useConnectionStalled(
  connection: Pick<EnvironmentConnectionPresentation, "phase" | "failingSince"> | null,
): boolean {
  const stallAt = connection === null ? null : connectionStallAt(connection);
  const [reached, setReached] = useState<number | null>(null);
  useEffect(() => {
    if (stallAt === null) return;
    const timer = window.setTimeout(() => setReached(stallAt), Math.max(0, stallAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [stallAt]);
  return stallAt !== null && reached === stallAt;
}
