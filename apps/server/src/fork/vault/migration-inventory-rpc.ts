import {
  VAULT_MIGRATION_INVENTORY_WS_METHODS as V,
  VaultError,
  type VaultReplacementVerify,
  type VaultOriginalVerify,
  type VaultRecoverySnapshotInput,
  type VaultReplacementPreviewInput,
  type VaultMigrationInventoryInput,
  type VaultReplacementPrepare,
  type VaultReplacementReview,
  type VaultReplacementList,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultMigrationInventory from "./VaultMigrationInventory.ts";
export const makeVaultMigrationInventoryRpcHandlers = Effect.fn(
  "VaultMigrationInventory.makeRpcHandlers",
)(function* (auth: ForkRpcAuth, actor: string) {
  const service = yield* VaultMigrationInventory.VaultMigrationInventory;
  const authorize = Effect.suspend(() => auth.effect(V.verify, Effect.void)).pipe(
    Effect.mapError(() => new VaultError({ reason: "denied" })),
  );
  const previewAuthorization = Effect.suspend(() => auth.effect(V.preview, Effect.void)).pipe(
    Effect.mapError(() => new VaultError({ reason: "denied" })),
  );
  const originalAuthorization = Effect.suspend(() =>
    auth.effect(V.originalVerify, Effect.void),
  ).pipe(Effect.mapError(() => new VaultError({ reason: "denied" })));
  const recoveryAuthorization = Effect.suspend(() =>
    auth.effect(V.recoveryPreview, Effect.void),
  ).pipe(Effect.mapError(() => new VaultError({ reason: "denied" })));
  return {
    [V.originalVerify]: (input: VaultOriginalVerify) =>
      auth.effect(V.originalVerify, service.originalVerify(input, actor, originalAuthorization)),
    [V.originalVerification]: (input: { id: string }) =>
      auth.effect(V.originalVerification, service.originalVerification(input.id)),
    [V.recoveryPreview]: (input: VaultRecoverySnapshotInput) =>
      auth.effect(V.recoveryPreview, service.recoveryPreview(input, recoveryAuthorization)),
    [V.preview]: (input: VaultReplacementPreviewInput) =>
      auth.effect(V.preview, service.preview(input, previewAuthorization)),
    [V.verify]: (input: VaultReplacementVerify) =>
      auth.effect(V.verify, service.verify(input, actor, authorize)),
    [V.verification]: (input: { id: string }) =>
      auth.effect(V.verification, service.verification(input.id)),
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
