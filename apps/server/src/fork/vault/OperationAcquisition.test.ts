import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import type * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { journalFixture } from "./OperationJournal.testkit.ts";

const withAcquisition = <A, E>(
  use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, Crypto.Crypto>,
) => Effect.flatMap(fixture, use).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
const fixture = Effect.gen(function* () {
  const f = yield* journalFixture;
  yield* f.journal.prepare(f.input, f.threadId);
  const mutation = { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id };
  const revokeId = yield* f.id;
  const revoke = f.access
    .approvalChange(
      {
        ...f.decision,
        expectedRevision: 2,
        expectedPolicyRevision: 1,
        operationId: revokeId,
        decision: "revoke",
      },
      "human",
      Effect.void,
    )
    .pipe(Effect.asVoid);
  return { ...f, mutation, revoke };
});
const isReservation = (value: unknown) => {
  const stored = value as { entries: Array<{ state: string }> };
  return stored.entries.some((entry) => entry.state === "reserved");
};

it.effect(
  "creates a fresh local handle only after acknowledged CAS and discards it on its first check",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        const before = [...f.records.entries()].find(([key]) => key.endsWith("/access-policy"));
        const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
        expect(acquired).toMatchObject({
          entry: { state: "reserved", revision: 2 },
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        const reserved = f.records.get(f.path());
        expect(yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId)).toMatchObject({
          entry: { state: "reserved" },
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect(
          (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect(f.records.get(f.path())).toEqual(reserved);
        expect([...f.records.entries()].find(([key]) => key.endsWith("/access-policy"))).toEqual(
          before,
        );
      }),
    ),
);

it.effect.each(["same-id", "different-id"] as const)(
  "permits one fresh CAS acknowledgement under a %s contested write and reconciles the loser",
  (mode) =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        const arrived = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let waiting = 0;
        f.faults.beforeJournalWrite = (value) =>
          Effect.gen(function* () {
            if (!isReservation(value)) return;
            if (++waiting === 2) yield* Deferred.succeed(arrived, undefined);
            yield* Deferred.await(release);
          });
        const other =
          mode === "same-id" ? f.mutation : { ...f.mutation, reservationId: yield* f.id };
        const run = yield* Effect.all(
          [
            f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.result),
            f.journal.acquire(f.input, other, f.threadId).pipe(Effect.result),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.forkChild);
        yield* Deferred.await(arrived);
        yield* Deferred.succeed(release, undefined);
        const results = yield* Fiber.join(run);
        const winners = results.filter((r) => r._tag === "Success");
        expect(winners).toHaveLength(1);
        expect(results.filter((r) => r._tag === "Failure")).toHaveLength(1);
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
        expect(
          (yield* f.journal
            .checkAcquisition(winners[0]!.success.acquisition, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
      }),
    ),
);

it.effect.each(["before", "after"] as const)(
  "never reconstructs a handle after a %s-write failure",
  (failure) =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        f.faults.write = failure;
        expect(
          (yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        f.faults.write = "none";
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe(
          failure === "before" ? "prepared" : "unknown",
        );
        if (failure === "before") {
          expect((yield* f.journal.acquire(f.input, f.mutation, f.threadId)).entry.state).toBe(
            "reserved",
          );
        } else
          expect(
            (yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
          ).toBe("conflict");
      }),
    ),
);

it.effect(
  "reconciles replay after restart and cannot transfer the old handle between service instances",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
        const rebuilt = yield* f.rebuild;
        expect(
          (yield* rebuilt.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect(
          (yield* rebuilt.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
        expect(
          (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
            .reason,
        ).toBe("conflict");
      }),
    ),
);

it.effect(
  "rejects deserialized and copied handles while keeping their original identity single-use",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
        const serialized = JSON.stringify(acquired.acquisition);
        expect(serialized).toBe("{}");
        const parsed: unknown = JSON.parse(serialized);
        expect(
          (yield* f.journal.checkAcquisition(parsed as never, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(
          (yield* f.journal
            .checkAcquisition({ ...acquired.acquisition }, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(
          (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId)).canExecute,
        ).toBe(false);
      }),
    ),
);

it.effect(
  "binds captured proposal and mutation values independently of subsequent caller mutation",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        if (f.input.operation.kind !== "ssh") throw new Error("fixture");
        const argv = [...f.input.operation.input.command.argv];
        const proposal = {
          ...f.input,
          operation: {
            ...f.input.operation,
            input: {
              ...f.input.operation.input,
              command: { ...f.input.operation.input.command, argv },
            },
          },
        };
        const mutation = { ...f.mutation };
        const acquired = yield* f.journal.acquire(proposal, mutation, f.threadId);
        argv.push("changed-after-acquire");
        mutation.reservationId = "0".repeat(32);
        expect(
          (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId)).entry.reservationId,
        ).toBe(f.mutation.reservationId);
      }),
    ),
);

it.effect(
  "burns a handle before asynchronous validation and rejects a simultaneous second check",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        f.faults.beforeJournalRead = () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)));
        const checking = yield* f.journal
          .checkAcquisition(acquired.acquisition, f.threadId)
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        expect(
          (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        yield* Deferred.succeed(release, undefined);
        expect((yield* Fiber.join(checking)).canExecute).toBe(false);
      }),
    ),
);

it.effect("interruption after commit reconciles unknown without delivering a fresh handle", () =>
  withAcquisition((f) =>
    Effect.gen(function* () {
      const committed = yield* Deferred.make<void>();
      const never = yield* Deferred.make<void>();
      let delivered = 0;
      f.faults.afterJournalWrite = (value) =>
        isReservation(value)
          ? Deferred.succeed(committed, undefined).pipe(Effect.andThen(Deferred.await(never)))
          : Effect.void;
      const acquiring = yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(
        Effect.tap(() => Effect.sync(() => delivered++)),
        Effect.forkChild,
      );
      yield* Deferred.await(committed);
      yield* Fiber.interrupt(acquiring);
      expect(delivered).toBe(0);
      expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
    }),
  ),
);

it.effect(
  "interrupted validation cannot restore a handle and reconciles retained reservation evidence",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
        const entered = yield* Deferred.make<void>();
        const never = yield* Deferred.make<void>();
        f.faults.beforeJournalRead = () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(never)));
        const checking = yield* f.journal
          .checkAcquisition(acquired.acquisition, f.threadId)
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        f.faults.beforeJournalRead = null;
        yield* Fiber.interrupt(checking);
        expect(
          (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
      }),
    ),
);

it.effect.each([
  "revoke",
  "run",
  "outage",
  "corrupt",
  "expire",
  "wrong-requester",
  "item",
] as const)("refuses %s at validation and never refunds a handle", (failure) =>
  withAcquisition((f) =>
    Effect.gen(function* () {
      const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
      let requester = f.threadId;
      switch (failure) {
        case "revoke":
          yield* f.revoke;
          break;
        case "run":
          f.state.thread = { ...f.state.thread, activeRunId: null };
          break;
        case "item":
          yield* f.core.change(
            { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
            "human",
          );
          break;
        case "outage":
          f.faults.reads = true;
          break;
        case "corrupt":
          f.records.set(f.path(), { value: Redacted.make({ schemaVersion: 99 }), version: 3 });
          break;
        case "expire":
          yield* TestClock.adjust("5 minutes");
          break;
        case "wrong-requester":
          requester = ThreadId.make("not-owner");
          break;
      }
      const refused = yield* f.journal
        .checkAcquisition(acquired.acquisition, requester)
        .pipe(Effect.flip);
      expect(refused.reason).toBe(
        failure === "outage"
          ? "unavailable"
          : failure === "corrupt"
            ? "invalid-response"
            : "denied",
      );
      f.faults.reads = false;
      expect(
        (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
          .reason,
      ).toBe("denied");
      expect((yield* f.access.approvalInbox).requests).toHaveLength(1);
    }),
  ),
);

it.effect("rejects authority withdrawn between reservation commit and acknowledgement", () =>
  withAcquisition((f) =>
    Effect.gen(function* () {
      f.faults.afterJournalWrite = (value) => (isReservation(value) ? f.revoke : Effect.void);
      const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
      expect(
        (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
          .reason,
      ).toBe("denied");
      expect(
        (yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect((yield* f.access.approvalInbox).requests[0]?.state).toBe("revoked");
    }),
  ),
);

it.effect("rejects withdrawn authority before a prepared reservation can be acquired", () =>
  withAcquisition((f) =>
    Effect.gen(function* () {
      yield* f.revoke;
      const before = f.records.get(f.path());
      expect(
        (yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(f.records.get(f.path())).toEqual(before);
    }),
  ),
);

it.effect("cannot validate an aged entry while its approved request is still retained", () =>
  withAcquisition((f) =>
    Effect.gen(function* () {
      const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
      const record = f.records.get(f.path())!;
      const stored = Redacted.value(record.value) as { entries: Array<{ retireAt: number }> };
      f.records.set(f.path(), {
        ...record,
        value: Redacted.make({
          ...stored,
          entries: stored.entries.map((entry) => ({ ...entry, retireAt: 100 })),
        }),
      });
      yield* TestClock.adjust("100 millis");
      expect((yield* f.access.approvalStatus(f.input.id, f.threadId)).request.state).toBe(
        "approved",
      );
      expect(
        (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
          .reason,
      ).toBe("not-found");
      expect(
        (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
          .reason,
      ).toBe("denied");
    }),
  ),
);

it.effect(
  "refuses changed proposals, stale revisions and mismatched request IDs without reserving",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        if (f.input.operation.kind !== "ssh") throw new Error("fixture");
        const changed = {
          ...f.input,
          operation: {
            ...f.input.operation,
            input: {
              ...f.input.operation.input,
              command: { ...f.input.operation.input.command, argv: ["changed"] },
            },
          },
        };
        const before = f.records.get(f.path());
        expect(
          (yield* f.journal.acquire(changed, f.mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* f.journal
            .acquire(f.input, { ...f.mutation, expectedRevision: 9 }, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* f.journal
            .acquire(f.input, { ...f.mutation, id: "0".repeat(32) }, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        expect(f.records.get(f.path())).toEqual(before);
      }),
    ),
);

it.effect(
  "an unavailable reconciliation never returns a handle and retry later reconciles unknown",
  () =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        f.faults.write = "after";
        f.faults.afterJournalWrite = (value) =>
          Effect.sync(() => {
            if (isReservation(value)) f.faults.reads = true;
          });
        expect(
          (yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        f.faults.reads = false;
        f.faults.afterJournalWrite = null;
        expect(
          (yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
      }),
    ),
);

it.effect("refuses a replay reconciliation that races between journal and policy validation", () =>
  withAcquisition((f) =>
    Effect.gen(function* () {
      const acquired = yield* f.journal.acquire(f.input, f.mutation, f.threadId);
      let armed = false,
        fired = false;
      f.faults.onJournalRead = () => {
        armed = true;
      };
      f.faults.beforePolicyRead = () =>
        Effect.gen(function* () {
          if (!armed || fired) return;
          fired = true;
          yield* f.journal.reconcile(f.input.id, f.threadId);
        });
      expect(
        (yield* f.journal.checkAcquisition(acquired.acquisition, f.threadId).pipe(Effect.flip))
          .reason,
      ).toBe("conflict");
      expect(fired).toBe(true);
      expect((yield* f.journal.status(f.input.id, f.threadId)).journal?.state).toBe("unknown");
    }),
  ),
);

it.effect.each(["operationId", "itemId"] as const)(
  "rejects a prepared journal whose %s binding disagrees with its request",
  (field) =>
    withAcquisition((f) =>
      Effect.gen(function* () {
        const record = f.records.get(f.path())!;
        const stored = Redacted.value(record.value) as { entries: Array<Record<string, unknown>> };
        f.records.set(f.path(), {
          ...record,
          value: Redacted.make({
            ...stored,
            entries: stored.entries.map((entry) => ({ ...entry, [field]: "0".repeat(32) })),
          }),
        });
        const before = f.records.get(f.path());
        expect(
          (yield* f.journal.acquire(f.input, f.mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(f.records.get(f.path())).toEqual(before);
      }),
    ),
);
