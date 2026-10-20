import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { VaultSshTarget, VaultSshPublicKey } from "./vault-ssh.ts";
import { VaultGitHubCredential, VaultGitHubRepository } from "./vault-github.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError, VaultItemId, VaultItemSummary } from "./vault-core.ts";

export class VaultMigrationError extends Schema.TaggedError<VaultMigrationError>()(
  "VaultMigrationError",
  {
    reason: Schema.Literals(["expired", "invalid-state", "review-mismatch", "invalid-credential"]),
  },
) {
  override get message() {
    if (this.reason === "invalid-credential")
      return "Use an unencrypted Ed25519 PEM/OpenSSH key, a dedicated GitHub token, or an unencrypted GitHub App RSA PEM key of at least 2048 bits.";
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
export const VaultTypedMigrationCredential = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ssh"), target: VaultSshTarget, privateKey: privateValue }),
  Schema.Struct({
    type: Schema.Literal("github"),
    account: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/)),
    repositories: Schema.Array(VaultGitHubRepository).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(32),
    ),
    credential: VaultGitHubCredential,
  }),
]);
export type VaultTypedMigrationCredential = typeof VaultTypedMigrationCredential.Type;
export const VaultTypedMigrationDetails = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("ssh"),
    target: VaultSshTarget,
    publicKey: VaultSshPublicKey,
    fingerprint: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("github"),
    account: Schema.String,
    repositories: Schema.Array(VaultGitHubRepository),
    mechanism: Schema.Literals(["token", "app"]),
    appId: Schema.NullOr(Schema.String),
    installationId: Schema.NullOr(Schema.String),
  }),
]);
export type VaultTypedMigrationDetails = typeof VaultTypedMigrationDetails.Type;
export const VaultTypedMigrationPrepare = Schema.Struct({
  id: VaultItemId,
  label: VaultItemSummary.fields.label,
  developmentOnly: Schema.Literal(true),
  credential: VaultTypedMigrationCredential,
});
export type VaultTypedMigrationPrepare = typeof VaultTypedMigrationPrepare.Type;
export const VaultTypedMigrationApply = Schema.Struct({
  id: VaultItemId,
  reviewed: Schema.Literal(true),
  developmentOnly: Schema.Literal(true),
  credential: VaultTypedMigrationCredential,
});
export type VaultTypedMigrationApply = typeof VaultTypedMigrationApply.Type;
export const VaultTypedMigrationPlan = Schema.Struct({
  ...VaultMigrationPlan.fields,
  kind: Schema.Literals(["ssh-key", "service-connection"]),
  details: VaultTypedMigrationDetails,
}).check(Schema.makeFilter((p) => (p.kind === "ssh-key") === (p.details.type === "ssh")));
export type VaultTypedMigrationPlan = typeof VaultTypedMigrationPlan.Type;
export const VaultTypedMigrationResult = Schema.Struct({
  plan: VaultTypedMigrationPlan,
  item: Schema.NullOr(VaultItemSummary),
  canArchive: Schema.Boolean,
  accessVerification: Schema.Literal("not-performed"),
  workloadAuthorization: Schema.Literal("not-evaluated"),
  canCutover: Schema.Literal(false),
  canRollback: Schema.Literal(false),
  configurationWrites: Schema.Literal(false),
});
export type VaultTypedMigrationResult = typeof VaultTypedMigrationResult.Type;
export const VaultTypedMigrationPage = Schema.Struct({
  items: Schema.Array(VaultTypedMigrationResult).check(Schema.isMaxLength(25)),
  nextCursor: Schema.NullOr(VaultItemId),
});
export type VaultTypedMigrationPage = typeof VaultTypedMigrationPage.Type;
export const VAULT_MIGRATION_WS_METHODS = {
  typedPrepare: "loom.vault-migration.typed-prepare",
  typedApply: "loom.vault-migration.typed-apply",
  typedInspect: "loom.vault-migration.typed-inspect",
  typedList: "loom.vault-migration.typed-list",
  typedCancel: "loom.vault-migration.typed-cancel",
  typedArchive: "loom.vault-migration.typed-archive",
  prepare: "loom.vault-migration.prepare",
  apply: "loom.vault-migration.apply",
  inspect: "loom.vault-migration.inspect",
  list: "loom.vault-migration.list",
  cancel: "loom.vault-migration.cancel",
  archive: "loom.vault-migration.archive",
} as const;
const error = Schema.Union([VaultError, VaultMigrationError, EnvironmentAuthorizationError]);
export const VaultMigrationRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_MIGRATION_WS_METHODS.typedPrepare, {
    payload: VaultTypedMigrationPrepare,
    success: VaultTypedMigrationResult,
    error,
  }),
  Rpc.make(VAULT_MIGRATION_WS_METHODS.typedApply, {
    payload: VaultTypedMigrationApply,
    success: VaultTypedMigrationResult,
    error,
  }),
  Rpc.make(VAULT_MIGRATION_WS_METHODS.typedList, {
    payload: VaultMigrationList,
    success: VaultTypedMigrationPage,
    error,
  }),
  ...[
    VAULT_MIGRATION_WS_METHODS.typedInspect,
    VAULT_MIGRATION_WS_METHODS.typedCancel,
    VAULT_MIGRATION_WS_METHODS.typedArchive,
  ].map((method) =>
    Rpc.make(method, {
      payload: Schema.Struct({ id: VaultItemId }),
      success: VaultTypedMigrationResult,
      error,
    }),
  ),
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
