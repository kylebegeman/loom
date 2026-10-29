import type { EnvironmentId } from "@t3tools/contracts";
import { UPDATE_PLAN_WS_METHODS, type UpdatePlanStatus } from "@t3tools/contracts/fork";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export interface UpdatePlanEligibilityTarget {
  readonly environmentId: EnvironmentId;
  readonly advertised: boolean;
}

export function createUpdatePlanEligibilityAtom(
  targets: readonly UpdatePlanEligibilityTarget[],
  status: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<UpdatePlanStatus, unknown>>,
  permission: (environmentId: EnvironmentId) => Atom.Atom<boolean>,
) {
  return Atom.make((get) =>
    targets.map((target) => {
      const result = target.advertised ? get(status(target.environmentId)) : null;
      return {
        canMaintain: get(permission(target.environmentId)),
        status: result === null ? null : AsyncResult.getOrElse(result, () => null),
        ready: result !== null && AsyncResult.isSuccess(result),
      };
    }),
  );
}

export function createUpdatePlanAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:machine-updates:status",
    tag: UPDATE_PLAN_WS_METHODS.status,
    // Another client can arm a new plan after a terminal state.
    refreshIntervalMs: 30_000,
  });
  const refresh = (
    { environmentId }: { environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.refresh(status({ environmentId, input: {} })));
  const arm = createEnvironmentRpcCommand(runtime, {
    label: "loom:machine-updates:arm",
    tag: UPDATE_PLAN_WS_METHODS.arm,
    onSuccess: refresh,
  });
  const cancel = createEnvironmentRpcCommand(runtime, {
    label: "loom:machine-updates:cancel",
    tag: UPDATE_PLAN_WS_METHODS.cancel,
    onSuccess: refresh,
  });
  const eligibility = Atom.family((key: string) =>
    createUpdatePlanEligibilityAtom(
      JSON.parse(key) as UpdatePlanEligibilityTarget[],
      (environmentId) => status({ environmentId, input: {} }),
      arm.permissionAtom,
    ),
  );
  return {
    status,
    eligibility: (targets: readonly UpdatePlanEligibilityTarget[]) =>
      eligibility(JSON.stringify(targets)),
    arm,
    cancel,
  };
}

export function updatePlanText(status: UpdatePlanStatus | null): string | null {
  const plan = status?.plan;
  if (!plan) return null;
  switch (plan.state) {
    case "armed":
      return "Update armed";
    case "waiting":
      return status.waitingAgents === null
        ? "Waiting to check agents"
        : `Waiting for ${status.waitingAgents} ${status.waitingAgents === 1 ? "agent" : "agents"}`;
    case "installing":
      return `Installing ${plan.targetVersion}`;
    case "done":
      return `Updated to ${plan.targetVersion}`;
    case "cancelled":
      return "Update cancelled";
    case "failed":
      return plan.error ? `Update failed: ${plan.error}` : "Update failed";
  }
}

export const updatePlanCanCancel = (status: UpdatePlanStatus | null) =>
  status?.plan?.state === "armed" || status?.plan?.state === "waiting";

export function updatePlanUnavailableReason(input: {
  readonly advertised: boolean;
  readonly connected: boolean;
  readonly canMaintain: boolean;
  readonly status?: UpdatePlanStatus | null;
  readonly ready?: boolean;
  readonly targetVersion?: string;
}) {
  if (!input.advertised) return "Update this computer to schedule updates.";
  if (!input.connected) return "Reconnect this computer to change its update plan.";
  if (!input.canMaintain) return "This connection does not allow computer updates.";
  if (input.status?.supported === false)
    return input.status.unavailableReason ?? "This computer cannot install updates automatically.";
  if (!input.status || input.ready === false) return "Waiting for this computer's update status.";
  if (updatePlanCanCancel(input.status) || input.status.plan?.state === "installing")
    return "This computer already has an active update plan.";
  if (parseSemver(input.status.currentVersion) === null)
    return "This computer's current version is unavailable.";
  if (input.targetVersion !== undefined) {
    if (parseSemver(input.targetVersion) === null) return "No update version is available.";
    if (compareSemverVersions(input.targetVersion, input.status.currentVersion) <= 0)
      return "Already up to date";
  }
  return null;
}

export interface UpdatePlanTarget {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly unavailableReason: string | null;
}
export interface UpdatePlanOutcome {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly state: "armed" | "current" | "skipped" | "failed";
  readonly message: string;
}

/** Every destination has its own outcome; a partial arm must never read as fleet success. */
export async function armUpdatePlans(
  targets: readonly UpdatePlanTarget[],
  version: (target: UpdatePlanTarget) => Promise<string | null>,
  arm: (target: UpdatePlanTarget, targetVersion: string) => Promise<UpdatePlanStatus>,
): Promise<readonly UpdatePlanOutcome[]> {
  return Promise.all(
    targets.map(async (target): Promise<UpdatePlanOutcome> => {
      if (target.unavailableReason)
        return { ...target, state: "skipped", message: target.unavailableReason };
      try {
        const targetVersion = await version(target);
        if (targetVersion === null)
          return { ...target, state: "current", message: "Already up to date" };
        const status = await arm(target, targetVersion);
        if (!status.plan || status.plan.state === "failed" || status.plan.state === "cancelled")
          return {
            ...target,
            state: "failed",
            message:
              status.plan?.error ??
              status.unavailableReason ??
              "The computer did not arm the update.",
          };
        return {
          ...target,
          state: status.plan.state === "done" ? "current" : "armed",
          message:
            status.plan.state === "done"
              ? `Updated to ${status.plan.targetVersion}`
              : "Update armed",
        };
      } catch (error) {
        return {
          ...target,
          state: "failed",
          message: error instanceof Error ? error.message : "Could not arm the update.",
        };
      }
    }),
  );
}
