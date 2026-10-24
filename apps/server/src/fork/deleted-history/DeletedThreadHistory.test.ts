import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  ContextTransferId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { LibraryResolvedBinding } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as Statement from "effect/sql/Statement";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../../config.ts";
import { CodexProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as ProjectionMaintenance from "../../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { ServerActivation } from "../../serverActivation.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { LibraryHistoryMigrations } from "../project-library/history-migrations.ts";
import * as LibraryMigration from "../project-library/LibraryMigration.ts";
import * as Publisher from "../project-library/LibraryPublisher.ts";
import { ProjectLibraryMigrations } from "../project-library/migrations.ts";
import * as WorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";
import { localProjectId, resource, source } from "../project-library/Library.testkit.ts";
import * as DeletedThreadHistory from "./DeletedThreadHistory.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const deletedAt = Date.UTC(2026, 9, 1);
const hour = 60 * 60 * 1000;
// Every test runs a day and an hour after `deletedAt`.
const now = deletedAt + 25 * hour;
const at = (ms: number) => DateTime.makeUnsafe(ms);

const resolved: LibraryResolvedBinding = {
  cwd: "/workspace",
  localProjectId,
  repositoryPaths: ["/workspace/api"],
  binding: {
    projectId: "project",
    projectRevision: 1,
    workingCopyId: "copy",
    environmentId: source,
    resourceIds: [resource.id],
  },
};

const makeThread = (
  id: string,
  overrides: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread => ({
  createdBy: "user",
  creationSource: "web",
  id: ThreadId.make(id),
  projectId: ProjectId.make("project"),
  title: id,
  providerInstanceId,
  modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
  forkedFrom: null,
  createdAt: at(deletedAt - hour),
  updatedAt: at(deletedAt - hour),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
  ...overrides,
});

let eventIndex = 0;
const eventId = () => EventId.make(`event:${(eventIndex += 1)}`);
const created = (thread: OrchestrationV2AppThread): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "thread.created",
  threadId: thread.id,
  providerInstanceId,
  occurredAt: thread.createdAt,
  payload: thread,
});
const deleted = (thread: OrchestrationV2AppThread, ms = deletedAt): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "thread.deleted",
  threadId: thread.id,
  occurredAt: at(ms),
  payload: { ...thread, deletedAt: at(ms), updatedAt: at(ms) },
});
const renamed = (thread: OrchestrationV2AppThread): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "thread.metadata-updated",
  threadId: thread.id,
  occurredAt: at(deletedAt),
  payload: { ...thread, title: `${thread.title} ${eventIndex}` },
});
const message = (
  thread: OrchestrationV2AppThread,
  text: string,
  attachmentId?: string,
): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "message.updated",
  threadId: thread.id,
  occurredAt: thread.createdAt,
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: MessageId.make(`message:${thread.id}:${eventIndex}`),
    threadId: thread.id,
    runId: null,
    nodeId: null,
    role: "user",
    text,
    attachments:
      attachmentId === undefined
        ? []
        : [
            {
              type: "image",
              id: ChatAttachmentId.make(attachmentId),
              name: "shot.png",
              mimeType: "image/png",
              sizeBytes: 3,
            },
          ],
    streaming: false,
    createdAt: thread.createdAt,
    updatedAt: thread.createdAt,
  },
});
const subagent = (
  parent: OrchestrationV2AppThread,
  input: {
    readonly id: string;
    readonly prompt: string;
    readonly child?: ThreadId;
    readonly providerThreadId?: ProviderThreadId;
  },
): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "subagent.updated",
  threadId: parent.id,
  nodeId: NodeId.make(input.id),
  providerInstanceId,
  occurredAt: parent.createdAt,
  payload: {
    id: NodeId.make(input.id),
    threadId: parent.id,
    runId: null,
    parentNodeId: NodeId.make(`${input.id}:parent`),
    origin: "app_owned",
    createdBy: "agent",
    driver,
    providerInstanceId,
    providerThreadId: input.providerThreadId ?? null,
    childThreadId: input.child ?? null,
    nativeTaskRef: null,
    prompt: input.prompt,
    title: "Child",
    model: "gpt-5.4",
    status: "running",
    result: null,
    startedAt: parent.createdAt,
    completedAt: null,
    updatedAt: parent.createdAt,
  },
});
const transfer = (input: {
  readonly id: string;
  readonly type: "fork" | "subagent_spawn" | "subagent_result";
  readonly stream: OrchestrationV2AppThread;
  readonly from: ThreadId;
  readonly to: ThreadId;
}): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "context-transfer.created",
  threadId: input.stream.id,
  providerInstanceId,
  occurredAt: input.stream.createdAt,
  payload: {
    id: ContextTransferId.make(input.id),
    type: input.type,
    sourceThreadId: input.from,
    targetThreadId: input.to,
    sourcePoint: { threadId: input.from },
    basePoint: null,
    sourceProviderInstanceId: providerInstanceId,
    targetProviderInstanceId: providerInstanceId,
    targetRunId: null,
    status: "consumed",
    resolution: null,
    createdBy: "agent",
    error: null,
    createdAt: input.stream.createdAt,
    updatedAt: input.stream.createdAt,
    consumedAt: input.stream.createdAt,
  },
});
const completedRun = (
  thread: OrchestrationV2AppThread,
  runId: RunId,
): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "run.created",
  threadId: thread.id,
  runId,
  occurredAt: thread.createdAt,
  payload: {
    id: runId,
    threadId: thread.id,
    ordinal: 1,
    providerInstanceId,
    modelSelection: thread.modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${runId}`),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: thread.createdAt,
    startedAt: thread.createdAt,
    completedAt: thread.createdAt,
    checkpointId: null,
    contextHandoffId: null,
  },
});
const sessionAttached = (
  thread: OrchestrationV2AppThread,
  sessionId: ProviderSessionId,
): OrchestrationV2DomainEvent => ({
  id: eventId(),
  type: "provider-session.attached",
  threadId: thread.id,
  driver,
  providerInstanceId,
  occurredAt: thread.createdAt,
  payload: {
    id: sessionId,
    driver,
    providerInstanceId,
    status: "stopped",
    cwd: "/workspace",
    model: "gpt-5.4",
    capabilities: CodexProviderCapabilitiesV2,
    createdAt: thread.createdAt,
    updatedAt: thread.createdAt,
    lastError: null,
  },
});

const database = SqlitePersistence.layerMemory.pipe(Layer.provideMerge(NodeServices.layer));
const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
  Layer.provideMerge(database),
);
const testLayer = Layer.mergeAll(
  EventSink.layer,
  ProjectionMaintenance.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "deleted-history-" }),
).pipe(Layer.provideMerge(stores));

const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    return yield* use(f);
  }).pipe(
    // The cleanup loop never starts; each test runs its passes directly.
    Effect.provideService(ServerActivation, Effect.never),
    Effect.provide(testLayer),
    Effect.scoped,
  );

const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  yield* runForkMigrationSet(LibraryHistoryMigrations);
  yield* TestClock.setTime(now);
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink.EventSinkV2;
  const eventStore = yield* EventStore.EventStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bound = new Set<string>();
  // Each runs once, at the next binding lookup: right before an unbound thread's first delete,
  // after the pass evaluated it and loaded its links.
  const beforeFirstDelete: Array<Effect.Effect<void>> = [];
  // A fresh service, as after a restart. Without a Library connection replication never runs.
  const historyWith = (options: { readonly replicating: boolean }) =>
    DeletedThreadHistory.DeletedThreadHistory.pipe(
      Effect.provide(
        DeletedThreadHistory.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceStore.LibraryWorkspaceStore)({
                bindings: Effect.sync(() =>
                  [...bound].map((threadId) => ({ threadId: ThreadId.make(threadId), resolved })),
                ),
                getBinding: (threadId) =>
                  Effect.suspend(() => beforeFirstDelete.shift() ?? Effect.void).pipe(
                    Effect.as(bound.has(threadId) ? resolved : null),
                  ),
              }),
              Layer.mock(Publisher.LibraryPublisher)({ enabled: options.replicating }),
            ),
          ),
        ),
      ),
    );
  const history = historyWith({ replicating: true });
  const service = yield* history;
  const write = (...events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
    sink.write({ events }).pipe(Effect.asVoid, Effect.orDie);
  // A live conversation that always owns the newest event, which a purge never deletes.
  const live = makeThread("thread:live");
  yield* write(created(live));
  const advance = Effect.suspend(() => write(renamed(live)));
  const eventTypes = (threadId: ThreadId) =>
    eventStore.read({ threadId }).pipe(
      Stream.runCollect,
      Effect.map((events) => Array.from(events, (stored) => stored.event.type)),
    );
  const deletion = (threadId: ThreadId) =>
    sql<{ readonly sequence: number }>`
      SELECT sequence FROM orchestration_events
      WHERE stream_id = ${threadId} AND event_type = 'thread.deleted'`.pipe(
      Effect.map((rows) => rows[0]!.sequence),
    );
  const acknowledge = (threadId: ThreadId, sequence: number) =>
    sql`
      INSERT INTO fork_library_source_threads (thread_id, queued_sequence, acknowledged_sequence)
      VALUES (${threadId}, ${sequence}, ${sequence})
      ON CONFLICT(thread_id) DO UPDATE SET acknowledged_sequence = excluded.acknowledged_sequence`;
  const attachment = (id: string) => path.join(config.attachmentsDir, `${id}.png`);
  const saveAttachment = (id: string) => fs.writeFileString(attachment(id), "png");
  return {
    sql,
    eventStore,
    projections,
    maintenance,
    fs,
    bound,
    beforeFirstDelete,
    history,
    historyWith,
    service,
    write,
    live,
    advance,
    eventTypes,
    deletion,
    acknowledge,
    attachment,
    saveAttachment,
    stateDir: config.stateDir,
  };
});

const kept = ["thread.created", "thread.deleted"];

describe("deleted conversation history purge", () => {
  it.effect(
    "purges an old deleted conversation to its creation and deletion, and verify and rebuild keep it deleted",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const old = makeThread("thread:old");
          const attachmentId = "old-00000000-0000-4000-8000-000000000001";
          yield* f.saveAttachment(attachmentId);
          yield* f.write(
            created(old),
            message(old, "first"),
            message(old, "with a file", attachmentId),
          );
          yield* f.write(deleted(old));
          yield* f.advance;
          const row = f.sql`
            SELECT thread_id, deleted_at FROM orchestration_v2_projection_threads
            WHERE thread_id = ${old.id}`;
          const before = yield* row;

          const result = yield* f.service.pass();
          assert.deepEqual(
            { purged: result.purgedThreads, events: result.deletedEvents, pending: result.pending },
            { purged: 1, events: 2, pending: false },
          );
          assert.deepEqual(yield* f.eventTypes(old.id), kept);
          assert.deepEqual(
            yield* f.sql`SELECT message_id FROM orchestration_v2_projection_messages
              WHERE thread_id = ${old.id}`,
            [],
          );
          assert.isFalse(yield* f.fs.exists(f.attachment(attachmentId)));
          // An unbound conversation is recorded as delivered, so a later binding cannot send
          // what is left of it.
          const sequence = yield* f.deletion(old.id);
          assert.deepEqual(
            yield* f.sql`SELECT queued_sequence, acknowledged_sequence
              FROM fork_library_source_threads WHERE thread_id = ${old.id}`,
            [{ queued_sequence: sequence, acknowledged_sequence: sequence }],
          );
          assert.isTrue((yield* f.maintenance.verify).valid);
          assert.isTrue((yield* f.maintenance.rebuild).valid);
          assert.deepEqual(yield* row, before);
          assert.isNotNull((yield* f.projections.getThreadProjection(old.id)).thread.deletedAt);
          assert.isTrue((yield* f.maintenance.verify).valid);
          assert.equal((yield* f.service.pass()).purgedThreads, 0);
        }),
      ),
  );

  it.effect("ends a client replaying from an old cursor with the conversation deleted", () =>
    run((f) =>
      Effect.gen(function* () {
        const old = makeThread("thread:replayed");
        yield* f.write(created(old), message(old, "seen by the client"));
        const cursor = yield* f.eventStore.latestSequence({ threadId: old.id });
        yield* f.write(message(old, "not yet seen"), deleted(old));
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 1);
        const replay = yield* f.eventStore
          .read({ threadId: old.id, afterSequence: cursor })
          .pipe(Stream.runCollect);
        assert.deepEqual(
          Array.from(replay, (stored) => stored.event.type),
          ["thread.deleted"],
        );
        const last = Array.from(replay).at(-1)!.event;
        assert.isTrue(last.type === "thread.deleted" && last.payload.deletedAt !== null);
      }),
    ),
  );

  it.effect("leaves unacknowledged and recently deleted conversations untouched", () =>
    run((f) =>
      Effect.gen(function* () {
        const unacknowledged = makeThread("thread:unacknowledged");
        const neverSent = makeThread("thread:never-sent");
        const recent = makeThread("thread:recent");
        const queued = makeThread("thread:queued");
        for (const thread of [unacknowledged, neverSent, queued]) {
          yield* f.write(created(thread), message(thread, "kept"), deleted(thread));
          f.bound.add(thread.id);
        }
        yield* f.write(created(recent), message(recent, "kept"), deleted(recent, now - hour));
        yield* f.advance;
        const unacknowledgedDeletion = yield* f.deletion(unacknowledged.id);
        yield* f.acknowledge(unacknowledged.id, unacknowledgedDeletion - 1);
        // The Library holds the deletion, but a newer snapshot still waits to go up.
        yield* f.acknowledge(queued.id, yield* f.deletion(queued.id));
        yield* f.sql`INSERT INTO fork_library_source_outbox (thread_id, source_sequence, payload_json)
          VALUES (${queued.id}, ${yield* f.deletion(queued.id)}, '{}')`;

        const result = yield* f.service.pass();
        assert.equal(result.purgedThreads, 0);
        for (const thread of [unacknowledged, neverSent, recent, queued])
          assert.deepEqual(yield* f.eventTypes(thread.id), [
            "thread.created",
            "message.updated",
            "thread.deleted",
          ]);
        assert.deepEqual(
          yield* f.sql`SELECT thread_id FROM fork_library_source_threads ORDER BY thread_id`,
          [{ thread_id: queued.id }, { thread_id: unacknowledged.id }],
        );

        yield* f.acknowledge(unacknowledged.id, unacknowledgedDeletion);
        assert.equal((yield* f.service.pass()).purgedThreads, 1);
        assert.deepEqual(yield* f.eventTypes(unacknowledged.id), kept);
        assert.isTrue((yield* f.maintenance.verify).valid);
      }),
    ),
  );

  it.effect("keeps an unbound conversation that an export not yet activated holds", () =>
    run((f) =>
      Effect.gen(function* () {
        const exported = makeThread("thread:exported");
        const ordinary = makeThread("thread:ordinary");
        for (const thread of [exported, ordinary])
          yield* f.write(created(thread), message(thread, "kept"), deleted(thread));
        yield* f.advance;
        yield* LibraryMigration.recordPendingImport({
          stateDir: f.stateDir,
          requestId: "onboarding",
          threadIds: [exported.id],
        });

        assert.equal((yield* f.service.pass()).purgedThreads, 1);
        assert.deepEqual(yield* f.eventTypes(ordinary.id), kept);
        assert.deepEqual(yield* f.eventTypes(exported.id), [
          "thread.created",
          "message.updated",
          "thread.deleted",
        ]);
        assert.deepEqual(yield* f.sql`SELECT thread_id FROM fork_library_source_threads`, [
          { thread_id: ordinary.id },
        ]);

        // Activation binds it and removes the record; the Library then gets the deletion.
        f.bound.add(exported.id);
        yield* LibraryMigration.clearPendingImport({
          stateDir: f.stateDir,
          requestId: "onboarding",
        });
        assert.equal((yield* f.service.pass()).purgedThreads, 0);
        yield* f.acknowledge(exported.id, yield* f.deletion(exported.id));
        assert.equal((yield* f.service.pass()).purgedThreads, 1);
        assert.deepEqual(yield* f.eventTypes(exported.id), kept);
      }),
    ),
  );

  it.effect("keeps every prompt readable while a purge stops between pages", () =>
    run((f) =>
      Effect.gen(function* () {
        const old = makeThread("thread:subagents");
        const prompt = "Inspect the whole repository and report back";
        yield* f.write(
          created(old),
          ...Array.from({ length: 60 }, () => subagent(old, { id: "subagent:repeated", prompt })),
        );
        yield* f.write(deleted(old));
        yield* f.advance;
        // Later ticks store only a pointer to the first row's prompt.
        const pointers = yield* f.sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM orchestration_events
          WHERE stream_id = ${old.id} AND json_type(payload_json, '$.promptSequence') = 'integer'`;
        assert.isAbove(pointers[0]!.count, 50);

        const first = yield* f.service.pass({ maxPages: 1 });
        assert.deepEqual(
          { purged: first.purgedThreads, events: first.deletedEvents, pending: first.pending },
          { purged: 0, events: 50, pending: true },
        );
        const remaining = yield* f.eventStore.read({ threadId: old.id }).pipe(Stream.runCollect);
        const prompts = Array.from(remaining).flatMap((stored) =>
          stored.event.type === "subagent.updated" ? [stored.event.payload.prompt] : [],
        );
        assert.deepEqual(
          prompts,
          Array.from({ length: 10 }, () => prompt),
        );
        assert.isTrue((yield* f.maintenance.verify).valid);
        assert.isTrue((yield* f.maintenance.rebuild).valid);

        assert.equal((yield* f.service.pass()).purgedThreads, 1);
        assert.deepEqual(yield* f.eventTypes(old.id), kept);
        assert.isTrue((yield* f.maintenance.verify).valid);
      }),
    ),
  );

  // Parent and child are linked every way a subagent links them; the cases after this one each
  // keep a thread through one link alone.
  it.effect("keeps a deleted child while its parent is live, then purges both together", () =>
    run((f) =>
      Effect.gen(function* () {
        const parent = makeThread("thread:parent");
        const child = makeThread("thread:child", {
          createdBy: "agent",
          creationSource: "provider",
          lineage: {
            parentThreadId: parent.id,
            relationshipToParent: "subagent",
            rootThreadId: parent.id,
          },
        });
        const providerThreadId = ProviderThreadId.make("provider-thread:child");
        const prompt = "Inspect the child flow";
        yield* f.write(
          created(parent),
          created(child),
          subagent(parent, { id: "subagent:child", prompt, child: child.id, providerThreadId }),
          subagent(parent, { id: "subagent:child", prompt, child: child.id, providerThreadId }),
          transfer({
            id: "transfer:spawn",
            type: "subagent_spawn",
            stream: child,
            from: parent.id,
            to: child.id,
          }),
          {
            id: eventId(),
            type: "provider-thread.updated",
            threadId: parent.id,
            driver,
            providerInstanceId,
            occurredAt: parent.createdAt,
            payload: {
              id: providerThreadId,
              driver,
              providerInstanceId,
              providerSessionId: null,
              appThreadId: child.id,
              ownerNodeId: null,
              nativeThreadRef: null,
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: 1,
              lastRunOrdinal: 1,
              handoffIds: [],
              forkedFrom: null,
              createdAt: parent.createdAt,
              updatedAt: parent.createdAt,
            },
          },
          transfer({
            id: "transfer:result",
            type: "subagent_result",
            stream: parent,
            from: child.id,
            to: parent.id,
          }),
          message(child, "child work"),
        );
        yield* f.write(deleted(child));
        yield* f.advance;
        const parentView = Effect.gen(function* () {
          const projection = yield* f.projections.getThreadProjection(parent.id);
          return {
            transfers: projection.contextTransfers.map((entry) => entry.id).toSorted(),
            providerThreads: projection.providerThreads.map((entry) => entry.id),
            prompts: projection.subagents.map((entry) => entry.prompt),
          };
        });
        const expected = yield* parentView;
        assert.deepEqual(expected.transfers, ["transfer:result", "transfer:spawn"]);
        assert.deepEqual(expected.providerThreads, [providerThreadId]);

        const pinned = yield* f.service.pass();
        assert.equal(pinned.purgedThreads, 0);
        assert.deepEqual(yield* f.eventTypes(child.id), [
          "thread.created",
          "context-transfer.created",
          "message.updated",
          "thread.deleted",
        ]);
        assert.deepEqual(yield* parentView, expected);
        const parentPrompts = yield* f.eventStore.read({ threadId: parent.id }).pipe(
          Stream.runCollect,
          Effect.map((events) =>
            Array.from(events).flatMap((stored) =>
              stored.event.type === "subagent.updated" ? [stored.event.payload.prompt] : [],
            ),
          ),
        );
        assert.deepEqual(parentPrompts, [prompt, prompt]);
        assert.isTrue((yield* f.maintenance.rebuild).valid);
        assert.deepEqual(yield* parentView, expected);

        yield* f.write(deleted(parent));
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 2);
        assert.deepEqual(yield* f.eventTypes(parent.id), kept);
        assert.deepEqual(yield* f.eventTypes(child.id), kept);
        assert.isTrue((yield* f.maintenance.verify).valid);
        assert.isTrue((yield* f.maintenance.rebuild).valid);
        assert.isNotNull((yield* f.projections.getThreadProjection(child.id)).thread.deletedAt);
      }),
    ),
  );

  it.effect("keeps a deleted fork source while its live fork exists", () =>
    run((f) =>
      Effect.gen(function* () {
        const source = makeThread("thread:fork-source");
        const runId = RunId.make("run:fork-source");
        yield* f.write(created(source), completedRun(source, runId), message(source, "inherited"));
        const fork = makeThread("thread:fork", {
          forkedFrom: { type: "run", threadId: source.id, runId },
        });
        yield* f.write(created(fork), message(fork, "forked"));
        yield* f.write(deleted(source));
        yield* f.advance;
        // A run fork reads the source's runs and turn items as its own history.
        const sourceRuns = f.sql`
          SELECT run_id FROM orchestration_v2_projection_runs WHERE thread_id = ${source.id}`;

        assert.equal((yield* f.service.pass()).purgedThreads, 0);
        assert.deepEqual(yield* sourceRuns, [{ run_id: runId }]);
        assert.deepEqual(yield* f.eventTypes(source.id), [
          "thread.created",
          "run.created",
          "message.updated",
          "thread.deleted",
        ]);

        yield* f.write(deleted(fork));
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 2);
        assert.deepEqual(yield* sourceRuns, []);
        assert.isTrue((yield* f.maintenance.verify).valid);
      }),
    ),
  );

  it.effect("keeps a deleted conversation while a live one shares its provider session", () =>
    run((f) =>
      Effect.gen(function* () {
        const gone = makeThread("thread:session-deleted");
        const live = makeThread("thread:session-live");
        const sessionId = ProviderSessionId.make("provider-session:shared");
        yield* f.write(created(gone), sessionAttached(gone, sessionId), message(gone, "kept"));
        yield* f.write(created(live), sessionAttached(live, sessionId));
        yield* f.write(deleted(gone));
        yield* f.advance;

        assert.equal((yield* f.service.pass()).purgedThreads, 0);
        assert.deepEqual(yield* f.eventTypes(gone.id), [
          "thread.created",
          "provider-session.attached",
          "message.updated",
          "thread.deleted",
        ]);

        yield* f.write(deleted(live));
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 2);
        assert.deepEqual(yield* f.eventTypes(gone.id), kept);
      }),
    ),
  );

  it.effect("stops a purge when a live conversation forks the thread during the pass", () =>
    run((f) =>
      Effect.gen(function* () {
        const source = makeThread("thread:late-fork-source");
        const runId = RunId.make("run:late-fork-source");
        yield* f.write(created(source), completedRun(source, runId), message(source, "inherited"));
        yield* f.write(deleted(source));
        yield* f.advance;
        const sourceEvents = yield* f.eventTypes(source.id);
        const fork = makeThread("thread:late-fork", {
          forkedFrom: { type: "run", threadId: source.id, runId },
        });
        // The fork commits after the pass loaded its links, and writes only to its own stream.
        f.beforeFirstDelete.push(
          f.write(
            created(fork),
            transfer({
              id: "transfer:late-fork",
              type: "fork",
              stream: fork,
              from: source.id,
              to: fork.id,
            }),
          ),
        );
        const forkRecord = f.sql`
          SELECT context_transfer_id FROM orchestration_v2_projection_context_transfers
          WHERE source_thread_id = ${source.id}`;

        const result = yield* f.service.pass();
        assert.deepEqual(
          { purged: result.purgedThreads, events: result.deletedEvents, rows: result.deletedRows },
          { purged: 0, events: 0, rows: 0 },
        );
        assert.deepEqual(yield* f.eventTypes(source.id), sourceEvents);
        assert.deepEqual(yield* forkRecord, [{ context_transfer_id: "transfer:late-fork" }]);
        // Later passes see the fork in the link graph.
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 0);
        assert.deepEqual(yield* f.eventTypes(source.id), sourceEvents);

        yield* f.write(deleted(fork));
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 2);
        assert.deepEqual(yield* f.eventTypes(source.id), kept);
        assert.deepEqual(yield* forkRecord, []);
      }),
    ),
  );

  it.effect("abandons a purge when its conversation gets an event after evaluation", () =>
    run((f) =>
      Effect.gen(function* () {
        const thread = makeThread("thread:late-event");
        yield* f.write(created(thread), message(thread, "kept"), deleted(thread));
        yield* f.advance;
        f.beforeFirstDelete.push(f.write(message(thread, "late")));

        const result = yield* f.service.pass();
        assert.deepEqual(
          { purged: result.purgedThreads, events: result.deletedEvents },
          { purged: 0, events: 0 },
        );
        assert.deepEqual(yield* f.eventTypes(thread.id), [
          "thread.created",
          "message.updated",
          "thread.deleted",
          "message.updated",
        ]);

        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 1);
        assert.deepEqual(yield* f.eventTypes(thread.id), kept);
      }),
    ),
  );

  it.effect("deletes each page by seeking its rowids", () =>
    run((f) =>
      Effect.gen(function* () {
        const thread = makeThread("thread:planned");
        const runId = RunId.make("run:planned");
        // Full pages: a short rowid list is cheap enough that the planner seeks it anyway.
        yield* f.write(
          created(thread),
          completedRun(thread, runId),
          message(thread, "kept"),
          ...Array.from({ length: 60 }, (_, index) =>
            subagent(thread, { id: `subagent:planned:${index}`, prompt: "Plan the pages" }),
          ),
        );
        yield* f.write(deleted(thread));
        yield* f.advance;
        const deletes: Array<readonly [string, ReadonlyArray<unknown>]> = [];
        const capture: Statement.Transformer = (statement) => {
          const compiled = statement.compile();
          if (/^\s*DELETE FROM/.test(compiled[0])) deletes.push(compiled);
          return Effect.succeed(statement);
        };
        const result = yield* f.service
          .pass()
          .pipe(Effect.provideService(Statement.CurrentTransformer, capture));
        assert.equal(result.purgedThreads, 1);

        const tables = new Set<string>();
        for (const [text, parameters] of deletes) {
          const table = /DELETE FROM\s+"?(\w+)"?/.exec(text)![1]!;
          tables.add(table);
          const plan = yield* f.sql.unsafe<{ readonly parent: number; readonly detail: string }>(
            `EXPLAIN QUERY PLAN ${text}`,
            parameters,
          );
          assert.deepEqual(
            plan
              .filter((row) => row.parent === 0 && /^(SEARCH|SCAN) /.test(row.detail))
              .map((row) => row.detail),
            [`SEARCH ${table} USING INTEGER PRIMARY KEY (rowid=?)`],
            text,
          );
        }
        for (const table of [
          "orchestration_events",
          "orchestration_v2_projection_runs",
          "orchestration_v2_projection_subagents",
          "orchestration_v2_projection_messages",
        ])
          assert.isTrue(tables.has(table), table);
      }),
    ),
  );

  it.effect("holds a Library conversation's files until the Library has its deletion", () =>
    run((f) =>
      Effect.gen(function* () {
        const thread = makeThread("thread:held");
        const attachmentId = "held-00000000-0000-4000-8000-000000000002";
        yield* f.saveAttachment(attachmentId);
        f.bound.add(thread.id);
        yield* f.write(created(thread), message(thread, "with a file", attachmentId));
        const sent = yield* f.eventStore.latestSequence({ threadId: thread.id });
        yield* f.acknowledge(thread.id, sent);
        // Recently deleted, so only the files are in question.
        yield* f.write(deleted(thread, now - hour));
        yield* f.advance;

        const waiting = yield* f.service.pass();
        assert.deepEqual(
          { held: waiting.held, released: waiting.released },
          { held: 1, released: 0 },
        );
        assert.isTrue(yield* f.fs.exists(f.attachment(attachmentId)));

        yield* f.acknowledge(thread.id, yield* f.deletion(thread.id));
        const released = yield* f.service.pass();
        assert.deepEqual(
          { held: released.held, released: released.released, purged: released.purgedThreads },
          { held: 0, released: 1, purged: 0 },
        );
        assert.isFalse(yield* f.fs.exists(f.attachment(attachmentId)));
        assert.equal((yield* f.service.pass()).released, 0);
        // A restart checks it once more, which is harmless once the files are gone.
        assert.equal((yield* (yield* f.history).pass()).released, 1);
      }),
    ),
  );

  it.effect("keeps a conversation's history while one of its files cannot be removed", () =>
    run((f) =>
      Effect.gen(function* () {
        const thread = makeThread("thread:stuck-file");
        const attachmentId = "stuck-00000000-0000-4000-8000-000000000003";
        // A directory at the file's path makes the non-recursive remove fail.
        yield* f.fs.makeDirectory(f.attachment(attachmentId));
        yield* f.fs.writeFileString(`${f.attachment(attachmentId)}/inner`, "x");
        yield* f.write(created(thread), message(thread, "with a file", attachmentId));
        yield* f.write(deleted(thread));
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 0);
        assert.deepEqual(yield* f.eventTypes(thread.id), [
          "thread.created",
          "message.updated",
          "thread.deleted",
        ]);
        yield* f.fs.remove(f.attachment(attachmentId), { recursive: true });
        assert.equal((yield* f.service.pass()).purgedThreads, 1);
      }),
    ),
  );

  it.effect("holds a bound conversation's files until the Library has received its deletion", () =>
    run((f) =>
      Effect.gen(function* () {
        const thread = makeThread("thread:bound-unsent");
        const attachmentId = "unsent-00000000-0000-4000-8000-000000000004";
        yield* f.saveAttachment(attachmentId);
        f.bound.add(thread.id);
        yield* f.write(created(thread), message(thread, "with a file", attachmentId));
        yield* f.write(deleted(thread));
        yield* f.advance;
        const waiting = yield* f.service.pass();
        assert.deepEqual(
          { held: waiting.held, released: waiting.released, purged: waiting.purgedThreads },
          { held: 1, released: 0, purged: 0 },
        );
        assert.isTrue(yield* f.fs.exists(f.attachment(attachmentId)));

        yield* f.acknowledge(thread.id, yield* f.deletion(thread.id));
        const result = yield* f.service.pass();
        assert.deepEqual(
          { held: result.held, purged: result.purgedThreads },
          { held: 0, purged: 1 },
        );
        assert.isFalse(yield* f.fs.exists(f.attachment(attachmentId)));
      }),
    ),
  );

  it.effect("releases held files at once on a computer without a Library connection", () =>
    run((f) =>
      Effect.gen(function* () {
        const thread = makeThread("thread:disconnected");
        const attachmentId = "offline-00000000-0000-4000-8000-000000000005";
        yield* f.saveAttachment(attachmentId);
        f.bound.add(thread.id);
        yield* f.write(created(thread), message(thread, "with a file", attachmentId));
        yield* f.acknowledge(
          thread.id,
          yield* f.eventStore.latestSequence({ threadId: thread.id }),
        );
        yield* f.write(deleted(thread));
        yield* f.advance;

        const disconnected = yield* f.historyWith({ replicating: false });
        const result = yield* disconnected.pass();
        assert.deepEqual(
          { held: result.held, released: result.released, purged: result.purgedThreads },
          { held: 0, released: 1, purged: 0 },
        );
        assert.isFalse(yield* f.fs.exists(f.attachment(attachmentId)));
        // The history still waits for the Library, which a later connection may reach.
        assert.deepEqual(yield* f.eventTypes(thread.id), [
          "thread.created",
          "message.updated",
          "thread.deleted",
        ]);
      }),
    ),
  );

  it.effect("releases acknowledged files however many newer conversations are still held", () =>
    run((f) =>
      Effect.gen(function* () {
        const acknowledged = makeThread("thread:acknowledged");
        const attachmentId = "acked-00000000-0000-4000-8000-000000000006";
        yield* f.saveAttachment(attachmentId);
        yield* f.write(
          created(acknowledged),
          message(acknowledged, "with a file", attachmentId),
          deleted(acknowledged, now - 2 * hour),
        );
        yield* f.acknowledge(acknowledged.id, yield* f.deletion(acknowledged.id));
        const held = Array.from({ length: 101 }, (_, index) => makeThread(`thread:held-${index}`));
        yield* f.write(
          ...held.flatMap((thread) => [
            created(thread),
            message(thread, "kept"),
            deleted(thread, now - hour),
          ]),
        );
        yield* f.sql`
          INSERT INTO fork_library_source_threads (thread_id, queued_sequence, acknowledged_sequence)
          SELECT thread_id, 0, 0 FROM orchestration_v2_projection_threads
          WHERE thread_id LIKE 'thread:held-%'`;
        yield* f.advance;

        const result = yield* f.service.pass();
        assert.deepEqual(
          { held: result.held, released: result.released },
          { held: 101, released: 1 },
        );
        assert.isFalse(yield* f.fs.exists(f.attachment(attachmentId)));
      }),
    ),
  );

  it.effect("holds a conversation's files while a newer snapshot still waits to go up", () =>
    run((f) =>
      Effect.gen(function* () {
        const thread = makeThread("thread:snapshot-waiting");
        const attachmentId = "waiting-00000000-0000-4000-8000-000000000007";
        yield* f.saveAttachment(attachmentId);
        f.bound.add(thread.id);
        yield* f.write(
          created(thread),
          message(thread, "with a file", attachmentId),
          deleted(thread, now - hour),
        );
        yield* f.advance;
        const sequence = yield* f.deletion(thread.id);
        yield* f.acknowledge(thread.id, sequence);
        yield* f.sql`INSERT INTO fork_library_source_outbox (thread_id, source_sequence, payload_json)
          VALUES (${thread.id}, ${sequence}, '{}')`;

        const waiting = yield* f.service.pass();
        assert.deepEqual(
          { held: waiting.held, released: waiting.released },
          { held: 1, released: 0 },
        );
        assert.isTrue(yield* f.fs.exists(f.attachment(attachmentId)));

        yield* f.sql`DELETE FROM fork_library_source_outbox`;
        const released = yield* f.service.pass();
        assert.deepEqual(
          { held: released.held, released: released.released },
          { held: 0, released: 1 },
        );
        assert.isFalse(yield* f.fs.exists(f.attachment(attachmentId)));
      }),
    ),
  );

  it.effect("reports pending work while more files wait than one pass releases", () =>
    run((f) =>
      Effect.gen(function* () {
        const threads = Array.from({ length: 101 }, (_, index) =>
          makeThread(`thread:release-${index}`),
        );
        yield* f.write(
          ...threads.flatMap((thread) => [
            created(thread),
            message(thread, "kept"),
            deleted(thread, now - hour),
          ]),
        );
        yield* f.advance;
        // The Library holds every deletion, and none is old enough to purge.
        yield* f.sql`
          INSERT INTO fork_library_source_threads (thread_id, queued_sequence, acknowledged_sequence)
          SELECT stream_id, sequence, sequence FROM orchestration_events
          WHERE event_type = 'thread.deleted' AND stream_id LIKE 'thread:release-%'`;

        const first = yield* f.service.pass();
        assert.deepEqual(
          { released: first.released, pending: first.pending },
          { released: 100, pending: true },
        );
        const second = yield* f.service.pass();
        assert.deepEqual(
          { released: second.released, pending: second.pending },
          { released: 1, pending: false },
        );
      }),
    ),
  );

  it.effect("skips finished purges after a restart", () =>
    run((f) =>
      Effect.gen(function* () {
        for (const id of ["thread:finished-a", "thread:finished-b"]) {
          const thread = makeThread(id);
          yield* f.write(created(thread), message(thread, "gone"), deleted(thread));
        }
        yield* f.advance;
        assert.equal((yield* f.service.pass()).purgedThreads, 2);

        const restarted = yield* f.history;
        const result = yield* restarted.pass({ maxPages: 0 });
        assert.deepEqual(
          { purged: result.purgedThreads, pending: result.pending },
          { purged: 0, pending: false },
        );
      }),
    ),
  );

  it.effect(
    "waits for a newer event, not a minute, when a deleted conversation is the newest",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const thread = makeThread("thread:newest");
          yield* f.write(created(thread), message(thread, "gone"), deleted(thread));
          const idle = yield* f.service.pass();
          assert.deepEqual(
            { purged: idle.purgedThreads, pending: idle.pending },
            { purged: 0, pending: false },
          );
          yield* f.advance;
          assert.equal((yield* f.service.pass()).purgedThreads, 1);
        }),
      ),
  );
});
