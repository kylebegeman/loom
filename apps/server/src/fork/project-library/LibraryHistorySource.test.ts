import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, EventId } from "@t3tools/contracts";
import { type LibraryProject, type LibraryResolvedBinding } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { isWithheldError } from "../deleted-history/deletedHistory.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import * as HistorySource from "./LibraryHistorySource.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import { source, threadId, localProjectId, resource, archiveFor } from "./Library.testkit.ts";

const project: LibraryProject = {
  id: "central-project",
  title: "AspectAvy",
  brief: "Work across the repositories.",
  revision: 2,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const resolved: LibraryResolvedBinding = {
  cwd: "/workspace",
  localProjectId,
  repositoryPaths: ["/workspace/api"],
  binding: {
    projectId: project.id,
    projectRevision: project.revision,
    workingCopyId: "copy",
    environmentId: source,
    resourceIds: [resource.id],
  },
};
const run = <A, E, R>(
  use: (fixture: {
    service: HistorySource.LibraryHistorySource["Service"];
    restart: Effect.Effect<
      HistorySource.LibraryHistorySource["Service"],
      never,
      import("effect/Crypto").Crypto | ProjectionStore.ProjectionStoreV2 | SqlClient.SqlClient
    >;
    binding: Ref.Ref<LibraryResolvedBinding | null>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const archive = yield* archiveFor(project);
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* projections.apply({
      id: EventId.make("thread-created"),
      threadId,
      type: "thread.created",
      payload: archive.projection.thread,
      occurredAt: archive.projection.updatedAt,
    });
    yield* projections.apply({
      id: EventId.make("message-created"),
      threadId,
      type: "message.updated",
      payload: archive.projection.messages[0]!,
      occurredAt: archive.projection.updatedAt,
    });
    const binding = yield* Ref.make<LibraryResolvedBinding | null>(resolved);
    const store = Layer.mock(WorkspaceStore.LibraryWorkspaceStore)({
      getBinding: () => Ref.get(binding),
      getBoundProject: () => Effect.succeed(project),
    });
    const serviceLayer = HistorySource.layer.pipe(
      Layer.provide(store),
      Layer.provide(
        Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
      ),
    );
    const restart = HistorySource.LibraryHistorySource.pipe(
      Effect.provide(Layer.fresh(serviceLayer)),
    );
    const service = yield* restart;
    return yield* use({ service, restart, binding });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ProjectionStore.layerMemory,
        SqlitePersistence.layerMemory,
        NodeServices.layer,
      ),
    ),
    Effect.scoped,
  );

describe("execution host Library snapshots", () => {
  it.effect(
    "retains native identifiers, full body, bound context, and atomic event watermark",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const snapshot = yield* f.service.snapshotThread({ threadId });
          expect(snapshot.summary).toMatchObject({
            projectId: project.id,
            projectRevision: 2,
            environmentId: source,
            threadId,
            localProjectId,
            workingCopyId: "copy",
            resourceIds: [resource.id],
            archived: false,
            settled: false,
            sequence: 2,
          });
          expect(snapshot.context).toEqual(project);
          expect(snapshot.projection.messages[0]?.text).toContain("complete conversation");
          expect(snapshot.projection.thread.projectId).toBe(localProjectId);
          const restarted = yield* f.restart;
          expect((yield* restarted.snapshotThread({ threadId })).summary.id).toBe(
            snapshot.summary.id,
          );
        }),
      ),
  );
  it.effect("saves whether the conversation was settled", () =>
    run((f) =>
      Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const { projection } = yield* projections.getThreadSnapshot(threadId);
        yield* projections.apply({
          id: EventId.make("thread-settled"),
          threadId,
          type: "thread.settled",
          payload: {
            ...projection.thread,
            settledOverride: "settled",
            settledAt: projection.updatedAt,
          },
          occurredAt: projection.updatedAt,
        });
        expect((yield* f.service.snapshotThread({ threadId })).summary.settled).toBe(true);
      }),
    ),
  );
  it.effect("refuses unbound legacy threads and mismatched host bindings", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.binding, null);
        expect((yield* f.service.snapshotThread({ threadId }).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
        yield* Ref.set(f.binding, {
          ...resolved,
          binding: { ...resolved.binding, environmentId: EnvironmentId.make("different-host") },
        });
        expect((yield* f.service.snapshotThread({ threadId }).pipe(Effect.flip)).reason).toBe(
          "invalid",
        );
      }),
    ),
  );
  it.effect(
    "withholds a deleted conversation once the Library holds its deletion or it was purged",
    () =>
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        const sql = yield* SqlClient.SqlClient;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const archive = yield* archiveFor(project);
        const event = (sequence: number, eventType: string) =>
          sql`INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json) VALUES (${sequence},${`event-${sequence}`},${sequence},'2026-10-15T00:00:00.000Z','server','{}',2,'thread',${threadId},${eventType},'{}')`;
        yield* projections.apply({
          id: EventId.make("thread-created"),
          threadId,
          type: "thread.created",
          payload: archive.projection.thread,
          occurredAt: archive.projection.updatedAt,
        });
        yield* projections.apply({
          id: EventId.make("message-created"),
          threadId,
          type: "message.updated",
          payload: archive.projection.messages[0]!,
          occurredAt: archive.projection.updatedAt,
        });
        yield* projections.apply({
          id: EventId.make("thread-deleted"),
          threadId,
          type: "thread.deleted",
          payload: { ...archive.projection.thread, deletedAt: archive.projection.updatedAt },
          occurredAt: archive.projection.updatedAt,
        });
        yield* event(1, "thread.created");
        yield* event(2, "message.updated");
        yield* event(3, "thread.deleted");
        const service = yield* HistorySource.LibraryHistorySource.pipe(
          Effect.provide(
            HistorySource.layer.pipe(
              Layer.provide(
                Layer.mock(WorkspaceStore.LibraryWorkspaceStore)({
                  getBinding: () => Effect.succeed(resolved),
                  getBoundProject: () => Effect.succeed(project),
                }),
              ),
              Layer.provide(
                Layer.succeed(ServerEnvironmentIdentity, {
                  getEnvironmentId: Effect.succeed(source),
                }),
              ),
            ),
          ),
        );
        const withheld = service.snapshotThread({ threadId }).pipe(
          Effect.flip,
          Effect.map(isWithheldError),
          Effect.orElseSucceed(() => false),
        );
        // The deletion itself still goes up while the Library has not acknowledged it.
        expect((yield* service.snapshotThread({ threadId })).summary.deleted).toBe(true);
        yield* sql`INSERT INTO fork_library_source_threads (thread_id,queued_sequence,acknowledged_sequence) VALUES (${threadId},2,2)`;
        expect(yield* withheld).toBe(false);
        yield* sql`UPDATE fork_library_source_threads SET acknowledged_sequence=3`;
        expect(yield* withheld).toBe(true);
        // A purged history stays withheld even when replication starts over without its rows.
        yield* sql`DELETE FROM fork_library_source_threads`;
        expect(yield* withheld).toBe(false);
        yield* sql`DELETE FROM orchestration_events WHERE sequence=2`;
        expect(yield* withheld).toBe(true);
      }).pipe(
        Effect.provide(
          ProjectionStore.layer.pipe(
            Layer.provideMerge(SqlitePersistence.layerMemory),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
        Effect.scoped,
      ),
  );
  it.effect("sends the deletion of a conversation that never had more than its creation", () =>
    Effect.gen(function* () {
      yield* runForkMigrationSet(ProjectLibraryMigrations);
      const sql = yield* SqlClient.SqlClient;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const thread = (yield* archiveFor(project)).projection.thread;
      yield* projections.apply({
        id: EventId.make("thread-created"),
        threadId,
        type: "thread.created",
        payload: thread,
        occurredAt: thread.createdAt,
      });
      yield* projections.apply({
        id: EventId.make("thread-deleted"),
        threadId,
        type: "thread.deleted",
        payload: { ...thread, deletedAt: thread.createdAt },
        occurredAt: thread.createdAt,
      });
      yield* sql`INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json) VALUES
        (1,'created',0,'2026-10-15T00:00:00.000Z','server','{}',2,'thread',${threadId},'thread.created','{}'),
        (2,'deleted',1,'2026-10-15T00:00:00.000Z','server','{}',2,'thread',${threadId},'thread.deleted','{}')`;
      const service = yield* HistorySource.LibraryHistorySource.pipe(
        Effect.provide(
          HistorySource.layer.pipe(
            Layer.provide(
              Layer.mock(WorkspaceStore.LibraryWorkspaceStore)({
                getBinding: () => Effect.succeed(resolved),
                getBoundProject: () => Effect.succeed(project),
              }),
            ),
            Layer.provide(
              Layer.succeed(ServerEnvironmentIdentity, {
                getEnvironmentId: Effect.succeed(source),
              }),
            ),
          ),
        ),
      );
      // Not yet received by the Library, and received only while it was live.
      expect((yield* service.snapshotThread({ threadId })).summary.deleted).toBe(true);
      yield* sql`INSERT INTO fork_library_source_threads (thread_id,queued_sequence,acknowledged_sequence) VALUES (${threadId},1,1)`;
      expect((yield* service.snapshotThread({ threadId })).summary.deleted).toBe(true);
    }).pipe(
      Effect.provide(
        ProjectionStore.layer.pipe(
          Layer.provideMerge(SqlitePersistence.layerMemory),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
  );
});
