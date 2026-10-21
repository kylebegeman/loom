import {
  VAULT_CORE_WS_METHODS as V,
  type VaultItemSave,
  type VaultItemChange,
  type VaultItemList,
  type VaultItemReveal,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";

export const makeVaultCoreRpcHandlers = Effect.fn("VaultCore.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  actorId: string,
) {
  const vault = yield* VaultCore.VaultCore;
  const access = yield* VaultAccess.VaultAccess;
  return {
    [V.status]: () => auth.effect(V.status, vault.status),
    [V.list]: (input: VaultItemList) => auth.effect(V.list, vault.list(input)),
    [V.reveal]: (input: VaultItemReveal) => auth.effect(V.reveal, access.reveal(input, actorId)),
    [V.save]: (input: VaultItemSave) => auth.effect(V.save, vault.save(input, actorId)),
    [V.change]: (input: VaultItemChange) => auth.effect(V.change, vault.change(input, actorId)),
  };
});
