import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const GitHubSetupRequest = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});
export const GitHubSetupState = Schema.Struct({
  requestId: Schema.NullOr(GitHubSetupRequest.fields.requestId),
  phase: Schema.Literals([
    "idle",
    "checking",
    "installing",
    "waiting",
    "configuring",
    "ready",
    "error",
    "cancelled",
  ]),
  deviceCode: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/))),
  message: Schema.NullOr(Schema.String),
});
export type GitHubSetupState = typeof GitHubSetupState.Type;
export class GitHubSetupFlowError extends Schema.TaggedError<GitHubSetupFlowError>()(
  "GitHubSetupFlowError",
  {},
) {
  override get message() {
    return "This GitHub setup request has been replaced. Refresh and try again.";
  }
}
export const GITHUB_HOST_SETUP_WS_METHODS = {
  start: "loom.github-host-setup.start",
  cancel: "loom.github-host-setup.cancel",
  watch: "loom.github-host-setup.watch",
} as const;
const error = Schema.Union([GitHubSetupFlowError, EnvironmentAuthorizationError]);
export const GitHubHostSetupRpcGroup = RpcGroup.make(
  Rpc.make(GITHUB_HOST_SETUP_WS_METHODS.start, {
    payload: GitHubSetupRequest,
    success: GitHubSetupState,
    error,
  }),
  Rpc.make(GITHUB_HOST_SETUP_WS_METHODS.cancel, {
    payload: GitHubSetupRequest,
    success: GitHubSetupState,
    error,
  }),
  Rpc.make(GITHUB_HOST_SETUP_WS_METHODS.watch, {
    payload: Schema.Struct({}),
    success: GitHubSetupState,
    error,
    stream: true,
  }),
);
