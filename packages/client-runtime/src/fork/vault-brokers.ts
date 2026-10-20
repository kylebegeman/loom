import { VAULT_BROKER_WS_METHODS as V, type VaultBrokerMachine } from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
const changes = Atom.family((_environmentId: EnvironmentId) => Atom.make(0).pipe(Atom.keepAlive));
export function createVaultBrokerAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const refresh = (
    target: { readonly environmentId: EnvironmentId },
    registry: import("effect/reactivity/AtomRegistry").AtomRegistry,
  ) =>
    Effect.sync(() => {
      const signal = changes(target.environmentId);
      registry.set(signal, registry.get(signal) + 1);
    });
  return {
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:brokers",
      tag: V.snapshot,
      refreshTrigger: ({ environmentId }) => changes(environmentId),
    }),
    begin: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:broker-invite",
      tag: V.begin,
      onSuccess: refresh,
    }),
    apply: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:broker-apply",
      tag: V.apply,
      onSuccess: refresh,
    }),
  };
}
export const vaultBrokerState = (machine: VaultBrokerMachine, now: number) =>
  machine.state === "disabled"
    ? "Disabled permanently"
    : machine.lastSeenAt === null
      ? "Awaiting first heartbeat"
      : machine.leaseUntil <= now
        ? "Heartbeat overdue"
        : "Online";
