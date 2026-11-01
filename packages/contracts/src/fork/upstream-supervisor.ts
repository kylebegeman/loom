import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { IsoDateTime, PositiveInt, ProjectId } from "../baseSchemas.ts";
import { VaultGitHubTarget } from "./vault-github.ts";

export const UPSTREAM_WORKFLOW = "loom-upstream.yml";
export const UPSTREAM_REF = "main";
export const UpstreamCommitSha = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
export const UpstreamRequestId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const UpstreamTargetTag = Schema.String.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^v[0-9][0-9A-Za-z.+-]*$/),
);
export const UpstreamSupervisorConfigInput = Schema.Struct({
  projectId: ProjectId,
  clientSessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  connection: VaultGitHubTarget,
  enabled: Schema.Boolean,
});
export type UpstreamSupervisorConfigInput = typeof UpstreamSupervisorConfigInput.Type;
export const UpstreamSupervisorConfig = Schema.Struct({
  ...UpstreamSupervisorConfigInput.fields,
  updatedAt: IsoDateTime,
});
export type UpstreamSupervisorConfig = typeof UpstreamSupervisorConfig.Type;
export const UpstreamSupervisorStatusInput = Schema.Struct({
  projectId: ProjectId,
  runIds: Schema.optionalKey(Schema.Array(PositiveInt).check(Schema.isMaxLength(30))),
});
export type UpstreamSupervisorStatusInput = typeof UpstreamSupervisorStatusInput.Type;
export const UpstreamSupervisorDispatchInput = Schema.Struct({
  projectId: ProjectId,
  clientRequestId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,160}$/)),
  targetTag: UpstreamTargetTag,
  expectedMainSha: UpstreamCommitSha,
});
export type UpstreamSupervisorDispatchInput = typeof UpstreamSupervisorDispatchInput.Type;
export const UpstreamSupervisorRetryInput = Schema.Struct({
  projectId: ProjectId,
  clientRequestId: UpstreamSupervisorDispatchInput.fields.clientRequestId,
  runId: PositiveInt,
  expectedAttempt: PositiveInt,
  expectedMainSha: UpstreamCommitSha,
});
export type UpstreamSupervisorRetryInput = typeof UpstreamSupervisorRetryInput.Type;
export const UpstreamWorkflowRun = Schema.Struct({
  id: PositiveInt,
  attempt: PositiveInt,
  status: Schema.String.check(Schema.isMaxLength(80)),
  conclusion: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))),
  headSha: UpstreamCommitSha,
  url: Schema.String.check(Schema.isMaxLength(2048)),
  title: Schema.String.check(Schema.isMaxLength(300)),
  createdAt: IsoDateTime,
});
export type UpstreamWorkflowRun = typeof UpstreamWorkflowRun.Type;
export const UpstreamWorkflowSnapshot = Schema.Struct({
  mainSha: UpstreamCommitSha,
  runs: Schema.Array(UpstreamWorkflowRun).check(Schema.isMaxLength(30)),
});
export type UpstreamWorkflowSnapshot = typeof UpstreamWorkflowSnapshot.Type;
export const UpstreamSupervisorReceipt = Schema.Struct({
  id: UpstreamRequestId,
  clientRequestId: UpstreamSupervisorDispatchInput.fields.clientRequestId,
  targetTag: UpstreamTargetTag,
  expectedMainSha: UpstreamCommitSha,
  status: Schema.Literals(["dispatching", "accepted", "unknown", "refused"]),
  createdAt: IsoDateTime,
  httpStatus: Schema.NullOr(Schema.Int),
  run: Schema.NullOr(UpstreamWorkflowRun),
});
export type UpstreamSupervisorReceipt = typeof UpstreamSupervisorReceipt.Type;
export const UpstreamSupervisorRetryReceipt = Schema.Struct({
  ...UpstreamSupervisorRetryInput.fields,
  id: UpstreamRequestId,
  status: Schema.Literals(["retrying", "accepted", "unknown", "refused"]),
  createdAt: IsoDateTime,
  httpStatus: Schema.NullOr(Schema.Int),
  run: Schema.NullOr(UpstreamWorkflowRun),
});
export type UpstreamSupervisorRetryReceipt = typeof UpstreamSupervisorRetryReceipt.Type;
export const UpstreamSupervisorStatus = Schema.Struct({
  unavailable: Schema.optionalKey(Schema.Boolean),
  config: Schema.NullOr(UpstreamSupervisorConfig),
  workflow: Schema.Literal(UPSTREAM_WORKFLOW),
  mainSha: Schema.NullOr(UpstreamCommitSha),
  runs: UpstreamWorkflowSnapshot.fields.runs,
  receipts: Schema.Array(UpstreamSupervisorReceipt),
  retryReceipts: Schema.optionalKey(Schema.Array(UpstreamSupervisorRetryReceipt)),
});
export type UpstreamSupervisorStatus = typeof UpstreamSupervisorStatus.Type;
export class UpstreamSupervisorError extends Schema.TaggedError<UpstreamSupervisorError>()(
  "UpstreamSupervisorError",
  {
    reason: Schema.Literals([
      "denied",
      "not_configured",
      "disabled",
      "conflict",
      "active",
      "stale",
      "invalid",
      "storage",
      "unavailable",
      "unknown",
    ]),
  },
) {
  override get message() {
    return {
      denied: "This caller is not authorized to supervise upstream integrations.",
      not_configured: "Configure an upstream supervisor on this computer first.",
      disabled: "Upstream supervisor control is disabled on this computer.",
      conflict: "The upstream request conflicts with a saved request or configuration.",
      active: "An upstream integration is already active. Follow its existing run.",
      stale: "Main changed after this request was prepared. Read current upstream status.",
      invalid:
        "Use the configured upstream workflow, an exact upstream tag and current main commit.",
      storage: "Loom could not read or save upstream supervisor state.",
      unavailable:
        "The upstream integration service is unavailable. Check its status before retrying.",
      unknown: "The upstream dispatch outcome is unknown. Inspect its receipt before further work.",
    }[this.reason];
  }
}
export const UPSTREAM_WS_METHODS = {
  status: "loom.upstream.status",
  configure: "loom.upstream.configure",
  dispatch: "loom.upstream.dispatch",
} as const;
const error = Schema.Union([UpstreamSupervisorError, EnvironmentAuthorizationError]);
export const UpstreamSupervisorRpcGroup = RpcGroup.make(
  Rpc.make(UPSTREAM_WS_METHODS.status, {
    payload: UpstreamSupervisorStatusInput,
    success: UpstreamSupervisorStatus,
    error,
  }),
  Rpc.make(UPSTREAM_WS_METHODS.configure, {
    payload: UpstreamSupervisorConfigInput,
    success: UpstreamSupervisorConfig,
    error,
  }),
  Rpc.make(UPSTREAM_WS_METHODS.dispatch, {
    payload: UpstreamSupervisorDispatchInput,
    success: UpstreamSupervisorReceipt,
    error,
  }),
);
