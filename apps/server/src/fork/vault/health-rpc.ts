import { VAULT_HEALTH_WS_METHODS as V, type VaultHealthMutation } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultHealth from "./VaultHealth.ts";
import * as VaultHealthChecks from "./VaultHealthChecks.ts";
export const makeVaultHealthRpcHandlers = (auth: ForkRpcAuth, actor: string) =>
  Effect.gen(function* () {
    const health = yield* VaultHealth.VaultHealth,
      checks = yield* VaultHealthChecks.VaultHealthChecks;
    return {
      [V.snapshot]: () => auth.effect(V.snapshot, health.snapshot),
      [V.apply]: (input: VaultHealthMutation) => auth.effect(V.apply, health.apply(input, actor)),
      [V.recheck]: (input: { itemId: string }) =>
        auth.effect(V.recheck, checks.recheck(input.itemId)),
    };
  });
