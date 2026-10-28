import {
  VAULT_APPROVAL_RETENTION_MS,
  VAULT_APPROVAL_PENDING_MS,
  type VaultApprovalRequest,
  type VaultApprovalNotificationOutcome,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ApprovalNotificationTransport from "./ApprovalNotificationTransport.ts";

export class ApprovalNotifications extends Context.Service<
  ApprovalNotifications,
  {
    readonly pending: (request: VaultApprovalRequest) => Effect.Effect<void>;
    readonly changed: (request: VaultApprovalRequest, republish?: boolean) => Effect.Effect<void>;
    readonly changes: Stream.Stream<VaultApprovalRequest>;
    readonly waitForDecision: (request: VaultApprovalRequest) => Effect.Effect<void>;
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
type DecisionSignal = {
  readonly request: VaultApprovalRequest;
  readonly decided: Deferred.Deferred<void>;
};
const STATE_ORDER: Record<VaultApprovalRequest["state"], number> = {
  pending: 0,
  approved: 1,
  denied: 2,
  cancelled: 2,
  expired: 2,
  revoked: 3,
};
const MAX_OUTCOMES = 128;
const ATTEMPT_TIMEOUT = "2 seconds";
const make = Effect.gen(function* () {
  const transport = yield* ApprovalNotificationTransport.ApprovalNotificationTransport;
  const attempts = yield* Ref.make<ReadonlyMap<string, Attempt>>(new Map());
  const signals = yield* Ref.make<ReadonlyMap<string, DecisionSignal>>(new Map());
  const changes = yield* PubSub.unbounded<VaultApprovalRequest>();
  const changed = Effect.fn("ApprovalNotifications.changed")(function* (
    request: VaultApprovalRequest,
    republish = false,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const candidate = yield* Deferred.make<void>();
    const signal = yield* Ref.modify(signals, (current) => {
      const kept = new Map(
        [...current].filter(
          ([, value]) => now < value.request.requestedAt + VAULT_APPROVAL_RETENTION_MS,
        ),
      );
      const previous = kept.get(request.id);
      if (
        republish &&
        previous &&
        previous.request.requestedAt === request.requestedAt &&
        previous.request.revision === request.revision &&
        previous.request.state === request.state
      )
        return [previous, kept] as const;
      if (
        (now >= request.requestedAt + VAULT_APPROVAL_RETENTION_MS && request.state === "pending") ||
        (previous &&
          (previous.request.requestedAt > request.requestedAt ||
            (previous.request.requestedAt === request.requestedAt &&
              (previous.request.revision > request.revision ||
                (previous.request.revision === request.revision &&
                  STATE_ORDER[previous.request.state] >= STATE_ORDER[request.state])))))
      )
        return [null, kept] as const;
      const next = {
        request,
        decided:
          previous?.request.requestedAt === request.requestedAt ? previous.decided : candidate,
      };
      kept.set(request.id, next);
      return [next, kept] as const;
    });
    if (!signal) return;
    yield* PubSub.publish(changes, request);
    if (request.state !== "pending") yield* Deferred.succeed(signal.decided, undefined);
  });
  const waitForDecision = Effect.fn("ApprovalNotifications.waitForDecision")(function* (
    request: VaultApprovalRequest,
  ) {
    if (request.state !== "pending") return;
    yield* changed(request);
    const signal = (yield* Ref.get(signals)).get(request.id);
    if (!signal || signal.request.requestedAt !== request.requestedAt) return;
    const now = yield* Clock.currentTimeMillis;
    const remaining = Math.min(VAULT_APPROVAL_PENDING_MS, request.requestExpiresAt - now);
    if (remaining <= 0) return;
    yield* Deferred.await(signal.decided).pipe(Effect.timeoutOption(remaining));
  });
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
  return ApprovalNotifications.of({
    pending,
    changed,
    changes: Stream.fromPubSub(changes),
    waitForDecision,
    outcomes,
  });
});
export const layer = Layer.effect(ApprovalNotifications, make);
// Restart discards observations. Reading the inbox never dispatches or retries a notification.
export const stub = layer.pipe(Layer.provide(ApprovalNotificationTransport.stub));
