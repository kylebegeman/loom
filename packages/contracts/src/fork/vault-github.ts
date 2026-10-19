import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { PositiveInt, IsoDateTime } from "../baseSchemas.ts";
import { VaultError, VaultItemId, VaultItemSummary, VaultItemChange } from "./vault-core.ts";
export const VaultGitHubRepository = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/),
);
const privateText = Schema.RedactedFromValue(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16384)),
);
export const VaultGitHubCredential = Schema.Union([
  Schema.Struct({ type: Schema.Literal("token"), token: privateText }),
  Schema.Struct({
    type: Schema.Literal("app"),
    appId: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,19}$/)),
    installationId: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,19}$/)),
    privateKey: privateText,
  }),
]);
export type VaultGitHubCredential = typeof VaultGitHubCredential.Type;
export const VaultGitHubInfo = Schema.Struct({
  item: VaultItemSummary,
  account: Schema.String,
  mechanism: Schema.Literals(["token", "app"]),
  repositories: Schema.Array(VaultGitHubRepository),
});
export type VaultGitHubInfo = typeof VaultGitHubInfo.Type;
const VaultGitHubConnect = Schema.Struct({
  id: VaultItemId,
  operationId: VaultItemId,
  expectedVersion: VaultItemChange.fields.expectedVersion,
  label: VaultItemSummary.fields.label,
  repositories: Schema.Array(VaultGitHubRepository).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
  ),
  credential: VaultGitHubCredential,
});
// New connections use expectedVersion 0; replacement uses the current item version.
export const VaultGitHubSave = Schema.Struct({
  ...VaultGitHubConnect.fields,
  expectedVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type VaultGitHubSave = typeof VaultGitHubSave.Type;
export const VaultGitHubTarget = Schema.Struct({
  id: VaultItemId,
  expectedVersion: PositiveInt,
  repository: VaultGitHubRepository,
});
export type VaultGitHubTarget = typeof VaultGitHubTarget.Type;
export const VaultGitHubTestResult = Schema.Struct({
  account: Schema.String,
  repository: VaultGitHubRepository,
  checkedAt: IsoDateTime,
  tokenExpiresAt: Schema.NullOr(IsoDateTime),
  api: Schema.Literal("ready"),
});
export type VaultGitHubTestResult = typeof VaultGitHubTestResult.Type;
const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8000));
export const VaultGitHubOperation = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["repo-view", "pr-list", "issue-list"]) }),
  Schema.Struct({
    action: Schema.Literals(["pr-view", "issue-view", "pr-checks"]),
    number: PositiveInt,
  }),
  Schema.Struct({
    action: Schema.Literals(["pr-comment", "issue-comment"]),
    number: PositiveInt,
    body: text,
  }),
  Schema.Struct({
    action: Schema.Literal("issue-create"),
    title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    body: text,
  }),
]);
export type VaultGitHubOperation = typeof VaultGitHubOperation.Type;
export const VaultGitHubRun = Schema.Struct({
  ...VaultGitHubTarget.fields,
  operation: VaultGitHubOperation,
});
export type VaultGitHubRun = typeof VaultGitHubRun.Type;
export const VaultGitHubResult = Schema.Struct({
  account: Schema.String,
  repository: VaultGitHubRepository,
  exitCode: Schema.Int,
  stdout: Schema.String,
});
export type VaultGitHubResult = typeof VaultGitHubResult.Type;
export const vaultGitHubDestination = (repository: string) =>
  `https://github.com/${repository.toLowerCase()}`;
export class VaultGitHubError extends Schema.TaggedError<VaultGitHubError>()("VaultGitHubError", {
  reason: Schema.Literals([
    "invalid-credential",
    "unauthorized",
    "repository-denied",
    "unavailable",
    "invalid-response",
    "cli-unavailable",
    "failed",
    "timeout",
    "unsupported",
  ]),
}) {
  override get message() {
    return {
      "invalid-credential":
        "Use valid dedicated GitHub credentials. App keys must be RSA PEM private keys.",
      unauthorized: "GitHub refused these credentials. Replace or renew the connection in Vault.",
      "repository-denied":
        "This connection cannot access the selected repository. Check its allowlist and GitHub permissions.",
      unavailable: "GitHub could not be reached. Check the connection before retrying.",
      "invalid-response": "GitHub returned an unsupported response.",
      "cli-unavailable":
        "Install GitHub CLI on the Loom server before using mediated GH operations.",
      failed:
        "The GH operation failed. Its remote outcome may be unknown; inspect GitHub before retrying a write.",
      timeout:
        "The GH operation timed out. Its remote outcome may be unknown; inspect GitHub before retrying a write.",
      unsupported:
        "This connector supports github.com and the documented mediated GH operations only.",
    }[this.reason];
  }
}
export const VAULT_GITHUB_WS_METHODS = {
  info: "loom.vault-connectors.githubInfo",
  list: "loom.vault-connectors.githubList",
  save: "loom.vault-connectors.githubSave",
  test: "loom.vault-connectors.githubTest",
  change: "loom.vault-connectors.githubChange",
} as const;
const error = Schema.Union([VaultError, VaultGitHubError, EnvironmentAuthorizationError]);
export const VaultGitHubRpcGroup = RpcGroup.make(
  Rpc.make(VAULT_GITHUB_WS_METHODS.list, {
    payload: Schema.Struct({ cursor: Schema.NullOr(VaultItemId) }),
    success: Schema.Struct({
      items: Schema.Array(VaultGitHubInfo),
      nextCursor: Schema.NullOr(VaultItemId),
    }),
    error,
  }),
  Rpc.make(VAULT_GITHUB_WS_METHODS.info, {
    payload: Schema.Struct({ id: VaultItemId }),
    success: VaultGitHubInfo,
    error,
  }),
  Rpc.make(VAULT_GITHUB_WS_METHODS.save, {
    payload: VaultGitHubSave,
    success: VaultGitHubInfo,
    error,
  }),
  Rpc.make(VAULT_GITHUB_WS_METHODS.test, {
    payload: VaultGitHubTarget,
    success: VaultGitHubTestResult,
    error,
  }),
  Rpc.make(VAULT_GITHUB_WS_METHODS.change, {
    payload: VaultItemChange,
    success: VaultItemSummary,
    error,
  }),
);
