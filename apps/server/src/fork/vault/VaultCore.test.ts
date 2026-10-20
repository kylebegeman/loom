import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, SecretRef } from "@t3tools/contracts";
import { VaultError, type VaultItemSave } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";

const id = "a".repeat(32);
const input: VaultItemSave = {
  id,
  operationId: "b".repeat(32),
  expectedVersion: 0,
  label: "Development account",
  kind: "account",
  value: Redacted.make("synthetic-account-secret"),
};
const fixture = () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const backend = OpenBaoStore.OpenBaoStore.of({
    status: Effect.succeed({
      backend: "openbao",
      state: "ready",
      origin: "https://vault.example.test",
    }),
    read: (key) => Effect.sync(() => records.get(key) ?? null),
    write: (key, value, expectedVersion) =>
      Effect.suspend(() => {
        const version = records.get(key)?.version ?? 0;
        if (version !== expectedVersion) return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(key, { value, version: version + 1 });
        return Effect.succeed(version + 1);
      }),
    keys: (prefix) =>
      Effect.sync(() =>
        [...records.keys()]
          .filter((key) => key.startsWith(prefix + "/"))
          .map((key) => key.slice(prefix.length + 1)),
      ),
  });
  return { records, backend };
};
function withCore<A, E>(
  use: (core: VaultCore.VaultCore["Service"], f: ReturnType<typeof fixture>) => Effect.Effect<A, E>,
) {
  const f = fixture();
  return Effect.gen(function* () {
    const core = yield* VaultCore.VaultCore.pipe(
      Effect.provide(VaultCore.layer),
      Effect.provideService(OpenBaoStore.OpenBaoStore, f.backend),
      Effect.provideService(ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("test-environment")),
      }),
    );
    return yield* use(core, f);
  }).pipe(Effect.provide(NodeServices.layer));
}
it.effect(
  "creates and lists safe metadata without returning secret fields or mutation fingerprints",
  () =>
    withCore((core, f) =>
      Effect.gen(function* () {
        const item = yield* core.save(input, "owner");
        expect(item).toMatchObject({ id, label: input.label, version: 1, state: "active" });
        const page = yield* core.list({ cursor: null, includeArchived: false });
        expect(page.items).toEqual([item]);
        expect(JSON.stringify(page)).not.toContain("synthetic-account-secret");
        expect(JSON.stringify(page)).not.toContain("fingerprint");
        expect(f.records.size).toBe(1);
      }),
    ),
);
it.effect(
  "replays the same operation safely and rejects operation ID reuse with different content",
  () =>
    withCore((core) =>
      Effect.gen(function* () {
        const first = yield* core.save(input, "owner");
        expect(yield* core.save(input, "owner")).toEqual(first);
        expect(
          (yield* core
            .save({ ...input, value: Redacted.make("another-secret") }, "owner")
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(
          (yield* core.save({ ...input, operationId: "c".repeat(32) }, "owner").pipe(Effect.flip))
            .reason,
        ).toBe("conflict");
      }),
    ),
);
it.effect("archives, restores and deletes with explicit version preconditions", () =>
  withCore((core) =>
    Effect.gen(function* () {
      yield* core.save(input, "owner");
      const archived = yield* core.change(
        { id, operationId: "c".repeat(32), expectedVersion: 1, action: "archive" },
        "owner",
      );
      expect(archived.state).toBe("archived");
      expect((yield* core.list({ cursor: null, includeArchived: false })).items).toEqual([]);
      expect((yield* core.list({ cursor: null, includeArchived: true })).items).toEqual([archived]);
      expect(
        (yield* core
          .save({ ...input, operationId: "d".repeat(32), expectedVersion: 2 }, "owner")
          .pipe(Effect.flip)).reason,
      ).toBe("archived");
      yield* core.change(
        { id, operationId: "d".repeat(32), expectedVersion: 2, action: "restore" },
        "owner",
      );
      const deletion = {
        id,
        operationId: "e".repeat(32),
        expectedVersion: 3,
        action: "delete" as const,
      };
      expect((yield* core.change(deletion, "owner")).state).toBe("deleted");
      expect((yield* core.change(deletion, "owner")).version).toBe(4);
      expect((yield* core.list({ cursor: null, includeArchived: true })).items).toEqual([]);
      expect(
        (yield* core
          .change(
            { ...deletion, action: "restore", operationId: "f".repeat(32), expectedVersion: 4 },
            "owner",
          )
          .pipe(Effect.flip)).reason,
      ).toBe("not-found");
    }),
  ),
);
it.effect("allows exactly one concurrent replacement of the same version", () =>
  withCore((core) =>
    Effect.gen(function* () {
      yield* core.save(input, "owner");
      const results = yield* Effect.all(
        ["c", "d"].map((letter) =>
          core
            .save(
              { ...input, expectedVersion: 1, operationId: letter.repeat(32), label: letter },
              "owner",
            )
            .pipe(Effect.result),
        ),
        { concurrency: "unbounded" },
      );
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
      expect((yield* core.list({ cursor: null, includeArchived: false })).items[0]?.version).toBe(
        2,
      );
    }),
  ),
);
it.effect("rejects malformed input and oversized values before persistence", () =>
  withCore((core, f) =>
    Effect.gen(function* () {
      expect(
        (yield* core.save({ ...input, id: "../escape" }, "owner").pipe(Effect.flip)).reason,
      ).toBe("invalid-input");
      expect(
        (yield* core
          .save({ ...input, value: Redacted.make("x".repeat(1024 * 1024 + 1)) }, "owner")
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-input");
      expect(f.records.size).toBe(0);
    }),
  ),
);

it.effect("renames without reading a value into the client and checks reveal versions", () =>
  withCore((core) =>
    Effect.gen(function* () {
      yield* core.save(input, "owner");
      const { value: _, ...metadata } = input;
      const renamed = yield* core.save(
        { ...metadata, operationId: "c".repeat(32), expectedVersion: 1, label: "Renamed account" },
        "owner",
      );
      expect(renamed.label).toBe("Renamed account");
      expect((yield* core.reveal({ id, expectedVersion: 1 }).pipe(Effect.flip)).reason).toBe(
        "conflict",
      );
      expect(Redacted.value((yield* core.reveal({ id, expectedVersion: 2 })).value)).toBe(
        "synthetic-account-secret",
      );
      expect(
        (yield* core
          .save(
            { ...metadata, operationId: "d".repeat(32), expectedVersion: 2, kind: "ssh-key" },
            "owner",
          )
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-input");
    }),
  ),
);

it.effect("recognizes private input retries after the one-use source has been consumed", () =>
  withCore((core) =>
    Effect.gen(function* () {
      const secretRef = SecretRef.make("secret-ref:" + "a".repeat(32));
      const { value: _, ...metadata } = input;
      const request = { ...metadata, secretRef };
      expect(yield* core.savedPrivate(request, "thread:one")).toBeNull();
      const saved = yield* core.save(input, "thread:one", Effect.void, secretRef);
      expect(yield* core.savedPrivate(request, "thread:one")).toEqual(saved);
      expect((yield* core.savedPrivate(request, "thread:two").pipe(Effect.flip)).reason).toBe(
        "conflict",
      );
      expect(
        (yield* core
          .savedPrivate(
            { ...request, secretRef: SecretRef.make("secret-ref:" + "b".repeat(32)) },
            "thread:one",
          )
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(
        (yield* core
          .savedPrivate({ ...request, label: "Other destination" }, "thread:one")
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }),
  ),
);

it.effect("checks live authorization immediately before persistence", () =>
  withCore((core, f) =>
    Effect.gen(function* () {
      const denied = Effect.fail(new VaultError({ reason: "denied" }));
      expect((yield* core.save(input, "owner", denied).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.records.size).toBe(0);
      yield* core.save(input, "owner");
      expect(
        (yield* core
          .change(
            { id, operationId: "c".repeat(32), expectedVersion: 1, action: "delete" },
            "owner",
            denied,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect((yield* core.reveal({ id, expectedVersion: 1 })).item.state).toBe("active");
    }),
  ),
);

it.effect("paginates filtered and deleted records without losing the next cursor", () =>
  withCore((core) =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        Array.from({ length: 27 }, (_, index) => index.toString(16).padStart(32, "0")),
        (next) => core.save({ ...input, id: next }, "owner"),
      );
      const first = yield* core.list({ cursor: null, includeArchived: false });
      expect(first.items).toHaveLength(25);
      const last = yield* core.list({ cursor: first.nextCursor, includeArchived: false });
      expect(last.items).toHaveLength(2);
      expect(last.nextCursor).toBeNull();
      expect(new Set([...first.items, ...last.items].map((item) => item.id)).size).toBe(27);
    }),
  ),
);

it.effect("namespaces the same item ID by the server environment identity", () =>
  withCore((core, f) =>
    Effect.gen(function* () {
      yield* core.save(input, "owner");
      const other = yield* VaultCore.VaultCore.pipe(
        Effect.provide(VaultCore.layer),
        Effect.provideService(OpenBaoStore.OpenBaoStore, f.backend),
        Effect.provideService(ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(EnvironmentId.make("other-environment")),
        }),
        Effect.provide(NodeServices.layer),
      );
      expect((yield* other.list({ cursor: null, includeArchived: false })).items).toEqual([]);
      yield* other.save({ ...input, value: Redacted.make("separate-value") }, "owner");
      expect(Redacted.value((yield* core.reveal({ id, expectedVersion: 1 })).value)).toBe(
        "synthetic-account-secret",
      );
      expect(Redacted.value((yield* other.reveal({ id, expectedVersion: 1 })).value)).toBe(
        "separate-value",
      );
    }),
  ),
);
