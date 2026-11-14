import { isWorkspaceCatalogPending, type WorkspaceState } from "../../state/workspaceModel";

export interface HomeEmptyState {
  readonly title: string;
  readonly detail: string;
  readonly loading: boolean;
  readonly showsAddEnvironment: boolean;
}

export function deriveHomeEmptyState(
  catalogState: WorkspaceState,
  projectCount: number,
): HomeEmptyState {
  const emptyState = deriveEmptyState(catalogState, projectCount);
  return {
    ...emptyState,
    showsAddEnvironment: !emptyState.loading && !catalogState.hasReadyEnvironment,
  };
}

function deriveEmptyState(
  catalogState: WorkspaceState,
  projectCount: number,
): Omit<HomeEmptyState, "showsAddEnvironment"> {
  // fork: fleet-connections - Computer wording; readiness, not the shell snapshot, gates empty states.
  if (catalogState.isLoadingConnections) {
    return {
      // fork: fleet-connections
      title: "Loading computers",
      detail: "Checking saved computers on this device.",
      loading: true,
    };
  }

  if (!catalogState.hasConnections) {
    return {
      // fork: fleet-connections
      title: "Connect a computer",
      detail: "Connect a computer to open projects and start tasks there.",
      loading: false,
    };
  }

  if (
    (catalogState.connectionState === "available" ||
      catalogState.connectionState === "offline" ||
      catalogState.connectionState === "error" ||
      catalogState.connectionState === "unsupported") &&
    !catalogState.hasReadyEnvironment // fork: fleet-connections
  ) {
    return {
      title:
        catalogState.connectionState === "unsupported"
          ? "Client not supported"
          : "Computer unavailable", // fork: fleet-connections
      detail:
        catalogState.connectionError ??
        // fork: fleet-connections
        "The saved computer is offline. Reconnect it or choose another computer to start working.",
      loading: false,
    };
  }

  if (isWorkspaceCatalogPending(catalogState)) {
    return {
      // fork: fleet-connections
      title: catalogState.hasReadyEnvironment ? "Loading threads" : "Connecting to computer",
      detail: "Loading projects and conversations from the saved computer.",
      loading: true,
    };
  }

  if (projectCount === 0 && catalogState.hasLoadedShellSnapshot) {
    return {
      // fork: fleet-connections
      title: "Start your first task",
      detail: "Choose a project or start without one. Your work runs on the connected computer.",
      loading: false,
    };
  }

  return {
    title: "No threads yet",
    detail: "Start a task in a project, or work without one.", // fork: fleet-connections
    loading: false,
  };
}
