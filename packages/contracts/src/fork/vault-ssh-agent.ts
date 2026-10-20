import * as Schema from "effect/Schema";
import { PositiveInt, NonNegativeInt } from "../baseSchemas.ts";
import { VaultItemId } from "./vault-core.ts";
import { VaultSshTarget, VaultSshPublicKey } from "./vault-ssh.ts";

export const VaultSshAgentOpen = Schema.Struct({ id: VaultItemId, expectedVersion: PositiveInt });
export type VaultSshAgentOpen = typeof VaultSshAgentOpen.Type;
export const VaultSshAgentSession = Schema.Struct({
  sessionId: VaultItemId,
  id: VaultItemId,
  version: PositiveInt,
  expiresAt: NonNegativeInt,
  destination: Schema.String,
  target: VaultSshTarget,
  publicKey: VaultSshPublicKey,
});
export type VaultSshAgentSession = typeof VaultSshAgentSession.Type;
const Frame = Schema.String.check(
  Schema.isMaxLength(21_848),
  Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/),
);
export const VaultSshAgentFrame = Schema.Struct({
  sessionId: VaultItemId,
  channelId: VaultItemId,
  sequence: NonNegativeInt.check(Schema.isLessThanOrEqualTo(64)),
  frame: Frame,
});
export type VaultSshAgentFrame = typeof VaultSshAgentFrame.Type;
export const VaultSshAgentResponse = Schema.Struct({ response: Frame });
export const VaultSshAgentClose = Schema.Struct({ sessionId: VaultItemId });
export const VaultSshAgentClosed = Schema.Struct({ closed: Schema.Literal(true) });
export const VaultSshAgentRun = Schema.Struct({
  ...VaultSshAgentOpen.fields,
  command: Schema.Struct({
    tool: Schema.Literals(["ssh", "git"]),
    argv: Schema.Array(
      Schema.String.check(
        Schema.isMaxLength(4096),
        Schema.makeFilter((value) => !value.includes("\0")),
      ),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  }),
  timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 300_000 })),
});
export type VaultSshAgentRun = typeof VaultSshAgentRun.Type;
