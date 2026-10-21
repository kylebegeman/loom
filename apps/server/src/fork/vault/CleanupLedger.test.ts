import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as CleanupLedger from "./CleanupLedger.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import { syntheticCleanupBarrier } from "./testkit/SyntheticCleanupBarrier.ts";

const environmentId = EnvironmentId.make("cleanup-ledger-proof");
const scope: CleanupLedger.CleanupScope = {
  environmentId,
  itemId: "a".repeat(32),
  itemVersion: 1,
  accountId: "b".repeat(32),
  collectionId: "c".repeat(32),
  machineId: "d".repeat(32),
  application: "Loom proof",
  target: "development",
  origin: "http://127.0.0.1:15713",
};
const request = { operationId: "operation-one", leaseId: "lease-one", runId: "run-one" };
const fixture = Effect.gen(function* () {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const faults = { write: "none" as "none" | "before" | "after", reads: false, conflict: false };
  const backend = Layer.succeed(OpenBaoStore.OpenBaoStore, {
    status: Effect.succeed({ backend: "openbao" as const, state: "ready" as const, origin: null }),
    keys: () => Effect.die("Ledger must not enumerate unrelated records"),
    read: (path) =>
      Effect.suspend(() =>
        faults.reads
          ? Effect.fail(new VaultError({ reason: "unavailable" }))
          : Effect.succeed(records.get(path) ?? null),
      ),
    write: (path, value, expected) =>
      Effect.gen(function* () {
        if (faults.write === "before") return yield* new VaultError({ reason: "unavailable" });
        const version = records.get(path)?.version ?? 0;
        if (version !== expected || faults.conflict)
          return yield* new VaultError({ reason: "conflict" });
        records.set(path, { value, version: version + 1 });
        if (faults.write === "after") return yield* new VaultError({ reason: "unavailable" });
        return version + 1;
      }),
  });
  const dependencies = Layer.mergeAll(
    backend,
    NodeServices.layer,
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
  );
  const rebuild = CleanupLedger.CleanupLedger.pipe(
    Effect.provide(Layer.fresh(CleanupLedger.layer.pipe(Layer.provide(dependencies)))),
  );
  const ledger = yield* rebuild;
  const calls = { starts: 0, fences: 0, resets: 0, lostStart: false };
  const controller = (store: CleanupLedger.CleanupStore) =>
    syntheticCleanupBarrier(
      scope,
      store,
      {
        start: () =>
          Effect.gen(function* () {
            calls.starts++;
            if (calls.lostStart) return yield* new VaultError({ reason: "unavailable" });
          }),
        fence: (ticket) =>
          Effect.sync(() => {
            calls.fences++;
            return { ticket, outcome: "fenced" as const };
          }),
        reset: (intent) =>
          Effect.sync(() => {
            calls.resets++;
            return intent;
          }),
      },
      { start: () => Effect.void, maintain: Effect.void },
    );
  return {
    records,
    faults,
    ledger,
    rebuild,
    controller,
    calls,
    path: () => [...records.keys()][0]!,
    raw: () => Redacted.value(records.values().next().value!.value),
    replace: (change: (value: Record<string, unknown>) => unknown) => {
      const path = [...records.keys()][0]!;
      const record = records.get(path)!;
      records.set(path, {
        ...record,
        value: Redacted.make(
          change(structuredClone(Redacted.value(record.value)) as Record<string, unknown>),
        ),
      });
    },
  };
});

it.effect("persists reset and cleanup intent independently with all delivery gates closed", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const model = f.controller(f.ledger);
    yield* model.enroll;
    expect(f.path()).toMatch(
      /^environments\/[a-f0-9]{64}\/profiles\/_operations\/cleanup-reset-v1$/,
    );
    yield* model.reset("bootstrap");
    yield* model.start(request);
    expect(f.raw()).toMatchObject({
      schemaVersion: 1,
      revision: 4,
      entries: [{ phase: "uncertain" }],
    });
    const rebuilt = yield* f.rebuild;
    const restarted = f.controller(rebuilt);
    expect((yield* restarted.snapshot).phase).toBe("uncertain");
    expect((yield* restarted.start(request).pipe(Effect.flip)).reason).toBe("denied");
    yield* restarted.cleanup;
    yield* restarted.reset("reset-one");
    expect((yield* f.controller(yield* f.rebuild).snapshot).phase).toBe("ready");
    expect(f.calls).toMatchObject({ starts: 1, fences: 1, resets: 2 });
    expect(restarted.gates).toEqual({
      canExecute: false,
      canDeliver: false,
      canReset: false,
      canReuse: false,
      automaticResumption: false,
      allowOnceConsumption: false,
    });
  }),
);
it.effect.each(["before", "after"] as const)(
  "recovers %s a lost start-intent acknowledgement without dispatch",
  (failure) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const model = f.controller(f.ledger);
      yield* model.enroll;
      yield* model.reset("bootstrap");
      f.faults.write = failure;
      expect((yield* model.start(request).pipe(Effect.flip)).reason).toBe("unavailable");
      f.faults.write = "none";
      expect((yield* f.controller(yield* f.rebuild).snapshot).phase).toBe(
        failure === "after" ? "uncertain" : "ready",
      );
      expect(f.calls.starts).toBe(0);
    }),
);
it.effect("retains unknown external start across restart and cleans without retrying it", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const model = f.controller(f.ledger);
    yield* model.enroll;
    yield* model.reset("bootstrap");
    f.calls.lostStart = true;
    yield* model.start(request).pipe(Effect.flip);
    const restarted = f.controller(yield* f.rebuild);
    expect((yield* restarted.snapshot).phase).toBe("uncertain");
    yield* restarted.cleanup;
    expect(f.calls.starts).toBe(1);
    expect(f.calls.fences).toBe(1);
  }),
);
it.effect("CAS rejects a competing enrollment and never overwrites an acknowledged snapshot", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const before = yield* f.ledger.read;
    yield* f.controller(f.ledger).enroll;
    const committed = f.raw();
    expect(
      (yield* f.ledger.cas(before.revision, { ...before, revision: 1 }).pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect(f.raw()).toEqual(committed);
    f.faults.conflict = true;
    expect((yield* f.controller(f.ledger).reset("bootstrap").pipe(Effect.flip)).reason).toBe(
      "conflict",
    );
    expect(f.calls.resets).toBe(0);
  }),
);
it.effect.each(["environment", "schema", "unknown-field", "duplicate", "orphan-ticket", "phase"])(
  "refuses corrupt or unsupported %s evidence without replacing it",
  (defect) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.controller(f.ledger).enroll;
      f.replace((value) => {
        const entries = value.entries as Array<Record<string, unknown>>;
        if (defect === "environment") value.environmentId = "foreign";
        if (defect === "schema") value.schemaVersion = 2;
        if (defect === "unknown-field") value.token = "must-not-be-accepted";
        if (defect === "duplicate") entries.push(entries[0]!);
        if (defect === "orphan-ticket") {
          entries[0]!.phase = "uncertain";
          entries[0]!.ticket = { scope, ...request, generation: 0 };
        }
        if (defect === "phase") entries[0]!.phase = "ready";
        return value;
      });
      const raw = f.raw();
      expect((yield* (yield* f.rebuild).read.pipe(Effect.flip)).reason).toBe("invalid-response");
      expect(f.raw()).toEqual(raw);
    }),
);
it.effect("never prunes unresolved work or replay history after the queue retention window", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const model = f.controller(f.ledger);
    yield* model.enroll;
    yield* model.reset("bootstrap");
    yield* model.start(request);
    const before = f.raw();
    yield* TestClock.adjust("2 days");
    const store = yield* f.rebuild;
    expect((yield* f.controller(store).snapshot).phase).toBe("uncertain");
    expect(f.raw()).toEqual(before);
    const state = yield* store.read;
    expect(
      (yield* store
        .cas(state.revision, {
          ...state,
          revision: state.revision + 1,
          operationIds: new Set(),
          leaseIds: new Set(),
        })
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-input");
  }),
);
it.effect(
  "refuses scope reassignment, missing resources and a forged direct ready transition",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.controller(f.ledger).enroll;
      const before = yield* f.ledger.read;
      const key = CleanupLedger.cleanupResourceKey(scope);
      for (const entries of [
        new Map(),
        new Map([[key, { ...before.entries.get(key)!, phase: "ready" as const, generation: 1 }]]),
        new Map([
          [key, { ...before.entries.get(key)!, scope: { ...scope, machineId: "f".repeat(32) } }],
        ]),
      ]) {
        expect(
          (yield* f.ledger
            .cas(before.revision, { ...before, revision: before.revision + 1, entries })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
      }
      f.faults.reads = true;
      expect((yield* f.ledger.read.pipe(Effect.flip)).reason).toBe("unavailable");
    }),
);

it.effect.each(["resources", "operations", "resets"] as const)(
  "refuses %s capacity overflow without forgetting durable evidence",
  (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const model = f.controller(f.ledger);
      yield* model.enroll;
      if (kind === "operations") yield* model.reset("bootstrap");
      f.replace((value) => {
        if (kind === "resources")
          value.entries = Array.from({ length: 32 }, (_, index) => ({
            scope: { ...scope, itemId: index.toString(16).padStart(32, "0") },
            phase: "quarantined",
            generation: 0,
            ticket: null,
            reset: null,
          }));
        if (kind === "operations") {
          value.operationIds = Array.from({ length: 128 }, (_, index) => `old-operation-${index}`);
          value.leaseIds = Array.from({ length: 128 }, (_, index) => `old-lease-${index}`);
        }
        if (kind === "resets")
          value.resetIds = Array.from({ length: 160 }, (_, index) => `old-reset-${index}`);
        return value;
      });
      const before = yield* f.ledger.read;
      const key = CleanupLedger.cleanupResourceKey(scope);
      const next: CleanupLedger.CleanupState =
        kind === "resources"
          ? {
              ...before,
              revision: before.revision + 1,
              entries: new Map(before.entries).set(key, {
                scope,
                phase: "quarantined",
                generation: 0,
                ticket: null,
                reset: null,
              }),
            }
          : kind === "operations"
            ? {
                ...before,
                revision: before.revision + 1,
                entries: new Map(before.entries).set(key, {
                  ...before.entries.get(key)!,
                  phase: "uncertain",
                  ticket: { scope, ...request, generation: 1 },
                }),
                operationIds: new Set(before.operationIds).add(request.operationId),
                leaseIds: new Set(before.leaseIds).add(JSON.stringify([key, request.leaseId])),
              }
            : {
                ...before,
                revision: before.revision + 1,
                entries: new Map(before.entries).set(key, {
                  ...before.entries.get(key)!,
                  phase: "resetting",
                  reset: { scope, resetId: "new-reset", from: 0, to: 1 },
                }),
                resetIds: new Set(before.resetIds).add("new-reset"),
              };
      const retained = f.raw();
      expect((yield* f.ledger.cas(before.revision, next).pipe(Effect.flip)).reason).toBe(
        "invalid-input",
      );
      expect(f.raw()).toEqual(retained);
    }),
);

it.effect("refuses a backwards clock before dispatch rather than backdating durable evidence", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const model = f.controller(f.ledger);
    yield* model.enroll;
    yield* TestClock.adjust("1 minute");
    yield* model.reset("bootstrap");
    const before = f.raw();
    yield* TestClock.setTime(0);
    expect((yield* model.start(request).pipe(Effect.flip)).reason).toBe("unavailable");
    expect(f.calls.starts).toBe(0);
    expect(f.raw()).toEqual(before);
  }),
);
