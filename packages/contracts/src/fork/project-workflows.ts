import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { EnvironmentId, IsoDateTime, NonNegativeInt, ThreadId } from "../baseSchemas.ts";
import {
  LibraryError,
  LibraryId,
  LibraryTitle,
  LibraryRequestId,
  LibraryProject,
  LibraryResource,
  LibraryProjectColor,
  LibraryCreateProjectRequest,
  LibraryPrepareCopyRequest,
  LibraryReopenCopyRequest,
  LibraryReleaseCopyRequest,
  LibrarySnapshotCopyRequest,
  LibraryThreadBinding,
  LibraryWorkingCopy,
  LibraryRestoreCopyRequest,
  LibraryLaunchWorkspace,
} from "./project-library.ts";
import {
  LibraryProjectProfileInput,
  looksLikeSecretValue,
  libraryProfileSecretValueField,
} from "./project-library-profile.ts";
import { ModelSelection } from "../modelSelection.ts";
import { RuntimeMode, ProviderInteractionMode } from "../providerPolicy.ts";

export const PROJECT_WORKFLOWS_FEATURE = "project-workflows";
export const LibraryBlueprint = Schema.Struct({
  format: Schema.Literal("loom-project"),
  version: Schema.Literal(1),
  title: LibraryTitle,
  brief: Schema.String.check(Schema.isMaxLength(65536)),
  resources: Schema.Array(LibraryResource).check(Schema.isMaxLength(64)),
  color: Schema.optional(LibraryProjectColor),
  setup: Schema.optional(LibraryProjectProfileInput),
  connections: Schema.Array(LibraryTitle).check(Schema.isMaxLength(32)),
}).check(
  Schema.makeFilter((value) => {
    if (
      value.resources.some(
        (resource) =>
          resource.kind !== "link" &&
          (/^[\\/]|^[a-z]:|[\\\p{Cc}\p{Cf}]/iu.test(resource.relativePath) ||
            (resource.relativePath !== "." &&
              resource.relativePath
                .split("/")
                .some((part) => !part || part === "." || part === ".."))),
      )
    )
      return "Repository folders must stay within the project.";
    if (
      value.resources.some((resource) => {
        const remote = resource.kind === "link" ? resource.url : resource.remoteUrl;
        if (!remote) return false;
        try {
          const url = new URL(remote.replace(/^([^@:/]+)@([^@:/]+):(.+)$/, "ssh://$1@$2/$3"));
          return (
            !["https:", "ssh:"].includes(url.protocol) ||
            !!url.password ||
            !!url.search ||
            !!url.hash ||
            (url.protocol === "https:" && !!url.username)
          );
        } catch {
          return true;
        }
      })
    )
      return "Use portable HTTPS or SSH references without embedded credentials.";
    if (value.setup?.preferredEnvironmentIds?.length || value.setup?.defaultModelSelection)
      return "Keep computer and provider selections on the computer, outside the blueprint.";
    if (value.setup && libraryProfileSecretValueField(value.setup))
      return "Blueprint setup cannot contain credential values.";
    if (value.connections.some(looksLikeSecretValue))
      return "Connection names cannot contain credentials.";
    return JSON.stringify(value).length <= 131072 || "The blueprint is too large.";
  }),
);
export type LibraryBlueprint = typeof LibraryBlueprint.Type;

export const LibraryWorkstreamReference = Schema.Struct({
  kind: Schema.Literals(["thread", "copy", "repository", "branch", "pull-request", "verification"]),
  id: LibraryId,
  label: LibraryTitle,
  environmentId: Schema.optional(EnvironmentId),
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
  state: Schema.Literals(["open", "passed", "completed", "blocked"]),
});
export type LibraryWorkstreamReference = typeof LibraryWorkstreamReference.Type;
export const LibraryWorkstream = Schema.Struct({
  id: LibraryId,
  projectId: LibraryId,
  revision: NonNegativeInt,
  title: LibraryTitle,
  goal: Schema.String.check(Schema.isMaxLength(8192)),
  state: Schema.Literals(["active", "completed", "archived"]),
  references: Schema.Array(LibraryWorkstreamReference).check(Schema.isMaxLength(128)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type LibraryWorkstream = typeof LibraryWorkstream.Type;
export const LibrarySaveWorkstream = Schema.Struct({
  requestId: LibraryRequestId,
  id: LibraryId,
  projectId: LibraryId,
  expectedRevision: NonNegativeInt,
  title: LibraryTitle,
  goal: Schema.String.check(Schema.isMaxLength(8192)),
  state: LibraryWorkstream.fields.state,
  references: LibraryWorkstream.fields.references,
});
export type LibrarySaveWorkstream = typeof LibrarySaveWorkstream.Type;

export const LibraryLaunchOperation = Schema.Struct({
  project: LibraryProject,
  binding: LibraryThreadBinding,
  threadId: ThreadId,
  title: LibraryTitle,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  keepOnComputer: Schema.optional(Schema.Boolean),
  /** Absent means the copy folder, which is all a computer without worktree starts offers. */
  workspace: Schema.optional(LibraryLaunchWorkspace),
  /**
   * Files this launch reserves, then fills after the conversation exists. Only computers with
   * `library-launch-files` accept it, and `binding.workingCopyId` must equal its `requestId`.
   */
  files: Schema.optional(LibraryPrepareCopyRequest),
});
export const LibraryOperationInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create"), input: LibraryCreateProjectRequest }),
  Schema.Struct({ kind: Schema.Literal("prepare"), input: LibraryPrepareCopyRequest }),
  Schema.Struct({ kind: Schema.Literal("restore"), input: LibraryRestoreCopyRequest }),
  Schema.Struct({ kind: Schema.Literal("reopen"), input: LibraryReopenCopyRequest }),
  Schema.Struct({ kind: Schema.Literal("snapshot"), input: LibrarySnapshotCopyRequest }),
  Schema.Struct({ kind: Schema.Literal("release"), input: LibraryReleaseCopyRequest }),
  Schema.Struct({ kind: Schema.Literal("unregister"), input: LibraryReleaseCopyRequest }),
  Schema.Struct({ kind: Schema.Literal("launch"), input: LibraryLaunchOperation }),
]);
export type LibraryOperationInput = typeof LibraryOperationInput.Type;
export const LibraryOperation = Schema.Struct({
  id: LibraryId,
  kind: Schema.Literals([
    "create",
    "prepare",
    "restore",
    "reopen",
    "snapshot",
    "release",
    "unregister",
    "launch",
  ]),
  projectId: Schema.NullOr(LibraryId),
  environmentId: EnvironmentId,
  state: Schema.Literals(["queued", "running", "succeeded", "failed", "cancelled", "needs-input"]),
  phase: Schema.String,
  attempt: NonNegativeInt,
  error: Schema.NullOr(Schema.String),
  failureReason: Schema.optional(LibraryError.fields.reason),
  repair: LibraryError.fields.repair,
  result: Schema.NullOr(
    Schema.Union([LibraryProject, LibraryWorkingCopy, Schema.Struct({ threadId: ThreadId })]),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type LibraryOperation = typeof LibraryOperation.Type;
export const LibraryPreservationEntry = Schema.Struct({
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  blockers: Schema.Array(Schema.String),
  restore: Schema.Literals(["verified-archive", "repository", "unverified"]),
  checkedAt: Schema.NullOr(IsoDateTime),
});
export type LibraryPreservationEntry = typeof LibraryPreservationEntry.Type;
export const PROJECT_WORKFLOW_WS_METHODS = {
  changes: "loom.project-workflows.changes",
  workstreams: "loom.project-workflows.workstreams",
  saveWorkstream: "loom.project-workflows.save-workstream",
  blueprint: "loom.project-workflows.blueprint",
  applyBlueprint: "loom.project-workflows.apply-blueprint",
  preservation: "loom.project-workflows.preservation",
  operations: "loom.project-workflows.operations",
  run: "loom.project-workflows.run",
  cancel: "loom.project-workflows.cancel",
  execute: "loom.project-workflows.execute",
  resume: "loom.project-workflows.resume",
} as const;
const W = PROJECT_WORKFLOW_WS_METHODS;
const error = Schema.Union([LibraryError, EnvironmentAuthorizationError]);
export const ProjectWorkflowsRpcGroup = RpcGroup.make(
  Rpc.make(W.changes, { payload: {}, success: NonNegativeInt, stream: true, error }),
  Rpc.make(W.workstreams, {
    payload: { projectId: LibraryId },
    success: Schema.Array(LibraryWorkstream),
    error,
  }),
  Rpc.make(W.saveWorkstream, { payload: LibrarySaveWorkstream, success: LibraryWorkstream, error }),
  Rpc.make(W.blueprint, { payload: { projectId: LibraryId }, success: LibraryBlueprint, error }),
  Rpc.make(W.applyBlueprint, {
    payload: {
      requestId: LibraryRequestId,
      projectId: LibraryId,
      expectedRevision: NonNegativeInt,
      blueprint: LibraryBlueprint,
    },
    success: LibraryProject,
    error,
  }),
  Rpc.make(W.preservation, {
    payload: { projectId: Schema.optional(LibraryId) },
    success: Schema.Array(LibraryPreservationEntry),
    error,
  }),
  Rpc.make(W.operations, {
    payload: { projectId: Schema.optional(LibraryId) },
    success: Schema.Array(LibraryOperation),
    error,
  }),
  Rpc.make(W.run, {
    payload: { operationId: LibraryRequestId, request: LibraryOperationInput },
    success: LibraryOperation,
    error,
  }),
  Rpc.make(W.execute, {
    payload: { operationId: LibraryRequestId, request: LibraryOperationInput },
    success: LibraryOperation,
    error,
  }),
  Rpc.make(W.resume, {
    payload: { operationId: LibraryRequestId },
    success: LibraryOperation,
    error,
  }),
  Rpc.make(W.cancel, {
    payload: { operationId: LibraryRequestId },
    success: LibraryOperation,
    error,
  }),
);
