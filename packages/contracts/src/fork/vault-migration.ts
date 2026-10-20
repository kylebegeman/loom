import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError, VaultItemId, VaultItemSummary } from "./vault-core.ts";

export class VaultMigrationError extends Schema.TaggedError<VaultMigrationError>()(
  "VaultMigrationError",
  {
    reason: Schema.Literals(["expired", "invalid-state", "review-mismatch"]),
  },
) {
  override get message() {
    if (this.reason === "review-mismatch")
      return "The private value does not match this review. Reenter the reviewed value or cancel and prepare a new review.";
    return this.reason === "expired"
      ? "This import review expired. Prepare a new review."
      : "This import has already advanced. Refresh its status before continuing.";
  }
}
const privateValue = Schema.RedactedFromValue(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65536)),
);
export const VaultMigrationPrepare = Schema.Struct({
  id: VaultItemId,
  label: VaultItemSummary.fields.label,
  kind: Schema.Literals(["secret", "secure-note"]),
  developmentOnly: Schema.Literal(true),
  value: privateValue,
});
export type VaultMigrationPrepare = typeof VaultMigrationPrepare.Type;
export const VaultMigrationApply = Schema.Struct({
  id: VaultItemId,
  reviewed: Schema.Literal(true),
  value: privateValue,
});
export type VaultMigrationApply = typeof VaultMigrationApply.Type;
export const VaultMigrationPlan = Schema.Struct({
  id: VaultItemId,
  itemId: VaultItemId,
  label: VaultItemSummary.fields.label,
  kind: VaultMigrationPrepare.fields.kind,
  developmentOnly: Schema.Literal(true),
  state: Schema.Literals([
    "prepared",
    "applying",
    "imported",
    "cancelled",
    "expired",
    "archiving",
    "archived",
  ]),
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
});
export type VaultMigrationPlan = typeof VaultMigrationPlan.Type;
export const VaultMigrationResult = Schema.Struct({
  plan: VaultMigrationPlan,
  item: Schema.NullOr(VaultItemSummary),
  canArchive: Schema.Boolean,
});
export type VaultMigrationResult = typeof VaultMigrationResult.Type;
export const VaultMigrationList = Schema.Struct({ cursor: Schema.NullOr(VaultItemId) });
export type VaultMigrationList = typeof VaultMigrationList.Type;
export const VaultMigrationPage = Schema.Struct({
  items: Schema.Array(VaultMigrationResult).check(Schema.isMaxLength(25)),
  nextCursor: Schema.NullOr(VaultItemId),
});
export type VaultMigrationPage = typeof VaultMigrationPage.Type;
export const VAULT_MIGRATION_WS_METHODS = {
  prepare: "loom.vault-migration.prepare",
  apply: "loom.vault-migration.apply",
  inspect: "loom.vault-migration.inspect",
  list: "loom.vault-migration.list",
  cancel: "loom.vault-migration.cancel",
  archive: "loom.vault-migration.archive",
} as const;
const error = Schema.Union([VaultError, VaultMigrationError, EnvironmentAuthorizationError]);
export const VaultMigrationRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_MIGRATION_WS_METHODS.prepare, {
    payload: VaultMigrationPrepare,
    success: VaultMigrationResult,
    error,
  }),
  Rpc.make(VAULT_MIGRATION_WS_METHODS.apply, {
    payload: VaultMigrationApply,
    success: VaultMigrationResult,
    error,
  }),
  Rpc.make(VAULT_MIGRATION_WS_METHODS.list, {
    payload: VaultMigrationList,
    success: VaultMigrationPage,
    error,
  }),
  ...[
    VAULT_MIGRATION_WS_METHODS.inspect,
    VAULT_MIGRATION_WS_METHODS.cancel,
    VAULT_MIGRATION_WS_METHODS.archive,
  ].map((method) =>
    Rpc.make(method, {
      payload: Schema.Struct({ id: VaultItemId }),
      success: VaultMigrationResult,
      error,
    }),
  ),
);
