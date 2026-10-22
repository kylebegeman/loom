import { expect, it } from "@effect/vitest";
import { VaultError } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import {
  syntheticCleanupBarrier,
  cleanupScopeKey,
  type CleanupScope,
  type CleanupState,
  type CleanupStore,
  type CleanupTicket,
  type CleanupProvider,
  type ResetIntent,
} from "./testkit/SyntheticCleanupBarrier.ts";

const scope: CleanupScope = {
  environmentId: "disposable-environment",
  itemId: "a".repeat(32),
  itemVersion: 1,
  accountId: "b".repeat(32),
  collectionId: "c".repeat(32),
  machineId: "d".repeat(32),
  application: "Disposable Loom target",
  target: "test",
  origin: "http://127.0.0.1:15713",
};
const request = (index = 1) => ({
  operationId: `operation-${index}`,
  leaseId: `lease-${index}`,
  runId: `run-${index}`,
});
const unavailable = () => new VaultError({ reason: "unavailable" });
const denied = () => new VaultError({ reason: "denied" });
const fixture = Effect.gen(function* () {
  const retained = yield* Ref.make<CleanupState>({
    revision: 0,
    entries: new Map(),
    operationIds: new Set(),
    leaseIds: new Set(),
    resetIds: new Set(),
  });
  const providerState = yield* Ref.make({
    generation: 0,
    fences: new Set<string>(),
    starts: new Map<string, CleanupTicket>(),
    active: new Set<string>(),
    resets: new Map<string, ResetIntent>(),
    resetEffects: 0,
  });
  const faults = {
    reads: false,
    write: "none" as "none" | "before" | "after",
    authorized: true,
    workerAuthorized: true,
    deniedLease: null as string | null,
    deniedRun: null as string | null,
    beforeStart: Effect.void as Effect.Effect<void, VaultError>,
    afterStart: Effect.void as Effect.Effect<void, VaultError>,
    beforeFence: Effect.void as Effect.Effect<void, VaultError>,
    afterFence: Effect.void as Effect.Effect<void, VaultError>,
    beforeReset: Effect.void as Effect.Effect<void, VaultError>,
    afterReset: Effect.void as Effect.Effect<void, VaultError>,
    fenceUnknown: false,
    forgedFence: false,
    forgedReset: false,
    fenceReceipt: null as null | ((ticket: CleanupTicket) => CleanupTicket),
    resetReceipt: null as null | ((intent: ResetIntent) => ResetIntent),
    providerAvailable: true,
    starts: 0,
    fences: 0,
    resets: 0,
  };
  const store: CleanupStore = {
    read: Effect.suspend(() => (faults.reads ? Effect.fail(unavailable()) : Ref.get(retained))),
    cas: (revision, next) =>
      Effect.gen(function* () {
        if (faults.write === "before") return yield* unavailable();
        const committed = yield* Ref.modify(retained, (current) =>
          current.revision === revision ? [true, next] : [false, current],
        );
        if (!committed) return yield* new VaultError({ reason: "conflict" });
        if (faults.write === "after") return yield* unavailable();
      }),
  };
  // Provider generation/fences/reset receipts are retained independently of each controller instance.
  const provider: CleanupProvider = {
    start: (ticket) =>
      Effect.gen(function* () {
        faults.starts++;
        yield* faults.beforeStart;
        if (!faults.providerAvailable) return yield* unavailable();
        const admitted = yield* Ref.modify(providerState, (current) => {
          if (
            current.generation !== ticket.generation ||
            [...current.starts.values()].some(
              (start) =>
                start.generation === ticket.generation && start.operationId !== ticket.operationId,
            ) ||
            current.fences.has(ticket.operationId) ||
            cleanupScopeKey(ticket.scope) !== cleanupScopeKey(scope)
          )
            return [false, current];
          const previous = current.starts.get(ticket.operationId);
          if (previous && JSON.stringify(previous) !== JSON.stringify(ticket))
            return [false, current];
          return [
            true,
            {
              ...current,
              starts: new Map(current.starts).set(ticket.operationId, ticket),
              active: new Set(current.active).add(ticket.operationId),
            },
          ];
        });
        if (!admitted) return yield* denied();
        yield* faults.afterStart;
      }),
    fence: (ticket) =>
      Effect.gen(function* () {
        faults.fences++;
        yield* faults.beforeFence;
        if (!faults.providerAvailable) return yield* unavailable();
        if (faults.fenceUnknown) return { ticket, outcome: "unknown" as const };
        yield* Ref.update(providerState, (current) => ({
          ...current,
          fences: new Set(current.fences).add(ticket.operationId),
          active: new Set([...current.active].filter((id) => id !== ticket.operationId)),
        }));
        yield* faults.afterFence;
        return {
          ticket: faults.fenceReceipt
            ? faults.fenceReceipt(ticket)
            : faults.forgedFence
              ? { ...ticket, leaseId: "foreign-lease" }
              : ticket,
          outcome: "fenced" as const,
        };
      }),
    reset: (intent) =>
      Effect.gen(function* () {
        faults.resets++;
        yield* faults.beforeReset;
        if (!faults.providerAvailable) return yield* unavailable();
        const committed = yield* Ref.modify(providerState, (current) => {
          const previous = current.resets.get(intent.resetId);
          if (previous)
            return [
              JSON.stringify(previous) === JSON.stringify(intent) &&
                current.generation === intent.to &&
                ![...current.starts.values()].some((start) => start.generation === intent.to),
              current,
            ];
          if (
            current.generation !== intent.from ||
            current.active.size !== 0 ||
            intent.to !== intent.from + 1 ||
            cleanupScopeKey(intent.scope) !== cleanupScopeKey(scope)
          )
            return [false, current];
          return [
            true,
            {
              ...current,
              generation: intent.to,
              active: new Set<string>(),
              resets: new Map(current.resets).set(intent.resetId, intent),
              resetEffects: current.resetEffects + 1,
            },
          ];
        });
        if (!committed) return yield* denied();
        yield* faults.afterReset;
        return faults.resetReceipt
          ? faults.resetReceipt(intent)
          : faults.forgedReset
            ? { ...intent, resetId: "foreign-reset" }
            : intent;
      }),
  };
  const authorize = Effect.suspend(() => (faults.authorized ? Effect.void : Effect.fail(denied())));
  const authority = {
    maintain: authorize,
    start: (input: ReturnType<typeof request>) =>
      Effect.gen(function* () {
        yield* authorize;
        if (
          !faults.workerAuthorized ||
          input.leaseId === faults.deniedLease ||
          input.runId === faults.deniedRun
        )
          return yield* denied();
      }),
  };
  const restart = (registration = scope) =>
    syntheticCleanupBarrier(registration, store, provider, authority);
  const model = restart();
  yield* model.enroll;
  const ready = Effect.gen(function* () {
    yield* model.reset("bootstrap");
    return restart();
  });
  return { retained, providerState, faults, store, provider, model, restart, ready };
});

it.effect(
  "requires explicit fenced cleanup then reset and a fresh lease before synthetic reuse",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect((yield* f.model.snapshot).phase).toBe("quarantined");
      expect((yield* f.model.start(request()).pipe(Effect.flip)).reason).toBe("denied");
      const model = yield* f.ready;
      const ticket = yield* model.start(request());
      expect((yield* model.snapshot).phase).toBe("uncertain");
      expect((yield* model.reset("too-early").pipe(Effect.flip)).reason).toBe("denied");
      yield* f.restart().cleanup;
      expect((yield* f.restart().snapshot).phase).toBe("fenced");
      expect((yield* f.restart().start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
      yield* f.restart().reset("reset-one");
      expect((yield* f.restart().snapshot).generation).toBe(2);
      expect(
        (yield* f
          .restart()
          .start({ ...request(2), leaseId: ticket.leaseId })
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* f
          .restart()
          .start({ ...request(2), operationId: ticket.operationId })
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      yield* f.restart().start(request(2));
      expect((yield* Ref.get(f.providerState)).active).toEqual(new Set(["operation-2"]));
      expect(model.gates).toEqual({
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
  "refuses external start after %s intent-write failure and reconstructs conservatively",
  (write) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const model = yield* f.ready;
      f.faults.write = write;
      expect((yield* model.start(request()).pipe(Effect.flip)).reason).toBe("unavailable");
      expect(f.faults.starts).toBe(0);
      f.faults.write = "none";
      expect((yield* f.restart().snapshot).phase).toBe(write === "after" ? "uncertain" : "ready");
      if (write === "after") {
        expect((yield* f.restart().start(request()).pipe(Effect.flip)).reason).toBe("denied");
        yield* f.restart().cleanup;
        expect((yield* f.restart().snapshot).phase).toBe("fenced");
      }
    }),
);

it.effect(
  "reconstructs after lost start reply, without retrying start or mistaking expiry for cleanup",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const model = yield* f.ready;
      f.faults.afterStart = Effect.fail(unavailable());
      expect((yield* model.start(request()).pipe(Effect.flip)).reason).toBe("unavailable");
      yield* TestClock.adjust("30 days");
      const restarted = f.restart();
      expect((yield* restarted.start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
      expect((yield* restarted.reset("reset").pipe(Effect.flip)).reason).toBe("denied");
      expect((yield* Ref.get(f.providerState)).active.size).toBe(1);
      yield* restarted.cleanup;
      expect(f.faults.starts).toBe(1);
      expect((yield* Ref.get(f.providerState)).active.size).toBe(0);
    }),
);

it.effect.each(["unknown", "forged", "provider-error", "lost-reply", "lost-store-ack"] as const)(
  "retains the barrier after %s cleanup evidence",
  (fault) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const model = yield* f.ready;
      yield* model.start(request());
      if (fault === "unknown") f.faults.fenceUnknown = true;
      else if (fault === "forged") f.faults.forgedFence = true;
      else if (fault === "provider-error") f.faults.providerAvailable = false;
      else if (fault === "lost-reply") f.faults.afterFence = Effect.fail(unavailable());
      else f.faults.write = "after";
      expect((yield* model.cleanup.pipe(Effect.flip)).reason).toBe("unavailable");
      f.faults.write = "none";
      expect((yield* f.restart().snapshot).phase).toBe(
        fault === "lost-store-ack" ? "fenced" : "uncertain",
      );
      expect((yield* f.restart().start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
      f.faults.fenceUnknown = false;
      f.faults.forgedFence = false;
      f.faults.providerAvailable = true;
      f.faults.afterFence = Effect.void;
      yield* f.restart().cleanup;
      expect((yield* f.restart().snapshot).phase).toBe("fenced");
    }),
);

it.effect.each([
  "intent-before",
  "intent-after",
  "provider-before",
  "provider-after",
  "commit-before",
  "commit-after",
  "forged",
] as const)("reconstructs reset after %s failure and deduplicates external reset", (fault) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const model = yield* f.ready;
    yield* model.start(request());
    yield* model.cleanup;
    if (fault === "intent-before") f.faults.write = "before";
    else if (fault === "intent-after") f.faults.write = "after";
    else if (fault === "provider-before") f.faults.beforeReset = Effect.fail(unavailable());
    else if (fault === "provider-after") f.faults.afterReset = Effect.fail(unavailable());
    else if (fault === "forged") f.faults.forgedReset = true;
    else
      f.faults.afterReset = Effect.sync(() => {
        f.faults.write = fault === "commit-before" ? "before" : "after";
      });
    expect((yield* model.reset("reset-one").pipe(Effect.flip)).reason).toBe("unavailable");
    f.faults.write = "none";
    f.faults.beforeReset = Effect.void;
    f.faults.afterReset = Effect.void;
    f.faults.forgedReset = false;
    const restarted = f.restart();
    if (fault !== "commit-after") {
      expect((yield* restarted.start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
      if ((yield* restarted.snapshot).phase === "resetting") {
        expect((yield* restarted.reset("another-reset").pipe(Effect.flip)).reason).toBe("denied");
        expect((yield* restarted.cleanup.pipe(Effect.flip)).reason).toBe("denied");
      }
      yield* restarted.reset("reset-one");
    }
    expect((yield* restarted.snapshot).phase).toBe("ready");
    expect((yield* Ref.get(f.providerState)).resetEffects).toBe(2);
    yield* restarted.start(request(2));
  }),
);

it.effect.each(["start", "reset"] as const)(
  "admits one CAS winner across reconstructed controllers for %s",
  (operation) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      if (operation === "reset") {
        yield* f.model.start(request());
        yield* f.model.cleanup;
      }
      const firstRead = yield* Deferred.make<void>(),
        bothRead = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      let visits = 0;
      const blocking: CleanupStore = {
        ...f.store,
        read: Effect.gen(function* () {
          const state = yield* f.store.read;
          if (++visits <= 2) {
            yield* Deferred.succeed(firstRead, undefined);
            if (visits === 2) yield* Deferred.succeed(bothRead, undefined);
            yield* Deferred.await(release);
          }
          return state;
        }),
      };
      const build = () =>
        syntheticCleanupBarrier(scope, blocking, f.provider, {
          start: () => Effect.void,
          maintain: Effect.void,
        });
      const run = (index: number) =>
        operation === "start" ? build().start(request(index)) : build().reset(`reset-${index}`);
      const first = yield* run(1).pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(firstRead);
      const second = yield* run(2).pipe(Effect.result, Effect.forkChild);
      // Both workers yield at a retained-read milestone before either CAS.
      yield* Deferred.await(bothRead);
      yield* Deferred.succeed(release, undefined);
      const results = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
      expect(operation === "start" ? f.faults.starts : f.faults.resets - 1).toBe(1);
    }),
);

it.effect("a delayed start cannot mint after restart cleanup, even after a newer reset", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const model = yield* f.ready;
    const sent = yield* Deferred.make<void>(),
      release = yield* Deferred.make<void>();
    f.faults.beforeStart = Deferred.succeed(sent, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
    );
    const old = yield* model.start(request()).pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(sent);
    yield* f.restart().cleanup;
    yield* f.restart().reset("reset-one");
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(old);
    expect(result._tag).toBe("Failure");
    expect((yield* Ref.get(f.providerState)).active.size).toBe(0);
    expect((yield* f.restart().snapshot).phase).toBe("ready");
  }),
);

it.effect("stale cleanup acknowledgement cannot overwrite a newer reset or active operation", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const model = yield* f.ready;
    yield* model.start(request());
    const fenced = yield* Deferred.make<void>(),
      release = yield* Deferred.make<void>();
    f.faults.afterFence = Deferred.succeed(fenced, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
    );
    const stale = yield* model.cleanup.pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(fenced);
    f.faults.afterFence = Effect.void;
    yield* f.restart().cleanup;
    yield* f.restart().reset("reset-one");
    yield* f.restart().start(request(2));
    yield* Deferred.succeed(release, undefined);
    const outcome = yield* Fiber.join(stale);
    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") expect(outcome.failure.reason).toBe("conflict");
    expect((yield* f.restart().snapshot).ticket?.operationId).toBe("operation-2");
    expect((yield* Ref.get(f.providerState)).active).toEqual(new Set(["operation-2"]));
  }),
);

it.effect.each([false, true])("provider refuses a forgotten generation start, fenced=%s", (fence) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.ready;
    const ready = yield* Ref.get(f.retained);
    yield* f.model.start(request());
    if (fence) yield* f.model.cleanup;
    yield* Ref.set(f.retained, ready);
    expect((yield* f.restart().start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
    expect((yield* Ref.get(f.providerState)).active).toEqual(new Set(fence ? [] : ["operation-1"]));
  }),
);

it.effect.each(["fenced", "resetting", "newer-generation"] as const)(
  "refuses replaying a spent reset receipt from a %s controller snapshot",
  (phase) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      yield* f.model.start(request());
      yield* f.model.cleanup;
      const fenced = yield* Ref.get(f.retained);
      let resetting = fenced;
      f.faults.beforeReset = Ref.get(f.retained).pipe(
        Effect.map((value) => {
          resetting = value;
        }),
      );
      yield* f.model.reset("reset-one");
      f.faults.beforeReset = Effect.void;
      yield* f.model.start(request(2));
      if (phase === "newer-generation") {
        yield* f.model.cleanup;
        yield* f.model.reset("reset-two");
      }
      yield* Ref.set(f.retained, phase === "resetting" ? resetting : fenced);
      expect((yield* f.restart().reset("reset-one").pipe(Effect.flip)).reason).toBe("denied");
      expect((yield* f.restart().snapshot).phase).toBe("resetting");
      expect((yield* Ref.get(f.providerState)).active).toEqual(
        new Set(phase === "newer-generation" ? [] : ["operation-2"]),
      );
    }),
);

it.effect("independent provider generations refuse a rolled-back controller snapshot", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.ready;
    const oldSnapshot = yield* Ref.get(f.retained);
    yield* f.model.start(request());
    yield* f.model.cleanup;
    yield* f.model.reset("reset-one");
    yield* Ref.set(f.retained, oldSnapshot);
    expect((yield* f.restart().start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
    expect((yield* Ref.get(f.providerState)).active.size).toBe(0);
    yield* f.restart().cleanup;
    expect((yield* f.restart().reset("rollback-reset").pipe(Effect.flip)).reason).toBe("denied");
    expect((yield* f.restart().snapshot).phase).toBe("resetting");
  }),
);

it.effect.each(["read-outage", "missing", "provider-loss"] as const)(
  "does not infer clean state from %s after restart",
  (fault) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      yield* f.model.start(request());
      if (fault === "read-outage") f.faults.reads = true;
      else if (fault === "missing")
        yield* Ref.update(f.retained, (state) => ({ ...state, entries: new Map() }));
      else f.faults.providerAvailable = false;
      expect((yield* f.restart().cleanup.pipe(Effect.flip)).reason).toBe(
        fault === "missing" ? "not-found" : "unavailable",
      );
      if (fault === "missing") {
        yield* f.restart().enroll;
        expect((yield* f.restart().reset("recovery-reset").pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect((yield* f.restart().snapshot).phase).toBe("resetting");
      }
      expect((yield* Ref.get(f.providerState)).active.size).toBe(1);
    }),
);

it.effect.each(["itemVersion", "accountId", "collectionId", "machineId", "origin"] as const)(
  "cannot bypass a retained resource barrier by changing %s",
  (field) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      yield* f.model.start(request());
      const changed = { ...scope, [field]: field === "itemVersion" ? 2 : "foreign" };
      expect((yield* f.restart(changed).enroll.pipe(Effect.flip)).reason).toBe("denied");
      expect((yield* f.restart(changed).start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
      expect((yield* Ref.get(f.retained)).entries.size).toBe(1);
    }),
);

it.effect(
  "capacity refusal preserves replay tombstones rather than freeing an expired barrier",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      yield* Ref.update(f.retained, (state) => ({
        ...state,
        operationIds: new Set(Array.from({ length: 128 }, (_, index) => `retained-${index}`)),
      }));
      yield* TestClock.adjust("30 days");
      expect((yield* f.restart().start(request()).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.faults.starts).toBe(0);
      expect((yield* Ref.get(f.retained)).operationIds.size).toBe(128);
    }),
);

it.effect("revalidates authority before each external mutation and after returned evidence", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.ready;
    f.faults.authorized = false;
    expect((yield* f.restart().start(request()).pipe(Effect.flip)).reason).toBe("denied");
    expect(f.faults.starts).toBe(0);
    f.faults.authorized = true;
    yield* f.model.start(request());
    f.faults.afterFence = Effect.sync(() => {
      f.faults.authorized = false;
    });
    expect((yield* f.restart().cleanup.pipe(Effect.flip)).reason).toBe("denied");
    expect((yield* f.restart().snapshot).phase).toBe("uncertain");
  }),
);

it.effect.each(["start", "reset"] as const)(
  "retains intent after cancellation during synthetic %s dispatch",
  (operation) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      const sent = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      const pause = Deferred.succeed(sent, undefined).pipe(Effect.andThen(Deferred.await(release)));
      if (operation === "start") f.faults.beforeStart = pause;
      else {
        yield* f.model.start(request());
        yield* f.model.cleanup;
        f.faults.beforeReset = pause;
      }
      const task = yield* (
        operation === "start"
          ? f.model.start(request()).pipe(Effect.asVoid)
          : f.model.reset("reset-one")
      ).pipe(Effect.forkChild);
      yield* Deferred.await(sent);
      yield* Fiber.interrupt(task);
      expect((yield* f.restart().snapshot).phase).toBe(
        operation === "start" ? "uncertain" : "resetting",
      );
      expect((yield* f.restart().start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
      if (operation === "start") {
        yield* f.restart().cleanup;
        expect((yield* Ref.get(f.providerState)).active.size).toBe(0);
      } else {
        f.faults.beforeReset = Effect.void;
        yield* f.restart().reset("reset-one");
        expect((yield* Ref.get(f.providerState)).resetEffects).toBe(2);
      }
    }),
);

it.effect.each(["resources", "reset-ids"] as const)(
  "refuses %s capacity instead of forgetting retained safety evidence",
  (capacity) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      if (capacity === "reset-ids") {
        yield* Ref.update(f.retained, (state) => ({
          ...state,
          resetIds: new Set(Array.from({ length: 160 }, (_, index) => `reset-${index}`)),
        }));
        expect((yield* f.restart().reset("new-reset").pipe(Effect.flip)).reason).toBe("denied");
        expect(f.faults.resets).toBe(0);
      } else {
        for (let index = 1; index < 32; index++)
          yield* f.restart({ ...scope, itemId: `item-${index}` }).enroll;
        expect(
          (yield* f.restart({ ...scope, itemId: "overflow" }).enroll.pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect((yield* Ref.get(f.retained)).entries.size).toBe(32);
      }
    }),
);

it.effect("a delayed reset acknowledgement cannot clear a newer operation", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.ready;
    yield* f.model.start(request());
    yield* f.model.cleanup;
    const reset = yield* Deferred.make<void>(),
      release = yield* Deferred.make<void>();
    f.faults.afterReset = Deferred.succeed(reset, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
    );
    const stale = yield* f.model.reset("reset-one").pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(reset);
    f.faults.afterReset = Effect.void;
    yield* f.restart().reset("reset-one");
    yield* f.restart().start(request(2));
    yield* Deferred.succeed(release, undefined);
    const outcome = yield* Fiber.join(stale);
    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") expect(outcome.failure.reason).toBe("conflict");
    expect((yield* f.restart().snapshot).ticket?.operationId).toBe("operation-2");
    expect((yield* Ref.get(f.providerState)).resetEffects).toBe(2);
    yield* f.restart().cleanup;
    const calls = f.faults.resets;
    expect((yield* f.restart().reset("reset-one").pipe(Effect.flip)).reason).toBe("denied");
    expect(f.faults.resets).toBe(calls);
    expect((yield* f.restart().snapshot).phase).toBe("fenced");
  }),
);

it.effect.each(["operation", "generation", "scope"] as const)(
  "rejects cleanup evidence for a foreign %s",
  (field) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      yield* f.model.start(request());
      f.faults.fenceReceipt = (ticket) =>
        field === "operation"
          ? { ...ticket, operationId: "foreign-operation" }
          : field === "generation"
            ? { ...ticket, generation: 999 }
            : { ...ticket, scope: { ...ticket.scope, itemId: "foreign" } };
      expect((yield* f.restart().cleanup.pipe(Effect.flip)).reason).toBe("unavailable");
      expect((yield* f.restart().snapshot).phase).toBe("uncertain");
      expect((yield* f.restart().reset("reset-one").pipe(Effect.flip)).reason).toBe("denied");
    }),
);

it.effect.each(["scope", "from", "to"] as const)(
  "rejects reset evidence for a foreign %s",
  (field) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      yield* f.model.start(request());
      yield* f.model.cleanup;
      f.faults.resetReceipt = (intent) =>
        field === "scope"
          ? { ...intent, scope: { ...intent.scope, accountId: "foreign" } }
          : { ...intent, [field]: 999 };
      expect((yield* f.restart().reset("reset-one").pipe(Effect.flip)).reason).toBe("unavailable");
      expect((yield* f.restart().snapshot).phase).toBe("resetting");
      f.faults.resetReceipt = null;
      yield* f.restart().reset("reset-one");
      expect((yield* f.restart().snapshot).generation).toBe(2);
      expect((yield* Ref.get(f.providerState)).resetEffects).toBe(2);
    }),
);

it.effect("retains an ambiguous reset when authority is revoked after the provider receipt", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.ready;
    yield* f.model.start(request());
    yield* f.model.cleanup;
    f.faults.afterReset = Effect.sync(() => {
      f.faults.authorized = false;
    });
    expect((yield* f.restart().reset("reset-one").pipe(Effect.flip)).reason).toBe("denied");
    expect((yield* f.restart().snapshot).phase).toBe("resetting");
    f.faults.authorized = true;
    f.faults.afterReset = Effect.void;
    yield* f.restart().reset("reset-one");
    expect((yield* f.restart().snapshot).phase).toBe("ready");
    expect((yield* Ref.get(f.providerState)).resetEffects).toBe(2);
  }),
);

it.effect.each(["lease", "run"] as const)(
  "passes the proposed %s to the fresh start authority before intent commit",
  (field) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.ready;
      if (field === "lease") f.faults.deniedLease = request().leaseId;
      else f.faults.deniedRun = request().runId;
      expect((yield* f.restart().start(request()).pipe(Effect.flip)).reason).toBe("denied");
      expect((yield* f.restart().snapshot).phase).toBe("ready");
      expect(f.faults.starts).toBe(0);
    }),
);

it.effect("withdrawn workload authority cannot prevent separately authorized host cleanup", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.ready;
    yield* f.model.start(request());
    f.faults.workerAuthorized = false;
    expect((yield* f.restart().start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
    yield* f.restart().cleanup;
    yield* f.restart().reset("reset-one");
    expect((yield* f.restart().snapshot).phase).toBe("ready");
    expect((yield* Ref.get(f.providerState)).active.size).toBe(0);
    expect((yield* f.restart().start(request(2)).pipe(Effect.flip)).reason).toBe("denied");
    expect(f.faults.starts).toBe(1);
  }),
);
