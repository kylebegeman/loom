import { PROJECT_PROFILES_WS_METHODS as PP } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createProjectProfilesAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    profile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:project-profile",
      tag: PP.get,
    }),
    envReport: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:project-env",
      tag: PP.envReport,
    }),
    budgetStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:project-budget",
      tag: PP.budgetStatus,
    }),
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:project-profile-settings",
      tag: PP.getSettings,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-profile-update",
      tag: PP.update,
    }),
    reset: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-profile-reset",
      tag: PP.reset,
    }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-profile-settings-update",
      tag: PP.updateSettings,
    }),
    validate: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-env-validate",
      tag: PP.varlockValidate,
    }),
    command: createEnvironmentRpcCommand(runtime, {
      label: "loom:project-env-command",
      tag: PP.varlockCommand,
    }),
  };
}
