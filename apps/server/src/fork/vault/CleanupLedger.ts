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

const Identifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.makeFilter((value) =>
    [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
  ),
);
const Counter = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const PositiveCounter = Counter.check(Schema.isGreaterThan(0));
const Scope = Schema.Struct({
  environmentId: Identifier,
  itemId: VaultItemId,
  itemVersion: PositiveCounter,
  accountId: VaultItemId,
  collectionId: VaultItemId,
  machineId: VaultItemId,
  application: Identifier,
  target: Identifier,
  origin: Identifier,
});
export type CleanupScope = typeof Scope.Type;
const Ticket = Schema.Struct({
  scope: Scope,
  operationId: Identifier,
  leaseId: Identifier,
  runId: Identifier,
  generation: Counter,
});
export type CleanupTicket = typeof Ticket.Type;
const Reset = Schema.Struct({
  scope: Scope,
  resetId: Identifier,
  from: Counter,
  to: Counter,
}).check(Schema.makeFilter((value) => value.to === value.from + 1));
export type ResetIntent = typeof Reset.Type;
export const cleanupResourceKey = (scope: CleanupScope) =>
  JSON.stringify([scope.environmentId, scope.itemId]);
export const cleanupScopeKey = (scope: CleanupScope) =>
  JSON.stringify([
    scope.environmentId,
    scope.itemId,
    scope.itemVersion,
    scope.accountId,
    scope.collectionId,
    scope.machineId,
    scope.application,
    scope.target,
    scope.origin,
  ]);
const Entry = Schema.Struct({
  scope: Scope,
  phase: Schema.Literals(["quarantined", "uncertain", "fenced", "resetting", "ready"]),
  generation: Counter,
  ticket: Schema.NullOr(Ticket),
  reset: Schema.NullOr(Reset),
}).check(
  Schema.makeFilter((entry) => {
    const ticketValid =
      entry.ticket !== null &&
      entry.ticket.generation === entry.generation &&
      cleanupScopeKey(entry.ticket.scope) === cleanupScopeKey(entry.scope);
    if (entry.phase === "quarantined")
      return entry.generation === 0 && !entry.ticket && !entry.reset;
    if (entry.phase === "ready") return entry.generation > 0 && !entry.ticket && !entry.reset;
    if (entry.phase === "uncertain" || entry.phase === "fenced") return ticketValid && !entry.reset;
    return (
      entry.reset !== null &&
      entry.reset.from === entry.generation &&
      cleanupScopeKey(entry.reset.scope) === cleanupScopeKey(entry.scope) &&
      (entry.ticket === null ? entry.generation === 0 : ticketValid)
    );
  }),
);
export type CleanupEntry = typeof Entry.Type;
export type CleanupState = {
  readonly revision: number;
  readonly entries: ReadonlyMap<string, CleanupEntry>;
  readonly operationIds: ReadonlySet<string>;
  readonly leaseIds: ReadonlySet<string>;
  readonly resetIds: ReadonlySet<string>;
};
export type CleanupStore = {
  readonly read: Effect.Effect<CleanupState, VaultError>;
  readonly cas: (revision: number, next: CleanupState) => Effect.Effect<void, VaultError>;
};
const Document = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: Identifier,
  revision: Counter,
  updatedAt: Counter,
  entries: Schema.Array(Entry).check(Schema.isMaxLength(32)),
  operationIds: Schema.Array(Identifier).check(Schema.isMaxLength(128)),
  leaseIds: Schema.Array(Schema.String.check(Schema.isMaxLength(1024))).check(
    Schema.isMaxLength(128),
  ),
  resetIds: Schema.Array(Identifier).check(Schema.isMaxLength(160)),
}).check(
  Schema.makeFilter((value) => {
    const operations = new Set(value.operationIds),
      leases = new Set(value.leaseIds),
      resets = new Set(value.resetIds);
    return (
      new Set(value.entries.map((e) => cleanupResourceKey(e.scope))).size ===
        value.entries.length &&
      operations.size === value.operationIds.length &&
      leases.size === value.leaseIds.length &&
      resets.size === value.resetIds.length &&
      operations.size === leases.size &&
      value.entries.every(
        (e) =>
          e.scope.environmentId === value.environmentId &&
          (!e.ticket ||
            (operations.has(e.ticket.operationId) &&
              leases.has(JSON.stringify([cleanupResourceKey(e.scope), e.ticket.leaseId])))) &&
          (!e.reset || resets.has(e.reset.resetId)),
      )
    );
  }),
);
const decode = Schema.decodeUnknownEffect(Document, { onExcessProperty: "error" });
const invalid = () => new VaultError({ reason: "invalid-response" });
const empty = (): CleanupState => ({
  revision: 0,
  entries: new Map(),
  operationIds: new Set(),
  leaseIds: new Set(),
  resetIds: new Set(),
});
const superset = (next: ReadonlySet<string>, before: ReadonlySet<string>) =>
  [...before].every((id) => next.has(id));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const validTransition = (before: CleanupState, next: CleanupState) => {
  if (
    next.revision !== before.revision + 1 ||
    !Number.isSafeInteger(next.revision) ||
    !superset(next.operationIds, before.operationIds) ||
    !superset(next.leaseIds, before.leaseIds) ||
    !superset(next.resetIds, before.resetIds) ||
    [...before.entries.keys()].some((key) => !next.entries.has(key))
  )
    return false;
  let changed = 0;
  for (const [key, entry] of next.entries) {
    if (key !== cleanupResourceKey(entry.scope)) return false;
    const old = before.entries.get(key);
    if (!old) {
      if (entry.phase !== "quarantined") return false;
      changed++;
      continue;
    }
    if (same(old, entry)) continue;
    changed++;
    if (cleanupScopeKey(old.scope) !== cleanupScopeKey(entry.scope)) return false;
    if (old.phase === "resetting" && entry.phase === "ready") {
      if (entry.generation !== old.reset?.to) return false;
    } else if (entry.generation !== old.generation) return false;
    if (old.phase === "ready" && entry.phase === "uncertain") {
      if (
        !entry.ticket ||
        before.operationIds.has(entry.ticket.operationId) ||
        before.leaseIds.has(JSON.stringify([key, entry.ticket.leaseId]))
      )
        return false;
    } else if (
      (old.phase === "quarantined" || old.phase === "fenced") &&
      entry.phase === "resetting"
    ) {
      if (
        !entry.reset ||
        before.resetIds.has(entry.reset.resetId) ||
        !same(old.ticket, entry.ticket)
      )
        return false;
    } else if (old.phase === "uncertain" && entry.phase === "fenced") {
      if (!same(old.ticket, entry.ticket)) return false;
    } else if (!(old.phase === "resetting" && entry.phase === "ready")) return false;
  }
  return changed === 1;
};

// Internal persistence only. No caller gains an execution, reset or reuse permit from these records.
export class CleanupLedger extends Context.Service<CleanupLedger, CleanupStore>()(
  "t3/fork/vault/CleanupLedger",
) {}
export const layer = Layer.effect(
  CleanupLedger,
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
    const path = `environments/${namespace}/profiles/_operations/cleanup-reset-v1`;
    const load = Effect.fn("CleanupLedger.load")(function* () {
      const stored = yield* store.read(path);
      if (!stored) return { state: empty(), version: 0, updatedAt: 0 };
      const value = yield* decode(Redacted.value(stored.value)).pipe(Effect.mapError(invalid));
      if (value.environmentId !== environmentId || value.revision === 0) return yield* invalid();
      return {
        state: {
          revision: value.revision,
          entries: new Map(value.entries.map((e) => [cleanupResourceKey(e.scope), e])),
          operationIds: new Set(value.operationIds),
          leaseIds: new Set(value.leaseIds),
          resetIds: new Set(value.resetIds),
        } satisfies CleanupState,
        version: stored.version,
        updatedAt: value.updatedAt,
      };
    });
    return CleanupLedger.of({
      read: load().pipe(Effect.map((value) => value.state)),
      cas: Effect.fn("CleanupLedger.cas")(function* (revision, next) {
        const current = yield* load();
        if (current.state.revision !== revision)
          return yield* new VaultError({ reason: "conflict" });
        if (!validTransition(current.state, next))
          return yield* new VaultError({ reason: "invalid-input" });
        const updatedAt = yield* Clock.currentTimeMillis;
        if (updatedAt < current.updatedAt) return yield* new VaultError({ reason: "unavailable" });
        const value = yield* decode({
          schemaVersion: 1,
          environmentId,
          revision: next.revision,
          updatedAt,
          entries: [...next.entries.values()],
          operationIds: [...next.operationIds],
          leaseIds: [...next.leaseIds],
          resetIds: [...next.resetIds],
        }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" })));
        yield* store.write(path, Redacted.make(value), current.version);
      }),
    });
  }),
);
