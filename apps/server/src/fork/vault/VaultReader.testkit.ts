import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import { OrchestratorProjectionError } from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";

/** A file database, so reads marked readOnly really use the reader worker. */
export const readerDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "vault-reader-" });
    return ProjectionStore.layer.pipe(
      Layer.provideMerge(SqlitePersistence.layerFromPath(path.join(directory, "statev2.sqlite"))),
    );
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

/** Thread reads straight from the projections, without the legacy transcript step. */
export const projectionThreads = Layer.unwrap(
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    return Layer.mock(ThreadManagementService)({
      getThreadShell: (threadId) =>
        projections
          .getThreadShell(threadId)
          .pipe(Effect.mapError((cause) => new OrchestratorProjectionError({ threadId, cause }))),
      getThreadRecords: (threadId, fields, filter) =>
        projections
          .getThreadRecords(threadId, fields, filter)
          .pipe(Effect.mapError((cause) => new OrchestratorProjectionError({ threadId, cause }))),
    });
  }),
);

export const readerThreadId = ThreadId.make("vault-reader-thread");
export const readerRunId = RunId.make("vault-reader-run");
const readerProjectId = ProjectId.make("vault-reader-project");
const providerInstanceId = ProviderInstanceId.make("codex");
const at = DateTime.makeUnsafe(Date.UTC(2026, 9, 24));

export const createReaderThread = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  yield* projections.apply({
    id: EventId.make("vault-reader:thread"),
    type: "thread.created",
    threadId: readerThreadId,
    providerInstanceId,
    occurredAt: at,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: readerThreadId,
      projectId: readerProjectId,
      title: "Vault reader",
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: readerThreadId },
      forkedFrom: null,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
});

export const updateReaderRun = (status: OrchestrationV2RunStatus) =>
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* projections.apply({
      id: EventId.make(`vault-reader:run:${status}`),
      type: "run.updated",
      threadId: readerThreadId,
      runId: readerRunId,
      providerInstanceId,
      occurredAt: at,
      payload: {
        id: readerRunId,
        threadId: readerThreadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
        providerThreadId: null,
        userMessageId: MessageId.make("vault-reader-message"),
        rootNodeId: null,
        activeAttemptId: null,
        status,
        requestedAt: at,
        startedAt: at,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    });
  });

/**
 * Opens a write transaction and keeps the writer until `use` finishes, so anything in `use`
 * that still needs the writer never completes.
 */
export const whileWriterHeld = <A, E, R>(use: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const held = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const writer = yield* sql
      .withTransaction(
        Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(held);
    const result = yield* use;
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(writer);
    return result;
  });
