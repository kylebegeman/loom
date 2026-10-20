import {
  VAULT_TEST_ACCOUNT_WS_METHODS as V,
  VaultError,
  type VaultTestAccountMutation,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultTestAccounts from "./VaultTestAccounts.ts";
export const makeVaultTestAccountRpcHandlers = Effect.fn("VaultTestAccounts.makeRpcHandlers")(
  function* (auth: ForkRpcAuth, actor: string) {
    const service = yield* VaultTestAccounts.VaultTestAccounts;
    return {
      [V.snapshot]: () => auth.effect(V.snapshot, service.snapshot(actor)),
      [V.apply]: (input: VaultTestAccountMutation) =>
        auth.effect(
          V.apply,
          service.apply(
            input,
            actor,
            Effect.suspend(() => auth.effect(V.apply, Effect.void)).pipe(
              Effect.mapError(() => new VaultError({ reason: "denied" })),
            ),
          ),
        ),
    };
  },
);
