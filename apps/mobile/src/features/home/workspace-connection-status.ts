import type { WorkspaceState } from "../../state/workspaceModel";

export interface WorkspaceConnectionStatusPresentation {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly showsProgress: boolean;
}

function shouldShowWorkspaceConnectionStatus(state: WorkspaceState): boolean {
  return (
    state.networkStatus === "offline" ||
    state.connectionError !== null ||
    state.hasConnectingEnvironment ||
    state.hasPendingShellSnapshot ||
    (state.hasLoadedShellSnapshot && !state.hasReadyEnvironment)
  );
}

function workspaceConnectionStatusLabel(state: WorkspaceState): string {
  if (state.networkStatus === "offline") return "You are offline";
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
  options?: { readonly compact: boolean },
): WorkspaceConnectionStatusPresentation | null {
  if (!shouldShowWorkspaceConnectionStatus(state)) return null;
  const label = workspaceConnectionStatusLabel(state);
  const connectingCount = state.connectingEnvironments.length;
  const compactLabel =
    state.networkStatus === "offline"
      ? "Offline"
      : state.connectionError !== null
        ? "Connection issue"
        : connectingCount > 0
          ? state.hasReadyEnvironment || connectingCount > 1
            ? `${connectingCount} reconnecting`
            : "Connecting"
          : state.hasPendingShellSnapshot
            ? state.hasLoadedShellSnapshot
              ? "Syncing"
              : "Loading"
            : "Not connected";
  return {
    label: options?.compact ? compactLabel : label,
    ...(options?.compact
      ? {
          accessibilityLabel:
            state.networkStatus === "offline"
              ? "You are offline"
              : (state.connectionError ??
                (connectingCount > 1 ? `Reconnecting to ${connectingCount} computers` : label)),
        }
      : {}),
    showsProgress:
      state.networkStatus !== "offline" &&
      state.connectionError === null &&
      (state.connectingEnvironments.length > 0 || state.hasPendingShellSnapshot),
  };
}
