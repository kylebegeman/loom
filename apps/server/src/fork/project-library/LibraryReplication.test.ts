import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  LibraryError,
  type LibraryIngestHistoryRequest,
  type LibraryProject,
  type LibraryResolvedBinding,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { ServerActivation } from "../../serverActivation.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as HistorySource from "./LibraryHistorySource.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as Replication from "./LibraryReplication.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import {
  source,
  threadId,
  localProjectId,
  resource,
  copyFor,
  archiveFor,
} from "./Library.testkit.ts";

const project: LibraryProject = {
  id: "independent-project",
  title: "AspectAvy",
  brief: "",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const copy = copyFor(project);
const resolved: LibraryResolvedBinding = {
  cwd: copy.rootPath,
  localProjectId,
  repositoryPaths: copy.repositories.map((repo) => repo.path),
  binding: {
    projectId: project.id,
    projectRevision: 1,
    workingCopyId: copy.id,
    environmentId: source,
    resourceIds: [resource.id],
  },
};
const receipt: WorkspaceStore.WorkspaceReceipt = {
  requestId: "copy",
  fingerprint: "copy",
  project,
  copy,
  rootLocalProjectId: localProjectId,
  rootCheckpointRepository: true,
  legacyThreadIds: [],
  rootIdentity: null,
  releaseRequestId: null,
  releaseReviewToken: null,
  removalPath: null,
  archivePath: null,
  archiveDigest: null,
};
const workspace = WorkspaceStore.LibraryWorkspaceStore.of({
  receipts: Effect.succeed([receipt]),
  bindings: Effect.succeed([{ threadId, resolved }]),
  get: () => Effect.succeed(receipt),
  getBinding: () => Effect.succeed(resolved),
  getBoundProject: () => Effect.succeed(project),
  put: () => Effect.void,
  importBindings: () => Effect.void,
  bind: () => Effect.void,
  repositoriesForRoot: () => Effect.succeed([]),
  validateThreadCwd: (input) => Effect.succeed(input.cwd),
});
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const sql = yield* SqlClient.SqlClient;
  const archive = yield* Ref.make(yield* archiveFor(project, 1));
  const snapshots = yield* Ref.make(0);
  const requests = yield* Ref.make<LibraryIngestHistoryRequest[]>([]);
  const order = yield* Ref.make<string[]>([]);
  const failAck = yield* Ref.make(false);
  const failAssets = yield* Ref.make(false);
  const claimedCursor = yield* Ref.make<number | null>(null);
  const authority = yield* Ref.make({
    environmentId: source,
    authorityId: "authority",
    authorityEpoch: 1,
    assets: "local" as const,
  });
  const publisher = Publisher.LibraryPublisher.of({
    enabled: true,
    info: Ref.get(authority),
    registerCopy: (input) =>
      Ref.update(order, (steps) => [...steps, "copy"]).pipe(Effect.as(input.copy)),
    publishAttachments: () =>
      Effect.gen(function* () {
        yield* Ref.update(order, (steps) => [...steps, "assets"]);
        if (yield* Ref.get(failAssets)) return yield* new LibraryError({ reason: "io" });
      }),
    ingest: (input) =>
      Effect.gen(function* () {
        yield* Ref.update(order, (steps) => [...steps, "history"]);
        yield* Ref.update(requests, (saved) => [...saved, input]);
        if (yield* Ref.get(failAck)) return yield* new LibraryError({ reason: "io" });
        return {
          sourceEnvironmentId: source,
          journalId: input.journalId,
          lastSequence: (yield* Ref.get(claimedCursor)) ?? input.entries.at(-1)!.sequence,
          applied: input.entries.length,
        };
      }),
  });
  const serviceLayer = Replication.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Publisher.LibraryPublisher, publisher),
        Layer.succeed(HistorySource.LibraryHistorySource, {
          snapshotThread: () =>
            Ref.update(snapshots, (count) => count + 1).pipe(Effect.andThen(Ref.get(archive))),
        }),
        Layer.succeed(WorkspaceStore.LibraryWorkspaceStore, workspace),
        Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
      ),
    ),
  );
  const restart = Replication.LibraryReplication.pipe(Effect.provide(Layer.fresh(serviceLayer)));
  const service = yield* restart;
  const event = (sequence: number, eventType: string, payload: string) =>
    sql`INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json) VALUES (${sequence},${`event-${sequence}`},${sequence},'2026-10-15T00:00:00.000Z','server','{}',2,'thread',${threadId},${eventType},${payload})`;
  return {
    service,
    restart,
    sql,
    archive,
    snapshots,
    requests,
    order,
    failAck,
    failAssets,
    claimedCursor,
    authority,
    event,
  };
});
const run = <A, E, R>(use: (state: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const state = yield* fixture;
    return yield* use(state);
  }).pipe(
    Effect.provideService(ServerActivation, Effect.never),
    Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

describe("durable Library history replication", () => {
  it.effect("replays a persisted batch after a lost acknowledgement and host restart", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* Ref.set(f.failAck, true);
        expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("io");
        const pending = yield* f.service.status;
        expect(pending).toMatchObject({
          pendingEntries: 1,
          acknowledgedSequence: 0,
          lastFailure: "io",
        });
        expect(pending.threads[0]?.pending).toBe(true);
        const first = (yield* Ref.get(f.requests))[0]!;
        yield* Ref.set(f.failAck, false);
        const restarted = yield* f.restart;
        yield* restarted.drain;
        expect((yield* Ref.get(f.requests))[1]).toEqual(first);
        expect(yield* restarted.status).toMatchObject({
          journalId: first.journalId,
          pendingEntries: 0,
          acknowledgedSequence: 1,
        });
        expect((yield* restarted.status).threads[0]).toMatchObject({
          acknowledgedSequence: 1,
          pending: false,
        });
      }),
    ),
  );
  it.effect(
    "keeps attachments pending and publishes them before acknowledging conversation history",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* f.event(1, "thread.created", "{}");
          yield* Ref.set(f.failAssets, true);
          expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("io");
          expect(yield* Ref.get(f.requests)).toEqual([]);
          expect((yield* f.service.status).pendingEntries).toBe(1);
          yield* Ref.set(f.failAssets, false);
          yield* Ref.set(f.order, []);
          yield* f.service.drain;
          expect(yield* Ref.get(f.order)).toEqual(["copy", "assets", "history"]);
          expect((yield* f.service.status).pendingEntries).toBe(0);
        }),
      ),
  );
  it.effect("scans token events cheaply and snapshots once at the committed milestone", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        const count = yield* Ref.get(f.snapshots);
        yield* f.event(2, "message.updated", '{"streaming":true}');
        yield* f.event(3, "turn-item.updated", '{"type":"assistant_message","streaming":true}');
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 3 },
        }));
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(count);
        expect((yield* f.service.status).threads[0]).toMatchObject({
          currentSequence: 3,
          acknowledgedSequence: 1,
          pending: true,
        });
        yield* f.event(4, "message.updated", '{"streaming":false}');
        yield* f.event(5, "checkpoint.captured", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 5 },
        }));
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(count + 1);
        expect((yield* Ref.get(f.requests)).at(-1)?.entries[0]?.thread.summary.sequence).toBe(5);
      }),
    ),
  );
  it.effect(
    "does not acknowledge beyond the submitted batch even when the server cursor is ahead",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* f.event(1, "thread.created", "{}");
          yield* Ref.set(f.claimedCursor, 99);
          yield* f.service.drain;
          expect((yield* f.service.status).acknowledgedSequence).toBe(1);
        }),
      ),
  );
  it.effect("fences an authority change from previously acknowledged host history", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* Ref.update(f.authority, (authority) => ({
          ...authority,
          authorityId: "different-authority",
        }));
        expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("blocked");
        expect(yield* Ref.get(f.requests)).toHaveLength(1);
        expect((yield* f.service.status).lastFailure).toBe("blocked");
      }),
    ),
  );
  it.effect(
    "retains the event watermark at the journal limit while allowing pending entries to upload",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* f.event(1, "thread.created", "{}");
          yield* f.service.drain;
          yield* f.event(2, "message.updated", '{"streaming":false}');
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 2 },
            projection: {
              ...archive.projection,
              messages: [{ ...archive.projection.messages[0]!, text: "x".repeat(2000) }],
            },
          }));
          yield* Ref.set(f.failAck, true);
          expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("io");
          yield* f.event(3, "message.updated", '{"streaming":false}');
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 3 },
          }));
          yield* Ref.set(f.failAck, false);
          expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect(yield* f.service.status).toMatchObject({
            pendingEntries: 0,
            pendingBytes: 0,
            maxPendingBytes: 5000,
            lastFailure: "storage-limit",
          });
          expect(
            yield* f.sql<{
              scan_sequence: number;
            }>`SELECT scan_sequence FROM fork_library_source_state`,
          ).toMatchObject([{ scan_sequence: 2 }]);
          expect((yield* f.service.status).threads[0]?.pending).toBe(true);
          yield* f.service.drain;
          expect((yield* f.service.status).threads[0]).toMatchObject({
            currentSequence: 3,
            acknowledgedSequence: 3,
            pending: false,
          });
        }),
      ).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_MAX_PENDING_BYTES: "5000" } }),
          ),
        ),
      ),
  );
  it.effect("does not report a pending conversation after navigation-only events", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* f.event(2, "thread.visited", "{}");
        yield* f.event(3, "thread.active-reordered", "{}");
        yield* f.service.drain;
        expect((yield* f.service.status).threads[0]).toMatchObject({
          currentSequence: 1,
          acknowledgedSequence: 1,
          pending: false,
        });
      }),
    ),
  );
  it.effect("does no database work when replication is disabled", () =>
    Effect.gen(function* () {
      const publisher = Publisher.LibraryPublisher.of({
        enabled: false,
        info: Effect.fail(new LibraryError({ reason: "blocked" })),
        ingest: () => Effect.fail(new LibraryError({ reason: "blocked" })),
        registerCopy: () => Effect.fail(new LibraryError({ reason: "blocked" })),
        publishAttachments: () => Effect.void,
      });
      const disabled = yield* Replication.LibraryReplication.pipe(
        Effect.provide(Replication.layer),
        Effect.provideService(Publisher.LibraryPublisher, publisher),
      );
      yield* disabled.drain;
      expect(yield* disabled.status).toMatchObject({ enabled: false, pendingEntries: 0 });
    }).pipe(
      Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.provideService(HistorySource.LibraryHistorySource, {
        snapshotThread: () => Effect.fail(new LibraryError({ reason: "not-found" })),
      }),
      Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, workspace),
      Effect.provideService(ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(source),
      }),
      Effect.scoped,
    ),
  );
});
