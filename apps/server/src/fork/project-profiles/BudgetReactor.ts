import { CommandId, EventId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import { forkParked } from "../../serverActivation.ts";
import { makeStore } from "./ProfileStore.ts";
import { processedTokens, serverLocalDay } from "./budget.ts";

export const startBudgetReactor = Effect.gen(function* () {
  const sink = yield* EventSink.EventSinkV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const store = yield* makeStore;
  const publish = Effect.gen(function* () {
    for (const alert of yield* store.pendingAlerts) {
      const threadId = ThreadId.make(alert.thread_id);
      yield* executor.withLock(
        threadId,
        Effect.gen(function* () {
          const thread = yield* projections.getThreadShell(threadId);
          if (!thread || thread.deletedAt) {
            yield* store.published(alert.id);
            return;
          }
          const now = yield* DateTime.now;
          // The deterministic receipt closes the crash window between commit and outbox clearance.
          yield* sink.commitCommand({
            commandId: CommandId.make(alert.id),
            threadId,
            commandType: "loom.project-profiles.budget-marker",
            acceptedAt: now,
            effects: [],
            events: [
              {
                id: EventId.make(alert.id),
                threadId,
                occurredAt: now,
                type: "turn-item.updated",
                payload: {
                  id: TurnItemId.make(alert.id),
                  threadId,
                  runId: null,
                  nodeId: null,
                  providerThreadId: null,
                  providerTurnId: null,
                  nativeItemRef: null,
                  parentItemId: null,
                  ordinal: 0,
                  status: "completed",
                  title: null,
                  startedAt: now,
                  completedAt: now,
                  updatedAt: now,
                  type: "system_notice",
                  message: alert.message,
                },
              },
            ],
          });
          yield* store.published(alert.id);
        }),
      );
    }
  });
  const run = Effect.gen(function* () {
    const afterSequence = yield* store.cursor(yield* sink.latestSequence());
    yield* store.cleanup();
    yield* publish;
    yield* Stream.runForEach(
      sink.stream({ afterSequence, eventType: "provider-turn.updated", bounded: false }),
      (stored) =>
        Effect.gen(function* () {
          const event = stored.event;
          if (event.type !== "provider-turn.updated") return;
          const tokens = processedTokens(event.payload);
          const thread = tokens === null ? null : yield* projections.getThreadShell(event.threadId);
          if (tokens !== null && thread && !thread.deletedAt) {
            const profile = yield* store.get(thread.projectId);
            yield* store.recordUsage({
              projectId: thread.projectId,
              threadId: thread.id,
              turnId: event.payload.id,
              tokens,
              sequence: stored.sequence,
              day: serverLocalDay(DateTime.formatIso(event.occurredAt)),
              profile,
            });
          }
          // Accounting commits before the marker enters the event sink.
          yield* publish;
          yield* store.advance(stored.sequence);
        }),
    );
  });
  yield* forkParked(run.pipe(Effect.retry(Schedule.spaced("5 seconds"))));
  yield* forkParked(
    sink.stream({ eventType: "thread.deleted", bounded: false }).pipe(
      Stream.runForEach(() => store.cleanup()),
      Effect.retry(Schedule.spaced("5 seconds")),
    ),
  );
  yield* forkParked(
    store.cleanup().pipe(Effect.repeat(Schedule.spaced("1 hour")), Effect.ignore({ log: true })),
  );
});
export const layer = Layer.effectDiscard(startBudgetReactor);
