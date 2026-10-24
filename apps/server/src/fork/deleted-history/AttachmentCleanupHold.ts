import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as EffectWorker from "../../orchestration-v2/EffectWorker.ts";
import * as LibraryWorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";
import { deletionSequence } from "./deletedHistory.ts";

/**
 * Keeps a deleted Library thread's attachment files while the Library still needs them for the
 * deletion's snapshot: a replicated thread until the Library acknowledges the deletion, and a
 * bound thread the Library has not received yet. Other threads are cleaned up immediately. The
 * next DeletedThreadHistory pass releases held files once the Library acknowledges the deletion,
 * or on a computer without a Library connection, and each restart checks them again.
 */
export const layerHold = <E, R>(
  executor: Layer.Layer<EffectWorker.OrchestrationEffectExecutorV2, E, R>,
) =>
  Layer.effect(
    EffectWorker.OrchestrationEffectExecutorV2,
    Effect.gen(function* () {
      const inner = yield* EffectWorker.OrchestrationEffectExecutorV2;
      const sql = yield* SqlClient.SqlClient;
      const workspaces = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
      // A failed check, including a database without the Library tables, cleans up immediately.
      const holds = (threadId: ThreadId) =>
        sql<{
          readonly acknowledged_sequence: number;
          readonly deletion: number | null;
          readonly pending: number;
        }>`
          SELECT acknowledged_sequence,
            ${deletionSequence(sql, threadId)} AS deletion,
            EXISTS (SELECT 1 FROM fork_library_source_outbox WHERE thread_id = ${threadId}) AS pending
          FROM fork_library_source_threads WHERE thread_id = ${threadId}`.pipe(
          Effect.flatMap(([row]) =>
            row === undefined
              ? workspaces.getBinding(threadId).pipe(Effect.map((binding) => binding !== null))
              : Effect.succeed(
                  row.deletion !== null &&
                    (row.pending === 1 || row.acknowledged_sequence < row.deletion),
                ),
          ),
          Effect.orElseSucceed(() => false),
          Effect.withTracerEnabled(false),
        );
      return EffectWorker.OrchestrationEffectExecutorV2.of({
        execute: (effect, options) =>
          effect.request.type === "attachment.cleanup"
            ? holds(effect.threadId).pipe(
                Effect.flatMap((held) => (held ? Effect.void : inner.execute(effect, options))),
              )
            : inner.execute(effect, options),
      });
    }),
  ).pipe(Layer.provide(executor));

export const holdLibraryAttachments = <E, R>(
  executor: Layer.Layer<EffectWorker.OrchestrationEffectExecutorV2, E, R>,
) => layerHold(executor).pipe(Layer.provide(LibraryWorkspaceStore.layer));
