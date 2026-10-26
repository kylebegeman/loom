import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import type {
  LibraryThreadArchive,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { WorkspaceReceipt } from "./LibraryWorkspaceStore.ts";

export const source = EnvironmentId.make("source-computer");
export const localProjectId = ProjectId.make("old-folder-project");
export const threadId = ThreadId.make("source-thread");
export const resource = {
  id: "api",
  title: "API",
  remoteUrl: "https://github.com/example/api.git",
  relativePath: "api",
  defaultBranch: "main",
};
export const copyFor = (project: LibraryProject): LibraryWorkingCopy => ({
  id: "copy",
  projectId: project.id,
  projectRevision: project.revision,
  environmentId: source,
  rootPath: "/borrowed/aspectavy",
  repositories: [
    {
      resourceId: resource.id,
      path: "/borrowed/aspectavy/api",
      localProjectId,
      head: "abc",
      branch: "main",
    },
  ],
  ownership: "borrowed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});
/** A managed copy's receipt with no repositories, holding `rootPath` until it is released. */
export const receiptFor = (
  id: string,
  rootPath: string,
  state: WorkspaceReceipt["copy"]["state"],
): WorkspaceReceipt => ({
  requestId: id,
  fingerprint: id,
  project: {
    id: `project-${id}`,
    revision: 1,
    title: id,
    brief: "",
    resources: [],
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  copy: {
    id,
    projectId: `project-${id}`,
    projectRevision: 1,
    environmentId: source,
    rootPath,
    repositories: [],
    ownership: "managed",
    state,
    keepOnComputer: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  rootLocalProjectId: null,
  rootCheckpointRepository: false,
  legacyThreadIds: [],
  rootIdentity: null,
  releaseRequestId: null,
  releaseReviewToken: null,
  removalPath: null,
  archivePath: null,
  archiveDigest: null,
});
export const archiveFor = Effect.fnUntraced(function* (project: LibraryProject, sequence = 1) {
  const timestamp = yield* DateTime.now;
  const projection: OrchestrationV2ThreadProjection = {
    thread: {
      id: threadId,
      projectId: localProjectId,
      title: "Work on API",
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: timestamp,
    messages: [
      {
        id: MessageId.make("message"),
        threadId,
        runId: null,
        nodeId: null,
        role: "user",
        text: "Preserve this complete conversation while the computer is offline.",
        attachments: [],
        streaming: false,
        createdBy: "user",
        creationSource: "web",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
  return {
    summary: {
      id: "archive-thread",
      projectId: project.id,
      environmentId: source,
      threadId,
      localProjectId,
      workingCopyId: "copy",
      resourceIds: ["api"],
      title: projection.thread.title,
      status: "ready",
      archived: false,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      syncedAt: project.updatedAt,
      sequence,
    },
    projection,
  } satisfies LibraryThreadArchive;
});
