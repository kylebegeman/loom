import {
  VAULT_MIGRATION_INVENTORY_WS_METHODS as V,
  type VaultMigrationInventoryInput,
  type VaultReplacementPrepare,
  type VaultReplacementReview,
  type VaultReplacementList,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultMigrationInventory from "./VaultMigrationInventory.ts";
export const makeVaultMigrationInventoryRpcHandlers = (auth: ForkRpcAuth, actor: string) =>
  Effect.gen(function* () {
    const service = yield* VaultMigrationInventory.VaultMigrationInventory;
    return {
      [V.inventory]: (input: VaultMigrationInventoryInput) =>
        auth.effect(V.inventory, service.inventory(input)),
      [V.prepare]: (input: VaultReplacementPrepare) =>
        auth.effect(V.prepare, service.prepare(input, actor)),
      [V.inspect]: (input: { id: string }) => auth.effect(V.inspect, service.inspect(input.id)),
      [V.list]: (input: VaultReplacementList) => auth.effect(V.list, service.list(input)),
      [V.review]: (input: VaultReplacementReview) =>
        auth.effect(V.review, service.review(input, actor)),
      [V.cancel]: (input: { id: string }) => auth.effect(V.cancel, service.cancel(input.id)),
    };
  });
