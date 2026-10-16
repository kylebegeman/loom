import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { OrchestrationV2ThreadProjection } from "../orchestrationV2.ts";

export const PROJECT_LIBRARY_FEATURE = "project-library";
export const LibraryId = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
export const LibraryTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(160));
export const LibraryRequestId = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
export const LibraryResource = Schema.Struct({
  id: LibraryId,
  title: LibraryTitle,
  kind: Schema.optional(Schema.Literals(["repository", "link"])),
  url: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048)))),
  remoteUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
  relativePath: Schema.String.check(Schema.isMaxLength(512)),
  defaultBranch: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
});
export type LibraryResource = typeof LibraryResource.Type;
export const LibraryProject = Schema.Struct({
  id: LibraryId,
  title: LibraryTitle,
  brief: Schema.String.check(Schema.isMaxLength(65536)),
  revision: PositiveInt,
  resources: Schema.Array(LibraryResource).check(Schema.isMaxLength(64)),
  archived: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type LibraryProject = typeof LibraryProject.Type;
export const LibraryCopyRepository = Schema.Struct({
  resourceId: LibraryId,
  path: Schema.String,
  localProjectId: ProjectId,
  head: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
});
export type LibraryCopyRepository = typeof LibraryCopyRepository.Type;
export const LibraryRecoveryManifest = Schema.Struct({
  version: Schema.Literal(1),
  projectId: LibraryId,
  projectRevision: PositiveInt,
  copyId: LibraryId,
  environmentId: EnvironmentId,
  title: LibraryTitle,
  rootBasename: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  manifestFile: Schema.Literal("loom-working-copy.json"),
});
export type LibraryRecoveryManifest = typeof LibraryRecoveryManifest.Type;
export const LibraryRecoveryMetadata = Schema.Struct({
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  byteLength: PositiveInt,
  archiveKey: Schema.String,
  verifiedAt: IsoDateTime,
});
export type LibraryRecoveryMetadata = typeof LibraryRecoveryMetadata.Type;
export const LibraryRecoveryReceipt = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  copyId: LibraryId,
  ...LibraryRecoveryMetadata.fields,
});
export type LibraryRecoveryReceipt = typeof LibraryRecoveryReceipt.Type;
export const LibraryWorkingCopy = Schema.Struct({
  registered: Schema.optional(Schema.Boolean),
  recovery: Schema.optional(LibraryRecoveryMetadata),
  id: LibraryId,
  projectId: LibraryId,
  projectRevision: PositiveInt,
  environmentId: EnvironmentId,
  rootPath: Schema.String,
  rootLocalProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  repositories: Schema.Array(LibraryCopyRepository),
  ownership: Schema.Literals(["borrowed", "managed"]),
  state: Schema.Literals(["preparing", "ready", "missing", "released", "failed"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type LibraryWorkingCopy = typeof LibraryWorkingCopy.Type;
export const LibraryContinuation = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  sequence: NonNegativeInt,
});
export type LibraryContinuation = typeof LibraryContinuation.Type;
export const LibraryThreadBinding = Schema.Struct({
  continuationOf: Schema.optional(LibraryContinuation),
  projectId: LibraryId,
  projectRevision: PositiveInt,
  workingCopyId: LibraryId,
  environmentId: EnvironmentId,
  resourceIds: Schema.Array(LibraryId),
});
export type LibraryThreadBinding = typeof LibraryThreadBinding.Type;
export const LibraryThreadSummary = Schema.Struct({
  projectRevision: Schema.optional(PositiveInt),
  continuationOf: Schema.optional(LibraryContinuation),
  id: LibraryId,
  projectId: LibraryId,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  localProjectId: ProjectId,
  workingCopyId: Schema.NullOr(LibraryId),
  resourceIds: Schema.Array(LibraryId),
  title: Schema.String,
  status: Schema.String,
  archived: Schema.Boolean,
  deleted: Schema.optional(Schema.Boolean),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  syncedAt: IsoDateTime,
  sequence: NonNegativeInt,
});
export type LibraryThreadSummary = typeof LibraryThreadSummary.Type;
export const LibraryThreadIndex = Schema.Struct({
  threads: Schema.Array(LibraryThreadSummary),
  nextOffset: Schema.NullOr(NonNegativeInt),
});
export type LibraryThreadIndex = typeof LibraryThreadIndex.Type;
export const LibraryThreadArchive = Schema.Struct({
  window: Schema.optional(
    Schema.Struct({
      offset: NonNegativeInt,
      totalItems: NonNegativeInt,
      hasMore: Schema.Boolean,
      nextOffset: Schema.optional(NonNegativeInt),
    }),
  ),
  context: Schema.optional(LibraryProject),
  summary: LibraryThreadSummary,
  projection: OrchestrationV2ThreadProjection,
});
export type LibraryThreadArchive = typeof LibraryThreadArchive.Type;
export const LibraryComputerRegistration = Schema.Struct({
  environmentId: EnvironmentId,
  label: LibraryTitle,
  platform: Schema.Struct({
    os: Schema.String.check(Schema.isMaxLength(32)),
    arch: Schema.String.check(Schema.isMaxLength(32)),
  }),
  appVersion: Schema.String.check(Schema.isMaxLength(160)),
  supportsExecution: Schema.Boolean,
  endpoints: Schema.Array(Schema.String.check(Schema.isMaxLength(2048))).check(
    Schema.isMaxLength(8),
  ),
});
export type LibraryComputerRegistration = typeof LibraryComputerRegistration.Type;
export const LibraryComputer = Schema.Struct({
  ...LibraryComputerRegistration.fields,
  enrolledAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});
export type LibraryComputer = typeof LibraryComputer.Type;
export const LibraryRegisterComputerRequest = Schema.Struct({
  authorityId: LibraryId,
  authorityEpoch: PositiveInt,
  computer: LibraryComputerRegistration,
});
export type LibraryRegisterComputerRequest = typeof LibraryRegisterComputerRequest.Type;
export const LibraryInfo = Schema.Struct({
  isAuthority: Schema.optional(Schema.Boolean),
  computers: Schema.optional(Schema.Array(LibraryComputer)),
  environmentId: EnvironmentId,
  authorityId: LibraryId,
  authorityEpoch: PositiveInt,
  assets: Schema.Literals(["local", "b2", "unconfigured"]),
});
export type LibraryInfo = typeof LibraryInfo.Type;
export class LibraryError extends Schema.TaggedError<LibraryError>()("LibraryError", {
  reason: Schema.Literals([
    "not-authority",
    "context-copy-required",
    "storage-limit",
    "archive-too-large",
    "publisher-unavailable",
    "archive-unverified",
    "not-found",
    "revision-conflict",
    "request-conflict",
    "invalid",
    "sequence-gap",
    "sequence-conflict",
    "blocked",
    "not-managed",
    "io",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    switch (this.reason) {
      case "not-authority":
        return "Use your Library connection to manage shared projects and saved history. This computer only runs your work.";
      case "context-copy-required":
        return "Create a fresh discussion working copy to start this conversation. This folder has no checkpointable project root.";
      case "storage-limit":
        return "Saved history is waiting on this computer until the upload backlog clears or its storage limit is raised.";
      case "archive-too-large":
        return "This recovery archive exceeds 4 GiB. Keep this working copy until its archive can be uploaded.";
      case "publisher-unavailable":
        return "Connect this computer to your Library before removing a managed working copy.";
      case "archive-unverified":
        return "Loom could not verify the recovery archive. Your working copy is preserved; try again.";
      case "not-found":
        return "This project, conversation, or working copy is unavailable.";
      case "revision-conflict":
        return "This project changed. Reload it before saving your edits.";
      case "request-conflict":
        return "This request was already used for a different change.";
      case "invalid":
        return "Review the project resources or working-copy binding before continuing.";
      case "sequence-gap":
        return "Earlier history is still waiting to upload.";
      case "sequence-conflict":
        return "This history does not match the saved source journal.";
      case "blocked":
        return "This working copy is still in use or has work that must be preserved.";
      case "not-managed":
        return "This folder belongs to you. Removing its registration preserves its files.";
      case "io":
        return "Loom could not read or save this data. Try again.";
    }
  }
}
export const LibraryCreateProjectRequest = Schema.Struct({
  requestId: LibraryRequestId,
  title: LibraryTitle,
  brief: Schema.optional(Schema.String.check(Schema.isMaxLength(65536))),
  resources: Schema.optional(Schema.Array(LibraryResource)),
});
export type LibraryCreateProjectRequest = typeof LibraryCreateProjectRequest.Type;
export const LibraryUpdateProjectRequest = Schema.Struct({
  requestId: LibraryRequestId,
  projectId: LibraryId,
  expectedRevision: PositiveInt,
  title: LibraryTitle,
  brief: Schema.String.check(Schema.isMaxLength(65536)),
  resources: Schema.Array(LibraryResource),
});
export type LibraryUpdateProjectRequest = typeof LibraryUpdateProjectRequest.Type;
export const LibraryArchiveProjectRequest = Schema.Struct({
  requestId: LibraryRequestId,
  projectId: LibraryId,
  expectedRevision: PositiveInt,
  archived: Schema.Boolean,
});
export type LibraryArchiveProjectRequest = typeof LibraryArchiveProjectRequest.Type;
export const LibraryRegisterCopyRequest = Schema.Struct({
  authorityId: Schema.optional(LibraryId),
  authorityEpoch: Schema.optional(PositiveInt),
  requestId: LibraryRequestId,
  copy: LibraryWorkingCopy,
});
export type LibraryRegisterCopyRequest = typeof LibraryRegisterCopyRequest.Type;
export const LibraryIngestHistoryRequest = Schema.Struct({
  authorityId: Schema.optional(LibraryId),
  authorityEpoch: Schema.optional(PositiveInt),
  requestId: LibraryRequestId,
  sourceEnvironmentId: EnvironmentId,
  journalId: LibraryId,
  fromSequence: NonNegativeInt,
  entries: Schema.Array(
    Schema.Struct({ sequence: PositiveInt, thread: LibraryThreadArchive }),
  ).check(Schema.isMaxLength(100)),
});
export type LibraryIngestHistoryRequest = typeof LibraryIngestHistoryRequest.Type;
export const LibraryIngestHistoryResult = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  journalId: LibraryId,
  lastSequence: NonNegativeInt,
  applied: NonNegativeInt,
});
export type LibraryIngestHistoryResult = typeof LibraryIngestHistoryResult.Type;
export const LibraryImportShadowRequest = Schema.Struct({
  authorityId: Schema.optional(LibraryId),
  authorityEpoch: Schema.optional(PositiveInt),
  requestId: LibraryRequestId,
  sourceEnvironmentId: EnvironmentId,
  journalId: LibraryId,
  projects: Schema.Array(LibraryProject),
  copies: Schema.Array(LibraryWorkingCopy),
  threads: Schema.Array(LibraryThreadArchive),
  throughSequence: NonNegativeInt,
});
export type LibraryImportShadowRequest = typeof LibraryImportShadowRequest.Type;
export const LibraryImportReceipt = Schema.Struct({
  requestId: LibraryRequestId,
  projects: NonNegativeInt,
  copies: NonNegativeInt,
  threads: NonNegativeInt,
  throughSequence: NonNegativeInt,
  verified: Schema.Boolean,
  logicalRecordsVerified: Schema.optional(Schema.Boolean),
  referencedAssets: Schema.optional(NonNegativeInt),
  missingAssets: Schema.optional(NonNegativeInt),
  assetBytesVerified: Schema.optional(Schema.Boolean),
});
export type LibraryImportReceipt = typeof LibraryImportReceipt.Type;
export const LibraryInspectFolderRequest = Schema.Struct({ rootPath: Schema.String });
export type LibraryInspectFolderRequest = typeof LibraryInspectFolderRequest.Type;
export const LibraryFolderInspection = Schema.Struct({
  rootPath: Schema.String,
  exists: Schema.Boolean,
  repositories: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      relativePath: Schema.String,
      remoteUrl: Schema.NullOr(Schema.String),
      head: Schema.NullOr(Schema.String),
      branch: Schema.NullOr(Schema.String),
    }),
  ),
});
export type LibraryFolderInspection = typeof LibraryFolderInspection.Type;
export const LibraryPrepareCopyRequest = Schema.Struct({
  requestId: LibraryRequestId,
  project: LibraryProject,
  rootPath: Schema.String,
  strategy: Schema.Literals(["reuse", "clone"]),
  resourceIds: Schema.optional(Schema.Array(LibraryId)),
});
export type LibraryPrepareCopyRequest = typeof LibraryPrepareCopyRequest.Type;
export const LibraryCopyStatus = Schema.Struct({
  copy: LibraryWorkingCopy,
  blockers: Schema.Array(Schema.String),
  reviewToken: Schema.NullOr(Schema.String),
});
export type LibraryCopyStatus = typeof LibraryCopyStatus.Type;
export const LibraryReleaseCopyRequest = Schema.Struct({
  requestId: LibraryRequestId,
  workingCopyId: LibraryId,
  reviewToken: Schema.String,
});
export type LibraryReleaseCopyRequest = typeof LibraryReleaseCopyRequest.Type;
export const LibraryResolveBindingRequest = Schema.Struct({
  binding: LibraryThreadBinding,
  project: Schema.optional(LibraryProject),
});
export type LibraryResolveBindingRequest = typeof LibraryResolveBindingRequest.Type;
export const LibraryResolvedBinding = Schema.Struct({
  project: Schema.optional(LibraryProject),
  cwd: Schema.String,
  localProjectId: ProjectId,
  repositoryPaths: Schema.Array(Schema.String),
  binding: LibraryThreadBinding,
});
export type LibraryResolvedBinding = typeof LibraryResolvedBinding.Type;
export const LibraryReplicationStatus = Schema.Struct({
  enabled: Schema.Boolean,
  journalId: Schema.NullOr(Schema.String),
  acknowledgedSequence: NonNegativeInt,
  pendingEntries: NonNegativeInt,
  pendingBytes: Schema.optional(NonNegativeInt),
  maxPendingBytes: Schema.optional(PositiveInt),
  lastFailure: Schema.NullOr(LibraryError.fields.reason),
  threads: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      queuedSequence: NonNegativeInt,
      acknowledgedSequence: NonNegativeInt,
      currentSequence: NonNegativeInt,
      pending: Schema.Boolean,
    }),
  ),
});
export type LibraryReplicationStatus = typeof LibraryReplicationStatus.Type;
export const LIBRARY_WS_METHODS = {
  subscribeRefreshes: "loom.library.subscribe-refreshes",
  replicationStatus: "loom.library.replication-status",
  flushHistory: "loom.library.flush-history",
  preparation: "loom.library.preparation",
  snapshotThread: "loom.library.snapshot-thread",
  registerThread: "loom.library.register-thread",
  info: "loom.library.info",
  projects: "loom.library.projects",
  project: "loom.library.project",
  createProject: "loom.library.create-project",
  updateProject: "loom.library.update-project",
  archiveProject: "loom.library.archive-project",
  registerCopy: "loom.library.register-copy",
  copies: "loom.library.copies",
  threads: "loom.library.threads",
  threadIndex: "loom.library.thread-index",
  threadBinding: "loom.library.thread-binding",
  lookupThread: "loom.library.lookup-thread",
  history: "loom.library.history",
  ingestHistory: "loom.library.ingest-history",
  importShadow: "loom.library.import-shadow",
  verifyImport: "loom.library.verify-import",
  inspectFolder: "loom.library.inspect-folder",
  prepareCopy: "loom.library.prepare-copy",
  copyStatus: "loom.library.copy-status",
  unregisterCopy: "loom.library.unregister-copy",
  releaseCopy: "loom.library.release-copy",
  resolveBinding: "loom.library.resolve-binding",
  bindThread: "loom.library.bind-thread",
} as const;
const error = Schema.Union([LibraryError, EnvironmentAuthorizationError]);
export const ProjectLibraryRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_WS_METHODS.subscribeRefreshes, {
    payload: Schema.Struct({}),
    success: NonNegativeInt,
    error,
    stream: true,
  }),
  Rpc.make(LIBRARY_WS_METHODS.replicationStatus, {
    payload: Schema.Struct({}),
    success: LibraryReplicationStatus,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.flushHistory, {
    payload: Schema.Struct({}),
    success: LibraryReplicationStatus,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.preparation, {
    payload: Schema.Struct({ requestId: LibraryRequestId }),
    success: Schema.NullOr(LibraryWorkingCopy),
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.snapshotThread, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: LibraryThreadArchive,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.registerThread, {
    payload: Schema.Struct({ requestId: LibraryRequestId, thread: LibraryThreadArchive }),
    success: LibraryThreadSummary,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.info, { payload: Schema.Struct({}), success: LibraryInfo, error }),
  Rpc.make(LIBRARY_WS_METHODS.lookupThread, {
    payload: Schema.Struct({ sourceEnvironmentId: EnvironmentId, threadId: ThreadId }),
    success: Schema.NullOr(LibraryThreadSummary),
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.threadIndex, {
    payload: Schema.Struct({
      offset: Schema.optional(NonNegativeInt),
      limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
    }),
    success: LibraryThreadIndex,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.threadBinding, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: Schema.NullOr(LibraryThreadBinding),
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.projects, {
    payload: Schema.Struct({ includeArchived: Schema.optional(Schema.Boolean) }),
    success: Schema.Array(LibraryProject),
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.project, {
    payload: Schema.Struct({ projectId: LibraryId }),
    success: LibraryProject,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.createProject, {
    payload: LibraryCreateProjectRequest,
    success: LibraryProject,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.updateProject, {
    payload: LibraryUpdateProjectRequest,
    success: LibraryProject,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.archiveProject, {
    payload: LibraryArchiveProjectRequest,
    success: LibraryProject,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.registerCopy, {
    payload: LibraryRegisterCopyRequest,
    success: LibraryWorkingCopy,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.copies, {
    payload: Schema.Struct({
      projectId: Schema.optional(LibraryId),
      includeReleased: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Array(LibraryWorkingCopy),
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.threads, {
    payload: Schema.Struct({ projectId: LibraryId }),
    success: Schema.Array(LibraryThreadSummary),
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.history, {
    payload: Schema.Struct({
      id: LibraryId,
      offset: Schema.optional(NonNegativeInt),
      limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
    }),
    success: LibraryThreadArchive,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.ingestHistory, {
    payload: LibraryIngestHistoryRequest,
    success: LibraryIngestHistoryResult,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.importShadow, {
    payload: LibraryImportShadowRequest,
    success: LibraryImportReceipt,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.verifyImport, {
    payload: Schema.Struct({ requestId: LibraryRequestId }),
    success: LibraryImportReceipt,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.inspectFolder, {
    payload: LibraryInspectFolderRequest,
    success: LibraryFolderInspection,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.prepareCopy, {
    payload: LibraryPrepareCopyRequest,
    success: LibraryWorkingCopy,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.copyStatus, {
    payload: Schema.Struct({ workingCopyId: LibraryId }),
    success: LibraryCopyStatus,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.unregisterCopy, {
    payload: LibraryReleaseCopyRequest,
    success: LibraryWorkingCopy,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.releaseCopy, {
    payload: LibraryReleaseCopyRequest,
    success: LibraryWorkingCopy,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.resolveBinding, {
    payload: LibraryResolveBindingRequest,
    success: LibraryResolvedBinding,
    error,
  }),
  Rpc.make(LIBRARY_WS_METHODS.bindThread, {
    payload: Schema.Struct({
      threadId: ThreadId,
      binding: LibraryThreadBinding,
      project: Schema.optional(LibraryProject),
    }),
    success: LibraryResolvedBinding,
    error,
  }),
);
