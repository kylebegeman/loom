import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { VaultApprovalRecoveryStatus, VaultApprovalRetryReport } from "@t3tools/contracts/fork";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { journalFixture as fixture } from "./OperationJournal.testkit.ts";

const isRecoveryStatus = Schema.is(VaultApprovalRecoveryStatus);
const isRetryReport = Schema.is(VaultApprovalRetryReport);
const withJournal = <A, E>(
  use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, Crypto.Crypto>,
) => Effect.flatMap(fixture, use).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect(
  "writes a bounded digest-only independent journal without changing the format-3 policy",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        const policy = [...f.records.entries()].find(([key]) => key.endsWith("/access-policy"))!;
        const prepared = yield* f.journal.prepare(f.input, f.threadId);
        expect(prepared).toMatchObject({
          entry: { state: "prepared", revision: 1, outcome: null },
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect(f.path()).toMatch(
          /^environments\/[a-f0-9]{64}\/profiles\/_operations\/approval-journal-v1$/,
        );
        expect(f.records.get(policy[0])).toEqual(policy[1]);
        expect(Redacted.value(policy[1].value)).toMatchObject({ schemaVersion: 3 });
        expect((yield* f.access.approvalInbox).requests).toHaveLength(1);
        const stored = Redacted.value(f.records.get(f.path())!.value);
        const allowedFields = new Set([
          "schemaVersion",
          "environmentId",
          "revision",
          "entries",
          "requestId",
          "operationId",
          "threadId",
          "runId",
          "itemId",
          "itemVersion",
          "requestRevision",
          "digest",
          "createdAt",
          "updatedAt",
          "retireAt",
          "state",
          "reservationId",
          "outcome",
        ]);
        const inspect = (value: unknown): void => {
          if (Array.isArray(value)) {
            value.forEach(inspect);
            return;
          }
          if (value !== null && typeof value === "object") {
            for (const [field, child] of Object.entries(value)) {
              expect(allowedFields.has(field), `unexpected persisted field: ${field}`).toBe(true);
              inspect(child);
            }
          } else expect(value).not.toBe("true");
        };
        inspect(stored);
        expect(stored).toMatchObject({
          schemaVersion: 1,
          entries: [{ digest: prepared.entry.digest }],
        });
        expect((yield* f.journal.prepare(f.input, f.threadId)).entry.revision).toBe(1);
        expect((yield* f.journal.reconcile(f.input.id, f.threadId)).entry.state).toBe("prepared");
      }),
    ),
);

it.effect("reconciles a lost prepare reply and refuses changed proposals or ownership", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      f.faults.write = "after";
      expect((yield* f.journal.prepare(f.input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "unavailable",
      );
      const journal = yield* f.rebuild;
      expect((yield* journal.prepare(f.input, f.threadId)).entry.state).toBe("prepared");
      const operation = f.input.operation;
      if (operation.kind !== "ssh") throw new Error("fixture");
      expect(
        (yield* journal
          .prepare(
            {
              ...f.input,
              operation: {
                ...operation,
                input: {
                  ...operation.input,
                  command: { ...operation.input.command, argv: ["changed"] },
                },
              },
            },
            f.threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(
        (yield* journal.reconcile(f.input.id, ThreadId.make("not-owner")).pipe(Effect.flip)).reason,
      ).toBe("denied");
    }),
  ),
);

it.effect(
  "keeps a failed pre-reservation write prepared and turns a lost committed reservation into unknown on restart",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        const mutation = { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id };
        f.faults.write = "before";
        expect(
          (yield* f.journal.reserve(f.input, mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        f.faults.write = "none";
        expect((yield* f.journal.reconcile(f.input.id, f.threadId)).entry.state).toBe("prepared");
        f.faults.write = "after";
        expect(
          (yield* f.journal.reserve(f.input, mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        const restarted = yield* f.rebuild;
        const unknown = yield* restarted.reconcile(f.input.id, f.threadId);
        expect(unknown).toMatchObject({
          entry: { state: "unknown", outcome: "unknown", revision: 3 },
          canExecute: false,
        });
        expect(
          (yield* restarted.reserve(f.input, mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* restarted
            .finish({ ...mutation, expectedRevision: 2, outcome: "succeeded" }, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
      }),
    ),
);

it.effect.each(["before", "after"] as const)(
  "recovers %s a completion write without replaying a side effect",
  (failure) =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        const mutation = { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id };
        yield* f.journal.reserve(f.input, mutation, f.threadId);
        f.faults.write = failure;
        expect(
          (yield* f.journal
            .finish({ ...mutation, expectedRevision: 2, outcome: "succeeded" }, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        f.faults.write = "none";
        const journal = yield* f.rebuild;
        expect((yield* journal.reconcile(f.input.id, f.threadId)).entry.state).toBe(
          failure === "after" ? "completed" : "unknown",
        );
        expect(
          (yield* journal.reserve(f.input, mutation, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("conflict");
      }),
    ),
);

it.effect("serializes competing reservations and bounds CAS retries", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      yield* f.journal.prepare(f.input, f.threadId);
      const a = { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id };
      const b = { ...a, reservationId: yield* f.id };
      const outcomes = yield* Effect.forEach(
        [f.journal.reserve(f.input, a, f.threadId), f.journal.reserve(f.input, b, f.threadId)],
        (e) => e.pipe(Effect.result),
        { concurrency: "unbounded" },
      );
      expect(outcomes.filter((e) => e._tag === "Success")).toHaveLength(1);
      f.faults.conflict = true;
      expect((yield* f.journal.reconcile(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
        "conflict",
      );
      f.faults.conflict = false;
      expect((yield* f.journal.reconcile(f.input.id, f.threadId)).entry.state).toBe("unknown");
    }),
  ),
);

it.effect(
  "does not block ordinary approvals when the journal is missing, corrupt, unavailable or unsupported",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        expect((yield* f.journal.reconcile(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
        yield* f.journal.prepare(f.input, f.threadId);
        for (const value of [{ schemaVersion: 99 }, { schemaVersion: 1 }, "invalid"]) {
          f.records.set(f.path(), { value: Redacted.make(value), version: 2 });
          expect(
            (yield* f.journal.reconcile(f.input.id, f.threadId).pipe(Effect.flip)).reason,
          ).toBe("invalid-response");
          expect((yield* f.access.approvalInbox).requests[0]?.state).toBe("approved");
        }
        f.faults.reads = true;
        expect((yield* f.journal.reconcile(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
          "unavailable",
        );
        yield* f.access.approvalChange(
          {
            ...f.decision,
            expectedRevision: 2,
            expectedPolicyRevision: 1,
            operationId: yield* f.id,
            decision: "revoke",
          },
          "human",
          Effect.void,
        );
        expect((yield* f.access.approvalInbox).requests[0]?.state).toBe("revoked");
      }),
    ),
);

it.effect("makes cancellation terminal, refuses revoked reservations and hides aged evidence", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      yield* f.journal.prepare(f.input, f.threadId);
      const cancelled = yield* f.journal.cancel(f.input.id, 1, f.threadId);
      expect((yield* f.journal.cancel(f.input.id, 1, f.threadId)).entry.state).toBe("cancelled");
      expect(
        (yield* f.journal
          .reserve(
            f.input,
            { id: f.input.id, expectedRevision: 2, reservationId: yield* f.id },
            f.threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      const record = f.records.get(f.path())!;
      f.records.set(f.path(), {
        ...record,
        value: Redacted.make({
          schemaVersion: 1,
          environmentId: f.environmentId,
          revision: 2,
          entries: [{ ...cancelled.entry, retireAt: 100 }],
        }),
      });
      yield* TestClock.adjust("100 millis");
      expect((yield* f.access.approvalStatus(f.input.id, f.threadId)).request.state).toBe(
        "approved",
      );
      const aged = f.records.get(f.path());
      expect((yield* f.journal.reconcile(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
        "not-found",
      );
      expect(f.records.get(f.path())).toEqual(aged);
    }),
  ),
);

it.effect("bounds the journal at 128 entries and atomically reclaims only aged entries", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      const prepared = yield* f.journal.prepare(f.input, f.threadId);
      const entries = Array.from({ length: 128 }, (_, i) => ({
        ...prepared.entry,
        requestId: i.toString(16).padStart(32, "0"),
        operationId: i.toString(16).padStart(32, "0"),
        runId: `retained-run-${i}`,
        retireAt: 100,
      }));
      const record = f.records.get(f.path())!;
      const value = Redacted.value(record.value) as {
        schemaVersion: number;
        environmentId: string;
        revision: number;
      };
      f.records.set(f.path(), {
        value: Redacted.make({ ...value, entries }),
        version: record.version,
      });
      expect((yield* f.journal.prepare(f.input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "conflict",
      );
      expect(
        (Redacted.value(f.records.get(f.path())!.value) as { entries: unknown[] }).entries,
      ).toHaveLength(128);
      yield* TestClock.adjust("100 millis");
      const fresh = yield* f.journal.prepare(f.input, f.threadId);
      expect(fresh.entry.retireAt).toBe(86_400_000);
      expect(
        (Redacted.value(f.records.get(f.path())!.value) as { entries: unknown[] }).entries,
      ).toHaveLength(1);
    }),
  ),
);

it.effect(
  "returns retained reservation/completion receipts on identical retry without opening a gate",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        const mutation = { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id };
        const first = yield* f.journal.reserve(f.input, mutation, f.threadId);
        expect(yield* f.journal.reserve(f.input, mutation, f.threadId)).toEqual(first);
        const finished = { ...mutation, expectedRevision: 2, outcome: "succeeded" as const };
        const completed = yield* f.journal.finish(finished, f.threadId);
        expect(yield* f.journal.finish(finished, f.threadId)).toEqual(completed);
        expect(completed).toMatchObject({
          entry: { state: "completed", revision: 3 },
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect(
          (yield* f.journal
            .finish({ ...finished, outcome: "failed" }, f.threadId)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
      }),
    ),
);

it.effect("refuses to reserve after approval withdrawal despite retained prepared evidence", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      yield* f.journal.prepare(f.input, f.threadId);
      yield* f.access.approvalChange(
        {
          ...f.decision,
          expectedRevision: 2,
          expectedPolicyRevision: 1,
          operationId: yield* f.id,
          decision: "revoke",
        },
        "human",
        Effect.void,
      );
      expect(
        (yield* f.journal
          .reserve(
            f.input,
            { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id },
            f.threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect((yield* f.journal.reconcile(f.input.id, f.threadId)).entry.state).toBe("prepared");
    }),
  ),
);

it.effect(
  "observes recovery without writes, reservations or external effects, including after restart",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        const before = [...f.records.entries()];
        expect(yield* f.journal.status(f.input.id, f.threadId)).toMatchObject({
          journal: null,
          recoveryState: "no-retained-evidence",
          nextStep: "review-history",
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect([...f.records.entries()]).toEqual(before);
        yield* f.journal.prepare(f.input, f.threadId);
        const prepared = f.records.get(f.path());
        expect(yield* f.journal.status(f.input.id, f.threadId)).toMatchObject({
          journal: { state: "prepared", revision: 1, outcome: null },
          recoveryState: "prepared-only",
          nextStep: "prepare-explicit-operation",
        });
        expect(f.records.get(f.path())).toEqual(prepared);
        const reservationId = yield* f.id;
        yield* f.journal.reserve(
          f.input,
          { id: f.input.id, expectedRevision: 1, reservationId },
          f.threadId,
        );
        const reserved = f.records.get(f.path());
        const rebuilt = yield* f.rebuild;
        const status = yield* rebuilt.status(f.input.id, f.threadId);
        expect(status).toMatchObject({
          journal: { state: "reserved", revision: 2 },
          recoveryState: "requires-outcome-review",
          nextStep: "inspect-outcome",
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect(isRecoveryStatus(status)).toBe(true);
        expect(status.journal).not.toHaveProperty("reservationId");
        expect(status.journal).not.toHaveProperty("threadId");
        expect(f.records.get(f.path())).toEqual(reserved);
        yield* rebuilt.reconcile(f.input.id, f.threadId);
        expect(yield* rebuilt.status(f.input.id, f.threadId)).toMatchObject({
          journal: { state: "unknown" },
          recoveryState: "requires-outcome-review",
        });
      }),
    ),
);

it.effect("reports cancelled preparation without implying the approval itself was withdrawn", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      yield* f.journal.prepare(f.input, f.threadId);
      yield* f.journal.cancel(f.input.id, 1, f.threadId);
      expect(yield* f.journal.status(f.input.id, f.threadId)).toMatchObject({
        status: { request: { state: "approved" } },
        journal: { state: "cancelled" },
        recoveryState: "cancelled",
        nextStep: "review-history",
      });
    }),
  ),
);
it.effect.each(["failed", "succeeded"] as const)(
  "keeps completed %s evidence distinct from current approval authority",
  (outcome) =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        const reservationId = yield* f.id;
        yield* f.journal.reserve(
          f.input,
          { id: f.input.id, expectedRevision: 1, reservationId },
          f.threadId,
        );
        yield* f.journal.finish(
          { id: f.input.id, expectedRevision: 2, reservationId, outcome },
          f.threadId,
        );
        yield* f.access.approvalChange(
          {
            ...f.decision,
            expectedRevision: 2,
            expectedPolicyRevision: 1,
            operationId: yield* f.id,
            decision: "revoke",
          },
          "human",
          Effect.void,
        );
        expect(yield* f.journal.status(f.input.id, f.threadId)).toMatchObject({
          status: { request: { state: "revoked" } },
          journal: { state: "completed", outcome },
          recoveryState: "completed",
          nextStep: "review-history",
          canExecute: false,
        });
      }),
    ),
);

it.effect(
  "checks requester ownership before reading a corrupt journal and preserves approval availability",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        f.records.set(f.path(), { value: Redacted.make({ schemaVersion: 99 }), version: 2 });
        const reads = f.faults.journalReads;
        expect(
          (yield* f.journal.status(f.input.id, ThreadId.make("not-owner")).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect(f.faults.journalReads).toBe(reads);
        expect((yield* f.journal.status(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
          "invalid-response",
        );
        f.faults.reads = true;
        const failedReads = f.faults.journalReads;
        expect(
          (yield* f.journal.status(f.input.id, ThreadId.make("not-owner")).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        expect(f.faults.journalReads).toBe(failedReads);
        expect((yield* f.journal.status(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
          "unavailable",
        );
        expect((yield* f.access.approvalInbox).requests[0]?.state).toBe("approved");
      }),
    ),
);

it.effect(
  "hides aged journal entries without erasing evidence or implying no external effect",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        const record = f.records.get(f.path())!;
        const value = Redacted.value(record.value) as { entries: Array<{ retireAt: number }> };
        f.records.set(f.path(), {
          ...record,
          value: Redacted.make({
            ...value,
            entries: value.entries.map((entry) => ({ ...entry, retireAt: 100 })),
          }),
        });
        yield* TestClock.adjust("100 millis");
        const before = f.records.get(f.path());
        expect(yield* f.journal.status(f.input.id, f.threadId)).toMatchObject({
          journal: null,
          recoveryState: "no-retained-evidence",
          nextStep: "review-history",
          canExecute: false,
        });
        expect(f.records.get(f.path())).toEqual(before);
        yield* TestClock.adjust("24 hours");
        expect((yield* f.journal.status(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
      }),
    ),
);

it.effect("rejects a journal entry that no longer matches the owned request correlation", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      yield* f.journal.prepare(f.input, f.threadId);
      const record = f.records.get(f.path())!;
      const value = Redacted.value(record.value) as { entries: Array<{ operationId: string }> };
      f.records.set(f.path(), {
        ...record,
        value: Redacted.make({
          ...value,
          entries: value.entries.map((entry) => ({ ...entry, operationId: "0".repeat(32) })),
        }),
      });
      expect((yield* f.journal.status(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
        "invalid-response",
      );
      expect((yield* f.access.approvalInbox).requests).toHaveLength(1);
    }),
  ),
);

it.effect(
  "prepares an explicit proposal with recovery context without creating journal evidence",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        const before = [...f.records.entries()];
        const report = yield* f.journal.previewRetry(f.input, f.threadId);
        expect(isRetryReport(report)).toBe(true);
        expect(report).toMatchObject({
          retryState: "policy-valid-recheck-adapter",
          recovery: { recoveryState: "no-retained-evidence", journal: null },
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect([...f.records.entries()]).toEqual(before);
        yield* f.journal.prepare(f.input, f.threadId);
        const prepared = [...f.records.entries()];
        expect(yield* f.journal.previewRetry(f.input, f.threadId)).toMatchObject({
          retryState: "policy-valid-recheck-adapter",
          recovery: { journal: { state: "prepared" } },
        });
        expect([...f.records.entries()]).toEqual(prepared);
      }),
    ),
);

it.effect(
  "compares retained proposal digests even when the requester omits its previous digest",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
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
        const before = [...f.records.entries()];
        expect(yield* f.journal.previewRetry(changed, f.threadId)).toMatchObject({
          retryState: "operation-changed",
          nextStep: "review-operation",
          canExecute: false,
        });
        expect([...f.records.entries()]).toEqual(before);
      }),
    ),
);

it.effect.each(["reserved", "unknown", "succeeded", "failed"] as const)(
  "requires outcome review for retained %s despite caller-reported not-started",
  (state) =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        const reservationId = yield* f.id;
        yield* f.journal.reserve(
          f.input,
          { id: f.input.id, expectedRevision: 1, reservationId },
          f.threadId,
        );
        if (state === "unknown") yield* f.journal.reconcile(f.input.id, f.threadId);
        else if (state !== "reserved")
          yield* f.journal.finish(
            {
              id: f.input.id,
              expectedRevision: 2,
              reservationId,
              outcome: state,
            },
            f.threadId,
          );
        const restarted = yield* f.rebuild;
        const before = [...f.records.entries()];
        expect(yield* restarted.previewRetry(f.input, f.threadId)).toMatchObject({
          retryState: "requires-outcome-review",
          nextStep: "inspect-outcome",
          canExecute: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect([...f.records.entries()]).toEqual(before);
        // Current authority still takes precedence over a historical result.
        yield* f.access.approvalChange(
          {
            ...f.decision,
            expectedRevision: 2,
            expectedPolicyRevision: 1,
            operationId: yield* f.id,
            decision: "revoke",
          },
          "human",
          Effect.void,
        );
        expect(
          yield* restarted.previewRetry({ ...f.input, expectedRevision: 3 }, f.threadId),
        ).toMatchObject({
          retryState: "blocked-request",
          nextStep: "request-new-approval",
          recovery: { status: { request: { state: "revoked" } } },
        });
      }),
    ),
);

it.effect(
  "refuses reuse of cancelled preparation and retains independent stale-request checks",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        yield* f.journal.prepare(f.input, f.threadId);
        yield* f.journal.cancel(f.input.id, 1, f.threadId);
        expect(yield* f.journal.previewRetry(f.input, f.threadId)).toMatchObject({
          retryState: "blocked-request",
          nextStep: "request-new-approval",
          recovery: { journal: { state: "cancelled" } },
        });
        expect(
          yield* f.journal.previewRetry({ ...f.input, expectedRevision: 1 }, f.threadId),
        ).toMatchObject({
          retryState: "stale-request",
          nextStep: "refresh-request",
        });
      }),
    ),
);

it.effect("fails retry preparation closed on unavailable evidence without blocking approvals", () =>
  withJournal((f) =>
    Effect.gen(function* () {
      yield* f.journal.prepare(f.input, f.threadId);
      f.faults.reads = true;
      const reads = f.faults.journalReads;
      expect(
        (yield* f.journal.previewRetry(f.input, ThreadId.make("not-owner")).pipe(Effect.flip))
          .reason,
      ).toBe("denied");
      expect(f.faults.journalReads).toBe(reads);
      expect((yield* f.journal.previewRetry(f.input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "unavailable",
      );
      f.faults.reads = false;
      f.records.set(f.path(), { value: Redacted.make({ schemaVersion: 99 }), version: 2 });
      expect((yield* f.journal.previewRetry(f.input, f.threadId).pipe(Effect.flip)).reason).toBe(
        "invalid-response",
      );
      expect((yield* f.access.approvalInbox).requests[0]?.state).toBe("approved");
    }),
  ),
);

it.effect(
  "invalidates a policy-valid proposal when run context changes during recovery lookup",
  () =>
    withJournal((f) =>
      Effect.gen(function* () {
        f.faults.onJournalRead = () => {
          f.state.thread = { ...f.state.thread, activeRunId: null };
        };
        expect(yield* f.journal.previewRetry(f.input, f.threadId)).toMatchObject({
          retryState: "context-changed",
          nextStep: "refresh-request",
          status: { operationState: "stale-run" },
          canExecute: false,
        });
        expect(f.path()).toBeUndefined();
      }),
    ),
);
