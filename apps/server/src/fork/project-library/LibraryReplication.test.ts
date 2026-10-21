import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it, vi } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryCopyHealth,
  type LibraryIngestHistoryRequest,
  type LibraryProject,
  type LibraryRegisterCopyRequest,
  type LibraryResolvedBinding,
  type LibraryThreadArchive,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { ServerActivation } from "../../serverActivation.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as CopyHealth from "./LibraryCopyHealthPublication.ts";
import * as HistorySource from "./LibraryHistorySource.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as Replication from "./LibraryReplication.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as Workspace from "./LibraryWorkspace.ts";
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
const health: LibraryCopyHealth = {
  copyId: copy.id,
  environmentId: source,
  checkedAt: "2026-10-16T00:00:00.000Z",
  repositories: [
    {
      resourceId: resource.id,
      branch: "main",
      uncommittedFiles: 2,
      unpushedCommits: 0,
      checkedAt: "2026-10-16T00:00:00.000Z",
    },
  ],
};
const healthSource = CopyHealth.LibraryCopyHealthSource.of({
  read: () => Effect.succeed(health),
  changes: () => Stream.empty,
});
const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const sql = yield* SqlClient.SqlClient;
  const archive = yield* Ref.make<LibraryThreadArchive>(yield* archiveFor(project, 1));
  const snapshots = yield* Ref.make(0);
  const requests = yield* Ref.make<LibraryIngestHistoryRequest[]>([]);
  const order = yield* Ref.make<string[]>([]);
  const registered = yield* Ref.make<LibraryRegisterCopyRequest[]>([]);
  const failAck = yield* Ref.make(false);
  const failAssets = yield* Ref.make(false);
  const failSnapshot = yield* Ref.make(false);
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
      Ref.update(order, (steps) => [...steps, "copy"]).pipe(
        Effect.andThen(Ref.update(registered, (requests) => [...requests, input])),
        Effect.as(input.copy),
      ),
    recordActivity: () => Effect.fail(new LibraryError({ reason: "blocked" })),
    project: () => Effect.die("unused"),
    proposeBrief: () => Effect.die("unused"),
    registerPreviews: () => Effect.die("unused"),
    publishPage: () => Effect.die("unused"),
    listPages: () => Effect.die("unused"),
    updatePage: () => Effect.die("unused"),
    nextReplies: () => Effect.die("unused"),
    ackReply: () => Effect.die("unused"),
    signOutPageReaders: () => Effect.die("unused"),
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
            Effect.gen(function* () {
              if (yield* Ref.get(failSnapshot)) return yield* new LibraryError({ reason: "io" });
              yield* Ref.update(snapshots, (count) => count + 1);
              return yield* Ref.get(archive);
            }),
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
    publisher,
    sql,
    archive,
    snapshots,
    requests,
    order,
    registered,
    failAck,
    failAssets,
    failSnapshot,
    claimedCursor,
    authority,
    event,
  };
});
const withText = (archive: LibraryThreadArchive, text: string): LibraryThreadArchive => ({
  ...archive,
  projection: {
    ...archive.projection,
    messages: [{ ...archive.projection.messages[0]!, text }],
  },
});
// About 600 KiB, so each snapshot waits two seconds before the next.
const longText = "x".repeat(600 * 1024);
// A service over several bound conversations sharing the fixture's publisher.
const serviceFor = (
  f: Effect.Success<typeof fixture>,
  threadIds: readonly ThreadId[],
  snapshotThread: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<LibraryThreadArchive, LibraryError>,
) =>
  Replication.LibraryReplication.pipe(
    Effect.provide(Replication.layer),
    Effect.provideService(Publisher.LibraryPublisher, f.publisher),
    Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, {
      ...workspace,
      bindings: Effect.succeed(threadIds.map((id) => ({ threadId: id, resolved }))),
    }),
    Effect.provideService(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(source),
    }),
    Effect.provideService(HistorySource.LibraryHistorySource, { snapshotThread }),
  );
const pendingLimit = (bytes: number) =>
  Effect.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_MAX_PENDING_BYTES: String(bytes) } }),
    ),
  );
const run = <A, E, R>(use: (state: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const state = yield* fixture;
    return yield* use(state);
  }).pipe(
    Effect.provideService(ServerActivation, Effect.never),
    Effect.provideService(CopyHealth.LibraryCopyHealthSource, healthSource),
    Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

describe("durable Library history replication", () => {
  it.effect(
    "seeds verified imported watermarks without uploading old history and catches later milestones",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const importedWorkspace = {
            ...workspace,
            bindings: Effect.succeed([
              {
                threadId,
                resolved,
                importedHistory: {
                  authorityId: "authority",
                  authorityEpoch: 1,
                  sequence: 100,
                  sourceEventSequence: 120,
                },
              },
            ]),
          };
          const service = yield* Replication.LibraryReplication.pipe(
            Effect.provide(Replication.layer),
            Effect.provideService(Publisher.LibraryPublisher, {
              enabled: true,
              info: Ref.get(f.authority),
              registerCopy: (input) => Effect.succeed(input.copy),
              recordActivity: () => Effect.fail(new LibraryError({ reason: "blocked" })),
              publishAttachments: () => Effect.void,
              project: () => Effect.die("unused"),
              proposeBrief: () => Effect.die("unused"),
              registerPreviews: () => Effect.die("unused"),
              publishPage: () => Effect.die("unused"),
              listPages: () => Effect.die("unused"),
              updatePage: () => Effect.die("unused"),
              nextReplies: () => Effect.die("unused"),
              ackReply: () => Effect.die("unused"),
              signOutPageReaders: () => Effect.die("unused"),
              ingest: (input) =>
                Ref.update(f.requests, (rows) => [...rows, input]).pipe(
                  Effect.as({
                    sourceEnvironmentId: source,
                    journalId: input.journalId,
                    lastSequence: input.entries.at(-1)!.sequence,
                    applied: input.entries.length,
                  }),
                ),
            }),
            Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, importedWorkspace),
            Effect.provideService(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(source),
            }),
            Effect.provideService(HistorySource.LibraryHistorySource, {
              snapshotThread: () =>
                Ref.update(f.snapshots, (n) => n + 1).pipe(Effect.andThen(Ref.get(f.archive))),
            }),
          );
          yield* service.drain;
          expect(yield* Ref.get(f.snapshots)).toBe(0);
          expect(yield* Ref.get(f.requests)).toEqual([]);
          expect((yield* service.status).threads[0]?.acknowledgedSequence).toBe(100);
          yield* f.event(121, "thread.metadata-updated", "{}");
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 121 },
          }));
          yield* service.drain;
          expect(yield* Ref.get(f.snapshots)).toBe(1);
          expect((yield* service.status).threads[0]?.acknowledgedSequence).toBe(121);
        }),
      ),
  );

  it.effect(
    "publishes file changes without history events and only cleans up after history is saved",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const current = yield* Ref.make({
            ...receipt,
            copy: { ...receipt.copy, keepOnComputer: false },
          });
          const cleanups = yield* Ref.make(0);
          const service = yield* Replication.LibraryReplication.pipe(
            Effect.provide(Replication.layer),
            Effect.provideService(Publisher.LibraryPublisher, f.publisher),
            Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, {
              ...workspace,
              receipts: Ref.get(current).pipe(Effect.map((value) => [value])),
              get: () => Ref.get(current),
            }),
            Effect.provideService(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(source),
            }),
            Effect.provideService(HistorySource.LibraryHistorySource, {
              snapshotThread: () => Ref.get(f.archive),
            }),
            Effect.provide(
              Layer.mock(Workspace.LibraryWorkspace)({
                cleanupTemporaryCopies: Ref.update(cleanups, (count) => count + 1).pipe(
                  Effect.andThen(
                    Ref.update(current, (value) => ({
                      ...value,
                      copy: { ...value.copy, state: "released" as const },
                    })),
                  ),
                ),
              }),
            ),
          );
          yield* f.event(1, "thread.created", "{}");
          yield* Ref.set(f.failAck, true);
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("io");
          expect(yield* Ref.get(cleanups)).toBe(0);
          yield* Ref.set(f.failAck, false);
          yield* service.drain;
          expect(yield* Ref.get(cleanups)).toBe(1);
          expect((yield* Ref.get(f.registered)).at(-1)?.copy).toMatchObject({
            state: "released",
            keepOnComputer: false,
          });
          const snapshots = (yield* Ref.get(f.requests)).length;
          yield* Ref.update(current, (value) => ({
            ...value,
            copy: { ...value.copy, keepOnComputer: true },
          }));
          yield* service.drain;
          expect((yield* Ref.get(f.registered)).at(-1)?.copy.keepOnComputer).toBe(true);
          expect((yield* Ref.get(f.requests)).length).toBe(snapshots);
        }),
      ),
  );

  it.effect("reports copy health on the history journal fence only when it changed", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.service.reportCopyHealth;
        yield* f.service.reportCopyHealth;
        const requests = yield* Ref.get(f.registered);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.copy.health).toEqual(health);
        const { journalId } = yield* f.service.status;
        expect(requests[0]?.requestId.startsWith(`${journalId}:health:`)).toBe(true);
        expect(requests[0]).toMatchObject({ authorityId: "authority", authorityEpoch: 1 });
        // Health never waits on, or adds to, the history outbox.
        expect(yield* Ref.get(f.requests)).toEqual([]);
      }),
    ),
  );

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
    "keeps one unacknowledged snapshot per conversation and coalesces later milestones",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* f.event(1, "thread.created", "{}");
          yield* f.service.drain;
          yield* f.event(2, "message.updated", '{"streaming":false}');
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 2 },
          }));
          yield* Ref.set(f.failAck, true);
          expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("io");
          const snapshots = yield* Ref.get(f.snapshots);
          yield* f.event(3, "message.updated", '{"streaming":false}');
          yield* f.event(4, "checkpoint.captured", "{}");
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 4 },
          }));
          expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("io");
          expect(yield* Ref.get(f.snapshots)).toBe(snapshots);
          expect((yield* f.service.status).pendingEntries).toBe(1);
          yield* Ref.set(f.failAck, false);
          yield* f.service.drain;
          expect((yield* f.service.status).threads[0]).toMatchObject({
            acknowledgedSequence: 2,
            pending: true,
          });
          yield* f.service.drain;
          expect(yield* Ref.get(f.snapshots)).toBe(snapshots + 1);
          expect((yield* f.service.status).threads[0]).toMatchObject({
            currentSequence: 4,
            acknowledgedSequence: 4,
            pending: false,
          });
        }),
      ),
  );
  it.effect(
    "advances the event watermark past a snapshot over the journal limit and retries it once it fits",
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
              messages: [{ ...archive.projection.messages[0]!, text: "x".repeat(6000) }],
            },
          }));
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
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            projection: {
              ...archive.projection,
              messages: [{ ...archive.projection.messages[0]!, text: "shorter" }],
            },
          }));
          yield* f.service.drain;
          expect(yield* f.service.status).toMatchObject({ lastFailure: null });
          expect((yield* f.service.status).threads[0]).toMatchObject({
            currentSequence: 2,
            acknowledgedSequence: 2,
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
  it.effect("spaces snapshots of a long conversation by its size", () =>
    run((f) =>
      Effect.gen(function* () {
        // About 600 KiB, so each snapshot waits two seconds before the next.
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          projection: {
            ...archive.projection,
            messages: [{ ...archive.projection.messages[0]!, text: "x".repeat(600 * 1024) }],
          },
        }));
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        yield* f.event(2, "message.updated", '{"streaming":false}');
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* f.service.drain;
        yield* TestClock.adjust("1 second");
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        expect((yield* f.service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 1,
          pending: true,
        });
        yield* TestClock.adjust("1 second");
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
        expect((yield* f.service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 2,
          pending: false,
        });
      }),
    ),
  );
  it.effect("finds a deferred snapshot again in the event log after a restart", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          projection: {
            ...archive.projection,
            messages: [{ ...archive.projection.messages[0]!, text: "x".repeat(600 * 1024) }],
          },
        }));
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* f.event(2, "message.updated", '{"streaming":false}');
        yield* f.event(3, "message.updated", '{"streaming":true}');
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 3 },
        }));
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        expect(
          yield* f.sql<{
            scan_sequence: number;
          }>`SELECT scan_sequence FROM fork_library_source_state`,
        ).toMatchObject([{ scan_sequence: 3 }]);
        const restarted = yield* f.restart;
        yield* restarted.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
        expect((yield* restarted.status).threads[0]).toMatchObject({
          acknowledgedSequence: 3,
          pending: false,
        });
        yield* (yield* f.restart).drain;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
      }),
    ),
  );
  it.effect("keeps reporting a snapshot over the journal limit while it waits", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          projection: {
            ...archive.projection,
            messages: [{ ...archive.projection.messages[0]!, text: "x".repeat(600 * 1024) }],
          },
        }));
        yield* f.event(1, "thread.created", "{}");
        expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
        expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
        expect((yield* f.service.flush.pipe(Effect.flip)).reason).toBe("storage-limit");
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        expect(yield* f.service.status).toMatchObject({ lastFailure: "storage-limit" });
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          projection: {
            ...archive.projection,
            messages: [{ ...archive.projection.messages[0]!, text: "shorter" }],
          },
        }));
        yield* TestClock.adjust("2 seconds");
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
        expect(yield* f.service.status).toMatchObject({ lastFailure: null });
      }),
    ).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_MAX_PENDING_BYTES: "300000" } }),
        ),
      ),
    ),
  );
  it.effect(
    "publishes and flushes conversations that fit while another waits for journal space",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const other = ThreadId.make("other-thread");
          const small = yield* Ref.get(f.archive);
          const large = {
            ...small,
            projection: {
              ...small.projection,
              messages: [{ ...small.projection.messages[0]!, text: "x".repeat(600 * 1024) }],
            },
          };
          const settle = (sequence: number) =>
            f.event(sequence, "thread.settled", "{}").pipe(
              Effect.andThen(
                Ref.update(f.archive, (archive) => ({
                  ...archive,
                  summary: { ...archive.summary, sequence },
                })),
              ),
            );
          const service = yield* Replication.LibraryReplication.pipe(
            Effect.provide(Replication.layer),
            Effect.provideService(Publisher.LibraryPublisher, f.publisher),
            Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, {
              ...workspace,
              bindings: Effect.succeed([
                { threadId: other, resolved },
                { threadId, resolved },
              ]),
            }),
            Effect.provideService(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(source),
            }),
            Effect.provideService(HistorySource.LibraryHistorySource, {
              snapshotThread: (input) =>
                input.threadId === other ? Effect.succeed(large) : Ref.get(f.archive),
            }),
          );
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
          const status = yield* service.status;
          expect(status).toMatchObject({ pendingEntries: 0, lastFailure: "storage-limit" });
          expect(status.threads).toMatchObject([
            { threadId: other, pending: true },
            { threadId, acknowledgedSequence: 1, pending: false },
          ]);
          yield* Ref.set(f.failAck, true);
          yield* settle(2);
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("io");
          yield* settle(3);
          yield* Ref.set(f.failAck, false);
          expect((yield* service.flush.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect((yield* service.status).threads[1]).toMatchObject({
            acknowledgedSequence: 3,
            pending: false,
          });
        }),
      ).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_MAX_PENDING_BYTES: "300000" } }),
          ),
        ),
      ),
  );
  it.effect("finds a milestone again after a restart when compaction replaced it", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          projection: {
            ...archive.projection,
            messages: [{ ...archive.projection.messages[0]!, text: "x".repeat(600 * 1024) }],
          },
        }));
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* f.event(2, "thread.settled", "{}");
        yield* f.event(3, "thread.active-reordered", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 3 },
        }));
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        // Compaction keeps only the newest whole-thread event.
        yield* f.sql`DELETE FROM orchestration_events WHERE sequence=2`;
        expect((yield* f.service.status).threads[0]?.pending).toBe(true);
        const restarted = yield* f.restart;
        yield* restarted.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
        expect((yield* restarted.status).threads[0]).toMatchObject({
          acknowledgedSequence: 3,
          pending: false,
        });
      }),
    ),
  );
  it.effect("flushes a spaced conversation and one with an unacknowledged snapshot at once", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          projection: {
            ...archive.projection,
            messages: [{ ...archive.projection.messages[0]!, text: "x".repeat(600 * 1024) }],
          },
        }));
        yield* Ref.set(f.failAck, true);
        yield* f.event(1, "thread.created", "{}");
        expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("io");
        yield* f.event(2, "thread.settled", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* Ref.set(f.failAck, false);
        yield* f.service.flush;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
        expect(yield* f.service.status).toMatchObject({ pendingEntries: 0, lastFailure: null });
        expect((yield* f.service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 2,
          pending: false,
        });
      }),
    ),
  );
  it.effect("finds a milestone again after a restart when a later reorder replaced it", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.archive, (archive) => withText(archive, longText));
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* f.event(2, "thread.settled", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        // The reorder lands after the last scan, then compaction removes the milestone.
        yield* f.event(3, "thread.active-reordered", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 3 },
        }));
        yield* f.sql`DELETE FROM orchestration_events WHERE sequence=2`;
        const restarted = yield* f.restart;
        yield* restarted.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
        expect((yield* restarted.status).threads[0]).toMatchObject({
          acknowledgedSequence: 3,
          pending: false,
        });
      }),
    ),
  );
  it.effect(
    "keeps a pull-request link update pending after compaction replaces it with a reorder",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* Ref.update(f.archive, (archive) => withText(archive, longText));
          yield* f.event(1, "thread.created", "{}");
          yield* f.service.drain;
          // The spaced link update waits in the background, then compaction keeps only the reorder.
          yield* f.event(2, "thread.pull-request-link-updated", "{}");
          yield* f.service.drain;
          yield* f.event(3, "thread.pin-reordered", "{}");
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 3 },
          }));
          yield* f.sql`DELETE FROM orchestration_events WHERE sequence=2`;
          expect(yield* Ref.get(f.snapshots)).toBe(1);
          expect((yield* f.service.status).threads[0]?.pending).toBe(true);
          yield* f.service.flush;
          expect(yield* Ref.get(f.snapshots)).toBe(2);
          expect((yield* f.service.status).threads[0]).toMatchObject({
            acknowledgedSequence: 3,
            pending: false,
          });
        }),
      ),
  );
  it.effect("does not snapshot a saved conversation again on flush for navigation alone", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* f.event(2, "thread.visited", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* f.service.flush;
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        expect((yield* f.service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 1,
          pending: false,
        });
      }),
    ),
  );
  it.effect("keeps a conversation deferred when its snapshot fails", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* f.event(2, "thread.settled", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* Ref.set(f.failSnapshot, true);
        expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("io");
        expect((yield* f.service.status).threads[0]?.pending).toBe(true);
        yield* Ref.set(f.failSnapshot, false);
        yield* f.service.drain;
        expect((yield* f.service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 2,
          pending: false,
        });
      }),
    ),
  );
  it.effect(
    "retries a snapshot that waited for the backlog as soon as it fits, without waiting out its spacing",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const other = ThreadId.make("other-thread");
          yield* Ref.update(f.archive, (archive) => withText(archive, longText));
          const service = yield* serviceFor(f, [other, threadId], () => Ref.get(f.archive));
          // Each snapshot fits the outbox alone, but not beside the other's.
          yield* Ref.set(f.failAck, true);
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("io");
          expect(yield* service.status).toMatchObject({ pendingEntries: 1 });
          yield* Ref.set(f.failAck, false);
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect(yield* service.status).toMatchObject({ pendingEntries: 0 });
          yield* service.drain;
          expect(yield* service.status).toMatchObject({ pendingEntries: 0, lastFailure: null });
          expect((yield* service.status).threads).toMatchObject([
            { threadId: other, acknowledgedSequence: 1, pending: false },
            { threadId, acknowledgedSequence: 1, pending: false },
          ]);
          // Its next milestone waits for spacing without reporting the storage limit again.
          yield* f.event(2, "thread.settled", "{}");
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 2 },
          }));
          yield* service.drain;
          expect(yield* service.status).toMatchObject({ lastFailure: null });
          expect((yield* service.status).threads[1]).toMatchObject({
            acknowledgedSequence: 1,
            pending: true,
          });
        }),
      ).pipe(pendingLimit(1_000_000)),
  );
  it.effect("flushes a conversation that fits once the flush acknowledges the backlog", () =>
    run((f) =>
      Effect.gen(function* () {
        const other = ThreadId.make("other-thread");
        yield* Ref.update(f.archive, (archive) => withText(archive, longText));
        const service = yield* serviceFor(f, [other, threadId], () =>
          Ref.update(f.snapshots, (count) => count + 1).pipe(Effect.andThen(Ref.get(f.archive))),
        );
        yield* Ref.set(f.failAck, true);
        expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("io");
        yield* Ref.set(f.failAck, false);
        yield* service.flush;
        expect(yield* Ref.get(f.snapshots)).toBe(3);
        expect(yield* service.status).toMatchObject({ pendingEntries: 0, lastFailure: null });
        expect((yield* service.status).threads).toMatchObject([
          { threadId: other, acknowledgedSequence: 1, pending: false },
          { threadId, acknowledgedSequence: 1, pending: false },
        ]);
      }),
    ).pipe(pendingLimit(1_000_000)),
  );
  it.effect("flushes every pending conversation, however many batches it takes", () =>
    run((f) =>
      Effect.gen(function* () {
        const threadIds = Array.from({ length: 25 }, (_, index) =>
          ThreadId.make(`thread-${index}`),
        );
        const service = yield* serviceFor(f, threadIds, () => Ref.get(f.archive));
        yield* service.flush;
        const status = yield* service.status;
        expect(status).toMatchObject({ pendingEntries: 0, lastFailure: null });
        expect(status.threads.every((thread) => !thread.pending)).toBe(true);
        expect((yield* Ref.get(f.requests)).map((request) => request.entries.length)).toEqual([
          10, 10, 5,
        ]);
      }),
    ),
  );
  it.effect("flushes a conversation whose newest events are not milestones", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.drain;
        yield* f.event(2, "turn-item.updated", '{"type":"assistant_message","streaming":true}');
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* f.service.drain;
        expect(yield* Ref.get(f.snapshots)).toBe(1);
        expect((yield* f.service.status).threads[0]?.pending).toBe(true);
        yield* f.service.flush;
        expect(yield* Ref.get(f.snapshots)).toBe(2);
        expect((yield* f.service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 2,
          pending: false,
        });
      }),
    ),
  );
  it.effect("ends a flush while a conversation keeps changing", () =>
    run((f) =>
      Effect.gen(function* () {
        let sequence = 0;
        let next: readonly [string, string] = [
          "turn-item.updated",
          '{"type":"assistant_message","streaming":true}',
        ];
        const service = yield* serviceFor(f, [threadId], () =>
          Effect.gen(function* () {
            sequence += 2;
            const archive = yield* Ref.get(f.archive);
            // The conversation changes again right after each snapshot.
            yield* f.event(sequence, ...next).pipe(Effect.orDie);
            return { ...archive, summary: { ...archive.summary, sequence: sequence - 1 } };
          }),
        );
        yield* service.flush;
        expect(sequence).toBe(2);
        expect((yield* service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 1,
          pending: true,
        });
        // Streaming alone does not snapshot again in the background.
        yield* service.drain;
        expect(sequence).toBe(2);
        next = ["message.updated", '{"streaming":false}'];
        yield* service.flush;
        expect(sequence).toBe(4);
        expect((yield* service.status).threads[0]).toMatchObject({
          acknowledgedSequence: 3,
          pending: true,
        });
      }),
    ),
  );
  it.effect("waits out a history too long to encode without holding back other uploads", () =>
    run((f) =>
      Effect.gen(function* () {
        const other = ThreadId.make("other-thread");
        const unencodable = withText(yield* Ref.get(f.archive), "longer than one string holds");
        // V8 cannot build a string over its maximum length; JSON.stringify throws RangeError.
        const stringify = JSON.stringify;
        let encodings = 0;
        const spy = vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
          const messages = (value as { projection?: { messages?: { text?: unknown }[] } } | null)
            ?.projection?.messages;
          if (messages?.[0]?.text === "longer than one string holds") {
            encodings += 1;
            throw new RangeError("Invalid string length");
          }
          return stringify(value, replacer as never, space);
        });
        yield* Effect.gen(function* () {
          const service = yield* serviceFor(f, [other, threadId], (input) =>
            input.threadId === other ? Effect.succeed(unencodable) : Ref.get(f.archive),
          );
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect(yield* service.status).toMatchObject({
            pendingEntries: 0,
            lastFailure: "storage-limit",
          });
          expect((yield* service.status).threads).toMatchObject([
            { threadId: other, pending: true },
            { threadId, acknowledgedSequence: 1, pending: false },
          ]);
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect((yield* service.flush.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect(encodings).toBe(1);
          // It is spaced as the longest string V8 can hold, then tried again.
          yield* TestClock.adjust("35 minutes");
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect(encodings).toBe(2);
        }).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())));
      }),
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
        recordActivity: () => Effect.fail(new LibraryError({ reason: "blocked" })),
        publishAttachments: () => Effect.void,
        project: () => Effect.die("unused"),
        proposeBrief: () => Effect.die("unused"),
        registerPreviews: () => Effect.die("unused"),
        publishPage: () => Effect.die("unused"),
        listPages: () => Effect.die("unused"),
        updatePage: () => Effect.die("unused"),
        nextReplies: () => Effect.die("unused"),
        ackReply: () => Effect.die("unused"),
        signOutPageReaders: () => Effect.die("unused"),
      });
      const disabled = yield* Replication.LibraryReplication.pipe(
        Effect.provide(Replication.layer),
        Effect.provideService(Publisher.LibraryPublisher, publisher),
      );
      yield* disabled.drain;
      yield* disabled.flush;
      expect(yield* disabled.status).toMatchObject({ enabled: false, pendingEntries: 0 });
    }).pipe(
      Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.provideService(HistorySource.LibraryHistorySource, {
        snapshotThread: () => Effect.fail(new LibraryError({ reason: "not-found" })),
      }),
      Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, workspace),
      Effect.provideService(CopyHealth.LibraryCopyHealthSource, healthSource),
      Effect.provideService(ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(source),
      }),
      Effect.scoped,
    ),
  );
});
