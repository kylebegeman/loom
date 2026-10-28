import { VAULT_SECRET_WS_METHODS as V, type VaultSecretAnswer } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { VaultSecretRequests } from "./VaultSecretRequests.ts";

export const makeVaultSecretRpcHandlers = Effect.fn("VaultSecretRequests.makeRpcHandlers")(
  function* (auth: ForkRpcAuth, actor: string) {
    const service = yield* VaultSecretRequests;
    return {
      [V.answerFromItem]: (input: VaultSecretAnswer) =>
        auth.effect(V.answerFromItem, service.answerFromItem(input, actor)),
    };
  },
);
