import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it, vi } from "@effect/vitest";
import * as NodeZlib from "node:zlib";
import {
  ChatAttachmentId,
  EventId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryCopyHealth,
  type LibraryInfo,
  type LibraryIngestHistoryRequest,
  type LibraryProject,
  type LibraryRegisterCopyRequest,
  type LibraryResolvedBinding,
  type LibraryThreadArchive,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { layerFromPath, layerMemory } from "../../persistence/Sqlite.ts";
import { ServerActivation } from "../../serverActivation.ts";
import * as DeletedThreadHistory from "../deleted-history/DeletedThreadHistory.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as CopyHealth from "./LibraryCopyHealthPublication.ts";
import * as HistorySource from "./LibraryHistorySource.ts";
import * as Migration from "./LibraryMigration.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as Replication from "./LibraryReplication.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as Workspace from "./LibraryWorkspace.ts";
import { LibraryHistoryMigrations } from "./history-migrations.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import { libraryAttachments } from "./attachments.ts";
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
  yield* runForkMigrationSet(LibraryHistoryMigrations);
  const sql = yield* SqlClient.SqlClient;
  const archive = yield* Ref.make<LibraryThreadArchive>(yield* archiveFor(project, 1));
  const snapshots = yield* Ref.make(0);
  const requests = yield* Ref.make<LibraryIngestHistoryRequest[]>([]);
  const order = yield* Ref.make<string[]>([]);
  const registered = yield* Ref.make<LibraryRegisterCopyRequest[]>([]);
  const failAck = yield* Ref.make(false);
  const rejectDeltas = yield* Ref.make(false);
  const failAssets = yield* Ref.make(false);
  const failSnapshot = yield* Ref.make(false);
  const missingAttachments = yield* Ref.make<ReadonlySet<string>>(new Set());
  const claimedCursor = yield* Ref.make<number | null>(null);
  const authority = yield* Ref.make<LibraryInfo>({
    environmentId: source,
    authorityId: "authority",
    authorityEpoch: 1,
    assets: "local" as const,
  });
  const publisher = Publisher.LibraryPublisher.of({
    projects: () => Effect.die("unused"),
    conversations: () => Effect.die("unused"),
    lookupThread: () => Effect.die("unused"),
    history: () => Effect.die("unused"),
    search: () => Effect.die("unused"),
    timeline: () => Effect.die("unused"),
    launchCandidates: () => Effect.die("unused"),
    copyRegistrations: Stream.empty,
    publishDocuments: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
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
    // Like the real publisher: a deleted conversation's lost attachments are reported back, while
    // a live conversation cannot be acknowledged without them.
    publishAttachments: (thread) =>
      Effect.gen(function* () {
        yield* Ref.update(order, (steps) => [...steps, "assets"]);
        if (yield* Ref.get(failAssets)) return yield* new LibraryError({ reason: "io" });
        const missing = yield* Ref.get(missingAttachments);
        const gone = new Set(
          libraryAttachments(thread)
            .map((attachment) => attachment.id)
            .filter((id) => missing.has(id)),
        );
        if (gone.size > 0 && thread.summary.deleted !== true)
          return yield* new LibraryError({ reason: "not-found" });
        return gone;
      }),
    ingest: (input) =>
      Effect.gen(function* () {
        yield* Ref.update(order, (steps) => [...steps, "history"]);
        yield* Ref.update(requests, (saved) => [...saved, input]);
        if (yield* Ref.get(failAck)) return yield* new LibraryError({ reason: "io" });
        if (
          (yield* Ref.get(rejectDeltas)) &&
          input.entries.some((entry) => entry.delta !== undefined)
        )
          return yield* new LibraryError({ reason: "sequence-conflict" });
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
    rejectDeltas,
    failAssets,
    failSnapshot,
    missingAttachments,
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
const withAttachment = (archive: LibraryThreadArchive): LibraryThreadArchive => ({
  ...archive,
  projection: {
    ...archive.projection,
    messages: [{ ...archive.projection.messages[0]!, attachments: [lostAttachment] }],
  },
});
const lostAttachment = {
  type: "file" as const,
  id: ChatAttachmentId.make("source-thread-00000000-0000-4000-8000-000000000000-txt"),
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 3,
};
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
const memoryDatabase = layerMemory.pipe(Layer.provideMerge(NodeServices.layer));
// A file database, so reads marked readOnly really use the reader worker.
const fileDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "library-replication-" });
    return layerFromPath(path.join(directory, "statev2.sqlite"));
  }),
).pipe(Layer.provideMerge(NodeServices.layer));
const runOn =
  <DatabaseError>(database: Layer.Layer<Layer.Success<typeof memoryDatabase>, DatabaseError>) =>
  <A, E, R>(use: (state: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const state = yield* fixture;
      return yield* use(state);
    }).pipe(
      Effect.provideService(ServerActivation, Effect.never),
      Effect.provideService(CopyHealth.LibraryCopyHealthSource, healthSource),
      Effect.provide(database),
      Effect.scoped,
    );
const run = runOn(memoryDatabase);
const readerAt = DateTime.makeUnsafe(Date.UTC(2026, 9, 24));
const readerProvider = ProviderInstanceId.make("codex");

describe("durable Library history replication", () => {
  it.effect(
    "retains a pending delta across a Library downgrade without sending tails as complete history",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* Ref.update(f.authority, (info) => ({
            ...info,
            features: ["library-history-deltas"],
          }));
          const initial = withText(yield* Ref.get(f.archive), "existing transcript ".repeat(500));
          yield* Ref.set(f.archive, initial);
          yield* f.event(1, "thread.created", "{}");
          yield* f.service.flush;
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 2 },
          }));
          yield* f.event(2, "checkpoint.captured", "{}");
          yield* Ref.set(f.failAck, true);
          yield* f.service.flush.pipe(Effect.flip);
          const pending = (yield* Ref.get(f.requests)).at(-1)!;
          expect(pending.entries[0]!.delta).toBeDefined();
          const attempts = (yield* Ref.get(f.requests)).length;
          yield* Ref.update(f.authority, (info) => ({ ...info, features: [] }));
          yield* Ref.set(f.failAck, false);
          expect((yield* f.service.flush.pipe(Effect.flip)).reason).toBe("publisher-unavailable");
          expect((yield* Ref.get(f.requests)).length).toBe(attempts);
          expect((yield* f.service.status).pendingEntries).toBe(1);
          yield* Ref.update(f.authority, (info) => ({
            ...info,
            features: ["library-history-deltas"],
          }));
          yield* f.service.flush;
          expect((yield* Ref.get(f.requests)).at(-1)).toEqual(pending);
          expect((yield* f.service.status).pendingEntries).toBe(0);
        }),
      ),
  );

  it.effect("keeps a rejected delta immutable until the Library can accept the same history", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.authority, (info) => ({
          ...info,
          features: ["library-history-deltas"],
        }));
        yield* f.event(1, "thread.created", "{}");
        const initial = withText(yield* Ref.get(f.archive), "unchanged transcript ".repeat(500));
        yield* Ref.set(f.archive, initial);
        yield* f.service.flush;
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* f.event(2, "checkpoint.captured", "{}");
        yield* Ref.set(f.rejectDeltas, true);
        expect((yield* f.service.flush.pipe(Effect.flip)).reason).toBe("sequence-conflict");
        expect((yield* Ref.get(f.requests)).at(-1)!.entries[0]!.delta).toBeDefined();
        const pending = (yield* Ref.get(f.requests)).at(-1)!;
        expect((yield* f.service.flush.pipe(Effect.flip)).reason).toBe("sequence-conflict");
        expect((yield* Ref.get(f.requests)).at(-1)).toEqual(pending);
        expect((yield* f.service.status).pendingEntries).toBe(1);
        yield* Ref.set(f.rejectDeltas, false);
        yield* f.service.flush;
        expect((yield* Ref.get(f.requests)).at(-1)).toEqual(pending);
        expect((yield* f.service.status).pendingEntries).toBe(0);
      }),
    ),
  );

  it.effect(
    "uploads only changed tails and retries the saved delta after a lost acknowledgment and restart",
    () =>
      run((f) =>
        Effect.gen(function* () {
          yield* Ref.update(f.authority, (info) => ({
            ...info,
            features: ["library-history-deltas"],
          }));
          const initial = withText(
            yield* Ref.get(f.archive),
            "long unchanged transcript ".repeat(5000),
          );
          yield* Ref.set(f.archive, initial);
          yield* f.event(1, "thread.created", "{}");
          yield* f.service.flush;
          expect((yield* Ref.get(f.requests))[0]!.entries[0]!.delta).toBeUndefined();
          const after = {
            ...initial,
            summary: { ...initial.summary, sequence: 2 },
            projection: {
              ...initial.projection,
              messages: [
                ...initial.projection.messages,
                {
                  ...initial.projection.messages[0]!,
                  id: MessageId.make("second"),
                  text: "A short reply.",
                },
              ],
            },
          };
          yield* Ref.set(f.archive, after);
          yield* f.event(2, "message.updated", '{"streaming":false}');
          yield* Ref.set(f.failAck, true);
          expect((yield* f.service.flush.pipe(Effect.flip)).reason).toBe("io");
          const pending = (yield* Ref.get(f.requests)).at(-1)!;
          expect(pending.entries[0]!.delta?.baseSequence).toBe(1);
          expect(pending.entries[0]!.delta?.prefixes.messages).toBe(1);
          expect(
            pending.entries[0]!.thread.projection.messages.map((message) => message.text),
          ).toEqual(["A short reply."]);
          expect(JSON.stringify(pending).length).toBeLessThan(JSON.stringify(after).length / 10);
          yield* Ref.set(f.failAck, false);
          const restarted = yield* f.restart;
          yield* restarted.flush;
          expect((yield* Ref.get(f.requests)).at(-1)).toEqual(pending);
          expect((yield* restarted.status).pendingEntries).toBe(0);
          const baseline = (yield* f.sql<{
            bytes: Uint8Array;
          }>`SELECT bytes FROM fork_library_source_baselines WHERE thread_id=${threadId}`)[0]!;
          expect(
            JSON.parse(NodeZlib.gunzipSync(baseline.bytes).toString("utf8")).summary.sequence,
          ).toBe(2);
        }),
      ),
  );
  it.effect("keeps full uploads compatible with Libraries that do not advertise deltas", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.event(1, "thread.created", "{}");
        yield* f.service.flush;
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* f.event(2, "checkpoint.captured", "{}");
        yield* f.service.flush;
        const request = (yield* Ref.get(f.requests)).at(-1)!;
        expect(request.entries[0]!.delta).toBeUndefined();
        expect(request.entries[0]!.thread.projection.messages).toHaveLength(1);
      }),
    ),
  );

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
              projects: () => Effect.die("unused"),
              conversations: () => Effect.die("unused"),
              lookupThread: () => Effect.die("unused"),
              history: () => Effect.die("unused"),
              search: () => Effect.die("unused"),
              timeline: () => Effect.die("unused"),
              launchCandidates: () => Effect.die("unused"),
              copyRegistrations: Stream.empty,
              publishDocuments: () => Effect.die("unused"),
              decisions: () => Effect.die("unused"),
              enabled: true,
              info: Ref.get(f.authority),
              registerCopy: (input) => Effect.succeed(input.copy),
              recordActivity: () => Effect.fail(new LibraryError({ reason: "blocked" })),
              publishAttachments: () => Effect.succeed(new Set<string>()),
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
                cleanupTemporaryCopies: (isHistoryAcknowledged) =>
                  Effect.gen(function* () {
                    if (!(yield* isHistoryAcknowledged(threadId))) return;
                    yield* Ref.update(cleanups, (count) => count + 1);
                    yield* Ref.update(current, (value) => ({
                      ...value,
                      copy: { ...value.copy, state: "released" as const },
                    }));
                  }),
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

  it.effect("cleans up acknowledged copies while unrelated oversized history waits", () =>
    run((f) =>
      Effect.gen(function* () {
        const pendingThread = ThreadId.make("pending-thread");
        const unknownThread = ThreadId.make("unknown-thread");
        const unboundThread = ThreadId.make("unbound-thread");
        const pendingResolved = {
          ...resolved,
          binding: { ...resolved.binding, workingCopyId: "pending-copy" },
        };
        const bindings = [
          { threadId: pendingThread, resolved: pendingResolved },
          { threadId, resolved },
        ];
        const cleaned = yield* Ref.make<string[]>([]);
        const pendingArchive = yield* Ref.get(f.archive).pipe(
          Effect.map((archive) => ({
            ...archive,
            summary: {
              ...archive.summary,
              threadId: pendingThread,
              workingCopyId: "pending-copy",
            },
            projection: {
              ...archive.projection,
              thread: { ...archive.projection.thread, id: pendingThread },
              messages: archive.projection.messages.map((message) => ({
                ...message,
                threadId: pendingThread,
                text: longText,
              })),
            },
          })),
        );
        // Old acknowledgement rows cannot prove an unbound conversation is saved now.
        yield* f.sql`INSERT INTO fork_library_source_threads(thread_id,queued_sequence,acknowledged_sequence) VALUES (${unboundThread},1,1)`;
        const service = yield* Replication.LibraryReplication.pipe(
          Effect.provide(Replication.layer),
          Effect.provideService(Publisher.LibraryPublisher, f.publisher),
          Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, {
            ...workspace,
            bindings: Effect.succeed(bindings),
            getBinding: (id) =>
              Effect.succeed(bindings.find((binding) => binding.threadId === id)?.resolved ?? null),
          }),
          Effect.provideService(ServerEnvironmentIdentity, {
            getEnvironmentId: Effect.succeed(source),
          }),
          Effect.provideService(HistorySource.LibraryHistorySource, {
            snapshotThread: (input) =>
              input.threadId === pendingThread
                ? Effect.succeed(pendingArchive)
                : Ref.get(f.archive),
          }),
          Effect.provide(
            Layer.mock(Workspace.LibraryWorkspace)({
              cleanupTemporaryCopies: (isHistoryAcknowledged) =>
                Effect.gen(function* () {
                  for (const [copyId, related] of [
                    ["pending-copy", [pendingThread]],
                    [copy.id, [threadId]],
                    ["unknown-copy", [unknownThread]],
                    ["unbound-copy", [unboundThread]],
                  ] as const) {
                    const saved = yield* Effect.forEach(related, isHistoryAcknowledged);
                    if (saved.every(Boolean)) yield* Ref.update(cleaned, (ids) => [...ids, copyId]);
                  }
                }),
            }),
          ),
        );
        expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
        expect((yield* service.status).threads).toMatchObject([
          { threadId: pendingThread, pending: true },
          { threadId, acknowledgedSequence: 1, pending: false },
        ]);
        expect(yield* Ref.get(cleaned)).toEqual([copy.id]);
      }),
    ).pipe(pendingLimit(300000)),
  );

  it.effect("keeps history beyond the published batch ineligible for cleanup", () =>
    run((f) =>
      Effect.gen(function* () {
        const threads = Array.from({ length: 11 }, (_, index) => ThreadId.make(`thread-${index}`));
        const acknowledged = yield* Ref.make<ThreadId[]>([]);
        const archive = yield* Ref.get(f.archive);
        const service = yield* serviceFor(f, threads, (input) =>
          Effect.succeed({
            ...archive,
            summary: { ...archive.summary, threadId: input.threadId },
            projection: {
              ...archive.projection,
              thread: { ...archive.projection.thread, id: input.threadId },
              messages: archive.projection.messages.map((message) => ({
                ...message,
                threadId: input.threadId,
              })),
            },
          }),
        ).pipe(
          Effect.provide(
            Layer.mock(Workspace.LibraryWorkspace)({
              cleanupTemporaryCopies: (isHistoryAcknowledged) =>
                Effect.gen(function* () {
                  const saved = yield* Effect.filter(threads, isHistoryAcknowledged);
                  yield* Ref.set(acknowledged, saved);
                }),
            }),
          ),
        );
        yield* service.drain;
        expect(yield* Ref.get(acknowledged)).toEqual(threads.slice(0, 10));
        expect((yield* service.status).pendingEntries).toBe(1);
        expect((yield* service.status).threads.at(-1)).toMatchObject({
          threadId: threads.at(-1),
          pending: true,
        });
      }),
    ),
  );

  it.effect(
    "rechecks current events and deferred history for every related cleanup conversation",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const checks = yield* Ref.make<boolean[]>([]);
          let changedDuringCleanup = false;
          yield* Ref.update(f.archive, (archive) => withText(archive, longText));
          const service = yield* Replication.LibraryReplication.pipe(
            Effect.provide(Replication.layer),
            Effect.provideService(Publisher.LibraryPublisher, f.publisher),
            Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, workspace),
            Effect.provideService(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(source),
            }),
            Effect.provideService(HistorySource.LibraryHistorySource, {
              snapshotThread: () => Ref.get(f.archive),
            }),
            Effect.provide(
              Layer.mock(Workspace.LibraryWorkspace)({
                cleanupTemporaryCopies: (isHistoryAcknowledged) =>
                  Effect.gen(function* () {
                    const saved = yield* isHistoryAcknowledged(threadId);
                    yield* Ref.update(checks, (values) => [...values, saved]);
                    if (changedDuringCleanup) return;
                    changedDuringCleanup = true;
                    // A new event arriving during cleanup invalidates its next history check.
                    yield* f.event(2, "thread.settled", "{}").pipe(Effect.orDie);
                    expect(yield* isHistoryAcknowledged(threadId)).toBe(false);
                  }),
              }),
            ),
          );
          yield* f.event(1, "thread.created", "{}");
          yield* service.drain;
          // Compaction drops the milestone but keeps a navigation event. The deferred snapshot
          // must still block cleanup even though the event tail now matches the acknowledgement.
          yield* f.event(3, "thread.active-reordered", "{}");
          yield* service.drain;
          yield* f.sql`DELETE FROM orchestration_events WHERE sequence=2`;
          yield* service.drain;
          expect(yield* Ref.get(checks)).toEqual([true, false, false]);
          expect((yield* service.status).threads[0]?.pending).toBe(true);
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
          // The failed attempt already registered the unchanged copy.
          expect(yield* Ref.get(f.order)).toEqual(["copy", "assets"]);
          yield* Ref.set(f.failAssets, false);
          yield* Ref.set(f.order, []);
          yield* f.service.drain;
          expect(yield* Ref.get(f.order)).toEqual(["assets", "history"]);
          expect((yield* f.service.status).pendingEntries).toBe(0);
        }),
      ),
  );
  it.effect(
    "publishes a deleted conversation without the attachment it lost, and the history behind it",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const deletedThread = ThreadId.make("deleted-thread");
          const live = yield* Ref.get(f.archive);
          const deleted = withAttachment({
            ...live,
            summary: { ...live.summary, deleted: true },
          });
          yield* Ref.set(f.missingAttachments, new Set([lostAttachment.id]));
          const service = yield* serviceFor(f, [deletedThread, threadId], (input) =>
            Effect.succeed(input.threadId === deletedThread ? deleted : live),
          );
          yield* service.drain;
          const [request] = yield* Ref.get(f.requests);
          expect(request?.entries.map((entry) => entry.thread.summary.deleted)).toEqual([
            true,
            undefined,
          ]);
          // The Library would otherwise count the attachment missing in every backup.
          expect(request?.entries.map((entry) => libraryAttachments(entry.thread))).toEqual([
            [],
            [],
          ]);
          expect(yield* service.status).toMatchObject({ pendingEntries: 0, lastFailure: null });
          expect((yield* service.status).threads).toMatchObject([
            { threadId: deletedThread, acknowledgedSequence: 1, pending: false },
            { threadId, acknowledgedSequence: 1, pending: false },
          ]);
          // Nothing will send the deleted conversation a delta, so it keeps no baseline.
          expect(yield* f.sql`SELECT thread_id FROM fork_library_source_baselines`).toEqual([
            { thread_id: threadId },
          ]);
        }),
      ),
  );
  it.effect("keeps a live conversation pending while an attachment it needs is missing", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.archive, withAttachment);
        yield* Ref.set(f.missingAttachments, new Set([lostAttachment.id]));
        yield* f.event(1, "thread.created", "{}");
        expect((yield* f.service.drain.pipe(Effect.flip)).reason).toBe("not-found");
        expect(yield* Ref.get(f.requests)).toEqual([]);
        expect(yield* f.service.status).toMatchObject({
          pendingEntries: 1,
          lastFailure: "not-found",
        });
      }),
    ),
  );
  it.effect("registers a working copy again only once it changed", () =>
    run((f) =>
      Effect.gen(function* () {
        const current = yield* Ref.make(receipt);
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
            Layer.mock(Workspace.LibraryWorkspace)({ cleanupTemporaryCopies: () => Effect.void }),
          ),
        );
        const copyRegistrations = Ref.get(f.registered).pipe(
          Effect.map((requests) => requests.filter((input) => input.requestId.includes(":copy:"))),
        );
        yield* f.event(1, "thread.created", "{}");
        yield* service.drain;
        yield* f.event(2, "checkpoint.captured", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* service.drain;
        expect(yield* Ref.get(f.requests)).toHaveLength(2);
        expect(yield* copyRegistrations).toHaveLength(1);
        yield* Ref.update(current, (value) => ({
          ...value,
          copy: { ...value.copy, keepOnComputer: !value.copy.keepOnComputer },
        }));
        yield* service.drain;
        expect(yield* copyRegistrations).toHaveLength(2);
      }),
    ),
  );
  // A launch uploads nothing itself: it creates the conversation, binds it and sets the copy's
  // retention, and a pass can scan the creation before the binding exists.
  it.effect("publishes a launched conversation and its file retention on the journal fence", () =>
    run((f) =>
      Effect.gen(function* () {
        const bindings = yield* Ref.make<Effect.Success<typeof workspace.bindings>>([]);
        const current = yield* Ref.make(receipt);
        const service = yield* Replication.LibraryReplication.pipe(
          Effect.provide(Replication.layer),
          Effect.provideService(Publisher.LibraryPublisher, f.publisher),
          Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, {
            ...workspace,
            bindings: Ref.get(bindings),
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
            Layer.mock(Workspace.LibraryWorkspace)({ cleanupTemporaryCopies: () => Effect.void }),
          ),
        );
        yield* f.event(1, "thread.created", "{}");
        yield* service.drain;
        expect(yield* Ref.get(f.requests)).toEqual([]);
        yield* Ref.set(bindings, [{ threadId, resolved }]);
        yield* Ref.update(current, (value) => ({
          ...value,
          copy: { ...value.copy, keepOnComputer: false },
        }));
        yield* service.drain;
        const history = yield* Ref.get(f.requests);
        expect(history.map((request) => request.entries[0]?.thread.summary.threadId)).toEqual([
          threadId,
        ]);
        expect(history[0]).toMatchObject({ authorityId: "authority", authorityEpoch: 1 });
        const copies = yield* Ref.get(f.registered);
        expect(copies.at(-1)?.copy.keepOnComputer).toBe(false);
        for (const request of copies)
          expect(request).toMatchObject({ authorityId: "authority", authorityEpoch: 1 });
        expect((yield* service.status).threads[0]?.pending).toBe(false);
      }),
    ),
  );
  it.effect("skips a copy whose project the Library no longer has and registers the rest", () =>
    run((f) =>
      Effect.gen(function* () {
        const gone: WorkspaceStore.WorkspaceReceipt = {
          ...receipt,
          project: { ...project, id: "deleted-project" },
          copy: { ...copy, id: "deleted-copy", projectId: "deleted-project", registered: false },
        };
        const cleanups = yield* Ref.make(0);
        const service = yield* Replication.LibraryReplication.pipe(
          Effect.provide(Replication.layer),
          Effect.provideService(Publisher.LibraryPublisher, {
            ...f.publisher,
            registerCopy: (input) =>
              input.copy.id === gone.copy.id
                ? Effect.fail(new LibraryError({ reason: "not-found" }))
                : f.publisher.registerCopy(input),
          }),
          Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, {
            ...workspace,
            receipts: Effect.succeed([gone, receipt]),
            bindings: Effect.succeed([]),
          }),
          Effect.provideService(ServerEnvironmentIdentity, {
            getEnvironmentId: Effect.succeed(source),
          }),
          Effect.provideService(HistorySource.LibraryHistorySource, {
            snapshotThread: () => Ref.get(f.archive),
          }),
          Effect.provide(
            Layer.mock(Workspace.LibraryWorkspace)({
              cleanupTemporaryCopies: () => Ref.update(cleanups, (count) => count + 1),
            }),
          ),
        );
        yield* service.drain;
        expect((yield* Ref.get(f.registered)).map((input) => input.copy.id)).toEqual([copy.id]);
        expect(yield* Ref.get(cleanups)).toBe(1);
        expect((yield* service.status).lastFailure).toBeNull();
      }),
    ),
  );
  it.effect("keeps a bound conversation's baseline and removes ones no delta will use", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.update(f.authority, (info) => ({
          ...info,
          features: ["library-history-deltas"],
        }));
        yield* Ref.set(f.archive, withText(yield* Ref.get(f.archive), "transcript ".repeat(500)));
        const unbound = ThreadId.make("unbound-thread");
        const deleted = ThreadId.make("deleted-thread");
        const stale = new Uint8Array([1]);
        yield* f.sql`INSERT INTO fork_library_source_baselines(thread_id,bytes) VALUES (${unbound},${stale}),(${deleted},${stale})`;
        // A bound conversation deleted after the Library acknowledged its last history.
        yield* f.sql`INSERT INTO fork_library_source_threads(thread_id,queued_sequence,acknowledged_sequence) VALUES (${deleted},5,5)`;
        yield* f.sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,deleted_at,payload_json) VALUES (${deleted},'project','Deleted','codex','full-access','default','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','2026-10-15T00:00:00.000Z','{}')`;
        const service = yield* serviceFor(f, [deleted, threadId], () => Ref.get(f.archive));
        yield* f.event(1, "thread.created", "{}");
        yield* service.drain;
        expect(yield* f.sql`SELECT thread_id FROM fork_library_source_baselines`).toEqual([
          { thread_id: threadId },
        ]);
        yield* f.event(2, "checkpoint.captured", "{}");
        yield* Ref.update(f.archive, (archive) => ({
          ...archive,
          summary: { ...archive.summary, sequence: 2 },
        }));
        yield* service.drain;
        expect((yield* Ref.get(f.requests)).at(-1)!.entries[0]!.delta).toBeDefined();
        expect(yield* service.status).toMatchObject({ pendingEntries: 0, lastFailure: null });
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
  it.effect("never sends a purged conversation again, even after an authority change", () =>
    run((f) =>
      Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const archive = yield* Ref.get(f.archive);
        const thread = archive.projection.thread;
        yield* projections.apply({
          id: EventId.make("purged-created"),
          threadId,
          type: "thread.created",
          payload: thread,
          occurredAt: thread.createdAt,
        });
        yield* projections.apply({
          id: EventId.make("purged-message"),
          threadId,
          type: "message.updated",
          payload: archive.projection.messages[0]!,
          occurredAt: thread.createdAt,
        });
        yield* f.event(1, "thread.created", "{}");
        yield* f.event(2, "message.updated", '{"streaming":false}');
        const sources = yield* HistorySource.LibraryHistorySource.pipe(
          Effect.provide(
            HistorySource.layer.pipe(
              Layer.provide(Layer.succeed(WorkspaceStore.LibraryWorkspaceStore, workspace)),
              Layer.provide(
                Layer.succeed(ServerEnvironmentIdentity, {
                  getEnvironmentId: Effect.succeed(source),
                }),
              ),
            ),
          ),
        );
        let attempts = 0;
        const snapshotThread = (input: { readonly threadId: ThreadId }) =>
          Effect.suspend(() => {
            attempts += 1;
            return sources.snapshotThread(input);
          });
        const service = yield* serviceFor(f, [threadId], snapshotThread);
        yield* service.drain;
        yield* projections.apply({
          id: EventId.make("purged-deleted"),
          threadId,
          type: "thread.deleted",
          payload: { ...thread, deletedAt: thread.createdAt },
          occurredAt: thread.createdAt,
        });
        yield* f.event(3, "thread.deleted", "{}");
        yield* service.flush;
        const sent = yield* Ref.get(f.requests);
        expect(sent.at(-1)?.entries.map((entry) => entry.thread.summary)).toMatchObject([
          { sequence: 3, deleted: true },
        ]);
        // Another conversation owns the newest event, which a purge always keeps.
        yield* f.sql`INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json) VALUES (4,'other-created',0,'2026-10-15T00:00:00.000Z','server','{}',2,'thread','other-thread','thread.created','{}')`;
        yield* TestClock.setTime(DateTime.toEpochMillis(thread.createdAt) + 25 * 60 * 60 * 1000);
        const history = yield* DeletedThreadHistory.DeletedThreadHistory.pipe(
          Effect.provide(
            DeletedThreadHistory.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(WorkspaceStore.LibraryWorkspaceStore, workspace),
                  Layer.succeed(Publisher.LibraryPublisher, f.publisher),
                  ServerConfig.layerTest(process.cwd(), { prefix: "library-replication-purge-" }),
                ),
              ),
            ),
          ),
        );
        expect((yield* history.pass()).purgedThreads).toBe(1);

        // A new Library authority starts this computer's history over from nothing.
        yield* Ref.update(f.authority, (info) => ({
          ...info,
          authorityId: "new-authority",
          authorityEpoch: 2,
        }));
        for (const table of [
          "fork_library_source_state",
          "fork_library_source_threads",
          "fork_library_source_outbox",
          "fork_library_source_baselines",
        ])
          yield* f.sql`DELETE FROM ${f.sql(table)}`;
        const attempted = attempts;
        const restarted = yield* serviceFor(f, [threadId], snapshotThread);
        yield* restarted.drain;
        yield* restarted.flush;
        yield* restarted.drain;
        expect(yield* Ref.get(f.requests)).toHaveLength(sent.length);
        // Refused once, then remembered for the life of the service.
        expect(attempts).toBe(attempted + 1);
        expect(yield* restarted.status).toMatchObject({ pendingEntries: 0, lastFailure: null });
        // The conversation has no replication row now, yet nothing about it waits to be saved.
        expect((yield* restarted.status).threads[0]).toMatchObject({ threadId, pending: false });
      }).pipe(Effect.provide(ProjectionStore.layer)),
    ),
  );
  it.effect(
    "sends the deletion of a conversation deleted after its export and before activation",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const projections = yield* ProjectionStore.ProjectionStoreV2;
          const { stateDir } = yield* ServerConfig.ServerConfig;
          const archive = yield* Ref.get(f.archive);
          const thread = archive.projection.thread;
          yield* projections.apply({
            id: EventId.make("exported-created"),
            threadId,
            type: "thread.created",
            payload: thread,
            occurredAt: thread.createdAt,
          });
          yield* projections.apply({
            id: EventId.make("exported-message"),
            threadId,
            type: "message.updated",
            payload: archive.projection.messages[0]!,
            occurredAt: thread.createdAt,
          });
          yield* f.event(1, "thread.created", "{}");
          yield* f.event(2, "message.updated", '{"streaming":false}');

          // `export` uploads the conversation live and records itself until `activate`.
          const migration = yield* Migration.LibraryMigration.pipe(
            Effect.provide(
              Migration.layer.pipe(
                Layer.provide(
                  Layer.mock(ProjectStore.ProjectStoreV2)({
                    list: () =>
                      Effect.succeed([
                        {
                          projectId: localProjectId,
                          title: "Original source folder",
                          workspaceRoot: copy.repositories[0]!.path,
                          defaultModelSelection: null,
                          defaultThreadEnvMode: null,
                          autoPull: false,
                          faviconPath: null,
                          projectIcon: null,
                          scripts: [],
                          createdAt: project.createdAt,
                          updatedAt: project.updatedAt,
                          deletedAt: null,
                        },
                      ]),
                  }),
                ),
              ),
            ),
          );
          const exported = yield* migration.exportShadow({
            requestId: "onboarding",
            journalId: "migration",
            plan: {
              sourceEnvironmentId: source,
              projects: [project],
              copies: [
                {
                  copy,
                  localProjects: [
                    { localProjectId, cwd: copy.repositories[0]!.path, resourceIds: [resource.id] },
                  ],
                },
              ],
              excludedThreadIds: [],
            },
          });
          expect(exported.threads.map((entry) => entry.summary)).toMatchObject([
            { threadId, deleted: false, sequence: 2 },
          ]);
          yield* Migration.recordPendingImport({
            stateDir,
            requestId: "onboarding",
            threadIds: [threadId],
          });

          // Deleted while still unbound, and more than a day passes before activation.
          yield* projections.apply({
            id: EventId.make("exported-deleted"),
            threadId,
            type: "thread.deleted",
            payload: { ...thread, deletedAt: thread.createdAt },
            occurredAt: thread.createdAt,
          });
          yield* f.event(3, "thread.deleted", "{}");
          yield* f.sql`INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json) VALUES (4,'other-created',0,'2026-10-15T00:00:00.000Z','server','{}',2,'thread','other-thread','thread.created','{}')`;
          yield* TestClock.setTime(DateTime.toEpochMillis(thread.createdAt) + 25 * 60 * 60 * 1000);

          let activated = false;
          const store = WorkspaceStore.LibraryWorkspaceStore.of({
            ...workspace,
            bindings: Effect.sync(() =>
              activated
                ? [
                    {
                      threadId,
                      resolved,
                      importedHistory: {
                        authorityId: "authority",
                        authorityEpoch: 1,
                        sequence: 2,
                        sourceEventSequence: 2,
                      },
                    },
                  ]
                : [],
            ),
            getBinding: () => Effect.sync(() => (activated ? resolved : null)),
          });
          const history = yield* DeletedThreadHistory.DeletedThreadHistory.pipe(
            Effect.provide(
              DeletedThreadHistory.layer.pipe(
                Layer.provide(
                  Layer.mergeAll(
                    Layer.succeed(WorkspaceStore.LibraryWorkspaceStore, store),
                    Layer.succeed(Publisher.LibraryPublisher, f.publisher),
                  ),
                ),
              ),
            ),
          );
          expect((yield* history.pass()).purgedThreads).toBe(0);
          expect(yield* f.sql`SELECT thread_id FROM fork_library_source_threads`).toEqual([]);

          // `activate` binds the conversation at its exported sequence and removes the record.
          activated = true;
          yield* Migration.clearPendingImport({ stateDir, requestId: "onboarding" });
          const sources = yield* HistorySource.LibraryHistorySource.pipe(
            Effect.provide(
              HistorySource.layer.pipe(
                Layer.provide(Layer.succeed(WorkspaceStore.LibraryWorkspaceStore, store)),
                Layer.provide(
                  Layer.succeed(ServerEnvironmentIdentity, {
                    getEnvironmentId: Effect.succeed(source),
                  }),
                ),
              ),
            ),
          );
          const service = yield* Replication.LibraryReplication.pipe(
            Effect.provide(Replication.layer),
            Effect.provideService(Publisher.LibraryPublisher, f.publisher),
            Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, store),
            Effect.provideService(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(source),
            }),
            Effect.provideService(HistorySource.LibraryHistorySource, sources),
          );
          yield* service.drain;
          expect(
            (yield* Ref.get(f.requests)).flatMap((request) =>
              request.entries.map((entry) => entry.thread.summary),
            ),
          ).toMatchObject([{ threadId, sequence: 3, deleted: true }]);

          // Once the Library holds the deletion, the history goes.
          expect((yield* history.pass()).purgedThreads).toBe(1);
        }).pipe(
          Effect.provide(
            Layer.merge(
              ProjectionStore.layer,
              ServerConfig.layerTest(process.cwd(), { prefix: "library-replication-import-" }),
            ),
          ),
        ),
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
  it.effect(
    "does not snapshot a waiting conversation again until the outbox has room for its last size",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const other = ThreadId.make("other-thread");
          const taken = yield* Ref.make<ThreadId[]>([]);
          yield* Ref.update(f.archive, (archive) => withText(archive, longText));
          const service = yield* serviceFor(f, [other, threadId], (input) =>
            Ref.update(taken, (ids) => [...ids, input.threadId]).pipe(
              Effect.andThen(Ref.get(f.archive)),
            ),
          );
          const snapshots = Ref.get(taken).pipe(
            Effect.map((ids) => ids.filter((id) => id === threadId).length),
          );
          // Each snapshot fits the outbox alone, but not beside the other's, which the Library
          // has not acknowledged yet.
          yield* Ref.set(f.failAck, true);
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("io");
          expect(yield* snapshots).toBe(1);
          for (let attempt = 0; attempt < 3; attempt++) {
            yield* TestClock.adjust("5 seconds");
            expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("io");
          }
          expect(yield* snapshots).toBe(1);
          // This pass captures before its acknowledgement frees the room.
          yield* Ref.set(f.failAck, false);
          expect((yield* service.drain.pipe(Effect.flip)).reason).toBe("storage-limit");
          expect(yield* snapshots).toBe(1);
          yield* service.drain;
          expect(yield* snapshots).toBe(2);
          expect(yield* service.status).toMatchObject({ pendingEntries: 0, lastFailure: null });
          // A flush still takes a milestone inside the conversation's spacing.
          yield* f.event(2, "thread.settled", "{}");
          yield* Ref.update(f.archive, (archive) => ({
            ...archive,
            summary: { ...archive.summary, sequence: 2 },
          }));
          yield* service.drain;
          expect(yield* snapshots).toBe(2);
          yield* service.flush;
          expect(yield* snapshots).toBe(3);
          expect((yield* service.status).threads[1]).toMatchObject({
            acknowledgedSequence: 2,
            pending: false,
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
        projects: () => Effect.die("unused"),
        conversations: () => Effect.die("unused"),
        lookupThread: () => Effect.die("unused"),
        history: () => Effect.die("unused"),
        search: () => Effect.die("unused"),
        timeline: () => Effect.die("unused"),
        launchCandidates: () => Effect.die("unused"),
        copyRegistrations: Stream.empty,
        publishDocuments: () => Effect.die("unused"),
        decisions: () => Effect.die("unused"),
        enabled: false,
        info: Effect.fail(new LibraryError({ reason: "blocked" })),
        ingest: () => Effect.fail(new LibraryError({ reason: "blocked" })),
        registerCopy: () => Effect.fail(new LibraryError({ reason: "blocked" })),
        recordActivity: () => Effect.fail(new LibraryError({ reason: "blocked" })),
        publishAttachments: () => Effect.succeed(new Set<string>()),
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
  it.effect("snapshots a conversation on the reader while another write holds the writer", () =>
    runOn(fileDatabase)((f) =>
      Effect.gen(function* () {
        const { projections, history } = yield* Effect.all({
          projections: ProjectionStore.ProjectionStoreV2,
          history: HistorySource.LibraryHistorySource,
        }).pipe(
          Effect.provide(HistorySource.layer.pipe(Layer.provideMerge(ProjectionStore.layer))),
          Effect.provideService(WorkspaceStore.LibraryWorkspaceStore, workspace),
          Effect.provideService(ServerEnvironmentIdentity, {
            getEnvironmentId: Effect.succeed(source),
          }),
        );
        yield* projections.apply({
          id: EventId.make("library-reader:thread"),
          type: "thread.created",
          threadId,
          providerInstanceId: readerProvider,
          occurredAt: readerAt,
          payload: {
            createdBy: "user",
            creationSource: "web",
            id: threadId,
            projectId: localProjectId,
            title: "Read on the reader",
            providerInstanceId: readerProvider,
            modelSelection: { instanceId: readerProvider, model: "gpt-5" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: readerAt,
            updatedAt: readerAt,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        });
        yield* f.event(1, "thread.created", "{}");
        const started = yield* Deferred.make<void>();
        const held = yield* Deferred.make<void>();
        const snapshotted = yield* Deferred.make<void>();
        // Forked outside the drain, so this transaction takes the writer itself. A snapshot that
        // needed the writer would wait for it forever.
        const writer = yield* Deferred.await(started).pipe(
          Effect.andThen(
            f.sql.withTransaction(
              Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(snapshotted))),
            ),
          ),
          Effect.forkChild,
        );
        const service = yield* serviceFor(f, [threadId], (input) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(held)),
            Effect.andThen(history.snapshotThread(input)),
            Effect.ensuring(Deferred.succeed(snapshotted, undefined)),
          ),
        );
        yield* service.drain;
        yield* Fiber.join(writer);
        const sent = (yield* Ref.get(f.requests)).flatMap((request) => request.entries);
        expect(sent.map((entry) => [entry.thread.summary.title, entry.sequence])).toEqual([
          ["Read on the reader", 1],
        ]);
        expect((yield* service.status).pendingEntries).toBe(0);
      }),
    ),
  );
});
