import { SKILL_REGISTRY_WS_METHODS as M } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export function createSkillRegistryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    inventory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:skills:inventory",
      tag: M.inventory,
    }),
    sources: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:skills:sources",
      tag: M.sources,
    }),
    fetchJob: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:skills:fetch",
      tag: M.watchFetch,
      completeWhen: (job) =>
        job.phase === "ready" || job.phase === "failed" || job.phase === "cancelled",
    }),
    fetchSource: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:fetch-source",
      tag: M.fetchSource,
    }),
    cancelFetch: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:cancel-fetch",
      tag: M.cancelFetch,
    }),
    install: createEnvironmentRpcCommand(runtime, { label: "loom:skills:install", tag: M.install }),
    previewUpdate: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:preview-update",
      tag: M.previewUpdate,
    }),
    update: createEnvironmentRpcCommand(runtime, { label: "loom:skills:update", tag: M.update }),
    remove: createEnvironmentRpcCommand(runtime, { label: "loom:skills:remove", tag: M.remove }),
    readSkill: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:read",
      tag: M.readSkill,
    }),
    writeSkill: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:write",
      tag: M.writeSkill,
    }),
    scaffold: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:scaffold",
      tag: M.scaffold,
    }),
    setEnabled: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:set-enabled",
      tag: M.setEnabled,
    }),
    validate: createEnvironmentRpcCommand(runtime, {
      label: "loom:skills:validate",
      tag: M.validate,
    }),
  };
}
