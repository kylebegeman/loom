import {
  VAULT_BROKER_WS_METHODS as V,
  type VaultBrokerBegin,
  type VaultBrokerMutation,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
export const makeVaultBrokerRpcHandlers = Effect.fn("VaultBrokers.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  actor: string,
) {
  const service = yield* VaultBrokers.VaultBrokers;
  return {
    [V.snapshot]: () => auth.effect(V.snapshot, service.snapshot),
    [V.begin]: (input: VaultBrokerBegin) => auth.effect(V.begin, service.begin(input, actor)),
    [V.apply]: (input: VaultBrokerMutation) => auth.effect(V.apply, service.apply(input, actor)),
  };
});
