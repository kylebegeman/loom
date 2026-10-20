import { VAULT_TEST_ACCOUNT_WS_METHODS as V, type VaultTestAccount } from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
const changes = Atom.family((_environmentId: EnvironmentId) => Atom.make(0).pipe(Atom.keepAlive));
export function createVaultTestAccountAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:test-accounts",
      tag: V.snapshot,
      refreshTrigger: ({ environmentId }) => changes(environmentId),
    }),
    apply: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:test-account-apply",
      tag: V.apply,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => {
          const signal = changes(environmentId);
          registry.set(signal, registry.get(signal) + 1);
        }),
    }),
  };
}
export const vaultTestAccountState = (account: VaultTestAccount, now: number) =>
  account.lease && account.lease.expiresAt <= now ? ("quarantined" as const) : account.state;
export function vaultTestAccountActions(
  account: VaultTestAccount,
  actor: string,
  archived: boolean,
  now: number,
) {
  const state = vaultTestAccountState(account, now);
  const actions: Array<{
    label: string;
    description: string;
    change: import("@t3tools/contracts/fork").VaultTestAccountChange;
  }> = [];
  if (state === "available" && !archived)
    actions.push({
      label: "Reserve for 5 minutes",
      description:
        "Reserve this account exclusively for your current Loom connection. Login delivery is not included.",
      change: { type: "reserve", id: account.id, durationMs: 300_000 },
    });
  if (state === "reserved" && account.lease?.owner === actor) {
    if (
      !archived &&
      now + 900_000 > account.lease.expiresAt &&
      account.lease.expiresAt < account.lease.createdAt + 3_600_000
    )
      actions.push({
        label: "Renew reservation",
        description:
          "Extend this reservation by up to 15 minutes, bounded at one hour from its start.",
        change: { type: "renew", id: account.id, leaseId: account.lease.id },
      });
    actions.push({
      label: "Release to quarantine",
      description:
        "End your reservation. Review and reset the test account before returning it to the pool.",
      change: { type: "release", id: account.id, leaseId: account.lease.id },
    });
  }
  if (state === "quarantined" && !archived)
    actions.push({
      label: "Mark clean",
      description:
        "Confirm you reset or independently checked this dedicated test account and it is safe for another test. Loom does not reset it automatically.",
      change: { type: "mark-clean", id: account.id, confirmedReset: true },
    });
  if (state !== "retired") {
    if (state !== "quarantined")
      actions.push({
        label: "Quarantine",
        description:
          "Remove this entry from the reservation pool and cancel its current local reservation. Existing external logins are not revoked.",
        change: { type: "quarantine", id: account.id },
      });
    actions.push({
      label: "Retire",
      description:
        "Retire this pool entry and end its reservation. The encrypted Vault account and external login remain unchanged.",
      change: { type: "retire", id: account.id },
    });
  } else
    actions.push({
      label: "Restore to quarantine",
      description:
        "Restore this entry for inspection. It must be checked clean before it can be reserved.",
      change: { type: "restore", id: account.id },
    });
  return actions;
}
