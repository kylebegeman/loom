import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  ProviderTurnId,
  ProviderThreadId,
  NodeId,
  EventId,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { defaultProjectProfile } from "@t3tools/contracts/fork";
import * as Sqlite from "@t3tools/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectProfilesMigrations } from "./migrations.ts";
import { makeStore } from "./ProfileStore.ts";
import { startBudgetReactor } from "./BudgetReactor.ts";
it.effect(
  "commits usage before publishing each threshold exactly once, recovers pending markers and follows deletions from the head",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectProfilesMigrations);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE projection_projects (project_id TEXT, deleted_at TEXT)`;
        yield* sql`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, deleted_at TEXT)`;
        const projectId = ProjectId.make("project"),
          threadId = ThreadId.make("thread"),
          deletedThreadId = ThreadId.make("deleted-thread");
        yield* sql`INSERT INTO projection_projects VALUES (${projectId},null)`;
        yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES (${threadId},null),(${deletedThreadId},null)`;
        yield* sql`INSERT INTO fork_project_profiles_turn_usage VALUES ('deleted-turn',${deletedThreadId},${projectId},5,1)`;
        yield* sql`INSERT INTO fork_project_profiles_thread_usage VALUES (${deletedThreadId},${projectId},5)`;
        const store = yield* makeStore;
        yield* store.put({
          ...defaultProjectProfile(projectId),
          budgets: { dailyTokens: 100, threadTokens: 100 },
        });
        const done = yield* Deferred.make<void>();
        const deletionsDone = yield* Deferred.make<void>();
        const head = 10;
        let deliveredDeletions = 0;
        const deletions = [5, 6, 7, 8, 9, head + 1].map((sequence) => ({
          sequence,
          event: {
            type: "thread.deleted",
            threadId: sequence > head ? deletedThreadId : ThreadId.make(`old-thread-${sequence}`),
          },
        }));
        const messages: string[] = [];
        const now = DateTime.makeUnsafe("2026-10-22T17:00:00Z");
        const events: OrchestrationV2StoredEvent[] = [90, 90, 110, 110].map((tokens, index) => ({
          sequence: index + 1,
          commandId: null,
          event: {
            type: "provider-turn.updated",
            id: EventId.make(`event-${index}`),
            threadId,
            occurredAt: now,
            payload: {
              id: ProviderTurnId.make("turn"),
              providerThreadId: ProviderThreadId.make("provider-thread"),
              nodeId: NodeId.make("node"),
              runAttemptId: null,
              nativeTurnRef: null,
              ordinal: 1,
              status: "completed",
              startedAt: now,
              completedAt: now,
              turnTokenUsage: {
                usageScope: "main_agent",
                usageStatus: "complete",
                hasSubagents: false,
                inputTokens: tokens - 10,
                outputTokens: 10,
              },
            },
          },
        }));
        const sink = {
          latestSequence: () => Effect.succeed(head),
          stream: (input: { afterSequence?: number; eventType?: string }) =>
            input.eventType === "thread.deleted"
              ? Stream.fromIterable(deletions).pipe(
                  Stream.filter((stored) => stored.sequence > (input.afterSequence ?? 0)),
                  Stream.tap((stored) =>
                    Effect.gen(function* () {
                      deliveredDeletions += 1;
                      yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at='deleted' WHERE thread_id=${stored.event.threadId}`;
                    }),
                  ),
                  Stream.ensuring(Deferred.succeed(deletionsDone, undefined)),
                )
              : Stream.fromIterable(events).pipe(
                  Stream.ensuring(Deferred.succeed(done, undefined)),
                ),
          commitCommand: (
            input: Parameters<EventSink.EventSinkV2["Service"]["commitCommand"]>[0],
          ) =>
            Effect.gen(function* () {
              const usage = yield* store.status(
                defaultProjectProfile(projectId),
                "2026-10-22",
                threadId,
              );
              expect(usage.thread?.tokens).toBeGreaterThanOrEqual(90);
              const item = input.events[0];
              if (item?.type === "turn-item.updated" && item.payload.type === "system_notice")
                messages.push(item.payload.message);
              return {
                committed: true,
                storedEvents: [],
                cancelledEffectCount: 0,
              } as unknown as Effect.Success<
                ReturnType<EventSink.EventSinkV2["Service"]["commitCommand"]>
              >;
            }),
        } as unknown as EventSink.EventSinkV2["Service"];
        yield* startBudgetReactor.pipe(
          Effect.provideService(EventSink.EventSinkV2, sink),
          Effect.provideService(ProjectionStore.ProjectionStoreV2, {
            getThreadShell: () =>
              Effect.succeed({ id: threadId, projectId } as OrchestrationV2ThreadShell),
          } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
          Effect.provide(ThreadCommandExecutor.layer),
        );
        yield* Deferred.await(done);
        yield* Deferred.await(deletionsDone);
        expect(deliveredDeletions).toBe(1);
        expect(
          yield* sql`SELECT thread_id FROM fork_project_profiles_turn_usage WHERE thread_id=${deletedThreadId} UNION ALL SELECT thread_id FROM fork_project_profiles_thread_usage WHERE thread_id=${deletedThreadId}`,
        ).toEqual([]);
        expect(messages).toHaveLength(4);
        expect(new Set(messages).size).toBe(4);
        expect(yield* store.pendingAlerts).toEqual([]);
        expect(
          (yield* store.status(defaultProjectProfile(projectId), "2026-10-22", threadId)).thread
            ?.tokens,
        ).toBe(110);
        yield* sql`UPDATE projection_projects SET deleted_at='deleted'`;
        yield* sql`DELETE FROM orchestration_v2_projection_threads`;
        yield* store.cleanup();
        expect(
          (yield* store.status(defaultProjectProfile(projectId), "2026-10-22", threadId)).thread
            ?.reported,
        ).toBe(false);
        expect((yield* store.get(projectId)).updatedAt).toBe(null);
      }),
    ).pipe(Effect.provide(Sqlite.layer({ filename: ":memory:" }))),
);
