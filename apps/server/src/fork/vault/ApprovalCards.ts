import { CommandId, EventId, TurnItemId } from "@t3tools/contracts";
import type { VaultApprovalRequest } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as VaultCore from "./VaultCore.ts";

const STATE_ORDER: Record<VaultApprovalRequest["state"], number> = {
  pending: 0,
  approved: 1,
  denied: 2,
  cancelled: 2,
  expired: 2,
  revoked: 3,
};

export class ApprovalCards extends Context.Service<
  ApprovalCards,
  {
    readonly post: (request: VaultApprovalRequest) => Effect.Effect<void>;
  }
>()("t3/fork/vault/ApprovalCards") {}

const make = Effect.gen(function* () {
  const sink = yield* EventSink.EventSinkV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const vault = yield* VaultCore.VaultCore;
  return ApprovalCards.of({
    post: Effect.fn("ApprovalCards.post")(
      (request) =>
        executor.withLock(
          request.threadId,
          Effect.gen(function* () {
            const thread = yield* projections.getThreadShell(request.threadId);
            if (thread === null || thread.deletedAt !== null) return;
            const itemId = TurnItemId.make(`vault-approval:${request.id}`);
            const item = yield* projections.getTurnItem({ threadId: request.threadId, itemId });
            if (item !== null && item.type !== "vault_access_request") return;
            const previous = item?.type === "vault_access_request" ? item : null;
            const previousAt =
              previous?.startedAt == null ? null : DateTime.toEpochMillis(previous.startedAt);
            if (previousAt !== null && request.requestedAt < previousAt) return;
            const sameLifecycle = previousAt === request.requestedAt;
            if (
              previous &&
              sameLifecycle &&
              (request.revision < previous.revision ||
                (request.revision === previous.revision &&
                  STATE_ORDER[request.state] <= STATE_ORDER[previous.state]))
            )
              return;
            const summary = yield* vault
              .inspect(request.itemId)
              .pipe(Effect.orElseSucceed(() => null));
            const now = yield* DateTime.now;
            const id = `vault-approval:${request.id}:${request.requestedAt}:${request.revision}:${request.state}`;
            const ordinal =
              previous?.ordinal ?? (yield* projections.getNextTurnItemOrdinal(request.threadId));
            yield* sink.commitCommand({
              commandId: CommandId.make(id),
              threadId: request.threadId,
              commandType: "loom.vault-approvals.card",
              acceptedAt: now,
              effects: [],
              events: [
                {
                  id: EventId.make(id),
                  threadId: request.threadId,
                  occurredAt: now,
                  type: "turn-item.updated",
                  payload: {
                    id: itemId,
                    threadId: request.threadId,
                    runId: null,
                    nodeId: null,
                    providerThreadId: null,
                    providerTurnId: null,
                    nativeItemRef: null,
                    parentItemId: null,
                    ordinal,
                    status: request.state === "pending" ? "waiting" : "completed",
                    title: "Vault access request",
                    startedAt:
                      sameLifecycle && previous
                        ? previous.startedAt
                        : DateTime.makeUnsafe(request.requestedAt),
                    completedAt: request.state === "pending" ? null : now,
                    updatedAt: now,
                    type: "vault_access_request",
                    requestId: request.id,
                    revision: request.revision,
                    itemLabel: summary?.label ?? previous?.itemLabel ?? "Vault item unavailable",
                    itemKind: summary?.kind ?? previous?.itemKind ?? null,
                    action: request.action,
                    destination: request.destination,
                    state: request.state,
                    requestExpiresAt: request.requestExpiresAt,
                    approvedUntil: request.approvedUntil,
                  },
                },
              ],
            });
          }),
        ),
      (effect, request) =>
        effect.pipe(
          Effect.catchCause(() =>
            Effect.logWarning("Vault approval card publication failed", {
              requestId: request.id,
              threadId: request.threadId,
            }),
          ),
        ),
    ),
  });
});

export const layer = Layer.effect(ApprovalCards, make);

export const reactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const notifications = yield* ApprovalNotifications.ApprovalNotifications;
    const cards = yield* ApprovalCards;
    yield* notifications.changes.pipe(
      Stream.runForEach(cards.post),
      Effect.forkScoped({ startImmediately: true }),
    );
  }),
);
