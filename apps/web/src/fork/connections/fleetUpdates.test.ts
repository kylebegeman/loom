import { describe, expect, it } from "vite-plus/test";
import { describeFleetUpdateStatus } from "./fleetUpdates";

const current = {
  connected: true,
  currentVersion: "0.0.50",
  targetVersion: "0.0.50",
  providerCount: 0,
  localVersion: null,
};

describe("fleet update snapshot", () => {
  it("does not report offline or unknown computers as up to date", () => {
    expect(describeFleetUpdateStatus({ ...current, connected: false })).toContain("Offline");
    expect(describeFleetUpdateStatus({ ...current, currentVersion: null })).toBe(
      "Waiting for version",
    );
  });
  it("shows runtime and provider updates together, including manual and blocked paths", () => {
    expect(
      describeFleetUpdateStatus({
        ...current,
        currentVersion: "0.0.49",
        providerCount: 2,
        blockedReason: "no permission",
      }),
    ).toBe("Runtime 0.0.50 available · 2 provider updates · no permission");
  });
  it("keeps this app's update distinct from remote runtime updates", () => {
    expect(describeFleetUpdateStatus({ ...current, localVersion: "0.0.51" })).toBe(
      "App 0.0.51 available",
    );
  });
  it("does not offer to downgrade a newer computer", () => {
    expect(describeFleetUpdateStatus({ ...current, currentVersion: "0.0.51" })).toBe("Up to date");
    expect(describeFleetUpdateStatus({ ...current, providerCount: 1 })).toBe("1 provider update");
  });
});
