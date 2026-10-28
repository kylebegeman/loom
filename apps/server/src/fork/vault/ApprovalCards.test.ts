import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import { VaultError, type VaultApprovalRequest } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as PubSub from "effect/PubSub";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as VaultCore from "./VaultCore.ts";
import * as ApprovalCards from "./ApprovalCards.ts";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";

const database = SqlitePersistence.layerMemory;
const stores = Layer.mergeAll(
  database,
  EventStore.layer.pipe(Layer.provide(database)),
  ProjectionStore.layer.pipe(Layer.provide(database)),
);
const persistence = Layer.mergeAll(
  stores,
  EventSink.layer.pipe(Layer.provide(stores)),
  ThreadCommandExecutor.layer,
).pipe(Layer.provideMerge(NodeServices.layer));
const at = Date.UTC(2026, 9, 28, 12);
const threadId = ThreadId.make("approval-thread");
const request: VaultApprovalRequest = {
  id: "a".repeat(32),
  threadId,
  itemId: "b".repeat(32),
  action: "reveal",
  destination: "synthetic.local",
  projectId: "project",
  itemVersion: 1,
  policyRevision: 1,
  revision: 1,
  requestedBy: "synthetic-agent",
  requestedAt: at,
  requestExpiresAt: at + 600_000,
  state: "pending",
  decidedBy: null,
  approvedUntil: null,
  grantId: null,
};
const thread = (): OrchestrationV2AppThread => ({
  id: threadId,
  projectId: ProjectId.make("project"),
  title: "Approval test",
  providerInstanceId: ProviderInstanceId.make("claude"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  createdAt: DateTime.makeUnsafe(at),
  updatedAt: DateTime.makeUnsafe(at),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
});
const createThread = Effect.gen(function* () {
  yield* TestClock.setTime(at);
  const sink = yield* EventSink.EventSinkV2;
  yield* sink.write({
    events: [
      {
        id: EventId.make("thread-created"),
        type: "thread.created",
        threadId,
        occurredAt: DateTime.makeUnsafe(at),
        payload: thread(),
      },
    ],
  });
});
const itemId = TurnItemId.make(`vault-approval:${request.id}`);
const readCard = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const item = yield* projections.getTurnItem({ threadId, itemId });
  if (item?.type !== "vault_access_request") throw new Error("Expected a Vault approval card");
  return item;
});

it.effect("commits one metadata-only card and keeps lifecycle and revision order", () =>
  Effect.gen(function* () {
    yield* createThread;
    const cards = yield* ApprovalCards.ApprovalCards;
    const store = yield* EventStore.EventStoreV2;
    yield* cards.post(request);
    const first = yield* readCard;
    expect(first).toMatchObject({
      id: itemId,
      state: "pending",
      status: "waiting",
      itemLabel: "Synthetic token",
      itemKind: "secret",
      revision: 1,
    });
    expect(DateTime.toEpochMillis(first.startedAt!)).toBe(at);
    const approved = {
      ...request,
      revision: 2,
      state: "approved" as const,
      decidedBy: "owner",
      grantId: request.id,
      approvedUntil: at + 300_000,
    };
    yield* Effect.all([cards.post(request), cards.post(approved), cards.post(request)], {
      concurrency: "unbounded",
    });
    const afterApproval = yield* readCard;
    expect(afterApproval).toMatchObject({
      state: "approved",
      status: "completed",
      revision: 2,
      ordinal: first.ordinal,
      startedAt: first.startedAt,
    });
    yield* cards.post({ ...request, revision: 2 });
    yield* cards.post({ ...approved, state: "expired" });
    yield* cards.post(approved);
    const expired = yield* readCard;
    expect(expired).toMatchObject({ state: "expired", revision: 2, ordinal: first.ordinal });
    const renewed = { ...request, requestedAt: at + 86_400_001, requestExpiresAt: at + 87_000_001 };
    yield* TestClock.setTime(renewed.requestedAt);
    yield* cards.post(renewed);
    yield* cards.post({ ...approved, revision: 99 });
    const newest = yield* readCard;
    expect(newest).toMatchObject({ state: "pending", revision: 1, id: itemId });
    expect(DateTime.toEpochMillis(newest.startedAt!)).toBe(renewed.requestedAt);
    const events = yield* store.read({ threadId }).pipe(Stream.runCollect);
    const updates = events.filter((event) => event.event.type === "turn-item.updated");
    expect(updates).toHaveLength(4);
    expect(new Set(updates.map((event) => event.commandId)).size).toBe(4);
    expect(JSON.stringify(updates)).not.toContain("private-value-must-not-leak");
  }).pipe(
    Effect.provide(
      ApprovalCards.layer.pipe(
        Layer.provideMerge(persistence),
        Layer.provide(
          Layer.mock(VaultCore.VaultCore)({
            inspect: () =>
              Effect.succeed({
                label: "Synthetic token",
                kind: "secret",
                value: "private-value-must-not-leak",
              } as never),
          }),
        ),
      ),
    ),
  ),
);

it.effect(
  "retains labels on backend failure, uses a safe missing-item label and skips deleted threads",
  () => {
    let reads = 0;
    return Effect.gen(function* () {
      yield* createThread;
      const cards = yield* ApprovalCards.ApprovalCards;
      yield* cards.post(request);
      const first = yield* readCard;
      expect(first.itemLabel).toBe("First label");
      yield* cards.post({ ...request, revision: 2, state: "denied" });
      expect(yield* readCard).toMatchObject({
        itemLabel: "First label",
        itemKind: "secret",
        state: "denied",
      });
      const other = { ...request, id: "c".repeat(32) };
      yield* cards.post(other);
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      expect(
        yield* projections.getTurnItem({
          threadId,
          itemId: TurnItemId.make(`vault-approval:${other.id}`),
        }),
      ).toMatchObject({ itemLabel: "Vault item unavailable", itemKind: null });
      const sink = yield* EventSink.EventSinkV2;
      yield* sink.write({
        events: [
          {
            id: EventId.make("thread-deleted"),
            type: "thread.metadata-updated",
            threadId,
            occurredAt: DateTime.makeUnsafe(at),
            payload: { ...thread(), deletedAt: DateTime.makeUnsafe(at) },
          },
        ],
      });
      yield* cards.post({ ...request, revision: 3, state: "cancelled" });
      yield* cards.post({ ...request, threadId: ThreadId.make("missing") });
      expect(yield* readCard).toMatchObject({ state: "denied", revision: 2 });
    }).pipe(
      Effect.provide(
        ApprovalCards.layer.pipe(
          Layer.provideMerge(persistence),
          Layer.provide(
            Layer.mock(VaultCore.VaultCore)({
              inspect: () =>
                ++reads === 1
                  ? Effect.succeed({ label: "First label", kind: "secret" } as never)
                  : Effect.fail(new VaultError({ reason: "unavailable" })),
            }),
          ),
        ),
      ),
    );
  },
);

it.effect(
  "subscribes immediately and recovers a failed commit when the current view is republished",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* createThread;
        const sink = yield* EventSink.EventSinkV2;
        const committed = yield* Deferred.make<void>();
        const changes = yield* PubSub.unbounded<VaultApprovalRequest>();
        let attempts = 0;
        const flaky = EventSink.EventSinkV2.of({
          ...sink,
          commitCommand: (input) =>
            Effect.gen(function* () {
              attempts++;
              if (attempts === 1)
                return yield* new EventSink.EventSinkWriteError({ eventCount: 1 });
              const result = yield* sink.commitCommand(input);
              yield* Deferred.succeed(committed, undefined);
              return result;
            }),
        });
        yield* Layer.build(
          ApprovalCards.reactor.pipe(
            Layer.provide(ApprovalCards.layer),
            Layer.provide(
              Layer.mock(ApprovalNotifications.ApprovalNotifications)({
                changes: Stream.fromPubSub(changes),
              }),
            ),
            Layer.provide(Layer.succeed(EventSink.EventSinkV2, flaky)),
          ),
        );
        yield* PubSub.publish(changes, request);
        yield* PubSub.publish(changes, request);
        yield* Deferred.await(committed);
        expect(attempts).toBe(2);
        expect(yield* readCard).toMatchObject({ requestId: request.id, state: "pending" });
      }),
    ).pipe(
      Effect.provide(persistence),
      Effect.provide(Layer.mock(VaultCore.VaultCore)({ inspect: () => Effect.succeed(null) })),
    ),
);
