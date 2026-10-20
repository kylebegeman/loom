import {
  VAULT_MIGRATION_WS_METHODS as V,
  VaultError,
  type VaultTypedMigrationPrepare,
  type VaultTypedMigrationApply,
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
    const check = (
      method:
        | typeof V.typedPrepare
        | typeof V.typedApply
        | typeof V.typedCancel
        | typeof V.typedArchive,
    ) =>
      Effect.suspend(() => auth.effect(method, Effect.void)).pipe(
        Effect.mapError(() => new VaultError({ reason: "denied" })),
      );
    return {
      [V.typedPrepare]: (input: VaultTypedMigrationPrepare) =>
        auth.effect(V.typedPrepare, service.typedPrepare(input, actor, check(V.typedPrepare))),
      [V.typedApply]: (input: VaultTypedMigrationApply) =>
        auth.effect(V.typedApply, service.typedApply(input, actor, check(V.typedApply))),
      [V.typedInspect]: (input: { id: string }) =>
        auth.effect(V.typedInspect, service.typedInspect(input.id)),
      [V.typedList]: (input: VaultMigrationList) =>
        auth.effect(V.typedList, service.typedList(input)),
      [V.typedCancel]: (input: { id: string }) =>
        auth.effect(V.typedCancel, service.typedCancel(input.id, check(V.typedCancel))),
      [V.typedArchive]: (input: { id: string }) =>
        auth.effect(V.typedArchive, service.typedArchive(input.id, actor, check(V.typedArchive))),
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
