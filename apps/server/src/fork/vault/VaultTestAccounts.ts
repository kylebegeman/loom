import {
  VaultError,
  VaultTestAccount,
  VaultTestAccountMutation,
  VaultTestCollection,
  type VaultTestAccountSnapshot,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";

export class VaultTestAccounts extends Context.Service<
  VaultTestAccounts,
  {
    readonly snapshot: (actor: string) => Effect.Effect<VaultTestAccountSnapshot, VaultError>;
    readonly quarantineLeases: (
      invalid: (account: VaultTestAccount) => Effect.Effect<boolean, VaultError>,
    ) => Effect.Effect<void, VaultError>;
    readonly apply: (
      input: VaultTestAccountMutation,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultTestAccountSnapshot, VaultError>;
  }
>()("t3/fork/vault/VaultTestAccounts") {}
const RECEIPT_AGE_MS = 86_400_000;
const Ledger = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  collections: Schema.Array(VaultTestCollection).check(Schema.isMaxLength(32)),
  accounts: Schema.Array(VaultTestAccount).check(Schema.isMaxLength(128)),
  receipts: Schema.Array(
    Schema.Struct({ id: Schema.String, fingerprint: Schema.String, at: Schema.Number }),
  ).check(Schema.isMaxLength(128)),
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.collections.map((c) => c.id)).size === value.collections.length &&
      new Set(value.accounts.map((a) => a.id)).size === value.accounts.length &&
      new Set(value.accounts.map((a) => a.itemId)).size === value.accounts.length &&
      new Set(value.receipts.map((r) => r.id)).size === value.receipts.length &&
      value.accounts.every((a) => value.collections.some((c) => c.id === a.collectionId)),
  ),
);
type Ledger = typeof Ledger.Type;
const decodeLedger = Schema.decodeUnknownOption(Ledger);
const encodeLedger = Schema.encodeEffect(Ledger);
const decodeMutation = Schema.decodeUnknownEffect(VaultTestAccountMutation, {
  onExcessProperty: "error",
});
const encodeFingerprint = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ input: VaultTestAccountMutation, actor: Schema.String })),
);
const empty: Ledger = {
  schemaVersion: 1,
  revision: 0,
  collections: [],
  accounts: [],
  receipts: [],
};
const expiredAccounts = (accounts: Ledger["accounts"], now: number): Ledger["accounts"] =>
  accounts.map((a) =>
    a.lease && a.lease.expiresAt <= now ? { ...a, state: "quarantined", lease: null } : a,
  );
const view = (ledger: Ledger, actor: string, now: number): VaultTestAccountSnapshot => ({
  revision: ledger.revision,
  checkedAt: now,
  actor,
  collections: ledger.collections,
  accounts: expiredAccounts(ledger.accounts, now),
  provisioning: "unsupported",
  loginDelivery: "unsupported",
});
const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore;
  const core = yield* VaultCore.VaultCore;
  const crypto = yield* Crypto.Crypto;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const hash = (text: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  // The reserved branch is outside every project hash; existing profiles/* rights cover it.
  const path = `environments/${yield* hash(environmentId)}/profiles/_test_accounts/registry-v1`;
  let ledgerMissing = false;
  const load = Effect.fn("VaultTestAccounts.load")(function* () {
    if (ledgerMissing) return { ledger: empty, version: 0 };
    const record = yield* store.read(path);
    if (!record) {
      ledgerMissing = true;
      return { ledger: empty, version: 0 };
    }
    const decoded = decodeLedger(Redacted.value(record.value));
    if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-response" });
    return { ledger: decoded.value, version: record.version };
  });
  const checkActor = (actor: string) =>
    actor.trim() && actor.length <= 512
      ? Effect.void
      : Effect.fail(new VaultError({ reason: "denied" }));
  const checkItem = Effect.fn("VaultTestAccounts.checkItem")(function* (account: VaultTestAccount) {
    const item = yield* core.inspect(account.itemId);
    if (!item || item.kind !== "account" || item.state !== "active")
      return yield* new VaultError({ reason: "denied" });
    if (item.version !== account.itemVersion) return yield* new VaultError({ reason: "conflict" });
  });
  return VaultTestAccounts.of({
    quarantineLeases: Effect.fn("VaultTestAccounts.quarantineLeases")(function* (invalid) {
      const loaded = yield* load();
      const now = yield* Clock.currentTimeMillis;
      const accounts = yield* Effect.forEach(loaded.ledger.accounts, (account) =>
        Effect.gen(function* () {
          if (!account.lease) return account;
          if (account.lease.expiresAt > now && !(yield* invalid(account))) return account;
          return { ...account, state: "quarantined" as const, lease: null };
        }),
      );
      if (accounts.every((a, index) => a === loaded.ledger.accounts[index])) return;
      const encoded = yield* encodeLedger({
        ...loaded.ledger,
        revision: loaded.ledger.revision + 1,
        accounts,
      }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-response" })));
      // CAS includes the observed lease identities. Never clear a newer owner's reservation.
      // A failed write may have committed; the next read must resolve that ambiguity.
      ledgerMissing = false;
      yield* store.write(path, Redacted.make(encoded), loaded.version);
    }),
    snapshot: Effect.fn("VaultTestAccounts.snapshot")(function* (actor) {
      yield* checkActor(actor);
      return view((yield* load()).ledger, actor, yield* Clock.currentTimeMillis);
    }),
    apply: Effect.fn("VaultTestAccounts.apply")(function* (raw, actor, authorize) {
      yield* checkActor(actor);
      const input = yield* decodeMutation(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      yield* authorize;
      const fingerprint = yield* hash(
        yield* encodeFingerprint({ input, actor }).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        ),
      );
      const loaded = yield* load();
      const now = yield* Clock.currentTimeMillis;
      const receipt = loaded.ledger.receipts.find((r) => r.id === input.operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          return yield* new VaultError({ reason: "conflict" });
        yield* authorize;
        return view(loaded.ledger, actor, now);
      }
      if (loaded.ledger.revision !== input.expectedRevision)
        return yield* new VaultError({ reason: "conflict" });
      let collections = [...loaded.ledger.collections];
      let accounts = [...expiredAccounts(loaded.ledger.accounts, now)];
      const c = input.change;
      let validated: VaultTestAccount | null = null;
      if (c.type === "collection-save") {
        const existing = collections.find((v) => v.id === c.collection.id);
        if (
          existing &&
          (existing.application !== c.collection.application ||
            existing.target !== c.collection.target) &&
          accounts.some((a) => a.collectionId === existing.id)
        )
          return yield* new VaultError({ reason: "conflict" });
        collections = [
          ...collections.filter((v) => v.id !== c.collection.id),
          { ...c.collection, archived: existing?.archived ?? false },
        ];
      } else if (c.type === "collection-archive") {
        if (!collections.some((v) => v.id === c.id))
          return yield* new VaultError({ reason: "not-found" });
        if (accounts.some((a) => a.collectionId === c.id && a.lease))
          return yield* new VaultError({ reason: "conflict" });
        collections = collections.map((v) => (v.id === c.id ? { ...v, archived: c.archived } : v));
      } else if (c.type === "account-save") {
        if (!collections.some((v) => v.id === c.account.collectionId && !v.archived))
          return yield* new VaultError({ reason: "denied" });
        const existing = accounts.find((v) => v.id === c.account.id);
        if (existing?.lease || existing?.state === "retired")
          return yield* new VaultError({ reason: "conflict" });
        if (existing && existing.collectionId !== c.account.collectionId)
          return yield* new VaultError({ reason: "conflict" });
        if (accounts.some((v) => v.itemId === c.account.itemId && v.id !== c.account.id))
          return yield* new VaultError({ reason: "conflict" });
        validated = { ...c.account, state: "quarantined", lease: null };
        accounts = [...accounts.filter((v) => v.id !== validated!.id), validated];
      } else {
        const account = accounts.find((v) => v.id === c.id);
        if (!account) return yield* new VaultError({ reason: "not-found" });
        const collection = collections.find((v) => v.id === account.collectionId)!;
        let next: VaultTestAccount = account;
        if (c.type === "reserve") {
          if (collection.archived || account.state !== "available")
            return yield* new VaultError({ reason: "conflict" });
          validated = account;
          next = {
            ...account,
            state: "reserved",
            lease: {
              id: input.operationId,
              owner: actor,
              createdAt: now,
              expiresAt: now + c.durationMs,
            },
          };
        } else if (c.type === "renew" || c.type === "release") {
          if (!account.lease || account.lease.id !== c.leaseId || account.lease.owner !== actor)
            return yield* new VaultError({ reason: "denied" });
          if (c.type === "release") next = { ...account, state: "quarantined", lease: null };
          else {
            validated = account;
            const expiresAt = Math.min(now + 900_000, account.lease.createdAt + 3_600_000);
            if (collection.archived || expiresAt <= account.lease.expiresAt)
              return yield* new VaultError({ reason: "conflict" });
            next = { ...account, lease: { ...account.lease, expiresAt } };
          }
        } else if (c.type === "mark-clean") {
          if (collection.archived || account.state !== "quarantined")
            return yield* new VaultError({ reason: "conflict" });
          validated = account;
          next = { ...account, state: "available", lease: null };
        } else if (c.type === "restore") {
          if (account.state !== "retired") return yield* new VaultError({ reason: "conflict" });
          next = { ...account, state: "quarantined", lease: null };
        } else {
          if (c.type === "quarantine" && account.state === "retired")
            return yield* new VaultError({ reason: "conflict" });
          next = {
            ...account,
            state: c.type === "retire" ? "retired" : "quarantined",
            lease: null,
          };
        }
        accounts = accounts.map((v) => (v.id === next.id ? next : v));
      }
      const next = {
        ...loaded.ledger,
        revision: loaded.ledger.revision + 1,
        collections,
        accounts,
        receipts: [
          ...loaded.ledger.receipts.filter((r) => r.at > now - RECEIPT_AGE_MS),
          { id: input.operationId, fingerprint, at: now },
        ].slice(-128),
      };
      const encoded = yield* encodeLedger(next).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      if (validated) yield* checkItem(validated);
      yield* authorize;
      // Time can advance during authorization; an expired lease never receives a late renewal.
      const committingAt = yield* Clock.currentTimeMillis;
      if (
        accounts.some((a) => a.lease && a.lease.expiresAt <= committingAt) ||
        (c.type === "renew" &&
          loaded.ledger.accounts.find((a) => a.id === c.id)!.lease!.expiresAt <= committingAt)
      )
        return yield* new VaultError({ reason: "conflict" });
      // A failed write may have committed; the next read must resolve that ambiguity.
      ledgerMissing = false;
      yield* store.write(path, Redacted.make(encoded), loaded.version);
      return view(next, actor, committingAt);
    }),
  });
});
export const layer = Layer.effect(VaultTestAccounts, make);
