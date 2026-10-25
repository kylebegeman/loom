import {
  CONNECTION_STALL_DETAIL,
  connectionStallAt,
  connectionStallTitle,
  isConnectionStalled,
} from "@t3tools/client-runtime/fork";
import { useEffect, useState } from "react";

import type { WorkspaceConnectionStatusPresentation } from "../../features/home/workspace-connection-status";
import type { WorkspaceEnvironment, WorkspaceState } from "../../state/workspaceModel";

const failing = (environment: WorkspaceEnvironment) => ({
  phase: environment.connectionState,
  ...(environment.connectionFailingSince === undefined
    ? {}
    : { failingSince: environment.connectionFailingSince }),
});

/** The next moment a reconnecting computer counts as stalled, so the status can change then. */
export function nextWorkspaceStallAt(state: WorkspaceState, now: number): number | null {
  let next: number | null = null;
  for (const environment of state.connectingEnvironments) {
    const at = connectionStallAt(failing(environment));
    if (at !== null && at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/**
 * Once every reconnecting computer has failed past the stall window, the status stops showing
 * progress and says since when, rather than promise a connection that is not coming. Null while
 * any is still within the window, and while this device is offline.
 */
export function stalledWorkspaceStatus(
  state: WorkspaceState,
  now: number,
  compact: boolean,
): WorkspaceConnectionStatusPresentation | null {
  const connecting = state.connectingEnvironments;
  if (
    state.networkStatus === "offline" ||
    connecting.length === 0 ||
    !connecting.every((environment) => isConnectionStalled(failing(environment), now))
  ) {
    return null;
  }
  const only = connecting.length === 1 ? connecting[0] : undefined;
  const label =
    only?.connectionFailingSince === undefined
      ? `Can't reach ${connecting.length} computers`
      : connectionStallTitle(only.environmentLabel, only.connectionFailingSince, now);
  return {
    label: !compact
      ? label
      : only === undefined
        ? `${connecting.length} unreachable`
        : `Can't reach ${only.environmentLabel}`,
    ...(compact ? { accessibilityLabel: `${label}. ${CONNECTION_STALL_DETAIL}` } : {}),
    showsProgress: false,
  };
}

/**
 * The clock the workspace status reads stalls against. It moves only when a reconnecting
 * computer reaches the stall window, through one timeout, so a long outage costs one render.
 */
export function useWorkspaceStallClock(state: WorkspaceState): number {
  const [now, setNow] = useState(Date.now);
  const next = nextWorkspaceStallAt(state, now);
  useEffect(() => {
    if (next === null) return;
    // Never earlier than `next`, so a timer that fires a millisecond early still counts.
    const timer = setTimeout(
      () => setNow(Math.max(Date.now(), next)),
      Math.max(0, next - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [next]);
  return now;
}
