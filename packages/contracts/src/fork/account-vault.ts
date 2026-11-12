import * as Schema from "effect/Schema";
import {
  VaultConnectionReport,
  VaultConnectionRequest,
  VaultConnectionPin,
} from "./vault-connections.ts";
import {
  VaultSshAgentFrame,
  VaultSshAgentClose,
  VaultSshAgentResponse,
  VaultSshAgentSession,
} from "./vault-ssh-agent.ts";
import { VaultError } from "./vault-core.ts";
import { VaultSshError } from "./vault-ssh.ts";

export const ACCOUNT_VAULT_ROUTE = "/api/loom/account/vault";
export const AccountVaultRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("sessions") }),
  Schema.Struct({ kind: Schema.Literal("resolve"), input: VaultConnectionRequest }),
  Schema.Struct({ kind: Schema.Literal("open"), input: VaultConnectionRequest }),
  Schema.Struct({ kind: Schema.Literal("frame"), input: VaultSshAgentFrame }),
  Schema.Struct({ kind: Schema.Literal("close"), input: VaultSshAgentClose }),
]);
export type AccountVaultRequest = typeof AccountVaultRequest.Type;
export const AccountVaultEnvelope = Schema.Struct({
  payload: Schema.String.check(Schema.isMaxLength(65_536)),
  proof: Schema.String.check(Schema.isMaxLength(16_384)),
});
export type AccountVaultEnvelope = typeof AccountVaultEnvelope.Type;
export const AccountVaultResponse = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("sessions"), sessions: Schema.Array(VaultSshAgentSession) }),
  Schema.Struct({ kind: Schema.Literal("resolve"), report: VaultConnectionReport }),
  Schema.Struct({
    kind: Schema.Literal("open"),
    pin: VaultConnectionPin,
    session: VaultSshAgentSession,
  }),
  Schema.Struct({ kind: Schema.Literal("frame"), ...VaultSshAgentResponse.fields }),
  Schema.Struct({ kind: Schema.Literal("close"), closed: Schema.Literal(true) }),
]);
export type AccountVaultResponse = typeof AccountVaultResponse.Type;
export const AccountVaultFailure = Schema.Union([VaultError, VaultSshError]);
