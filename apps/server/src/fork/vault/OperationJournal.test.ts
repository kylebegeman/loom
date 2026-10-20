import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadId } from "@t3tools/contracts";
import { VaultError, type VaultApprovalRetryInput } from "@t3tools/contracts/fork";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as OperationJournal from "./OperationJournal.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture } from "./VaultLaunch.testkit.ts";

const withJournal = <A, E>(
  use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, Crypto.Crypto>,
) => Effect.flatMap(fixture, use).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
const fixture = Effect.gen(function* () {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const faults = { write: "none" as "none" | "before" | "after", conflict: false, reads: false };
  const store = Layer.succeed(OpenBaoStore.OpenBaoStore, {
    status: Effect.succeed({ backend: "openbao" as const, state: "ready" as const, origin: null }),
    keys: (prefix: string) =>
      Effect.sync(() =>
        [...records.keys()]
          .filter((k) => k.startsWith(prefix + "/"))
          .map((k) => k.slice(prefix.length + 1)),
      ),
    read: (path: string) =>
      Effect.suspend(() =>
        faults.reads && path.endsWith("approval-journal-v1")
          ? Effect.fail(new VaultError({ reason: "unavailable" }))
          : Effect.succeed(records.get(path) ?? null),
      ),
    write: (path: string, value: Redacted.Redacted<unknown>, expected: number) =>
      Effect.suspend(() => {
        const journal = path.endsWith("approval-journal-v1");
        if (journal && faults.write === "before")
          return Effect.fail(new VaultError({ reason: "unavailable" }));
        const version = records.get(path)?.version ?? 0;
        if (version !== expected || (journal && faults.conflict))
          return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(path, { value, version: version + 1 });
        if (journal && faults.write === "after") {
          faults.write = "none";
          return Effect.fail(new VaultError({ reason: "unavailable" }));
        }
        return Effect.succeed(version + 1);
      }),
  });
  const f = yield* launchFixture(
    Layer.succeed(SshTransport.SshTransport, {
      execute: () => Effect.die("The journal must never invoke an execution adapter"),
    }),
  ).pipe(Effect.provide(store));
  const rebuild = OperationJournal.OperationJournal.pipe(
    Effect.provide(
      Layer.fresh(
        OperationJournal.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeedContext(f.context),
              store,
              Layer.succeed(ServerEnvironmentIdentity, {
                getEnvironmentId: Effect.succeed(f.environmentId),
              }),
            ),
          ),
        ),
      ),
    ),
  );
  const journal = yield* rebuild;
  const id = yield* f.id;
  yield* f.access.approvalCreate(
    { id, threadId: f.threadId, itemId: f.itemId, action: "use", destination: f.key.destination },
    `thread:${f.threadId}`,
    Effect.void,
  );
  const decision = {
    id,
    operationId: yield* f.id,
    expectedRevision: 1,
    expectedPolicyRevision: 0,
    decision: "approve" as const,
    durationMs: 300_000 as const,
  };
  yield* f.access.approvalChange(decision, "human", Effect.void);
  const input: VaultApprovalRetryInput = {
    id,
    waitingOperationId: id,
    expectedRevision: 2,
    previousOutcome: "not-started",
    operation: {
      kind: "ssh",
      target: f.key.target,
      input: { id: f.itemId, command: { expectedVersion: 1, argv: ["true"], timeoutMs: 1000 } },
    },
  };
  const path = () => [...records.keys()].find((k) => k.endsWith("approval-journal-v1"))!;
  return { ...f, journal, input, decision, rebuild, records, faults, path };
});

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
        expect(stored).not.toHaveProperty("argv");
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
      const outcomes = yield* Effect.all(
        [f.journal.reserve(f.input, a, f.threadId), f.journal.reserve(f.input, b, f.threadId)].map(
          (e) => e.pipe(Effect.result),
        ),
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
      yield* f.journal.cancel(f.input.id, 1, f.threadId);
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
      yield* TestClock.adjust("24 hours");
      expect((yield* f.journal.reconcile(f.input.id, f.threadId).pipe(Effect.flip)).reason).toBe(
        "not-found",
      );
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
