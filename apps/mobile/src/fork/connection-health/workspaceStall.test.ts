import { CONNECTION_STALL_MS } from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { workspaceConnectionStatusPresentation } from "../../features/home/workspace-connection-status";
import type { WorkspaceEnvironment, WorkspaceState } from "../../state/workspaceModel";
import { nextWorkspaceStallAt } from "./workspaceStall";

const FAILING_SINCE = Date.parse("2026-10-25T15:04:00");
const STALLED = FAILING_SINCE + CONNECTION_STALL_MS;
const since = new Date(FAILING_SINCE).toLocaleTimeString(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function reconnecting(label: string, failingSince = FAILING_SINCE): WorkspaceEnvironment {
  return {
    environmentId: EnvironmentId.make(label),
    environmentLabel: label,
    displayUrl: "",
    isRelayManaged: false,
    isEnabled: true,
    connectionState: "reconnecting",
    connectionError: null,
    connectionErrorTraceId: null,
    connectionFailingSince: failingSince,
  };
}

function workspace(connectingEnvironments: ReadonlyArray<WorkspaceEnvironment>): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: connectingEnvironments.length > 0,
    connectingEnvironments,
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    networkStatus: "online",
  };
}

describe("stalled workspace connection status", () => {
  it("keeps showing progress through the first minute of a reconnect", () => {
    const state = workspace([reconnecting("Dorothy")]);
    expect(
      workspaceConnectionStatusPresentation(state, { compact: false, now: STALLED - 1 }),
    ).toMatchObject({ label: "Reconnecting to Dorothy", showsProgress: true });
    expect(nextWorkspaceStallAt(state, STALLED - 1)).toBe(STALLED);
  });

  it("stops the spinner and says since when once the reconnect has stalled", () => {
    const state = workspace([reconnecting("Dorothy")]);
    expect(workspaceConnectionStatusPresentation(state, { compact: false, now: STALLED })).toEqual(
      { label: `Can't reach Dorothy since ${since}`, showsProgress: false },
    );
    expect(workspaceConnectionStatusPresentation(state, { compact: true, now: STALLED })).toEqual({
      label: "Can't reach Dorothy",
      accessibilityLabel: `Can't reach Dorothy since ${since}. Loom keeps trying.`,
      showsProgress: false,
    });
    expect(nextWorkspaceStallAt(state, STALLED)).toBeNull();
  });

  it("keeps progress while any reconnecting computer is still within the window", () => {
    const state = workspace([reconnecting("Dorothy"), reconnecting("Book", STALLED)]);
    expect(
      workspaceConnectionStatusPresentation(state, { compact: true, now: STALLED }),
    ).toMatchObject({ label: "2 reconnecting", showsProgress: true });
    expect(nextWorkspaceStallAt(state, STALLED)).toBe(STALLED + CONNECTION_STALL_MS);
    expect(
      workspaceConnectionStatusPresentation(state, {
        compact: true,
        now: STALLED + CONNECTION_STALL_MS,
      }),
    ).toMatchObject({ label: "2 unreachable", showsProgress: false });
  });

  it("lets this device being offline speak first", () => {
    const state = { ...workspace([reconnecting("Dorothy")]), networkStatus: "offline" as const };
    expect(
      workspaceConnectionStatusPresentation(state, { compact: false, now: STALLED }),
    ).toMatchObject({ label: "You are offline", showsProgress: false });
  });
});
