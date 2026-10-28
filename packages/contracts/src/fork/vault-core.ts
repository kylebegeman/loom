import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { SecretRef } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";

export const VaultItemId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/));
export const VaultItemKind = Schema.Literals([
  "secret",
  "ssh-key",
  "service-connection",
  "account",
  "secure-note",
  "secure-file",
]);
export type VaultItemKind = typeof VaultItemKind.Type;
export const VAULT_ITEM_SEARCH_FEATURE = "vault-item-search";
export const VaultItemSummary = Schema.Struct({
  id: VaultItemId,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  kind: VaultItemKind,
  state: Schema.Literals(["active", "archived", "deleted"]),
  version: PositiveInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VaultItemSummary = typeof VaultItemSummary.Type;
export const VaultCoreStatus = Schema.Struct({
  backend: Schema.Literal("openbao"),
  state: Schema.Literals([
    "unconfigured",
    "ready",
    "locked",
    "unavailable",
    "denied",
    "misconfigured",
  ]),
  origin: Schema.NullOr(Schema.String),
  /** Seconds the service token has left without renewal. Absent if unknown or non-expiring. */
  tokenTtlSeconds: Schema.optionalKey(NonNegativeInt),
});
export type VaultCoreStatus = typeof VaultCoreStatus.Type;
const messages = {
  "managed-ssh-key":
    "Use Manage SSH key to change this connection. The generic editor can only rename it.",
  "managed-service-connection":
    "Use GitHub for agents to change this connection. The generic editor can only rename it.",
  configuration: "Configure this environment's OpenBao connection and private service token file.",
  locked: "OpenBao is sealed. Unlock the backend before using Loom Vault.",
  denied:
    "This Vault operation is not permitted. Check the connection permissions and workload grant.",
  unavailable: "OpenBao could not be reached. Retry after checking its connection.",
  "invalid-response": "OpenBao returned an unsupported or invalid response.",
  "not-found": "This Vault item is unavailable.",
  conflict: "This item changed. Refresh it before saving again.",
  "invalid-input": "The Vault request is invalid or exceeds its size limit.",
  archived: "Restore this archived item before replacing its value.",
} as const;
// Agents relay these to the user, so each names the real cause, its repair and where in
// Settings to make it. They are fixed text: never derived from an underlying failure.
const deniedDetails = {
  "admin-only":
    "Only the environment owner can make this Vault change, from Loom Settings > Vault (/settings/vault). Agents cannot change Vault policy, trust or records.",
  "workload-inactive":
    "Vault works only while this thread's turn is running. Background work that continues after the turn ends cannot use Vault. Continue in a new turn of this thread. Owner access is in Loom Settings > Vault (/settings/vault).",
  "caller-permission":
    "Owner access works only in full access outside plan mode. Switch this thread to full access and leave plan mode, then continue. Owner access is in Loom Settings > Vault (/settings/vault).",
  "not-granted":
    "No current Vault grant covers this record, action and destination for this thread. Ask the environment owner to grant it in Loom Settings > Vault > Access (/settings/vault#loom-vault-access).",
  "untrusted-host":
    "This SSH destination has no trusted host key. The environment owner must verify and pin it in Loom Settings > Vault (/settings/vault).",
} as const;
const VaultDeniedDetail = Schema.Literals(
  Object.keys(deniedDetails) as [keyof typeof deniedDetails, ...Array<keyof typeof deniedDetails>],
);
export type VaultDeniedDetail = typeof VaultDeniedDetail.Type;
export const vaultDeniedMessage = (detail: VaultDeniedDetail) => deniedDetails[detail];
export class VaultError extends Schema.TaggedError<VaultError>()("VaultError", {
  reason: Schema.Literals(
    Object.keys(messages) as [keyof typeof messages, ...Array<keyof typeof messages>],
  ),
  detail: Schema.optionalKey(VaultDeniedDetail),
}) {
  override get message() {
    return this.reason === "denied" && this.detail !== undefined
      ? vaultDeniedMessage(this.detail)
      : messages[this.reason];
  }
}
export const VaultItemSave = Schema.Struct({
  id: VaultItemId,
  operationId: VaultItemId,
  expectedVersion: NonNegativeInt,
  label: VaultItemSummary.fields.label,
  kind: VaultItemKind,
  value: Schema.optional(Schema.RedactedFromValue(Schema.String)),
});
export type VaultItemSave = typeof VaultItemSave.Type;
export const VaultPrivateSave = Schema.Struct({
  id: VaultItemSave.fields.id,
  operationId: VaultItemSave.fields.operationId,
  expectedVersion: VaultItemSave.fields.expectedVersion,
  label: VaultItemSave.fields.label,
  kind: VaultItemSave.fields.kind,
  secretRef: SecretRef,
});
export type VaultPrivateSave = typeof VaultPrivateSave.Type;
export const VaultItemChange = Schema.Struct({
  id: VaultItemId,
  operationId: VaultItemId,
  expectedVersion: PositiveInt,
  action: Schema.Literals(["archive", "restore", "delete"]),
});
export type VaultItemChange = typeof VaultItemChange.Type;
export const VaultItemList = Schema.Struct({
  cursor: Schema.NullOr(VaultItemId),
  includeArchived: Schema.Boolean,
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
  kind: Schema.optionalKey(VaultItemKind),
  sort: Schema.optionalKey(Schema.Literals(["label", "updated"])),
});
export type VaultItemList = typeof VaultItemList.Type;
export const VaultItemPage = Schema.Struct({
  items: Schema.Array(VaultItemSummary),
  nextCursor: Schema.NullOr(VaultItemId),
  archivedCount: Schema.optionalKey(NonNegativeInt),
});
export type VaultItemPage = typeof VaultItemPage.Type;
export const VaultItemReveal = Schema.Struct({ id: VaultItemId, expectedVersion: PositiveInt });
export type VaultItemReveal = typeof VaultItemReveal.Type;
export const VaultItemValue = Schema.Struct({
  item: VaultItemSummary,
  value: Schema.RedactedFromValue(Schema.String),
});
export type VaultItemValue = typeof VaultItemValue.Type;
export const VAULT_CORE_WS_METHODS = {
  status: "loom.vault-core.status",
  reveal: "loom.vault-core.reveal",
  list: "loom.vault-core.list",
  save: "loom.vault-core.save",
  change: "loom.vault-core.change",
} as const;
const error = Schema.Union([VaultError, EnvironmentAuthorizationError]);
export const VaultCoreRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_CORE_WS_METHODS.reveal, {
    payload: VaultItemReveal,
    success: VaultItemValue,
    error,
  }),
  Rpc.make(VAULT_CORE_WS_METHODS.status, {
    payload: Schema.Struct({}),
    success: VaultCoreStatus,
    error,
  }),
  Rpc.make(VAULT_CORE_WS_METHODS.list, { payload: VaultItemList, success: VaultItemPage, error }),
  Rpc.make(VAULT_CORE_WS_METHODS.save, {
    payload: VaultItemSave,
    success: VaultItemSummary,
    error,
  }),
  Rpc.make(VAULT_CORE_WS_METHODS.change, {
    payload: VaultItemChange,
    success: VaultItemSummary,
    error,
  }),
);

export const VaultFileContent = Schema.Struct({
  name: TrimmedNonEmptyString.check(
    Schema.isMaxLength(255),
    Schema.makeFilter(
      (value) =>
        value !== "." &&
        value !== ".." &&
        !/[\\/]/.test(value) &&
        [...value].every((character) => character.codePointAt(0)! >= 32),
    ),
  ),
  mediaType: Schema.String.check(Schema.isMaxLength(255)),
  base64: Schema.String.check(
    Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  ),
});
