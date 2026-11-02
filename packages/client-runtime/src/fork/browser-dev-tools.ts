import { DEV_ENVIRONMENT_WS_METHODS as D } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";
export function createDevEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    diagnostics: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:dev:diagnostics",
      tag: D.diagnostics,
      staleTimeMs: 0,
    }),
    servers: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:dev:servers",
      tag: D.watch,
    }),
    containers: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:dev:containers",
      tag: D.containers,
      staleTimeMs: 0,
    }),
    start: createEnvironmentRpcCommand(runtime, { label: "loom:dev:start", tag: D.start }),
    control: createEnvironmentRpcCommand(runtime, { label: "loom:dev:control", tag: D.control }),
    compose: createEnvironmentRpcCommand(runtime, { label: "loom:dev:compose", tag: D.compose }),
    database: createEnvironmentRpcCommand(runtime, { label: "loom:dev:database", tag: D.database }),
    databaseUrl: createEnvironmentRpcCommand(runtime, {
      label: "loom:dev:database-url",
      tag: D.databaseUrl,
    }),
  };
}
