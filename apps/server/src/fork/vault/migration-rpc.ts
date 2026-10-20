import {
  VAULT_MIGRATION_WS_METHODS as V,
  type VaultMigrationPrepare,
  type VaultMigrationApply,
  type VaultMigrationList,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultMigration from "./VaultMigration.ts";
export const makeVaultMigrationRpcHandlers = (auth: ForkRpcAuth, actor: string) =>
  Effect.gen(function* () {
    const service = yield* VaultMigration.VaultMigration;
    return {
      [V.prepare]: (input: VaultMigrationPrepare) =>
        auth.effect(V.prepare, service.prepare(input, actor)),
      [V.apply]: (input: VaultMigrationApply) => auth.effect(V.apply, service.apply(input, actor)),
      [V.list]: (input: VaultMigrationList) => auth.effect(V.list, service.list(input)),
      [V.inspect]: (input: { id: string }) => auth.effect(V.inspect, service.inspect(input.id)),
      [V.cancel]: (input: { id: string }) => auth.effect(V.cancel, service.cancel(input.id)),
      [V.archive]: (input: { id: string }) =>
        auth.effect(V.archive, service.archive(input.id, actor)),
    };
  });
