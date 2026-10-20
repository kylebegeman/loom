import {
  VAULT_HEALTH_WS_METHODS as V,
  type VaultHealthContextInput,
  type VaultHealthMutation,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultHealthContext from "./VaultHealthContext.ts";
import * as VaultHealth from "./VaultHealth.ts";
import * as VaultHealthChecks from "./VaultHealthChecks.ts";
export const makeVaultHealthRpcHandlers = (auth: ForkRpcAuth, actor: string) =>
  Effect.gen(function* () {
    const context = yield* VaultHealthContext.VaultHealthContext,
      health = yield* VaultHealth.VaultHealth,
      checks = yield* VaultHealthChecks.VaultHealthChecks;
    return {
      [V.snapshot]: () => auth.effect(V.snapshot, health.snapshot),
      [V.context]: (input: VaultHealthContextInput) =>
        auth.effect(V.context, context.inspect(input)),
      [V.apply]: (input: VaultHealthMutation) => auth.effect(V.apply, health.apply(input, actor)),
      [V.recheck]: (input: { itemId: string }) =>
        auth.effect(V.recheck, checks.recheck(input.itemId)),
    };
  });
