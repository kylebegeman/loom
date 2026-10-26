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
    hasSyncingConnectedEnvironment: false,
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
  it.each([
    ["reconnecting", "Could not reach sleeping laptop"],
    ["error", "Could not reach sleeping laptop"],
  ] as const)(
    "keeps the brand while a secondary environment is %s (%s)",
    (connectionState, connectionError) => {
      const state = workspaceState({
        hasConnectingEnvironment: connectionState !== "error",
        hasPendingShellSnapshot: true,
        connectionError,
        connectingEnvironments:
          connectionState === "error"
            ? []
            : [
                {
                  environmentId: "environment-2" as never,
                  environmentLabel: "Sleeping laptop",
                  displayUrl: "",
                  isRelayManaged: false,
                  isEnabled: true,
                  connectionState,
                  connectionError,
                  connectionErrorTraceId: null,
                },
              ],
      });

      expect(workspaceConnectionStatusPresentation(state)).toBeNull();
    },
  );

  it("shows connected shell catch-up even while a secondary environment is unreachable", () => {
    const state = workspaceState({
      hasSyncingConnectedEnvironment: true,
      hasPendingShellSnapshot: true,
      hasConnectingEnvironment: true,
      connectionError: "Could not reach sleeping laptop",
      connectingEnvironments: [
        {
          environmentId: "environment-2" as never,
          environmentLabel: "Sleeping laptop",
          displayUrl: "",
          isRelayManaged: false,
          isEnabled: true,
          connectionState: "reconnecting",
          connectionError: "Could not reach sleeping laptop",
          connectionErrorTraceId: null,
        },
      ],
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Syncing threads...",
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
