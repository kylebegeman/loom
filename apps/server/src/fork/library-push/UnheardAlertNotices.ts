import { CommandId, EventId, type ThreadId, TurnItemId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";

export type UnheardAlert = "agent" | "vault";

const STEPS =
  "To get alerts, open Loom on your iPhone, sign in to your Library with your passkey, then turn on Library notifications in Settings and allow them.";

const NOTICE: Readonly<Record<UnheardAlert, { readonly title: string; readonly message: string }>> =
  {
    agent: {
      title: "No iPhone got this alert",
      message: `Your Library has no iPhone registered for notifications, so this alert reached no one. ${STEPS}`,
    },
    vault: {
      title: "No iPhone got this Vault request",
      message: `Your Library has no iPhone registered for notifications, so no one was alerted to this Vault request. Review it here. ${STEPS}`,
    },
  };

/**
 * Says so in the thread when the Library accepted an alert but no recipient has an iPhone
 * registered, so the gap shows on the computer instead of nowhere.
 */
export class UnheardAlertNotices extends Context.Service<
  UnheardAlertNotices,
  { readonly post: (threadId: ThreadId, alert: UnheardAlert) => Effect.Effect<void> }
>()("t3/fork/library-push/UnheardAlertNotices") {}

const make = Effect.gen(function* () {
  const sink = yield* EventSink.EventSinkV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;

  return UnheardAlertNotices.of({
    post: Effect.fn("UnheardAlertNotices.post")(
      function* (threadId: ThreadId, alert: UnheardAlert) {
        const now = yield* DateTime.now;
        // One per thread, kind and UTC day: the receipt makes every later post that day a no-op.
        const id = `library-push-unheard:${alert}:${DateTime.formatIso(now).slice(0, 10)}:${threadId}`;
        const notice = NOTICE[alert];
        yield* executor.withLock(
          threadId,
          Effect.gen(function* () {
            const thread = yield* projections.getThreadShell(threadId);
            if (!thread || thread.deletedAt) return;
            yield* sink.commitCommand({
              commandId: CommandId.make(id),
              threadId,
              commandType: "loom.library-push.unheard-alert",
              acceptedAt: now,
              effects: [],
              events: [
                {
                  id: EventId.make(id),
                  threadId,
                  occurredAt: now,
                  type: "turn-item.updated",
                  payload: {
                    id: TurnItemId.make(id),
                    threadId,
                    runId: null,
                    nodeId: null,
                    providerThreadId: null,
                    providerTurnId: null,
                    nativeItemRef: null,
                    parentItemId: null,
                    ordinal: 0,
                    status: "completed",
                    title: notice.title,
                    startedAt: now,
                    completedAt: now,
                    updatedAt: now,
                    type: "system_notice",
                    message: notice.message,
                  },
                },
              ],
            });
          }),
        );
      },
      Effect.catchCause((cause) => Effect.logDebug("Unheard alert notice failed", { cause })),
    ),
  });
});

export const layer = Layer.effect(UnheardAlertNotices, make);
