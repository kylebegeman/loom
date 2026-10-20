// A separate protocol keeps typed review metadata out of legacy client schemas while sharing the existing migration namespace.
import * as SshCrypto from "./SshCrypto.ts";
import { SecretRef } from "@t3tools/contracts";
import {
  VaultError,
  VaultMigrationError,
  VaultTypedMigrationPrepare,
  VaultItemSummary,
  VaultTypedMigrationApply,
  VaultMigrationList,
  VaultTypedMigrationPlan,
  type VaultTypedMigrationResult,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import { encodeTypedMigrationCredential } from "./TypedMigrationCredential.ts";
const isOtherImportProtocol = Schema.is(Schema.Struct({ protocol: Schema.Literal(1) }));
const Stored = Schema.Struct({
  protocol: Schema.Literal(2),
  plan: VaultTypedMigrationPlan,
  fingerprint: Schema.String,
  preparedBy: Schema.String,
  appliedBy: Schema.NullOr(Schema.String),
  archivedBy: Schema.NullOr(Schema.String),
  archiveOperationId: Schema.String,
});
type Stored = typeof Stored.Type;
const decode = Schema.decodeUnknownOption(Stored),
  encode = Schema.encodeEffect(Stored);
const encodeValue = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      label: VaultItemSummary.fields.label,
      kind: Schema.Literals(["ssh-key", "service-connection"]),
      value: Schema.RedactedFromValue(Schema.String),
    }),
  ),
);
const isPrepare = Schema.is(Schema.toType(VaultTypedMigrationPrepare)),
  isApply = Schema.is(Schema.toType(VaultTypedMigrationApply)),
  isList = Schema.is(VaultMigrationList);
const invalid = () => new VaultError({ reason: "invalid-input" });
const invalidState = () => new VaultMigrationError({ reason: "invalid-state" });
const REVIEW_TTL_MS = 10 * 60_000;
export const makeTypedMigration = Effect.gen(function* () {
  const keys = yield* SshCrypto.SshCrypto;
  const encodeCredential = (
    input: Parameters<typeof encodeTypedMigrationCredential>[0],
    id: string,
  ) =>
    encodeTypedMigrationCredential(input, id).pipe(
      Effect.provideService(SshCrypto.SshCrypto, keys),
    );
  const store = yield* OpenBaoStore.OpenBaoStore,
    core = yield* VaultCore.VaultCore,
    identity = yield* ServerEnvironmentIdentity,
    crypto = yield* Crypto.Crypto;
  const hash = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const prefix = `environments/${yield* hash(yield* identity.getEnvironmentId)}/migrations`;
  const lock = yield* Semaphore.make(1);
  const id = () =>
    crypto.randomUUIDv4().pipe(
      Effect.map((value) => value.replaceAll("-", "")),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const load = Effect.fnUntraced(function* (id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) return yield* invalid();
    const record = yield* store.read(`${prefix}/${id}`);
    if (!record) return yield* new VaultError({ reason: "not-found" });
    const parsed = decode(Redacted.value(record.value));
    if (Option.isNone(parsed) || parsed.value.plan.id !== id)
      return yield* new VaultError({ reason: "invalid-response" });
    return { record: parsed.value, revision: record.version };
  });
  const save = (record: Stored, revision: number) =>
    encode(record).pipe(
      Effect.mapError(invalid),
      Effect.flatMap((value) =>
        store.write(`${prefix}/${record.plan.id}`, Redacted.make(value), revision),
      ),
    );
  const receipt = (record: Stored) =>
    record.appliedBy === null
      ? Effect.succeed(null)
      : core
          .savedPrivate(
            {
              id: record.plan.itemId,
              operationId: record.plan.id,
              expectedVersion: 0,
              label: record.plan.label,
              kind: record.plan.kind,
              secretRef: SecretRef.make(`typed-migration:${record.plan.id}`),
            },
            record.appliedBy,
          )
          .pipe(
            Effect.catchTags({
              VaultError: (error) =>
                error.reason === "conflict" ? Effect.succeed(null) : Effect.fail(error),
            }),
          );
  const view = Effect.fnUntraced(function* (
    record: Stored,
  ): Effect.fn.Return<VaultTypedMigrationResult, VaultError> {
    const item = yield* core.inspect(record.plan.itemId);
    const expired =
      record.plan.state === "prepared" && (yield* Clock.currentTimeMillis) >= record.plan.expiresAt;
    return {
      plan: { ...record.plan, state: expired ? "expired" : record.plan.state },
      item,
      accessVerification: "not-performed",
      workloadAuthorization: "not-evaluated",
      canCutover: false,
      canRollback: false,
      configurationWrites: false,
      canArchive:
        record.plan.state === "archiving" ||
        (record.plan.state === "imported" && item?.version === 1 && item.state === "active"),
    };
  });
  const recover = Effect.fnUntraced(function* (loaded: { record: Stored; revision: number }) {
    if (loaded.record.plan.state === "applying" && (yield* receipt(loaded.record))) {
      const record = {
        ...loaded.record,
        plan: { ...loaded.record.plan, state: "imported" as const },
      };
      return { record, revision: yield* save(record, loaded.revision) };
    }
    return loaded;
  });
  const inspect = (id: string) =>
    lock.withPermit(
      Effect.gen(function* () {
        const loaded = yield* load(id);
        const committed =
          loaded.record.plan.state === "applying" && (yield* receipt(loaded.record));
        return yield* view(
          committed
            ? { ...loaded.record, plan: { ...loaded.record.plan, state: "imported" } }
            : loaded.record,
        );
      }),
    );
  return {
    typedInspect: inspect,
    typedList: Effect.fn("VaultMigration.typedList")(function* (input: VaultMigrationList) {
      if (!isList(input)) return yield* invalid();
      const keys = [...(yield* store.keys(prefix))].sort();
      if (keys.some((key) => !/^[a-f0-9]{32}$/.test(key)))
        return yield* new VaultError({ reason: "invalid-response" });
      const remaining = keys.filter((id) => input.cursor === null || id > input.cursor),
        page = remaining.slice(0, 25);
      return {
        items: (yield* Effect.forEach(page, (id) =>
          Effect.gen(function* () {
            const raw = yield* store.read(`${prefix}/${id}`);
            if (raw && isOtherImportProtocol(Redacted.value(raw.value))) return null;
            return yield* inspect(id);
          }),
        )).filter((r): r is VaultTypedMigrationResult => r !== null),
        nextCursor: remaining.length > 25 ? page.at(-1)! : null,
      };
    }),
    typedPrepare: (
      input: VaultTypedMigrationPrepare,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!isPrepare(input) || !actor.trim() || actor.length > 512) return yield* invalid();
          yield* authorize;
          const encoded = yield* encodeCredential(input.credential, input.id);
          const fingerprint = yield* hash(
            yield* encodeValue({
              label: input.label,
              kind: encoded.kind,
              value: encoded.value,
            }).pipe(Effect.mapError(invalid)),
          );
          const current = yield* store.read(`${prefix}/${input.id}`);
          if (current) {
            const loaded = yield* load(input.id);
            if (loaded.record.fingerprint !== fingerprint || loaded.record.preparedBy !== actor)
              return yield* new VaultError({ reason: "conflict" });
            return yield* view(loaded.record);
          }
          const now = yield* Clock.currentTimeMillis;
          const record: Stored = {
            protocol: 2,
            plan: {
              id: input.id,
              itemId: yield* id(),
              label: input.label,
              kind: encoded.kind,
              details: encoded.details,
              developmentOnly: true,
              state: "prepared",
              createdAt: now,
              expiresAt: now + REVIEW_TTL_MS,
            },
            fingerprint,
            preparedBy: actor,
            appliedBy: null,
            archivedBy: null,
            archiveOperationId: yield* id(),
          };
          yield* authorize;
          yield* save(record, 0);
          return yield* view(record);
        }),
      ),
    typedApply: (
      input: VaultTypedMigrationApply,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!isApply(input) || !actor.trim() || actor.length > 512) return yield* invalid();
          yield* authorize;
          let loaded = yield* load(input.id);
          if (
            loaded.record.preparedBy !== actor ||
            (loaded.record.appliedBy !== null && loaded.record.appliedBy !== actor)
          )
            return yield* new VaultError({ reason: "conflict" });
          const encoded = yield* encodeCredential(input.credential, input.id);
          const fingerprint = yield* hash(
            yield* encodeValue({
              label: loaded.record.plan.label,
              kind: loaded.record.plan.kind,
              value: encoded.value,
            }).pipe(Effect.mapError(invalid)),
          );
          if (encoded.kind !== loaded.record.plan.kind || fingerprint !== loaded.record.fingerprint)
            return yield* new VaultMigrationError({ reason: "review-mismatch" });
          loaded = yield* recover(loaded);
          if (loaded.record.plan.state === "imported") return yield* view(loaded.record);
          if (!["prepared", "applying"].includes(loaded.record.plan.state))
            return yield* invalidState();
          if (loaded.record.plan.state === "prepared") {
            if ((yield* Clock.currentTimeMillis) >= loaded.record.plan.expiresAt)
              return yield* new VaultMigrationError({ reason: "expired" });
            const record = {
              ...loaded.record,
              appliedBy: actor,
              plan: { ...loaded.record.plan, state: "applying" as const },
            };
            yield* authorize;
            loaded = { record, revision: yield* save(record, loaded.revision) };
          }
          yield* core.save(
            {
              id: loaded.record.plan.itemId,
              operationId: loaded.record.plan.id,
              expectedVersion: 0,
              label: loaded.record.plan.label,
              kind: loaded.record.plan.kind,
              value: encoded.value,
            },
            loaded.record.appliedBy!,
            authorize,
            `typed-migration:${input.id}`,
          );
          const record = {
            ...loaded.record,
            plan: { ...loaded.record.plan, state: "imported" as const },
          };
          yield* authorize;
          yield* save(record, loaded.revision);
          return yield* view(record);
        }),
      ),
    typedCancel: (id: string, authorize: Effect.Effect<void, VaultError>) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* authorize;
          const loaded = yield* recover(yield* load(id));
          if (loaded.record.plan.state === "cancelled") return yield* view(loaded.record);
          if (loaded.record.plan.state !== "prepared") return yield* invalidState();
          const record = {
            ...loaded.record,
            plan: { ...loaded.record.plan, state: "cancelled" as const },
          };
          yield* authorize;
          yield* save(record, loaded.revision);
          return yield* view(record);
        }),
      ),
    typedArchive: (id: string, actor: string, authorize: Effect.Effect<void, VaultError>) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (!actor.trim() || actor.length > 512) return yield* invalid();
          yield* authorize;
          let loaded = yield* recover(yield* load(id));
          if (loaded.record.plan.state === "archived") return yield* view(loaded.record);
          if (!["imported", "archiving"].includes(loaded.record.plan.state))
            return yield* invalidState();
          if (loaded.record.plan.state === "imported") {
            if (!(yield* receipt(loaded.record)))
              return yield* new VaultError({ reason: "conflict" });
            const record = {
              ...loaded.record,
              archivedBy: actor,
              plan: { ...loaded.record.plan, state: "archiving" as const },
            };
            yield* authorize;
            loaded = { record, revision: yield* save(record, loaded.revision) };
          }
          yield* core.change(
            {
              id: loaded.record.plan.itemId,
              operationId: loaded.record.archiveOperationId,
              expectedVersion: 1,
              action: "archive",
            },
            loaded.record.archivedBy!,
            authorize,
          );
          const record = {
            ...loaded.record,
            plan: { ...loaded.record.plan, state: "archived" as const },
          };
          yield* authorize;
          yield* save(record, loaded.revision);
          return yield* view(record);
        }),
      ),
  };
});
