import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { ThreadId, TurnItemId, PositiveInt } from "../baseSchemas.ts";
import { SecretRequestError } from "../secretRequest.ts";
import { VaultError, VaultItemId } from "./vault-core.ts";

const messages = {
  "secret-ssh-key":
    "Use loom_vault_ssh_exec or loom_vault_git for an SSH key. It cannot answer a private secret request.",
  "secret-service-connection":
    "Use loom_vault_github_exec for a GitHub connection. It cannot answer a private secret request.",
  "secret-file-required":
    "This saved item is a file. Ask again with request_secret and delivery: file.",
} as const;
export class VaultSecretError extends Schema.TaggedError<VaultSecretError>()("VaultSecretError", {
  reason: Schema.Literals(["secret-ssh-key", "secret-service-connection", "secret-file-required"]),
}) {
  override get message() {
    return messages[this.reason];
  }
}

export const VAULT_SECRET_FEATURE = "vault-secret-answer";
export const VAULT_SECRET_WS_METHODS = {
  answerFromItem: "loom.vault-secret.answer-from-item",
} as const;
export const VaultSecretAnswer = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  itemId: VaultItemId,
  expectedVersion: PositiveInt,
});
export type VaultSecretAnswer = typeof VaultSecretAnswer.Type;
export const VaultSecretRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_SECRET_WS_METHODS.answerFromItem, {
    payload: VaultSecretAnswer,
    success: Schema.Void,
    error: Schema.Union([
      VaultError,
      VaultSecretError,
      SecretRequestError,
      EnvironmentAuthorizationError,
    ]),
  }),
);
