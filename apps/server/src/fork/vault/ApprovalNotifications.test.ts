import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { VaultError, type VaultApprovalRequest } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as ApprovalNotificationTransport from "./ApprovalNotificationTransport.ts";

const request: VaultApprovalRequest = {
  id: "a".repeat(32),
  threadId: ThreadId.make("notification-thread"),
  itemId: "b".repeat(32),
  action: "use",
  destination: "ssh://qa@qa.invalid:22",
  projectId: "notification-project",
  itemVersion: 1,
  policyRevision: 0,
  revision: 1,
  requestedBy: "thread:notification-thread",
  requestedAt: 0,
  requestExpiresAt: 600_000,
  state: "pending",
  decidedBy: null,
  approvedUntil: null,
  grantId: null,
};
const withTransport = <A, E>(
  transport: ApprovalNotificationTransport.ApprovalNotificationTransport["Service"]["pending"],
  use: (service: ApprovalNotifications.ApprovalNotifications["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.flatMap(ApprovalNotifications.ApprovalNotifications, use).pipe(
    Effect.provide(
      ApprovalNotifications.layer.pipe(
        Layer.provide(
          Layer.succeed(ApprovalNotificationTransport.ApprovalNotificationTransport, {
            pending: transport,
          }),
        ),
      ),
    ),
  );

it.effect(
  "keeps the stub explicit and derives terminal states without claiming an alert was delivered",
  () =>
    Effect.gen(function* () {
      const service = yield* ApprovalNotifications.ApprovalNotifications;
      expect((yield* service.outcomes([request]))[0]).toMatchObject({
        delivery: "not-delivered",
        attemptedAt: null,
      });
      yield* service.pending(request);
      expect((yield* service.outcomes([request]))[0]).toMatchObject({
        delivery: "stubbed",
        storage: "process",
        inApp: "available-in-inbox",
      });
      expect(
        (yield* service.outcomes([
          { ...request, revision: 2, state: "denied", decidedBy: "human" },
        ]))[0],
      ).toMatchObject({ delivery: "not-required", requestRevision: 2 });
      yield* TestClock.adjust("10 minutes");
      expect((yield* service.outcomes([request]))[0]?.delivery).toBe("not-required");
    }).pipe(Effect.provide(ApprovalNotifications.stub)),
);

it.effect(
  "reserves one in-flight attempt per process and exposes only minimal adapter context",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const complete = yield* Deferred.make<"delivered">();
      let calls = 0;
      yield* withTransport(
        (notice) =>
          Effect.gen(function* () {
            calls++;
            expect(notice).not.toHaveProperty("destination");
            expect(notice).not.toHaveProperty("requestedBy");
            yield* Deferred.succeed(started, undefined);
            return yield* Deferred.await(complete);
          }),
        (service) =>
          Effect.gen(function* () {
            const first = yield* service.pending(request).pipe(Effect.forkChild);
            yield* Deferred.await(started);
            yield* service.pending(request);
            expect((yield* service.outcomes([request]))[0]?.delivery).toBe("sending");
            yield* Deferred.succeed(complete, "delivered");
            yield* Fiber.join(first);
            yield* service.pending(request);
            expect(calls).toBe(1);
            expect((yield* service.outcomes([request]))[0]?.delivery).toBe("delivered");
          }),
      );
    }),
);

it.effect("does not retry failed delivery on inbox reads or identical request replay", () => {
  let calls = 0;
  return withTransport(
    () =>
      Effect.gen(function* () {
        calls++;
        return yield* new VaultError({ reason: "unavailable" });
      }),
    (service) =>
      Effect.gen(function* () {
        yield* service.pending(request);
        yield* service.pending(request);
        expect((yield* service.outcomes([request]))[0]?.delivery).toBe("unconfirmed");
        expect((yield* service.outcomes([request]))[0]?.delivery).toBe("unconfirmed");
        expect(calls).toBe(1);
      }),
  );
});

it.effect("bounds a stalled attempt and records interrupted attempts as unconfirmed", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const nextStarted = yield* Deferred.make<void>();
    yield* withTransport(
      (notice) =>
        Deferred.succeed(notice.requestId === request.id ? started : nextStarted, undefined).pipe(
          Effect.andThen(Effect.never),
        ),
      (service) =>
        Effect.gen(function* () {
          const sending = yield* service.pending(request).pipe(Effect.forkChild);
          yield* Deferred.await(started);
          yield* TestClock.adjust("2 seconds");
          yield* Fiber.join(sending);
          expect((yield* service.outcomes([request]))[0]?.delivery).toBe("unconfirmed");
          const next = { ...request, id: "c".repeat(32) };
          const interrupted = yield* service.pending(next).pipe(Effect.forkChild);
          yield* Deferred.await(nextStarted);
          yield* Fiber.interrupt(interrupted);
          expect((yield* service.outcomes([next]))[0]?.delivery).toBe("unconfirmed");
        }),
    );
  }),
);

it.effect("bounds retention at 24 hours and 128 entries without evicting a young result", () => {
  let calls = 0;
  return withTransport(
    () =>
      Effect.sync(() => {
        calls++;
        return "stubbed" as const;
      }),
    (service) =>
      Effect.gen(function* () {
        const requests = Array.from({ length: 128 }, (_, i) => ({
          ...request,
          id: i.toString(16).padStart(32, "0"),
        }));
        yield* Effect.forEach(requests, (item) => service.pending(item));
        const overflow = { ...request, id: "f".repeat(32) };
        yield* service.pending(overflow);
        expect(calls).toBe(128);
        expect(
          (yield* service.outcomes([requests[0]!, overflow])).map((outcome) => outcome.delivery),
        ).toEqual(["stubbed", "not-delivered"]);
        yield* TestClock.adjust("24 hours");
        expect(yield* service.outcomes(requests)).toEqual([]);
        const fresh = {
          ...overflow,
          requestedAt: yield* Clock.currentTimeMillis,
          requestExpiresAt: 87_000_000,
        };
        yield* service.pending(fresh);
        expect((yield* service.outcomes([fresh]))[0]?.delivery).toBe("stubbed");
        expect(calls).toBe(129);
      }),
  );
});

it.effect(
  "forgets process observations after restart and never dispatches while rebuilding status",
  () =>
    Effect.gen(function* () {
      const before = yield* ApprovalNotifications.ApprovalNotifications;
      yield* before.pending(request);
      const after = yield* Effect.flatMap(ApprovalNotifications.ApprovalNotifications, (service) =>
        service.outcomes([request]),
      ).pipe(Effect.provide(Layer.fresh(ApprovalNotifications.stub)));
      expect(after[0]).toMatchObject({ delivery: "not-delivered", attemptedAt: null });
    }).pipe(Effect.provide(ApprovalNotifications.stub)),
);

it.effect("does not dispatch for terminal or expired requests", () => {
  let calls = 0;
  return withTransport(
    () =>
      Effect.sync(() => {
        calls++;
        return "delivered" as const;
      }),
    (service) =>
      Effect.gen(function* () {
        yield* service.pending({ ...request, state: "denied", revision: 2, decidedBy: "human" });
        yield* TestClock.adjust("10 minutes");
        yield* service.pending(request);
        expect(calls).toBe(0);
        expect((yield* service.outcomes([request]))[0]?.delivery).toBe("not-required");
      }),
  );
});
it.effect(
  "derives current expiry even if an adapter reports delivery after the request deadline",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const delivered = yield* Deferred.make<"delivered">();
      const short = { ...request, requestExpiresAt: 1_000 };
      yield* withTransport(
        () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(delivered))),
        (service) =>
          Effect.gen(function* () {
            const pending = yield* service.pending(short).pipe(Effect.forkChild);
            yield* Deferred.await(started);
            yield* TestClock.adjust("1 second");
            yield* Deferred.succeed(delivered, "delivered");
            yield* Fiber.join(pending);
            expect((yield* service.outcomes([short]))[0]?.delivery).toBe("not-required");
          }),
      );
    }),
);
