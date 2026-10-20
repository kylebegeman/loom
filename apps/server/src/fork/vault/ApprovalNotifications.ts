import {
  VAULT_APPROVAL_RETENTION_MS,
  type VaultApprovalRequest,
  type VaultApprovalNotificationOutcome,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as ApprovalNotificationTransport from "./ApprovalNotificationTransport.ts";

export class ApprovalNotifications extends Context.Service<
  ApprovalNotifications,
  {
    readonly pending: (request: VaultApprovalRequest) => Effect.Effect<void>;
    readonly outcomes: (
      requests: ReadonlyArray<VaultApprovalRequest>,
    ) => Effect.Effect<ReadonlyArray<VaultApprovalNotificationOutcome>>;
  }
>()("t3/fork/vault/ApprovalNotifications") {}

type Attempt = {
  requestedAt: number;
  attemptedAt: number;
  delivery: "sending" | "stubbed" | "unconfirmed" | "delivered";
};
const MAX_OUTCOMES = 128;
const ATTEMPT_TIMEOUT = "2 seconds";
const make = Effect.gen(function* () {
  const transport = yield* ApprovalNotificationTransport.ApprovalNotificationTransport;
  const attempts = yield* Ref.make<ReadonlyMap<string, Attempt>>(new Map());
  const retained = (current: ReadonlyMap<string, Attempt>, now: number) =>
    new Map(
      [...current].filter(([, attempt]) => now < attempt.requestedAt + VAULT_APPROVAL_RETENTION_MS),
    );
  const pending = Effect.fn("ApprovalNotifications.pending")(function* (
    request: VaultApprovalRequest,
  ) {
    const now = yield* Clock.currentTimeMillis;
    if (
      request.state !== "pending" ||
      now >= request.requestExpiresAt ||
      now >= request.requestedAt + VAULT_APPROVAL_RETENTION_MS
    )
      return;
    const finish = (delivery: Attempt["delivery"]) =>
      Ref.update(attempts, (current) => {
        const previous = current.get(request.id);
        if (
          !previous ||
          previous.requestedAt !== request.requestedAt ||
          previous.delivery !== "sending"
        )
          return current;
        return new Map(current).set(request.id, { ...previous, delivery });
      });
    yield* Effect.acquireUseRelease(
      Ref.modify(attempts, (current) => {
        const next = retained(current, now);
        if (next.has(request.id) || next.size >= MAX_OUTCOMES) return [false, next] as const;
        next.set(request.id, {
          requestedAt: request.requestedAt,
          attemptedAt: now,
          delivery: "sending",
        });
        return [true, next] as const;
      }),
      (reserved) =>
        reserved
          ? transport
              .pending({
                requestId: request.id,
                threadId: request.threadId,
                projectId: request.projectId,
                itemId: request.itemId,
                action: request.action,
                expiresAt: request.requestExpiresAt,
              })
              .pipe(
                Effect.timeoutOption(ATTEMPT_TIMEOUT),
                Effect.match({
                  onFailure: () => "unconfirmed" as const,
                  onSuccess: (outcome) =>
                    Option.isSome(outcome) ? outcome.value : ("unconfirmed" as const),
                }),
                Effect.flatMap(finish),
              )
          : Effect.void,
      (reserved) => (reserved ? finish("unconfirmed") : Effect.void),
    );
  });
  const outcomes = Effect.fn("ApprovalNotifications.outcomes")(function* (
    requests: ReadonlyArray<VaultApprovalRequest>,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const current = yield* Ref.updateAndGet(attempts, (previous) => retained(previous, now));
    return requests
      .filter((request) => now < request.requestedAt + VAULT_APPROVAL_RETENTION_MS)
      .slice(0, MAX_OUTCOMES)
      .map((request) => {
        const recorded = current.get(request.id);
        const attempt = recorded?.requestedAt === request.requestedAt ? recorded : undefined;
        return {
          requestId: request.id,
          requestRevision: request.revision,
          storage: "process" as const,
          inApp: "available-in-inbox" as const,
          delivery:
            request.state !== "pending" || now >= request.requestExpiresAt
              ? ("not-required" as const)
              : (attempt?.delivery ?? ("not-delivered" as const)),
          attemptedAt: attempt?.attemptedAt ?? null,
          expiresAt: request.requestedAt + VAULT_APPROVAL_RETENTION_MS,
        };
      });
  });
  return ApprovalNotifications.of({ pending, outcomes });
});
export const layer = Layer.effect(ApprovalNotifications, make);
// Restart discards observations. Reading the inbox never dispatches or retries a notification.
export const stub = layer.pipe(Layer.provide(ApprovalNotificationTransport.stub));
