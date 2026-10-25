import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { VaultError, type VaultTestAccountChange } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Store from "./OpenBaoStore.ts";
import * as Core from "./VaultCore.ts";
import * as Accounts from "./VaultTestAccounts.ts";
const collection = {
  id: "a".repeat(32),
  label: "Editors",
  application: "Disposable app",
  target: "staging" as const,
};
const account = {
  id: "b".repeat(32),
  collectionId: collection.id,
  label: "Editor one",
  role: "editor",
  itemId: "c".repeat(32),
  itemVersion: 1,
};
const fixture = () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const faults = {
    reads: 0,
    lost: false,
    denied: false,
    beforeWrite: null as null | (() => Effect.Effect<void>),
  };
  const store = Layer.succeed(Store.OpenBaoStore, {
    status: Effect.succeed({ backend: "openbao" as const, state: "ready" as const, origin: null }),
    read: (path: string) =>
      Effect.sync(() => {
        if (path.endsWith("registry-v1")) faults.reads += 1;
        return records.get(path) ?? null;
      }),
    keys: (prefix: string) =>
      Effect.succeed(
        [...records.keys()]
          .filter((k) => k.startsWith(prefix + "/"))
          .map((k) => k.slice(prefix.length + 1)),
      ),
    write: (path: string, value: Redacted.Redacted<unknown>, expected: number) =>
      Effect.gen(function* () {
        if (faults.beforeWrite && path.endsWith("registry-v1")) yield* faults.beforeWrite();
        if (faults.denied) return yield* new VaultError({ reason: "denied" });
        const version = records.get(path)?.version ?? 0;
        if (version !== expected) return yield* new VaultError({ reason: "conflict" });
        records.set(path, { value, version: version + 1 });
        if (faults.lost) {
          faults.lost = false;
          return yield* new VaultError({ reason: "unavailable" });
        }
        return version + 1;
      }),
  });
  const identity = Layer.succeed(ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(EnvironmentId.make("test-accounts")),
  });
  const core = Core.layer.pipe(Layer.provide(Layer.merge(store, identity)));
  const layer = Accounts.layer.pipe(
    Layer.provideMerge(core),
    Layer.provide(Layer.merge(store, identity)),
  );
  return { records, faults, layer };
};
const withAccounts = <A, E>(
  use: (f: Effect.Success<ReturnType<typeof setup>>) => Effect.Effect<A, E>,
) => {
  const f = fixture();
  return Effect.flatMap(setup(f), use).pipe(
    Effect.provide(f.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  );
};
const setup = (f: ReturnType<typeof fixture>) =>
  Effect.gen(function* () {
    const service = yield* Accounts.VaultTestAccounts,
      core = yield* Core.VaultCore;
    let sequence = 1;
    const id = () => (sequence++).toString(16).padStart(32, "0");
    const mutation = Effect.fnUntraced(function* (
      change: VaultTestAccountChange,
      actor = "client:one",
    ) {
      return {
        operationId: id(),
        expectedRevision: (yield* service.snapshot(actor)).revision,
        change,
      };
    });
    const apply = Effect.fnUntraced(function* (
      change: VaultTestAccountChange,
      actor = "client:one",
    ) {
      return yield* service.apply(yield* mutation(change, actor), actor, Effect.void);
    });
    yield* core.save(
      {
        id: account.itemId,
        operationId: id(),
        expectedVersion: 0,
        label: "Dedicated editor",
        kind: "account",
        value: Redacted.make("synthetic-password-never-in-ledger"),
      },
      "human",
    );
    yield* apply({ type: "collection-save", collection });
    yield* apply({ type: "account-save", account, developmentOnly: true });
    const ready = () => apply({ type: "mark-clean", id: account.id, confirmedReset: true });
    const reserve = () => apply({ type: "reserve", id: account.id, durationMs: 300_000 });
    return { ...f, service, core, id, mutation, apply, ready, reserve };
  });

it.effect(
  "references only existing active account records and begins in quarantine without exposing credentials",
  () =>
    withAccounts((f) =>
      Effect.gen(function* () {
        const snapshot = yield* f.service.snapshot("client:one");
        expect(snapshot.accounts[0]).toMatchObject({ state: "quarantined", lease: null });
        expect(snapshot).toMatchObject({
          provisioning: "unsupported",
          loginDelivery: "unsupported",
        });
        const path = [...f.records.keys()].find((k) => k.endsWith("registry-v1"))!;
        expect(path).toMatch(/^environments\/[a-f0-9]{64}\/profiles\/_test_accounts\/registry-v1$/);
        expect(JSON.stringify(snapshot)).not.toContain("synthetic-password");
        expect(JSON.stringify(Redacted.value(f.records.get(path)!.value))).not.toContain(
          "synthetic-password",
        );
        expect((yield* f.reserve().pipe(Effect.flip)).reason).toBe("conflict");
        yield* f.ready();
        expect((yield* f.reserve()).accounts[0]!.lease?.owner).toBe("client:one");
      }),
    ),
);

it.effect("permits only one contender under real CAS and does not silently retry the loser", () =>
  withAccounts((f) =>
    Effect.gen(function* () {
      yield* f.ready();
      const input = yield* f.mutation({ type: "reserve", id: account.id, durationMs: 300_000 });
      const arrived = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      let writes = 0;
      f.faults.beforeWrite = () =>
        Effect.gen(function* () {
          if (++writes === 2) yield* Deferred.succeed(arrived, undefined);
          yield* Deferred.await(release);
        });
      const pending = yield* Effect.all(
        [
          f.service.apply(input, "client:one", Effect.void).pipe(Effect.result),
          f.service
            .apply({ ...input, operationId: f.id() }, "client:two", Effect.void)
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);
      yield* Deferred.await(arrived);
      yield* Deferred.succeed(release, undefined);
      const results = yield* Fiber.join(pending);
      expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
      expect(results.filter((r) => r._tag === "Failure")).toHaveLength(1);
      expect(writes).toBe(2);
    }),
  ),
);

it.effect("recovers a lost reservation reply without extending or recreating its lease", () =>
  withAccounts((f) =>
    Effect.gen(function* () {
      yield* f.ready();
      const input = yield* f.mutation({ type: "reserve", id: account.id, durationMs: 300_000 });
      f.faults.lost = true;
      expect(
        (yield* f.service.apply(input, "client:one", Effect.void).pipe(Effect.flip)).reason,
      ).toBe("unavailable");
      const original = yield* f.service.snapshot("client:one");
      yield* TestClock.adjust("1 minute");
      const replay = yield* f.service.apply(input, "client:one", Effect.void);
      expect(replay.accounts[0]!.lease).toEqual(original.accounts[0]!.lease);
      expect(replay.revision).toBe(original.revision);
      yield* TestClock.adjust("5 minutes");
      expect((yield* f.service.apply(input, "client:one", Effect.void)).accounts[0]).toMatchObject({
        state: "quarantined",
        lease: null,
      });
    }),
  ),
);

it.effect(
  "quarantines release and expiry, requires clean review and rejects old lease releases",
  () =>
    withAccounts((f) =>
      Effect.gen(function* () {
        yield* f.ready();
        const first = (yield* f.reserve()).accounts[0]!.lease!;
        expect(
          (yield* f
            .apply({ type: "release", id: account.id, leaseId: first.id }, "client:two")
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        yield* f.apply({ type: "release", id: account.id, leaseId: first.id });
        expect((yield* f.service.snapshot("client:one")).accounts[0]!.state).toBe("quarantined");
        yield* f.ready();
        const second = (yield* f.reserve()).accounts[0]!.lease!;
        expect(second.id).not.toBe(first.id);
        expect(
          (yield* f.apply({ type: "release", id: account.id, leaseId: first.id }).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        yield* TestClock.adjust("5 minutes");
        const before = [...f.records.values()];
        expect((yield* f.service.snapshot("client:one")).accounts[0]).toMatchObject({
          state: "quarantined",
          lease: null,
        });
        expect([...f.records.values()]).toEqual(before);
        expect(
          (yield* f.apply({ type: "renew", id: account.id, leaseId: second.id }).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
        yield* f.ready();
        expect((yield* f.reserve()).accounts[0]!.state).toBe("reserved");
      }),
    ),
);

it.effect("bounds renewal and refuses expiry during authorization", () =>
  withAccounts((f) =>
    Effect.gen(function* () {
      yield* f.ready();
      const first = (yield* f.reserve()).accounts[0]!.lease!;
      yield* TestClock.adjust("1 minute");
      const renewed = (yield* f.apply({ type: "renew", id: account.id, leaseId: first.id }))
        .accounts[0]!.lease!;
      expect(renewed.createdAt).toBe(first.createdAt);
      expect(renewed.expiresAt).toBeGreaterThan(first.expiresAt);
      const input = yield* f.mutation({ type: "renew", id: account.id, leaseId: first.id });
      let checks = 0;
      const authorize = Effect.gen(function* () {
        if (++checks === 2) yield* TestClock.adjust("16 minutes");
      });
      expect(
        (yield* f.service.apply(input, "client:one", authorize).pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }),
  ),
);

it.effect(
  "prevents duplicate credentials, moving accounts, and changing collection identity underneath accounts",
  () =>
    withAccounts((f) =>
      Effect.gen(function* () {
        expect(
          (yield* f
            .apply({
              type: "account-save",
              account: { ...account, id: f.id() },
              developmentOnly: true,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* f
            .apply({ type: "collection-save", collection: { ...collection, application: "other" } })
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        const other = { ...collection, id: f.id() };
        yield* f.apply({ type: "collection-save", collection: other });
        expect(
          (yield* f
            .apply({
              type: "account-save",
              account: { ...account, collectionId: other.id },
              developmentOnly: true,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
      }),
    ),
);

it.effect(
  "supports archive/restore and retire/restore without returning dirty accounts to availability",
  () =>
    withAccounts((f) =>
      Effect.gen(function* () {
        yield* f.ready();
        yield* f.reserve();
        expect(
          (yield* f
            .apply({ type: "collection-archive", id: collection.id, archived: true })
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        yield* f.apply({ type: "quarantine", id: account.id }, "client:two");
        yield* f.apply({ type: "collection-archive", id: collection.id, archived: true });
        expect((yield* f.ready().pipe(Effect.flip)).reason).toBe("conflict");
        yield* f.apply({ type: "collection-archive", id: collection.id, archived: false });
        yield* f.apply({ type: "retire", id: account.id });
        expect((yield* f.ready().pipe(Effect.flip)).reason).toBe("conflict");
        expect((yield* f.apply({ type: "restore", id: account.id })).accounts[0]!.state).toBe(
          "quarantined",
        );
      }),
    ),
);

it.effect(
  "denies missing, stale, archived and wrong-kind account records before marking clean",
  () =>
    withAccounts((f) =>
      Effect.gen(function* () {
        yield* f.core.change(
          { id: account.itemId, operationId: f.id(), expectedVersion: 1, action: "archive" },
          "human",
        );
        expect((yield* f.ready().pipe(Effect.flip)).reason).toBe("denied");
        yield* f.core.change(
          { id: account.itemId, operationId: f.id(), expectedVersion: 2, action: "restore" },
          "human",
        );
        expect((yield* f.ready().pipe(Effect.flip)).reason).toBe("conflict");
        const missing = { ...account, itemId: f.id() };
        expect(
          (yield* f
            .apply({ type: "account-save", account: missing, developmentOnly: true })
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);

it.effect(
  "validates external inputs, rechecks rights and refuses actor/idempotency substitution",
  () =>
    withAccounts((f) =>
      Effect.gen(function* () {
        const input = yield* f.mutation({
          type: "mark-clean",
          id: account.id,
          confirmedReset: true,
        });
        expect(
          (yield* f.service
            .apply(input, "client:one", Effect.fail(new VaultError({ reason: "denied" })))
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        let checks = 0;
        const authorize = Effect.suspend(() =>
          ++checks === 2 ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
        );
        expect(
          (yield* f.service.apply(input, "client:one", authorize).pipe(Effect.flip)).reason,
        ).toBe("denied");
        const clean = yield* f.service.apply(input, "client:one", Effect.void);
        expect(
          (yield* f.service.apply(input, "client:two", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* f.service
            .apply(
              { ...input, change: { type: "retire", id: account.id } },
              "client:one",
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* f.service
            .apply(
              { ...input, change: { ...input.change, password: "raw-value" } } as never,
              "client:one",
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        expect((yield* f.service.snapshot("client:one")).revision).toBe(clean.revision);
      }),
    ),
);

it.effect("fails closed on corrupt registry and keeps core account metadata readable", () =>
  withAccounts((f) =>
    Effect.gen(function* () {
      const path = [...f.records.keys()].find((k) => k.endsWith("registry-v1"))!;
      f.records.set(path, { value: Redacted.make({ schemaVersion: 42 }), version: 100 });
      expect((yield* f.service.snapshot("client:one").pipe(Effect.flip)).reason).toBe(
        "invalid-response",
      );
      expect((yield* f.core.inspect(account.itemId))?.kind).toBe("account");
    }),
  ),
);

it.effect("caps renewal at one hour without allowing a fresh reservation to replace it", () =>
  withAccounts((f) =>
    Effect.gen(function* () {
      yield* f.ready();
      const lease = (yield* f.reserve()).accounts[0]!.lease!;
      let latest = (yield* f.apply({ type: "renew", id: account.id, leaseId: lease.id }))
        .accounts[0]!.lease!;
      for (let index = 0; index < 5; index++) {
        yield* TestClock.adjust("10 minutes");
        latest = (yield* f.apply({ type: "renew", id: account.id, leaseId: lease.id })).accounts[0]!
          .lease!;
        expect(latest.expiresAt).toBeLessThanOrEqual(lease.createdAt + 3_600_000);
        expect(latest.id).toBe(lease.id);
      }
      expect(latest.expiresAt).toBe(lease.createdAt + 3_600_000);
      yield* TestClock.adjust("5 minutes");
      expect(
        (yield* f.apply({ type: "renew", id: account.id, leaseId: lease.id }).pipe(Effect.flip))
          .reason,
      ).toBe("conflict");
      expect((yield* f.reserve().pipe(Effect.flip)).reason).toBe("conflict");
    }),
  ),
);

it.effect("does not reuse aged or evicted receipts as authority to replay an old reservation", () =>
  withAccounts((f) =>
    Effect.gen(function* () {
      yield* f.ready();
      const input = yield* f.mutation({ type: "reserve", id: account.id, durationMs: 300_000 });
      const first = yield* f.service.apply(input, "client:one", Effect.void);
      yield* f.apply({ type: "release", id: account.id, leaseId: first.accounts[0]!.lease!.id });
      yield* TestClock.adjust("25 hours");
      for (let index = 0; index < 130; index++)
        yield* f.apply({
          type: "collection-save",
          collection: { ...collection, label: `QA ${index}` },
        });
      expect(
        (yield* f.service.apply(input, "client:one", Effect.void).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect((yield* f.service.snapshot("client:one")).accounts[0]).toMatchObject({
        state: "quarantined",
        lease: null,
      });
    }),
  ),
);

it.effect(
  "refuses a non-account credential and a thirty-third collection without touching existing entries",
  () =>
    withAccounts((f) =>
      Effect.gen(function* () {
        const secret = f.id();
        yield* f.core.save(
          {
            id: secret,
            operationId: f.id(),
            expectedVersion: 0,
            label: "Ordinary secret",
            kind: "secret",
            value: Redacted.make("synthetic-only"),
          },
          "human",
        );
        expect(
          (yield* f
            .apply({
              type: "account-save",
              account: { ...account, id: f.id(), itemId: secret },
              developmentOnly: true,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        for (let index = 1; index < 32; index++)
          yield* f.apply({ type: "collection-save", collection: { ...collection, id: f.id() } });
        const before = yield* f.service.snapshot("client:one");
        expect(
          (yield* f
            .apply({ type: "collection-save", collection: { ...collection, id: f.id() } })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        expect((yield* f.service.snapshot("client:one")).revision).toBe(before.revision);
      }),
    ),
);

it.effect("caches an absent ledger until a local write attempt", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const service = yield* Accounts.VaultTestAccounts;
    yield* service.snapshot("client:one");
    yield* service.quarantineLeases(() => Effect.succeed(false));
    yield* service.snapshot("client:one");
    expect(f.faults.reads).toBe(1);
    yield* service.apply(
      {
        operationId: "f".repeat(32),
        expectedRevision: 0,
        change: { type: "collection-save", collection },
      },
      "client:one",
      Effect.void,
    );
    expect((yield* service.snapshot("client:one")).collections).toHaveLength(1);
    expect(f.faults.reads).toBe(2);
  }).pipe(Effect.provide(f.layer.pipe(Layer.provideMerge(NodeServices.layer))));
});
