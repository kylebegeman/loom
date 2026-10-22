import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { VaultItemId, VaultItemSummary } from "./vault-core.ts";

const Resource = TrimmedNonEmptyString.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((value) =>
    [...value].every(
      (character) => character.codePointAt(0)! >= 32 && character.codePointAt(0)! !== 127,
    ),
  ),
);
export const VaultConnectionSelector = Schema.Union([
  Schema.Struct({ id: VaultItemId, expectedVersion: PositiveInt }),
  Schema.Struct({
    resource: Resource,
    preferredItemIds: Schema.optionalKey(Schema.Array(VaultItemId).check(Schema.isMaxLength(32))),
  }),
]);
export type VaultConnectionSelector = typeof VaultConnectionSelector.Type;
export const VaultConnectionKind = Schema.Literals(["ssh", "git-ssh", "github"]);
export const VaultConnectionRequest = Schema.Struct({
  kind: VaultConnectionKind,
  connection: VaultConnectionSelector,
  repository: Schema.optionalKey(Resource),
  account: Schema.optionalKey(Resource),
});
export type VaultConnectionRequest = typeof VaultConnectionRequest.Type;
export const VaultConnectionChoice = Schema.Struct({
  item: VaultItemSummary,
  kind: VaultConnectionKind,
  hostname: Schema.NullOr(Schema.String),
  account: Schema.NullOr(Schema.String),
  repositories: Schema.Array(Schema.String),
});
export type VaultConnectionChoice = typeof VaultConnectionChoice.Type;
export const VaultConnectionPin = Schema.Struct({
  ...VaultConnectionChoice.fields,
  destination: Resource,
  repository: Schema.NullOr(Resource),
});
export type VaultConnectionPin = typeof VaultConnectionPin.Type;
export const VaultConnectionState = Schema.Literals([
  "ready",
  "ambiguous",
  "missing",
  "inactive",
  "revoked",
  "expired",
  "policy-denied",
  "backend-unavailable",
  "backend-locked",
  "backend-unconfigured",
  "backend-denied",
  "untrusted-host",
  "broker-unavailable",
  "version-conflict",
  "incompatible",
  "invalid-input",
  "inventory-limit",
]);
export type VaultConnectionState = typeof VaultConnectionState.Type;
export const VaultConnectionRepair = Schema.NullOr(
  Schema.Literals([
    "select-connection",
    "create-connection",
    "restore-connection",
    "renew-access",
    "repair-policy",
    "check-backend",
    "unlock-backend",
    "configure-backend",
    "trust-host",
    "configure-broker",
    "refresh-connection",
    "check-request",
  ]),
);
export type VaultConnectionRepair = typeof VaultConnectionRepair.Type;
export const VaultConnectionReport = Schema.Struct({
  state: VaultConnectionState,
  selected: Schema.NullOr(VaultConnectionPin),
  choices: Schema.Array(VaultConnectionChoice),
  repair: VaultConnectionRepair,
});
export type VaultConnectionReport = typeof VaultConnectionReport.Type;
export class VaultConnectionError extends Schema.TaggedError<VaultConnectionError>()(
  "VaultConnectionError",
  {
    state: VaultConnectionState,
    choices: Schema.Array(VaultConnectionChoice),
    repair: VaultConnectionRepair,
  },
) {
  get reason() {
    return this.state;
  }
  override get message() {
    return {
      ready: "The connection is ready.",
      ambiguous:
        "More than one Vault connection matches. Choose the intended host or account from the matching connections.",
      missing: "This resource has no matching enrolled Vault connection.",
      inactive: "Restore this inactive Vault connection before use.",
      revoked: "Access to this Vault connection was revoked. An administrator must restore access.",
      expired: "Access to this Vault connection expired. An administrator must renew access.",
      "policy-denied": "Vault policy does not allow this connection and destination for this run.",
      "backend-unavailable": "The Vault backend is unavailable. Check its connection.",
      "backend-locked": "Unlock the Vault backend before retrying.",
      "backend-unconfigured": "Configure this environment's Vault backend before retrying.",
      "backend-denied": "The Vault backend denied access. Check its service policy.",
      "untrusted-host": "An administrator must verify and pin this SSH host key before use.",
      "broker-unavailable": "Configure and reconnect the enrolled Vault execution broker.",
      "version-conflict": "The selected connection changed. Resolve it again before use.",
      incompatible: "This Vault connection does not support the requested resource or operation.",
      "invalid-input": "The Vault connection request is invalid.",
      "inventory-limit":
        "Vault connection discovery reached its inventory limit. Select an item by ID and current version.",
    }[this.state];
  }
}
