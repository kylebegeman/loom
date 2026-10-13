import { COMPUTER_NAMING_WS_METHODS } from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

export function createComputerNamingAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:computer-naming:get",
      tag: COMPUTER_NAMING_WS_METHODS.get,
    }),
    rename: createEnvironmentRpcCommand(runtime, {
      label: "loom:computer-naming:rename",
      tag: COMPUTER_NAMING_WS_METHODS.rename,
    }),
  };
}

export { computerDisplayLabel, relayComputerDisplayRecord } from "./computer-label.ts";
