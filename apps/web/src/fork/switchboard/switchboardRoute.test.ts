import { EnvironmentId } from "@t3tools/contracts";
import type {
  SwitchboardAccountState,
  SwitchboardRouteSource,
  SwitchboardRouteStatus,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import { describeSwitchboardRoute } from "./switchboardRoute";

const status = (
  source: SwitchboardRouteSource,
  state: SwitchboardAccountState,
): SwitchboardRouteStatus => ({
  enabled: true,
  source,
  url: source === "environment" ? "http://127.0.0.1:8317" : null,
  account: {
    state,
    hub: { environmentId: EnvironmentId.make("dorothy"), label: "Dorothy" },
    checkedAt: 0,
    problem: null,
  },
});

describe("describeSwitchboardRoute", () => {
  it.each([
    ["account", "connected", "reconnect", false],
    ["account", "unreachable", "reconnect", true],
    ["local", "connecting", "retry", false],
    ["local", "searching", "retry", false],
    ["local", "unavailable", null, false],
    ["local", "hub", null, false],
    // Environment variables win over whatever the account would do, so there is nothing to retry.
    ["environment", "connected", null, false],
    ["invalid", "connecting", null, true],
  ] as const)("%s routing while %s offers %s", (source, state, action, attention) => {
    expect(describeSwitchboardRoute(status(source, state), 0)).toMatchObject({
      action,
      attention,
    });
  });

  it("names the hub and when it last answered", () => {
    expect(describeSwitchboardRoute(status("account", "connected"), 3 * 60_000).text).toBe(
      "Routes through Dorothy. Checked 3m ago.",
    );
  });
});
