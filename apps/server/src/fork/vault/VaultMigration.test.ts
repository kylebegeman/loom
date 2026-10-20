// @effect-diagnostics-next-line nodeBuiltinImport:off -- Generate synthetic RSA credentials locally for import validation.
import * as NodeCrypto from "node:crypto";
import * as SshCrypto from "./SshCrypto.ts";
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
    SshCrypto.layer,
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

it.effect(
  "reviews typed SSH and GitHub imports locally, preserves legacy pages and never persists private review material",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const key = yield* Effect.flatMap(SshCrypto.SshCrypto, (c) => c.create).pipe(
        Effect.provide(SshCrypto.layer),
      );
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration,
          core = yield* VaultCore.VaultCore;
        const legacy = yield* service.prepare(draft(), "admin");
        const credentials = [
          {
            type: "ssh" as const,
            privateKey: key.privateKey,
            target: { hostname: "dev.invalid", username: "git", port: 22, hostKey: null },
          },
          {
            type: "github" as const,
            account: "Development-Bot",
            repositories: ["Team/Repo", "team/repo"],
            credential: {
              type: "token" as const,
              token: Redacted.make("synthetic_dedicated_token"),
            },
          },
        ];
        for (const [i, credential] of credentials.entries()) {
          const id = (i === 0 ? "d" : "e").repeat(32);
          const input = {
            id,
            label: "Dedicated typed import",
            developmentOnly: true as const,
            credential,
          };
          const prepared = yield* service.typedPrepare(input, "admin", Effect.void);
          expect(prepared).toMatchObject({
            canCutover: false,
            canRollback: false,
            configurationWrites: false,
            accessVerification: "not-performed",
            workloadAuthorization: "not-evaluated",
            item: null,
          });
          expect(yield* service.typedPrepare(input, "admin", Effect.void)).toEqual(prepared);
          const value = yield* service.typedApply(
            { id, reviewed: true, developmentOnly: true, credential },
            "admin",
            Effect.void,
          );
          expect(value.plan.state).toBe("imported");
          expect(value.item?.version).toBe(1);
          expect(value.canArchive).toBe(true);
          expect(
            yield* service.typedApply(
              { id, reviewed: true, developmentOnly: true, credential },
              "admin",
              Effect.void,
            ),
          ).toEqual(value);
          const stored = yield* core.reveal({ id: prepared.plan.itemId, expectedVersion: 1 });
          if (credential.type === "ssh")
            expect(Redacted.value(stored.value)).toContain(key.publicKey);
          else
            expect(value.plan.details).toMatchObject({
              type: "github",
              account: "development-bot",
              repositories: ["team/repo"],
            });
          for (const [path, record] of f.records)
            if (path.includes("/migrations/")) {
              const text = JSON.stringify(Redacted.value(record.value));
              expect(text).not.toContain("synthetic_dedicated_token");
              expect(text).not.toContain("BEGIN PRIVATE KEY");
            }
          expect(JSON.stringify(value)).not.toContain("synthetic_dedicated_token");
        }
        expect((yield* service.list({ cursor: null })).items.map((r) => r.plan.id)).toEqual([
          legacy.plan.id,
        ]);
        expect((yield* service.typedList({ cursor: null })).items).toHaveLength(2);
        expect((yield* service.inspect("d".repeat(32)).pipe(Effect.flip)).reason).toBe(
          "invalid-response",
        );
        expect(
          [...f.records.keys()].every(
            (path) => path.includes("/migrations/") || path.includes("/items/"),
          ),
        ).toBe(true);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "binds typed reviews to exact metadata, actor, private material, expiry and destination write authorization",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration,
          core = yield* VaultCore.VaultCore;
        const credential = {
          type: "github" as const,
          account: "dev-bot",
          repositories: ["team/repo"],
          credential: { type: "token" as const, token: Redacted.make("synthetic_dedicated_token") },
        };
        const id = "f".repeat(32),
          input = { id, label: "Development", developmentOnly: true as const, credential };
        const denied = Effect.fail(new VaultError({ reason: "denied" }));
        expect((yield* service.typedPrepare(input, "admin", denied).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect(f.records.size).toBe(0);
        const prepared = yield* service.typedPrepare(input, "admin", Effect.void);
        const apply = { id, reviewed: true as const, developmentOnly: true as const, credential };
        expect(
          (yield* service
            .typedApply(
              { ...apply, credential: { ...credential, repositories: ["team/other"] } },
              "admin",
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("review-mismatch");
        expect(
          (yield* service.typedApply(apply, "other-admin", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect((yield* service.typedApply(apply, "admin", denied).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect(yield* core.inspect(prepared.plan.itemId)).toBeNull();
        yield* TestClock.adjust("10 minutes");
        expect(
          (yield* service.typedApply(apply, "admin", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("expired");
        expect((yield* service.typedCancel(id, Effect.void)).plan.state).toBe("cancelled");
        expect(
          (yield* service.typedApply(apply, "admin", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("invalid-state");
        expect(yield* core.inspect(prepared.plan.itemId)).toBeNull();
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "recovers typed committed receipts without a read-side write and archives only the unchanged imported item",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration,
          core = yield* VaultCore.VaultCore;
        const credential = {
          type: "github" as const,
          account: "dev-bot",
          repositories: ["team/repo"],
          credential: { type: "token" as const, token: Redacted.make("synthetic_dedicated_token") },
        };
        const id = "d".repeat(32),
          input = { id, label: "Development", developmentOnly: true as const, credential };
        const prepared = yield* service.typedPrepare(input, "admin", Effect.void);
        f.state.failReceipt = true;
        expect(
          (yield* service
            .typedApply(
              { id, reviewed: true, developmentOnly: true, credential },
              "admin",
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        const before = [...f.records.values()].map((r) => r.version);
        expect((yield* service.typedInspect(id)).plan.state).toBe("imported");
        expect([...f.records.values()].map((r) => r.version)).toEqual(before);
        f.state.failReceipt = false;
        expect((yield* service.typedArchive(id, "admin", Effect.void)).plan.state).toBe("archived");
        expect((yield* core.inspect(prepared.plan.itemId))?.state).toBe("archived");
        expect((yield* service.typedArchive(id, "admin", Effect.void)).plan.state).toBe("archived");
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "accepts locally valid dedicated App keys and rejects malformed credentials without an item write",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration,
          core = yield* VaultCore.VaultCore;
        const privateKey = Redacted.make(
          NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
            .privateKey.export({ type: "pkcs1", format: "pem" })
            .toString(),
        );
        const credential = {
          type: "github" as const,
          account: "team",
          repositories: ["team/repo"],
          credential: { type: "app" as const, appId: "123", installationId: "456", privateKey },
        };
        const id = "c".repeat(32);
        const prepared = yield* service.typedPrepare(
          { id, label: "Development App", developmentOnly: true, credential },
          "admin",
          Effect.void,
        );
        expect(prepared.plan.details).toMatchObject({
          type: "github",
          mechanism: "app",
          appId: "123",
          installationId: "456",
        });
        expect((yield* core.list({ cursor: null, includeArchived: true })).items).toEqual([]);
        expect(
          (yield* service.typedApply(
            { id, reviewed: true, developmentOnly: true, credential },
            "admin",
            Effect.void,
          )).plan.state,
        ).toBe("imported");
        const before = f.records.size;
        for (const bad of [
          {
            ...credential,
            credential: { ...credential.credential, privateKey: Redacted.make("invalid") },
          },
          {
            type: "github" as const,
            account: "team",
            repositories: ["team/repo"],
            credential: { type: "token" as const, token: Redacted.make("bad token") },
          },
        ]) {
          expect(
            (yield* service
              .typedPrepare(
                {
                  id: "d".repeat(32),
                  label: "Invalid development",
                  developmentOnly: true,
                  credential: bad,
                },
                "admin",
                Effect.void,
              )
              .pipe(Effect.flip)).reason,
          ).toBe("invalid-credential");
        }
        expect(f.records.size).toBe(before);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "rechecks authorization at typed item commit and preserves a later edit during guarded archive",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Effect.gen(function* () {
        const service = yield* VaultMigration.VaultMigration,
          core = yield* VaultCore.VaultCore;
        const credential = {
          type: "github" as const,
          account: "dev-bot",
          repositories: ["team/repo"],
          credential: { type: "token" as const, token: Redacted.make("synthetic_dedicated_token") },
        };
        const id = "c".repeat(32),
          input = { id, label: "Development", developmentOnly: true as const, credential };
        const prepared = yield* service.typedPrepare(input, "admin", Effect.void);
        let checks = 0;
        const revoked = Effect.suspend(() =>
          ++checks >= 3 ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
        );
        const apply = { id, reviewed: true as const, developmentOnly: true as const, credential };
        expect((yield* service.typedApply(apply, "admin", revoked).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect(checks).toBe(3);
        expect(yield* core.inspect(prepared.plan.itemId)).toBeNull();
        expect((yield* service.typedInspect(id)).plan.state).toBe("applying");
        const imported = yield* service.typedApply(apply, "admin", Effect.void);
        const item = yield* core.reveal({ id: prepared.plan.itemId, expectedVersion: 1 });
        yield* core.save(
          {
            id: prepared.plan.itemId,
            operationId: "e".repeat(32),
            expectedVersion: 1,
            label: "Later edit",
            kind: "service-connection",
            value: item.value,
          },
          "admin",
        );
        expect(
          (yield* service.typedArchive(id, "admin", Effect.void).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect((yield* core.inspect(prepared.plan.itemId))?.state).toBe("active");
        expect(imported.canCutover).toBe(false);
      }).pipe(Effect.provide(f.layer));
    }),
);
