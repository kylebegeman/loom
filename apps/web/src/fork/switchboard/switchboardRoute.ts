import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { FORK_WS_METHODS, type SwitchboardRouteStatus } from "@t3tools/contracts/fork";

import { connectionAtomRuntime } from "~/connection/runtime";
import { formatRelativeElapsed } from "~/timestampFormat";

/** The server checks its hub every one to five minutes, so a minute's polling stays current. */
export const switchboardRouteQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:switchboard:route",
  tag: FORK_WS_METHODS.route,
  staleTimeMs: 30_000,
  refreshIntervalMs: 60_000,
  idleTtlMs: 5 * 60_000,
});

export const switchboardReconnect = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:switchboard:reconnect",
  tag: FORK_WS_METHODS.reconnect,
});

export const switchboardRevokeComputer = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:switchboard:revoke-computer",
  tag: FORK_WS_METHODS.revokeComputer,
});

export interface SwitchboardRouteSummary {
  readonly text: string;
  readonly attention: boolean;
  /** `reconnect` replaces a credential the computer holds; `retry` asks the hub again now. */
  readonly action: "reconnect" | "retry" | null;
}

const checked = (checkedAt: number | null, now: number) => {
  if (checkedAt === null) return "";
  const { value, suffix } = formatRelativeElapsed(Math.max(0, now - checkedAt));
  return ` Checked ${suffix === null ? value : `${value} ${suffix}`}.`;
};

/** Where this computer's routed launches go, and what, if anything, needs a hand. */
export function describeSwitchboardRoute(
  status: SwitchboardRouteStatus,
  now: number,
): SwitchboardRouteSummary {
  const { account } = status;
  const hub = account.hub?.label ?? "your account's hub";
  if (status.source === "invalid")
    return {
      text: "LOOM_SWITCHBOARD_URL or LOOM_SWITCHBOARD_KEY_HELPER on this computer is invalid, so routed launches fail.",
      attention: true,
      action: null,
    };
  if (status.source === "environment")
    return {
      text: `Environment variables on this computer route it to ${status.url ?? "another Switchboard"}.`,
      attention: false,
      action: null,
    };
  switch (account.state) {
    case "hub":
      return {
        text: "This computer shares its Switchboard. Computers signed in to your account route through it on their own.",
        attention: false,
        action: null,
      };
    case "connected":
      return {
        text: `${status.enabled ? "Routes" : "Ready to route"} through ${hub}.${checked(account.checkedAt, now)}`,
        attention: false,
        action: "reconnect",
      };
    case "unreachable":
      return {
        text: account.problem ?? `${hub} did not answer the last check.`,
        attention: true,
        action: "reconnect",
      };
    case "connecting":
      return {
        text:
          account.problem ??
          (account.hub === null
            ? "Looking for your account's Switchboard."
            : `Connecting to ${hub}.`),
        attention: account.problem !== null,
        action: "retry",
      };
    case "searching":
      return {
        text: "No computer on your account shares its Switchboard yet. Launches use this computer's own.",
        attention: false,
        action: "retry",
      };
    case "unavailable":
      return {
        text: account.problem ?? "This computer cannot use your account's Switchboard.",
        attention: false,
        action: null,
      };
  }
}
