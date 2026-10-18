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
});
export type VaultCoreStatus = typeof VaultCoreStatus.Type;
const messages = {
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
export class VaultError extends Schema.TaggedError<VaultError>()("VaultError", {
  reason: Schema.Literals(
    Object.keys(messages) as [keyof typeof messages, ...Array<keyof typeof messages>],
  ),
}) {
  override get message() {
    return messages[this.reason];
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
});
export type VaultItemList = typeof VaultItemList.Type;
export const VaultItemPage = Schema.Struct({
  items: Schema.Array(VaultItemSummary),
  nextCursor: Schema.NullOr(VaultItemId),
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
