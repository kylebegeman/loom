import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentId, ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";

const RequestId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{8,64}$/));
const Sha = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/));
export const WorkspaceHandoffOffer = Schema.Struct({
  requestId: RequestId,
  sourceEnvironmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  title: Schema.String.check(Schema.isMaxLength(1000)),
  remoteUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  repositoryKey: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  branch: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  upstreamBranch: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  headSha: Sha,
  stateKey: Sha,
  context: Schema.String.check(Schema.isMaxLength(64000)),
  contextTruncated: Schema.Boolean,
});
export type WorkspaceHandoffOffer = typeof WorkspaceHandoffOffer.Type;
export const WorkspaceHandoffReceipt = Schema.Struct({
  requestId: RequestId,
  stateKey: Sha,
  destinationEnvironmentId: EnvironmentId,
  projectId: ProjectId,
  threadId: ThreadId,
  worktreePath: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  headSha: Sha,
});
export type WorkspaceHandoffReceipt = typeof WorkspaceHandoffReceipt.Type;
export const WorkspaceHandoffPrepareInput = Schema.Struct({
  offer: WorkspaceHandoffOffer,
  projectId: ProjectId,
});
export type WorkspaceHandoffPrepareInput = typeof WorkspaceHandoffPrepareInput.Type;
export const WorkspaceHandoffFinishInput = Schema.Struct({
  offer: WorkspaceHandoffOffer,
  receipt: WorkspaceHandoffReceipt,
});
export type WorkspaceHandoffFinishInput = typeof WorkspaceHandoffFinishInput.Type;
export const WorkspaceHandoffFinishResult = Schema.Struct({
  sourceSettled: Schema.Boolean,
  reason: Schema.String,
});
export type WorkspaceHandoffFinishResult = typeof WorkspaceHandoffFinishResult.Type;
export const WorkspaceHandoffAttemptRecord = Schema.Struct({
  completed: Schema.optional(Schema.Boolean),
  requestId: RequestId,
  destinationKey: Schema.String,
  offer: Schema.NullOr(WorkspaceHandoffOffer),
  receipt: Schema.NullOr(WorkspaceHandoffReceipt),
  sourceResult: Schema.NullOr(WorkspaceHandoffFinishResult),
});
export type WorkspaceHandoffAttemptRecord = typeof WorkspaceHandoffAttemptRecord.Type;

const messages = {
  busy: "Stop the source thread and its background work before handing it off.",
  unpublished: "Publish the source branch's current commits before handing it off.",
  "local-changes": "Commit or save the source checkout's local changes before handing it off.",
  "repository-mismatch": "The destination project must use the same repository as the source.",
  "source-changed":
    "Work changed during handoff. The original conversation is preserved. Review both threads and retry.",
  "invalid-receipt": "The destination does not match this handoff. The source was kept.",
  "preparation-failed":
    "Destination preparation failed. The original conversation is preserved. Check workspace setup and retry.",
  "provider-not-ready":
    "The destination provider is not ready for this model and runtime. Open Providers settings on that host, check installation and sign-in, then retry. The original conversation is preserved.",
  unavailable: "The project or published repository is unavailable on this host.",
} as const;
export class WorkspaceHandoffError extends Schema.TaggedError<WorkspaceHandoffError>()(
  "WorkspaceHandoffError",
  {
    reason: Schema.Literals(
      Object.keys(messages) as [keyof typeof messages, ...Array<keyof typeof messages>],
    ),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return messages[this.reason];
  }
}
export const WORKSPACE_HANDOFF_WS_METHODS = {
  offer: "loom.workspace-handoff.offer",
  prepare: "loom.workspace-handoff.prepare",
  finish: "loom.workspace-handoff.finish",
  resume: "loom.workspace-handoff.resume",
} as const;
const error = Schema.Union([WorkspaceHandoffError, EnvironmentAuthorizationError]);
export const WorkspaceHandoffRpcGroup = RpcGroup.make(
  Rpc.make(WORKSPACE_HANDOFF_WS_METHODS.offer, {
    payload: Schema.Struct({ threadId: ThreadId, requestId: RequestId }),
    success: WorkspaceHandoffOffer,
    error,
  }),
  Rpc.make(WORKSPACE_HANDOFF_WS_METHODS.prepare, {
    payload: WorkspaceHandoffPrepareInput,
    success: WorkspaceHandoffReceipt,
    error,
  }),
  Rpc.make(WORKSPACE_HANDOFF_WS_METHODS.finish, {
    payload: WorkspaceHandoffFinishInput,
    success: WorkspaceHandoffFinishResult,
    error,
  }),
  Rpc.make(WORKSPACE_HANDOFF_WS_METHODS.resume, {
    payload: WorkspaceHandoffFinishInput,
    success: WorkspaceHandoffReceipt,
    error,
  }),
);
