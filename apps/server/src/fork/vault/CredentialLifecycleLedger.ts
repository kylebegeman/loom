import { VaultError, VaultItemId } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const Counter = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const PositiveCounter = Counter.check(Schema.isGreaterThan(0));
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Reference = Schema.Struct({ itemId: VaultItemId, version: PositiveCounter });
const Record = Schema.Struct({
  id: VaultItemId,
  itemId: VaultItemId,
  itemVersion: PositiveCounter,
  issuer: Reference,
  generation: PositiveCounter,
  bindingDigest: Digest,
  consumersDigest: Digest,
  createdAt: Counter,
  expiresAt: Counter,
  updatedAt: Counter,
  revision: PositiveCounter,
  phase: Schema.Literals([
    "prepared",
    "issuing",
    "issued",
    "validated",
    "revoking",
    "revoked",
    "cancelled",
    "unknown",
  ]),
  credential: Schema.NullOr(Reference),
  receiptDigest: Schema.NullOr(Digest),
}).check(
  Schema.makeFilter(
    (entry) =>
      entry.expiresAt > entry.createdAt &&
      entry.updatedAt >= entry.createdAt &&
      (entry.phase === "prepared" || entry.phase === "issuing" || entry.phase === "cancelled"
        ? entry.credential === null && entry.receiptDigest === null
        : entry.phase === "unknown"
          ? true
          : entry.credential !== null && entry.receiptDigest !== null),
  ),
);
export type LifecycleRecord = typeof Record.Type;
export type LifecycleState = {
  readonly revision: number;
  readonly entries: ReadonlyArray<LifecycleRecord>;
};
const Document = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: Schema.String,
  revision: Counter,
  updatedAt: Counter,
  entries: Schema.Array(Record).check(Schema.isMaxLength(128)),
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.entries.map((entry) => entry.id)).size === value.entries.length &&
      new Set(value.entries.map((entry) => `${entry.itemId}:${entry.generation}`)).size ===
        value.entries.length &&
      value.entries.every((entry) => entry.updatedAt <= value.updatedAt),
  ),
);
const decode = Schema.decodeUnknownEffect(Document, { onExcessProperty: "error" });
const immutable = (entry: LifecycleRecord) =>
  JSON.stringify([
    entry.id,
    entry.itemId,
    entry.itemVersion,
    entry.issuer.itemId,
    entry.issuer.version,
    entry.generation,
    entry.bindingDigest,
    entry.consumersDigest,
    entry.createdAt,
    entry.expiresAt,
  ]);
const reference = (entry: LifecycleRecord) => JSON.stringify(entry.credential);
const terminal = (entry: LifecycleRecord) =>
  entry.phase === "revoked" || entry.phase === "cancelled";
const transitions: Readonly<
  Record<LifecycleRecord["phase"], ReadonlyArray<LifecycleRecord["phase"]>>
> = {
  prepared: ["issuing", "cancelled"],
  issuing: ["issued", "revoking", "unknown"],
  issued: ["validated", "revoking", "unknown"],
  validated: ["revoking", "unknown"],
  revoking: ["revoked", "unknown"],
  revoked: [],
  cancelled: [],
  unknown: ["revoking"],
};
const validTransition = (current: LifecycleState, next: LifecycleState, now: number) => {
  if (
    next.revision !== current.revision + 1 ||
    current.entries.some((old) => !next.entries.some((e) => e.id === old.id))
  )
    return false;
  let changes = 0;
  for (const entry of next.entries) {
    const old = current.entries.find((e) => e.id === entry.id);
    if (!old) {
      const previous = current.entries.filter((e) => e.itemId === entry.itemId);
      if (
        entry.phase !== "prepared" ||
        entry.revision !== 1 ||
        entry.createdAt !== now ||
        entry.updatedAt !== now ||
        now >= entry.expiresAt ||
        previous.some((e) => !terminal(e)) ||
        entry.generation !== Math.max(0, ...previous.map((e) => e.generation)) + 1
      )
        return false;
      changes++;
      continue;
    }
    if (JSON.stringify(old) === JSON.stringify(entry)) continue;
    changes++;
    if (
      immutable(old) !== immutable(entry) ||
      entry.revision !== old.revision + 1 ||
      entry.updatedAt !== now ||
      now < old.updatedAt ||
      !transitions[old.phase].includes(entry.phase)
    )
      return false;
    if ((entry.phase === "issuing" || entry.phase === "validated") && now >= entry.expiresAt)
      return false;
    // A receipt can attach a reference only once, after issuance; later changes cannot redirect cleanup.
    if (old.credential && reference(old) !== reference(entry)) return false;
    if (
      entry.phase === "revoking" &&
      old.receiptDigest !== null &&
      entry.receiptDigest !== old.receiptDigest
    )
      return false;
  }
  return changes === 1;
};

// These are recoverable evidence records, never grants or automatic issuer dispatch.
export class CredentialLifecycleLedger extends Context.Service<
  CredentialLifecycleLedger,
  {
    readonly read: Effect.Effect<LifecycleState, VaultError>;
    readonly cas: (revision: number, next: LifecycleState) => Effect.Effect<void, VaultError>;
  }
>()("t3/fork/vault/CredentialLifecycleLedger") {}
export const layer = Layer.effect(
  CredentialLifecycleLedger,
  Effect.gen(function* () {
    const store = yield* OpenBaoStore.OpenBaoStore;
    const identity = yield* ServerEnvironmentIdentity;
    const crypto = yield* Crypto.Crypto;
    const environmentId = yield* identity.getEnvironmentId;
    const namespace = Hex.encode(
      yield* crypto
        .digest("SHA-256", new TextEncoder().encode(environmentId))
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" }))),
    );
    const path = `environments/${namespace}/profiles/_operations/credential-lifecycle-v1`;
    const load = Effect.fn("CredentialLifecycleLedger.load")(function* () {
      const stored = yield* store.read(path);
      if (!stored)
        return {
          state: { revision: 0, entries: [] } satisfies LifecycleState,
          version: 0,
          updatedAt: 0,
        };
      const value = yield* decode(Redacted.value(stored.value)).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-response" })),
      );
      if (value.environmentId !== environmentId || value.revision === 0)
        return yield* new VaultError({ reason: "invalid-response" });
      return {
        state: { revision: value.revision, entries: value.entries } satisfies LifecycleState,
        version: stored.version,
        updatedAt: value.updatedAt,
      };
    });
    return CredentialLifecycleLedger.of({
      read: load().pipe(Effect.map((value) => value.state)),
      cas: Effect.fn("CredentialLifecycleLedger.cas")(function* (revision, next) {
        const current = yield* load();
        if (current.state.revision !== revision)
          return yield* new VaultError({ reason: "conflict" });
        const updatedAt = yield* Clock.currentTimeMillis;
        if (updatedAt < current.updatedAt) return yield* new VaultError({ reason: "unavailable" });
        const value = yield* decode({
          schemaVersion: 1,
          environmentId,
          revision: next.revision,
          updatedAt,
          entries: next.entries.map((entry) => {
            const old = current.state.entries.find((candidate) => candidate.id === entry.id);
            return old && JSON.stringify(old) === JSON.stringify(entry)
              ? entry
              : {
                  ...entry,
                  createdAt: old ? entry.createdAt : updatedAt,
                  updatedAt,
                };
          }),
        }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" })));
        if (!validTransition(current.state, value, updatedAt))
          return yield* new VaultError({ reason: "invalid-input" });
        yield* store.write(path, Redacted.make(value), current.version);
      }),
    });
  }),
);
