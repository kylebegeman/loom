import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import type { WorkspaceEnvironment, WorkspaceState } from "../../state/workspaceModel";
import { workspaceConnectionStatusPresentation } from "./workspace-connection-status";

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: false,
    connectingEnvironments: [],
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    networkStatus: "online",
    ...overrides,
  };
}

function connectingComputer(label: string): WorkspaceEnvironment {
  return {
    environmentId: EnvironmentId.make(label),
    environmentLabel: label,
    displayUrl: "",
    isRelayManaged: false,
    isEnabled: true,
    connectionState: "reconnecting",
    connectionError: null,
    connectionErrorTraceId: null,
  };
}

describe("workspace connection status", () => {
  it("stays hidden while a ready environment is connected", () => {
    expect(workspaceConnectionStatusPresentation(workspaceState())).toBeNull();
  });

  it("surfaces offline snapshots", () => {
    const state = workspaceState({ networkStatus: "offline", hasReadyEnvironment: false });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "You are offline",
      showsProgress: false,
    });
  });

  it("names the environment while reconnecting", () => {
    const state = workspaceState({
      hasConnectingEnvironment: true,
      hasReadyEnvironment: false,
      connectingEnvironments: [
        {
          environmentId: "environment-1" as never,
          environmentLabel: "Julius’s Mac mini",
          displayUrl: "",
          isRelayManaged: false,
          isEnabled: true,
          connectionState: "reconnecting",
          connectionError: null,
          connectionErrorTraceId: null,
        },
      ],
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Reconnecting to Julius’s Mac mini",
      showsProgress: true,
    });
  });

  it("surfaces connection errors before the generic disconnected fallback", () => {
    const state = workspaceState({
      connectionError: "Could not reach Julius’s Mac mini",
      hasLoadedShellSnapshot: false,
      hasReadyEnvironment: false,
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Could not reach Julius’s Mac mini",
      showsProgress: false,
    });
  });

  it("shows shell catch-up while cached threads remain visible", () => {
    const state = workspaceState({ hasPendingShellSnapshot: true });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Syncing threads...",
      showsProgress: true,
    });
  });

  it("distinguishes initial shell loading from cached catch-up", () => {
    const state = workspaceState({
      hasLoadedShellSnapshot: false,
      hasPendingShellSnapshot: true,
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Loading threads...",
      showsProgress: true,
    });
  });
});

describe("compact workspace connection status", () => {
  it("keeps partial reconnects short while retaining the computer name for accessibility", () => {
    const state = workspaceState({
      hasConnectingEnvironment: true,
      connectingEnvironments: [connectingComputer("Dorothy")],
    });

    expect(workspaceConnectionStatusPresentation(state, { compact: true })).toEqual({
      label: "1 reconnecting",
      accessibilityLabel: "Reconnecting to Dorothy",
      showsProgress: true,
    });
  });

  it("summarizes multiple reconnecting computers without replacing their error", () => {
    const state = workspaceState({
      hasConnectingEnvironment: true,
      connectingEnvironments: [
        connectingComputer("Dorothy"),
        connectingComputer("Dorothy 2"),
        connectingComputer("Dorothy 3"),
      ],
    });

    expect(workspaceConnectionStatusPresentation(state, { compact: true })).toEqual({
      label: "3 reconnecting",
      accessibilityLabel: "Reconnecting to 3 computers",
      showsProgress: true,
    });
    expect(
      workspaceConnectionStatusPresentation(
        { ...state, connectionError: "Dorothy 3 needs to be paired again." },
        { compact: true },
      ),
    ).toEqual({
      label: "Connection issue",
      accessibilityLabel: "Dorothy 3 needs to be paired again.",
      showsProgress: false,
    });
  });

  it("prioritizes device offline status over reconnect progress", () => {
    const state = workspaceState({
      networkStatus: "offline",
      hasReadyEnvironment: false,
      hasConnectingEnvironment: true,
      connectingEnvironments: [connectingComputer("Dorothy")],
    });

    expect(workspaceConnectionStatusPresentation(state, { compact: true })).toEqual({
      label: "Offline",
      accessibilityLabel: "You are offline",
      showsProgress: false,
    });
  });
});
