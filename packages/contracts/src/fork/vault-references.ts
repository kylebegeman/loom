import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentId } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError, VaultItemId, VaultItemKind, VaultItemSummary } from "./vault-core.ts";
export const VaultReferenceSearch = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(100)),
  kind: Schema.NullOr(VaultItemKind),
  includeArchived: Schema.Boolean,
  cursor: Schema.NullOr(VaultItemId),
});
export type VaultReferenceSearch = typeof VaultReferenceSearch.Type;
export const VaultReference = Schema.Struct({
  environmentId: EnvironmentId,
  item: VaultItemSummary,
  reference: Schema.String,
});
export type VaultReference = typeof VaultReference.Type;
export const VaultReferencePage = Schema.Struct({
  items: Schema.Array(VaultReference),
  nextCursor: Schema.NullOr(VaultItemId),
});
export type VaultReferencePage = typeof VaultReferencePage.Type;
export const vaultReferenceText = (environmentId: EnvironmentId, id: string) =>
  `loom-vault:${encodeURIComponent(environmentId)}:${id}`;
export const VAULT_REFERENCE_WS_METHODS = {
  search: "loom.vault-references.search",
  describe: "loom.vault-references.describe",
} as const;
export const VaultReferenceRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_REFERENCE_WS_METHODS.search, {
    payload: VaultReferenceSearch,
    success: VaultReferencePage,
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(VAULT_REFERENCE_WS_METHODS.describe, {
    payload: Schema.Struct({ id: VaultItemId }),
    success: Schema.NullOr(VaultReference),
    error: Schema.Union([VaultError, EnvironmentAuthorizationError]),
  }),
);
