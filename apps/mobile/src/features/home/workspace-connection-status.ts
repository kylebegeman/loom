import type { WorkspaceState } from "../../state/workspaceModel";
import { stalledWorkspaceStatus } from "../../fork/connection-health/workspaceStall"; // fork: fleet-connections

export interface WorkspaceConnectionStatusPresentation {
  readonly label: string;
  readonly accessibilityLabel?: string; // fork: fleet-connections
  readonly showsProgress: boolean;
}

function shouldShowWorkspaceConnectionStatus(state: WorkspaceState): boolean {
  if (state.networkStatus === "offline") return true;
  if (state.hasReadyEnvironment) return state.hasSyncingConnectedEnvironment;
  return (
    state.connectionError !== null ||
    state.hasConnectingEnvironment ||
    state.hasPendingShellSnapshot ||
    (state.hasLoadedShellSnapshot && !state.hasReadyEnvironment)
  );
}

function workspaceConnectionStatusLabel(state: WorkspaceState): string {
  if (state.networkStatus === "offline") return "You are offline";
  if (state.hasReadyEnvironment && state.hasSyncingConnectedEnvironment) {
    return state.hasLoadedShellSnapshot ? "Syncing threads..." : "Loading threads...";
  }
  if (state.connectingEnvironments.length === 1) {
    return `Reconnecting to ${state.connectingEnvironments[0]!.environmentLabel}`;
  }
  if (state.connectingEnvironments.length > 1) {
    return `Reconnecting ${state.connectingEnvironments.length} environments`;
  }
  if (state.connectionError !== null) return state.connectionError;
  if (state.hasPendingShellSnapshot) {
    return state.hasLoadedShellSnapshot ? "Syncing threads..." : "Loading threads...";
  }
  return "Not connected";
}

export function workspaceConnectionStatusPresentation(
  state: WorkspaceState,
  options?: { readonly compact: boolean; readonly now?: number }, // fork: fleet-connections
): WorkspaceConnectionStatusPresentation | null {
  if (!shouldShowWorkspaceConnectionStatus(state)) return null;
  // fork: fleet-connections - past the stall window, a reconnect stops showing progress.
  const stalled =
    options?.now === undefined ? null : stalledWorkspaceStatus(state, options.now, options.compact);
  if (stalled !== null) return stalled;
  const label = workspaceConnectionStatusLabel(state); // fork: fleet-connections
  const connectingCount = state.connectingEnvironments.length; // fork: fleet-connections
  // fork: fleet-connections - a ready computer's sync outranks secondary retries, as in `label`.
  const syncingConnected = state.hasReadyEnvironment && state.hasSyncingConnectedEnvironment;
  // fork: fleet-connections
  const compactLabel =
    state.networkStatus === "offline"
      ? "Offline"
      : syncingConnected
        ? state.hasLoadedShellSnapshot
          ? "Syncing"
          : "Loading"
        : state.connectionError !== null
          ? "Connection issue"
          : connectingCount > 0
            ? connectingCount > 1
              ? `${connectingCount} reconnecting`
              : "Connecting"
            : state.hasPendingShellSnapshot
              ? state.hasLoadedShellSnapshot
                ? "Syncing"
                : "Loading"
              : "Not connected";
  return {
    label: options?.compact ? compactLabel : label, // fork: fleet-connections
    // fork: fleet-connections
    ...(options?.compact
      ? {
          accessibilityLabel:
            state.networkStatus === "offline"
              ? "You are offline"
              : syncingConnected
                ? label
                : (state.connectionError ??
                  (connectingCount > 1 ? `Reconnecting to ${connectingCount} computers` : label)),
        }
      : {}),
    showsProgress:
      state.networkStatus !== "offline" &&
      (state.hasReadyEnvironment || state.connectionError === null) &&
      (state.connectingEnvironments.length > 0 || state.hasPendingShellSnapshot),
  };
}
