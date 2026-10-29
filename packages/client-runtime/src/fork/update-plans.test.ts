import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { UpdatePlanStatus } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import {
  armUpdatePlans,
  createUpdatePlanEligibilityAtom,
  updatePlanCanCancel,
  updatePlanText,
  updatePlanUnavailableReason,
} from "./update-plans.ts";

const status = (
  state: NonNullable<UpdatePlanStatus["plan"]>["state"],
  count: number | null = 2,
): UpdatePlanStatus => ({
  supported: true,
  unavailableReason: null,
  currentVersion: "0.0.1",
  waitingAgents: count,
  plan: {
    version: 1,
    id: "plan",
    targetVersion: "0.0.2",
    state,
    createdAt: 1,
    updatedAt: 1,
    finishedAt: null,
    error: null,
  },
});

it("shows waiting counts and only allows cancellation before installation", () => {
  expect(updatePlanText(status("waiting"))).toBe("Waiting for 2 agents");
  expect(updatePlanText(status("waiting", 1))).toBe("Waiting for 1 agent");
  expect(updatePlanText(status("waiting", null))).toBe("Waiting to check agents");
  expect(updatePlanCanCancel(status("armed"))).toBe(true);
  expect(updatePlanCanCancel(status("waiting"))).toBe(true);
  expect(updatePlanCanCancel(status("installing"))).toBe(false);
  expect(updatePlanText(status("done"))).toBe("Updated to 0.0.2");
  expect(updatePlanText(status("cancelled"))).toBe("Update cancelled");
});

it("preserves every outcome when a fleet arm partly fails and never dispatches unavailable computers", async () => {
  const targets = ["armed", "failed", "offline", "current"].map((id) => ({
    environmentId: EnvironmentId.make(id),
    label: id,
    unavailableReason: id === "offline" ? "Offline" : null,
  }));
  const arm = vi.fn(async (target: (typeof targets)[number]) => {
    if (target.label === "failed") throw new Error("No permission");
    return status("waiting");
  });
  const results = await armUpdatePlans(
    targets,
    async (target) => (target.label === "current" ? null : "0.0.2"),
    arm,
  );
  expect(results.map((result) => [result.label, result.state, result.message])).toEqual([
    ["armed", "armed", "Update armed"],
    ["failed", "failed", "No permission"],
    ["offline", "skipped", "Offline"],
    ["current", "current", "Already up to date"],
  ]);
  expect(arm.mock.calls.map(([target]) => target.label)).toEqual(["armed", "failed"]);
});

it("does not report success when a server returns no plan or a failed plan", async () => {
  const target = {
    environmentId: EnvironmentId.make("computer"),
    label: "Computer",
    unavailableReason: null,
  };
  for (const result of [
    { ...status("waiting"), plan: null },
    { ...status("failed"), plan: { ...status("failed").plan!, error: "Unavailable archive" } },
  ]) {
    const [outcome] = await armUpdatePlans(
      [target],
      async () => "0.0.2",
      async () => result,
    );
    expect(outcome?.state).toBe("failed");
  }
});

it("distinguishes old servers, disconnected computers and denied maintenance", () => {
  expect(
    updatePlanUnavailableReason({ advertised: false, connected: true, canMaintain: false }),
  ).toBe("Update this computer to schedule updates.");
  expect(
    updatePlanUnavailableReason({ advertised: true, connected: false, canMaintain: true }),
  ).toContain("Reconnect");
  expect(
    updatePlanUnavailableReason({ advertised: true, connected: true, canMaintain: false }),
  ).toContain("does not allow");
  expect(
    updatePlanUnavailableReason({
      advertised: true,
      connected: true,
      canMaintain: true,
      status: {
        ...status("done"),
        supported: false,
        unavailableReason: "Managed by the operating system",
      },
    }),
  ).toBe("Managed by the operating system");
});

it("only offers an idle update after a supported status with a known older version", async () => {
  const ready = { ...status("done"), plan: null };
  const base = { advertised: true, connected: true, canMaintain: true, status: ready };
  const inputs = [
    { ...base, status: null },
    { ...base, ready: false },
    { ...base, status: { ...ready, supported: false } },
    ...(["armed", "waiting", "installing"] as const).map((state) => ({
      ...base,
      status: status(state),
    })),
    { ...base, status: { ...ready, currentVersion: "" } },
    { ...base, targetVersion: "0.0.1" },
    { ...base, targetVersion: "0.0.0" },
    { ...base, targetVersion: "0.0.2" },
  ];
  const targets = inputs.map((input, index) => ({
    environmentId: EnvironmentId.make(`computer-${index}`),
    label: `Computer ${index}`,
    unavailableReason: updatePlanUnavailableReason(input),
  }));
  expect(targets.map((target) => target.unavailableReason === null)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
  ]);
  const arm = vi.fn(async () => status("waiting"));
  const outcomes = await armUpdatePlans(targets, async () => "0.0.2", arm);
  expect(arm).toHaveBeenCalledExactlyOnceWith(targets[9], "0.0.2");
  expect(outcomes.filter((outcome) => outcome.state === "armed")).toHaveLength(1);
});

it("composes current permission and status without querying unadvertised computers", () => {
  const ready = { ...status("done"), plan: null };
  const result = Atom.make<AsyncResult.AsyncResult<UpdatePlanStatus, Error>>(
    AsyncResult.success(ready),
  );
  const permission = Atom.make(true);
  const statusAtom = vi.fn(() => result);
  const composed = createUpdatePlanEligibilityAtom(
    [
      { environmentId: EnvironmentId.make("old"), advertised: false },
      { environmentId: EnvironmentId.make("supported"), advertised: true },
    ],
    statusAtom,
    () => permission,
  );
  const registry = AtomRegistry.make();
  const unmount = registry.mount(composed);
  try {
    expect(registry.get(composed)).toEqual([
      { canMaintain: true, status: null, ready: false },
      { canMaintain: true, status: ready, ready: true },
    ]);
    expect(statusAtom).toHaveBeenCalledWith("supported");
    expect(statusAtom).not.toHaveBeenCalledWith("old");
    registry.set(permission, false);
    expect(registry.get(composed)[1]?.canMaintain).toBe(false);
    registry.set(
      result,
      AsyncResult.failure(Cause.fail(new Error("Disconnected")), {
        previousSuccess: Option.some(AsyncResult.success(ready)),
      }),
    );
    expect(registry.get(composed)[1]).toMatchObject({ status: ready, ready: false });
  } finally {
    unmount();
    registry.dispose();
  }
});
