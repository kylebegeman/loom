import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { VaultError, VaultItemId } from "./vault-core.ts";

const Label = TrimmedNonEmptyString.check(Schema.isMaxLength(120));
const Time = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const VaultTestCollectionDefinition = Schema.Struct({
  id: VaultItemId,
  label: Label,
  application: Label,
  target: Schema.Literals(["development", "staging", "test"]),
});
export type VaultTestCollectionDefinition = typeof VaultTestCollectionDefinition.Type;
export const VaultTestCollection = Schema.Struct({
  ...VaultTestCollectionDefinition.fields,
  archived: Schema.Boolean,
});
export const VaultTestAccountDefinition = Schema.Struct({
  id: VaultItemId,
  collectionId: VaultItemId,
  label: Label,
  role: Label,
  itemId: VaultItemId,
  itemVersion: PositiveInt,
});
export type VaultTestAccountDefinition = typeof VaultTestAccountDefinition.Type;
export const VaultTestAccountLease = Schema.Struct({
  id: VaultItemId,
  owner: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  createdAt: Time,
  expiresAt: Time,
}).check(
  Schema.makeFilter(
    (lease) => lease.expiresAt > lease.createdAt && lease.expiresAt <= lease.createdAt + 3_600_000,
  ),
);
export const VaultTestAccount = Schema.Struct({
  ...VaultTestAccountDefinition.fields,
  state: Schema.Literals(["available", "reserved", "quarantined", "retired"]),
  lease: Schema.NullOr(VaultTestAccountLease),
}).check(
  Schema.makeFilter((account) => (account.state === "reserved") === (account.lease !== null)),
);
export type VaultTestAccount = typeof VaultTestAccount.Type;
export const VaultTestAccountSnapshot = Schema.Struct({
  revision: NonNegativeInt,
  checkedAt: Time,
  collections: Schema.Array(VaultTestCollection).check(Schema.isMaxLength(32)),
  accounts: Schema.Array(VaultTestAccount).check(Schema.isMaxLength(128)),
  actor: Schema.String,
  provisioning: Schema.Literal("unsupported"),
  loginDelivery: Schema.Literal("unsupported"),
});
export type VaultTestAccountSnapshot = typeof VaultTestAccountSnapshot.Type;
export const VaultTestAccountChange = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("collection-save"),
    collection: VaultTestCollectionDefinition,
  }),
  Schema.Struct({
    type: Schema.Literal("collection-archive"),
    id: VaultItemId,
    archived: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("account-save"),
    account: VaultTestAccountDefinition,
    developmentOnly: Schema.Literal(true),
  }),
  Schema.Struct({
    type: Schema.Literal("reserve"),
    id: VaultItemId,
    durationMs: Schema.Literals([300_000, 900_000]),
  }),
  Schema.Struct({ type: Schema.Literal("renew"), id: VaultItemId, leaseId: VaultItemId }),
  Schema.Struct({ type: Schema.Literal("release"), id: VaultItemId, leaseId: VaultItemId }),
  Schema.Struct({ type: Schema.Literal("quarantine"), id: VaultItemId }),
  Schema.Struct({
    type: Schema.Literal("mark-clean"),
    id: VaultItemId,
    confirmedReset: Schema.Literal(true),
  }),
  Schema.Struct({ type: Schema.Literal("retire"), id: VaultItemId }),
  Schema.Struct({ type: Schema.Literal("restore"), id: VaultItemId }),
]);
export type VaultTestAccountChange = typeof VaultTestAccountChange.Type;
export const VaultTestAccountMutation = Schema.Struct({
  operationId: VaultItemId,
  expectedRevision: NonNegativeInt,
  change: VaultTestAccountChange,
});
export type VaultTestAccountMutation = typeof VaultTestAccountMutation.Type;
// A pool destination is an authorization scope, never a provider login endpoint.
export const vaultTestAccountDestination = (collectionId: string) =>
  `loom:test-accounts:${collectionId}`;
export const VaultTestAccountAgentMutation = Schema.Struct({
  operationId: VaultItemId,
  expectedRevision: NonNegativeInt,
  change: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("reserve"),
      id: VaultItemId,
      durationMs: Schema.Literals([300_000, 900_000]),
    }),
    Schema.Struct({ type: Schema.Literal("renew"), id: VaultItemId, leaseId: VaultItemId }),
    Schema.Struct({ type: Schema.Literal("release"), id: VaultItemId, leaseId: VaultItemId }),
  ]),
});
export type VaultTestAccountAgentMutation = typeof VaultTestAccountAgentMutation.Type;
export const VaultTestAccountDiscovery = Schema.Struct({
  revision: NonNegativeInt,
  checkedAt: Time,
  collections: Schema.Array(VaultTestCollection).check(Schema.isMaxLength(32)),
  // Only available entries and this run's own reservations are returned.
  accounts: Schema.Array(VaultTestAccount).check(Schema.isMaxLength(128)),
  loginDelivery: Schema.Literal("unsupported"),
});
export type VaultTestAccountDiscovery = typeof VaultTestAccountDiscovery.Type;
export const VAULT_TEST_ACCOUNT_WS_METHODS = {
  snapshot: "loom.vault-test-accounts.snapshot",
  apply: "loom.vault-test-accounts.apply",
} as const;
const error = Schema.Union([VaultError, EnvironmentAuthorizationError]);
export const VaultTestAccountRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_TEST_ACCOUNT_WS_METHODS.snapshot, {
    payload: Schema.Struct({}),
    success: VaultTestAccountSnapshot,
    error,
  }),
  Rpc.make(VAULT_TEST_ACCOUNT_WS_METHODS.apply, {
    payload: VaultTestAccountMutation,
    success: VaultTestAccountSnapshot,
    error,
  }),
);
