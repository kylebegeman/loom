import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import { VaultError, type VaultMigrationPrepare } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultMigration from "./VaultMigration.ts";
const fixture = Effect.sync(() => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = { failReceipt: false, failArchiveReceipt: false };
  const backend = Layer.succeed(OpenBaoStore.OpenBaoStore, {
    status: Effect.succeed({
      backend: "openbao" as const,
      state: "ready" as const,
      origin: "http://127.0.0.1",
    }),
    read: (key) => Effect.sync(() => records.get(key) ?? null),
    keys: (prefix) =>
      Effect.sync(() =>
        [...records.keys()]
          .filter((key) => key.startsWith(prefix + "/"))
          .map((key) => key.slice(prefix.length + 1)),
      ),
    write: (key, value, expected) =>
      Effect.suspend(() => {
        const data = Redacted.value(value) as { plan?: { state: string } };
        if (state.failReceipt && data.plan?.state === "imported")
          return Effect.fail(new VaultError({ reason: "unavailable" }));
        if (state.failArchiveReceipt && data.plan?.state === "archived")
          return Effect.fail(new VaultError({ reason: "unavailable" }));
        const version = records.get(key)?.version ?? 0;
        if (version !== expected) return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(key, { value, version: version + 1 });
        return Effect.succeed(version + 1);
      }),
  });
  const shared = Layer.mergeAll(
    backend,
    NodeServices.layer,
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("migration-test")),
    }),
  );
  const core = VaultCore.layer.pipe(Layer.provide(shared));
  const layer = VaultMigration.layer.pipe(Layer.provideMerge(core), Layer.provide(shared));
  return { records, state, layer };
});
const draft = (letter = "a"): VaultMigrationPrepare => ({
  id: letter.repeat(32),
  label: "Dedicated development API",
  kind: "secret",
  developmentOnly: true,
  value: Redacted.make("synthetic-development-value"),
});
it.effect(
  "requires an explicit development-only review, binds bytes and metadata, and never overwrites an existing item",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration,
          core = yield* VaultCore.VaultCore;
        expect(
          (yield* service
            .prepare(
              { ...draft(), developmentOnly: false } as unknown as VaultMigrationPrepare,
              "admin",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        const prepared = yield* service.prepare(draft(), "admin");
        expect((yield* core.list({ cursor: null, includeArchived: true })).items).toEqual([]);
        expect(yield* service.prepare(draft(), "admin")).toEqual(prepared);
        expect(
          (yield* service.prepare({ ...draft(), label: "Changed" }, "admin").pipe(Effect.flip))
            .reason,
        ).toBe("conflict");
        expect(
          (yield* service
            .apply(
              { id: prepared.plan.id, reviewed: true, value: Redacted.make("different") },
              "admin",
            )
            .pipe(Effect.flip)).reason,
        ).toBe("review-mismatch");
        const imported = yield* service.apply(
          { id: prepared.plan.id, reviewed: true, value: draft().value },
          "admin",
        );
        expect(imported.plan.state).toBe("imported");
        expect(imported.item?.version).toBe(1);
        expect(imported.canArchive).toBe(true);
        expect(
          yield* service.apply(
            { id: prepared.plan.id, reviewed: true, value: draft().value },
            "admin",
          ),
        ).toEqual(imported);
        for (const [path, record] of f.records)
          if (path.includes("/migrations/"))
            expect(JSON.stringify(Redacted.value(record.value))).not.toContain(
              "synthetic-development-value",
            );
        expect(JSON.stringify(imported)).not.toContain("synthetic-development-value");
        yield* core.save(
          {
            id: prepared.plan.itemId,
            operationId: "b".repeat(32),
            expectedVersion: 1,
            label: "Edited",
            kind: "secret",
            value: Redacted.make("new-value"),
          },
          "admin",
        );
        expect((yield* service.archive(prepared.plan.id, "admin").pipe(Effect.flip)).reason).toBe(
          "conflict",
        );
        expect((yield* core.inspect(prepared.plan.itemId))?.state).toBe("active");
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "expires or cancels uncommitted reviews and archives only the unchanged imported record",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration;
        const a = yield* service.prepare(draft(), "admin");
        yield* TestClock.adjust("10 minutes");
        expect((yield* service.inspect(a.plan.id)).plan.state).toBe("expired");
        expect(
          (yield* service
            .apply({ id: a.plan.id, reviewed: true, value: draft().value }, "admin")
            .pipe(Effect.flip)).reason,
        ).toBe("expired");
        expect((yield* service.cancel(a.plan.id)).plan.state).toBe("cancelled");
        const b = yield* service.prepare(draft("b"), "admin");
        yield* service.apply({ id: b.plan.id, reviewed: true, value: draft().value }, "admin");
        const archived = yield* service.archive(b.plan.id, "admin");
        expect(archived.item?.state).toBe("archived");
        expect(yield* service.archive(b.plan.id, "admin")).toEqual(archived);
        expect((yield* service.list({ cursor: null })).items).toHaveLength(2);
      }).pipe(Effect.provide(f.layer));
    }),
);
it.effect(
  "recovers a committed import after its receipt write fails, without reentering its value",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration;
        const plan = yield* service.prepare(draft(), "admin");
        f.state.failReceipt = true;
        expect(
          (yield* service
            .apply({ id: plan.plan.id, reviewed: true, value: draft().value }, "admin")
            .pipe(Effect.flip)).reason,
        ).toBe("unavailable");
      }).pipe(Effect.provide(f.layer));
      f.state.failReceipt = false;
      const beforeRead = [...f.records.entries()];
      const recovered = yield* Effect.flatMap(VaultMigration.VaultMigration, (service) =>
        service.inspect(draft().id),
      ).pipe(Effect.provide(f.layer));
      expect([...f.records.entries()]).toEqual(beforeRead);
      expect(recovered.plan.state).toBe("imported");
      expect(recovered.item?.version).toBe(1);
    }),
);

it.effect("recovers an archive after its ledger write fails without a second item mutation", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* Effect.gen(function* () {
      const service = yield* VaultMigration.VaultMigration;
      const prepared = yield* service.prepare(draft(), "admin");
      yield* service.apply({ id: prepared.plan.id, reviewed: true, value: draft().value }, "admin");
      f.state.failArchiveReceipt = true;
      expect((yield* service.archive(prepared.plan.id, "admin").pipe(Effect.flip)).reason).toBe(
        "unavailable",
      );
      expect((yield* service.inspect(prepared.plan.id)).plan.state).toBe("archiving");
    }).pipe(Effect.provide(f.layer));
    f.state.failArchiveReceipt = false;
    const recovered = yield* Effect.flatMap(VaultMigration.VaultMigration, (service) =>
      service.archive(draft().id, "another-admin"),
    ).pipe(Effect.provide(f.layer));
    expect(recovered.plan.state).toBe("archived");
    expect(recovered.item?.version).toBe(2);
    expect(recovered.item?.state).toBe("archived");
  }),
);
