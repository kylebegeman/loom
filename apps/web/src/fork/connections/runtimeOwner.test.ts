import { EnvironmentId, type ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  awaitsTrackSwitch,
  collectChannelSwitchTargets,
  collectServerUpdateTargets,
  OS_MANAGED_SKIP_REASON,
  type UpdateEverythingMachine,
} from "~/components/sidebar/updateEverything.logic";
import { describeFleetUpdateStatus, OS_MANAGED_RUNTIME_STATUS } from "./fleetUpdates";

const machine = (
  id: string,
  capabilities: Partial<ExecutionEnvironmentCapabilities>,
): UpdateEverythingMachine => ({
  environmentId: EnvironmentId.make(id),
  label: id,
  serverConfig: {
    environment: {
      environmentId: EnvironmentId.make(id),
      label: id,
      platform: { os: "linux", arch: "arm64" },
      serverVersion: "0.0.40",
      capabilities: { repositoryIdentity: true, ...capabilities },
    },
    settings: { continueThreadsAfterServerUpdate: false },
  },
  connected: true,
  hostedByThisApp: false,
  canMaintain: true,
  updateState: { status: "idle" },
});

describe("a computer whose operating system owns the runtime", () => {
  it("is skipped by Update Everything with the operating system named, not a manual update", () => {
    const { targets, skipped } = collectServerUpdateTargets(
      [
        machine("mini", { serverRuntimeOwner: "operating-system" }),
        machine("manual", {}),
        machine("service", { serverSelfUpdate: "boot-service" }),
      ],
      "0.0.50",
    );
    expect(targets.map((target) => target.serverLabel)).toEqual(["service"]);
    expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
      ["mini", OS_MANAGED_SKIP_REASON],
      ["manual", "needs a manual update"],
    ]);
  });

  it.each([undefined, "boot-service", "desktop-managed"] as const)(
    "skips OS-managed track switches even with self-update capability %s",
    (serverSelfUpdate) => {
      const osManaged = machine("mini", {
        serverRuntimeOwner: "operating-system",
        ...(serverSelfUpdate === undefined ? {} : { serverSelfUpdate }),
      });
      const { targets, skipped } = collectChannelSwitchTargets(
        [
          osManaged,
          machine("manual", {}),
          machine("service", { serverSelfUpdate: "boot-service" }),
        ],
        { channel: "latest", version: "0.0.50", databaseMigration: 0 },
      );
      expect(targets.map((target) => target.serverLabel)).toEqual(["service"]);
      expect(skipped.map((entry) => [entry.label, entry.reason])).toEqual([
        ["mini", OS_MANAGED_SKIP_REASON],
        ["manual", "needs a manual update"],
      ]);
      expect(awaitsTrackSwitch(osManaged, "nightly")).toBe(false);
    },
  );

  it("reads as managed by its operating system in the fleet list instead of offering a runtime", () => {
    const behind = {
      connected: true,
      currentVersion: "0.0.40",
      targetVersion: "0.0.50",
      localVersion: null,
      blockedReason: OS_MANAGED_SKIP_REASON,
      osManaged: true,
    };
    expect(describeFleetUpdateStatus({ ...behind, providerCount: 0 })).toBe(
      OS_MANAGED_RUNTIME_STATUS,
    );
    expect(describeFleetUpdateStatus({ ...behind, providerCount: 1 })).toBe(
      `${OS_MANAGED_RUNTIME_STATUS} · 1 provider update`,
    );
    expect(
      describeFleetUpdateStatus({ ...behind, currentVersion: "0.0.50", providerCount: 0 }),
    ).toBe("Up to date");
  });
});
