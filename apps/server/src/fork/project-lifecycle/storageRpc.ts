import { PROJECT_STORAGE_WS_METHODS as S } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { ProjectStorageInventory } from "./ProjectStorageInventory.ts";

export const makeProjectStorageRpcHandlers = Effect.fn("ProjectStorage.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
) {
  const service = yield* ProjectStorageInventory;
  return {
    [S.byCategory]: (input: { readonly refresh?: boolean }) =>
      auth.effect(S.byCategory, service.byCategory(input)),
  };
});
