import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Ledger from "./CredentialLifecycleLedger.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const prepared: Ledger.LifecycleRecord = {
  id: "a".repeat(32),
  itemId: "b".repeat(32),
  itemVersion: 1,
  issuer: { itemId: "c".repeat(32), version: 1 },
  generation: 1,
  bindingDigest: "d".repeat(64),
  consumersDigest: "e".repeat(64),
  createdAt: 0,
  expiresAt: 300_000,
  updatedAt: 0,
  revision: 1,
  phase: "prepared",
  credential: null,
  receiptDigest: null,
};
const fixture = Effect.gen(function* () {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const faults = { write: "none" as "none" | "before" | "after" };
  const backend = Layer.succeed(OpenBaoStore.OpenBaoStore, {
    status: Effect.succeed({ backend: "openbao" as const, state: "ready" as const, origin: null }),
    keys: () => Effect.die("No enumeration"),
    read: (path) => Effect.sync(() => records.get(path) ?? null),
    write: (path, value, expected) =>
      Effect.gen(function* () {
        if (faults.write === "before") return yield* new VaultError({ reason: "unavailable" });
        const version = records.get(path)?.version ?? 0;
        if (version !== expected) return yield* new VaultError({ reason: "conflict" });
        records.set(path, { value, version: version + 1 });
        if (faults.write === "after") return yield* new VaultError({ reason: "unavailable" });
        return version + 1;
      }),
  });
  const dependencies = Layer.mergeAll(
    backend,
    NodeServices.layer,
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("lifecycle-ledger-proof")),
    }),
  );
  const rebuild = Ledger.CredentialLifecycleLedger.pipe(
    Effect.provide(Layer.fresh(Ledger.layer.pipe(Layer.provide(dependencies)))),
  );
  const ledger = yield* rebuild;
  const add = (entry = prepared) =>
    Effect.gen(function* () {
      const state = yield* ledger.read;
      yield* ledger.cas(state.revision, {
        revision: state.revision + 1,
        entries: [...state.entries, entry],
      });
    });
  const advance = (
    phase: Ledger.LifecycleRecord["phase"],
    change: Partial<Ledger.LifecycleRecord> = {},
  ) =>
    Effect.gen(function* () {
      const state = yield* ledger.read;
      const entry = state.entries[0]!;
      yield* ledger.cas(state.revision, {
        revision: state.revision + 1,
        entries: [
          { ...entry, ...change, phase, revision: entry.revision + 1 },
          ...state.entries.slice(1),
        ],
      });
    });
  const raw = () => Redacted.value(records.values().next().value!.value);
  const replace = (change: (value: Record<string, unknown>) => void) => {
    const key = [...records.keys()][0]!;
    const record = records.get(key)!;
    const value = structuredClone(Redacted.value(record.value)) as Record<string, unknown>;
    change(value);
    records.set(key, { ...record, value: Redacted.make(value) });
  };
  return { records, faults, ledger, rebuild, add, advance, raw, replace };
});
const issued = {
  credential: { itemId: "f".repeat(32), version: 1 },
  receiptDigest: "1".repeat(64),
};
it.effect(
  "retains issuance, consumer validation and revocation receipts with monotonic resource generations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.add();
      yield* f.advance("issuing");
      yield* f.advance("issued", issued);
      yield* f.advance("validated", { receiptDigest: "2".repeat(64) });
      yield* f.advance("revoking");
      yield* f.advance("revoked", { receiptDigest: "3".repeat(64) });
      expect((yield* (yield* f.rebuild).read).entries[0]).toMatchObject({
        phase: "revoked",
        revision: 6,
        ...issued,
        receiptDigest: "3".repeat(64),
      });
      yield* f.add({ ...prepared, id: "9".repeat(32), generation: 2 });
      expect([...f.records.keys()][0]).toMatch(
        /^environments\/[a-f0-9]{64}\/profiles\/_operations\/credential-lifecycle-v1$/,
      );
      expect(f.raw()).toMatchObject({
        schemaVersion: 1,
        entries: [{ phase: "revoked" }, { phase: "prepared" }],
      });
    }),
);
it.effect.each(["before", "after"] as const)(
  "reconciles %s issuance-intent commit without reminting",
  (fault) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.add();
      f.faults.write = fault;
      expect((yield* f.advance("issuing").pipe(Effect.flip)).reason).toBe("unavailable");
      f.faults.write = "none";
      const restarted = yield* f.rebuild;
      expect((yield* restarted.read).entries[0]!.phase).toBe(
        fault === "after" ? "issuing" : "prepared",
      );
      if (fault === "after") {
        yield* f.advance("unknown");
        yield* TestClock.adjust("2 days");
        expect((yield* (yield* f.rebuild).read).entries[0]!.phase).toBe("unknown");
        expect(
          (yield* f
            .add({
              ...prepared,
              id: "9".repeat(32),
              generation: 2,
              createdAt: 172800000,
              updatedAt: 172800000,
              expiresAt: 172900000,
            })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
      }
    }),
);
it.effect("refuses duplicate IDs, overlapping issuance, replay and forged phase skips", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.add();
    for (const effect of [
      f.add(),
      f.add({ ...prepared, id: "9".repeat(32), generation: 2 }),
      f.advance("issued", issued),
    ])
      expect((yield* effect.pipe(Effect.flip)).reason).toBe("invalid-input");
    yield* f.advance("issuing");
    yield* f.advance("unknown");
    expect((yield* f.advance("prepared").pipe(Effect.flip)).reason).toBe("invalid-input");
    const state = yield* f.ledger.read;
    expect(
      (yield* f.ledger
        .cas(state.revision, { revision: state.revision + 1, entries: [] })
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-input");
  }),
);
it.effect("does not let cleanup redirect an issued credential or change reviewed consumers", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.add();
    yield* f.advance("issuing");
    yield* f.advance("issued", issued);
    for (const change of [
      { credential: { itemId: "9".repeat(32), version: 1 } },
      { consumersDigest: "9".repeat(64) },
      { issuer: { itemId: "9".repeat(32), version: 1 } },
    ])
      expect((yield* f.advance("revoking", change).pipe(Effect.flip)).reason).toBe("invalid-input");
  }),
);
it.effect(
  "allows revocation maintenance after expiry but refuses fresh issuance or validation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.add();
      yield* f.advance("issuing");
      yield* f.advance("issued", issued);
      yield* TestClock.adjust("6 minutes");
      expect((yield* f.advance("validated", { updatedAt: 360000 }).pipe(Effect.flip)).reason).toBe(
        "invalid-input",
      );
      yield* f.advance("revoking", { updatedAt: 360000 });
      yield* f.advance("revoked", { updatedAt: 360000, receiptDigest: "3".repeat(64) });
    }),
);
it.effect("CAS refuses a stale completion without erasing the winning phase", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.add();
    const stale = yield* f.ledger.read;
    yield* f.advance("issuing");
    expect(
      (yield* f.ledger
        .cas(stale.revision, {
          revision: 2,
          entries: [{ ...prepared, phase: "cancelled", revision: 2 }],
        })
        .pipe(Effect.flip)).reason,
    ).toBe("conflict");
    expect((yield* f.ledger.read).entries[0]!.phase).toBe("issuing");
  }),
);
it.effect.each([
  "schema",
  "environment",
  "secret-field",
  "duplicate",
  "missing-reference",
  "future-time",
])("fails closed on %s without overwriting the corrupt record", (defect) =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.add();
    f.replace((value) => {
      const entries = value.entries as Array<Record<string, unknown>>;
      if (defect === "schema") value.schemaVersion = 2;
      if (defect === "environment") value.environmentId = "foreign";
      if (defect === "secret-field") entries[0]!.token = "must-not-be-accepted";
      if (defect === "duplicate") entries.push(entries[0]!);
      if (defect === "missing-reference") entries[0]!.phase = "issued";
      if (defect === "future-time") entries[0]!.updatedAt = 1;
    });
    const before = f.raw();
    expect((yield* (yield* f.rebuild).read.pipe(Effect.flip)).reason).toBe("invalid-response");
    expect(f.raw()).toEqual(before);
  }),
);

it.effect("refuses a 129th receipt instead of evicting a spent issuance ID", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.add();
    f.replace((value) => {
      value.entries = Array.from({ length: 128 }, (_, index) => ({
        ...prepared,
        id: index.toString(16).padStart(32, "0"),
        itemId: index.toString(16).padStart(32, "0"),
        phase: "cancelled",
      }));
    });
    const before = f.raw();
    expect((yield* f.add().pipe(Effect.flip)).reason).toBe("invalid-input");
    expect(f.raw()).toEqual(before);
  }),
);

it.effect("uses server timestamps and refuses a backwards clock without overwriting evidence", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* TestClock.adjust("1 minute");
    yield* f.add();
    expect((yield* f.ledger.read).entries[0]).toMatchObject({ createdAt: 60000, updatedAt: 60000 });
    yield* f.advance("issuing");
    const before = f.raw();
    yield* TestClock.setTime(0);
    expect((yield* f.advance("unknown").pipe(Effect.flip)).reason).toBe("unavailable");
    expect(f.raw()).toEqual(before);
  }),
);

it.effect(
  "records a late mint acknowledgement after expiry and preserves its revocation path",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.add();
      yield* f.advance("issuing");
      yield* TestClock.adjust("6 minutes");
      yield* f.advance("issued", issued);
      expect((yield* (yield* f.rebuild).read).entries[0]).toMatchObject({
        phase: "issued",
        ...issued,
      });
      expect((yield* f.advance("validated").pipe(Effect.flip)).reason).toBe("invalid-input");
      yield* f.advance("revoking");
      yield* f.advance("revoked", { receiptDigest: "2".repeat(64) });
      expect((yield* f.ledger.read).entries[0]!.phase).toBe("revoked");
    }),
);
it.effect.each(["issuing", "unknown"] as const)(
  "reconciles an expired %s mint directly into revocation without another issuance",
  (phase) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.add();
      yield* f.advance("issuing");
      if (phase === "unknown") yield* f.advance("unknown");
      yield* TestClock.adjust("6 minutes");
      yield* f.advance("revoking", issued);
      expect((yield* (yield* f.rebuild).read).entries[0]).toMatchObject({
        phase: "revoking",
        ...issued,
      });
      expect((yield* f.advance("issuing").pipe(Effect.flip)).reason).toBe("invalid-input");
      yield* f.advance("revoked", { receiptDigest: "2".repeat(64) });
    }),
);

it.effect(
  "preserves every acknowledged receipt through validation, uncertainty and revocation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.add();
      yield* f.advance("issuing");
      yield* f.advance("issued", issued);
      yield* f.advance("validated", { receiptDigest: "2".repeat(64) });
      yield* f.advance("unknown");
      yield* f.advance("revoking");
      yield* f.advance("revoked", { receiptDigest: "3".repeat(64) });
      expect((yield* (yield* f.rebuild).read).entries[0]).toMatchObject({
        receiptDigest: "3".repeat(64),
        receiptHistory: [
          { phase: "issued", digest: "1".repeat(64) },
          { phase: "validated", digest: "2".repeat(64) },
          { phase: "revoked", digest: "3".repeat(64) },
        ],
      });
    }),
);
it.effect.each(["issued", "validated", "revoking"] as const)(
  "cannot erase an acknowledged receipt when %s becomes unknown",
  (phase) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.add();
      yield* f.advance("issuing");
      yield* f.advance("issued", issued);
      if (phase === "validated") yield* f.advance("validated", { receiptDigest: "2".repeat(64) });
      if (phase === "revoking") yield* f.advance("revoking");
      const before = f.raw();
      expect((yield* f.advance("unknown", { receiptDigest: null }).pipe(Effect.flip)).reason).toBe(
        "invalid-input",
      );
      expect(f.raw()).toEqual(before);
    }),
);

it.effect("refuses replacing receipt history and preserves surviving legacy evidence", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.add();
    yield* f.advance("issuing");
    yield* f.advance("issued", issued);
    const before = f.raw();
    expect(
      (yield* f
        .advance("validated", { receiptDigest: "2".repeat(64), receiptHistory: [] })
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-input");
    expect(f.raw()).toEqual(before);
    f.replace((value) => {
      delete (value.entries as Array<Record<string, unknown>>)[0]!.receiptHistory;
    });
    yield* f.advance("validated", { receiptDigest: "2".repeat(64) });
    expect((yield* f.ledger.read).entries[0]).toMatchObject({
      receiptHistory: [
        { phase: "legacy", digest: "1".repeat(64) },
        { phase: "validated", digest: "2".repeat(64) },
      ],
    });
  }),
);
it.effect("refuses receipt history overflow without discarding older evidence", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.add();
    yield* f.advance("issuing");
    yield* f.advance("issued", issued);
    f.replace((value) => {
      (value.entries as Array<Record<string, unknown>>)[0]!.receiptHistory = Array.from(
        { length: 8 },
        (_, index) => ({
          phase: "legacy",
          at: 0,
          digest: index === 7 ? issued.receiptDigest : (index + 2).toString(16).padStart(64, "0"),
        }),
      );
    });
    const before = f.raw();
    expect(
      (yield* f.advance("validated", { receiptDigest: "2".repeat(64) }).pipe(Effect.flip)).reason,
    ).toBe("invalid-input");
    expect(f.raw()).toEqual(before);
  }),
);
