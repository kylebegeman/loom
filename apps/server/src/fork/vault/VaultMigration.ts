import { makeTypedMigration } from "./TypedMigration.ts";
import { SecretRef } from "@t3tools/contracts";
import {
  VaultError,
  VaultMigrationError,
  VaultMigrationPrepare,
  VaultMigrationApply,
  VaultMigrationList,
  VaultMigrationPlan,
  type VaultTypedMigrationPrepare,
  type VaultTypedMigrationApply,
  type VaultTypedMigrationResult,
  type VaultTypedMigrationPage,
  type VaultMigrationResult,
  type VaultMigrationPage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
type Failure = VaultError | VaultMigrationError;
export class VaultMigration extends Context.Service<
  VaultMigration,
  {
    readonly typedPrepare: (
      input: VaultTypedMigrationPrepare,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultTypedMigrationResult, Failure>;
    readonly typedApply: (
      input: VaultTypedMigrationApply,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultTypedMigrationResult, Failure>;
    readonly typedInspect: (id: string) => Effect.Effect<VaultTypedMigrationResult, Failure>;
    readonly typedList: (
      input: VaultMigrationList,
    ) => Effect.Effect<VaultTypedMigrationPage, Failure>;
    readonly typedCancel: (
      id: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultTypedMigrationResult, Failure>;
    readonly typedArchive: (
      id: string,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultTypedMigrationResult, Failure>;
    readonly prepare: (
      input: VaultMigrationPrepare,
      actor: string,
    ) => Effect.Effect<VaultMigrationResult, Failure>;
    readonly apply: (
      input: VaultMigrationApply,
      actor: string,
    ) => Effect.Effect<VaultMigrationResult, Failure>;
    readonly inspect: (id: string) => Effect.Effect<VaultMigrationResult, Failure>;
    readonly list: (input: VaultMigrationList) => Effect.Effect<VaultMigrationPage, Failure>;
    readonly cancel: (id: string) => Effect.Effect<VaultMigrationResult, Failure>;
    readonly archive: (id: string, actor: string) => Effect.Effect<VaultMigrationResult, Failure>;
  }
>()("t3/fork/vault/VaultMigration") {}
const isOtherImportProtocol = Schema.is(Schema.Struct({ protocol: Schema.Literal(2) }));
const Stored = Schema.Struct({
  protocol: Schema.Literal(1),
  plan: VaultMigrationPlan,
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
      label: VaultMigrationPrepare.fields.label,
      kind: VaultMigrationPrepare.fields.kind,
      value: VaultMigrationPrepare.fields.value,
    }),
  ),
);
const isPrepare = Schema.is(Schema.toType(VaultMigrationPrepare)),
  isApply = Schema.is(Schema.toType(VaultMigrationApply)),
  isList = Schema.is(VaultMigrationList);
const invalid = () => new VaultError({ reason: "invalid-input" });
const invalidState = () => new VaultMigrationError({ reason: "invalid-state" });
const REVIEW_TTL_MS = 10 * 60_000;
const make = Effect.gen(function* () {
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
              secretRef: SecretRef.make(`migration:${record.plan.id}`),
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
  ): Effect.fn.Return<VaultMigrationResult, VaultError> {
    const item = yield* core.inspect(record.plan.itemId);
    const expired =
      record.plan.state === "prepared" && (yield* Clock.currentTimeMillis) >= record.plan.expiresAt;
    return {
      plan: { ...record.plan, state: expired ? "expired" : record.plan.state },
      item,
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
  return VaultMigration.of({
    ...(yield* makeTypedMigration),
    inspect,
    list: Effect.fn("VaultMigration.list")(function* (input) {
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
        )).filter((r): r is VaultMigrationResult => r !== null),
        nextCursor: remaining.length > 25 ? page.at(-1)! : null,
      };
    }),
    prepare: Effect.fn("VaultMigration.prepare")(function (input, actor) {
      return lock.withPermit(
        Effect.gen(function* () {
          if (!isPrepare(input) || !actor.trim() || actor.length > 512) return yield* invalid();
          const fingerprint = yield* hash(yield* encodeValue(input).pipe(Effect.mapError(invalid)));
          const current = yield* store.read(`${prefix}/${input.id}`);
          if (current) {
            const loaded = yield* load(input.id);
            if (loaded.record.fingerprint !== fingerprint || loaded.record.preparedBy !== actor)
              return yield* new VaultError({ reason: "conflict" });
            return yield* view(loaded.record);
          }
          const now = yield* Clock.currentTimeMillis;
          const record: Stored = {
            protocol: 1,
            plan: {
              id: input.id,
              itemId: yield* id(),
              label: input.label,
              kind: input.kind,
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
          yield* save(record, 0);
          return yield* view(record);
        }),
      );
    }),
    apply: Effect.fn("VaultMigration.apply")(function (input, actor) {
      return lock.withPermit(
        Effect.gen(function* () {
          if (!isApply(input) || !actor.trim() || actor.length > 512) return yield* invalid();
          let loaded = yield* recover(yield* load(input.id));
          const fingerprint = yield* hash(
            yield* encodeValue({
              label: loaded.record.plan.label,
              kind: loaded.record.plan.kind,
              value: input.value,
            }).pipe(Effect.mapError(invalid)),
          );
          if (fingerprint !== loaded.record.fingerprint)
            return yield* new VaultMigrationError({ reason: "review-mismatch" });
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
            loaded = { record, revision: yield* save(record, loaded.revision) };
          }
          yield* core.save(
            {
              id: loaded.record.plan.itemId,
              operationId: loaded.record.plan.id,
              expectedVersion: 0,
              label: loaded.record.plan.label,
              kind: loaded.record.plan.kind,
              value: input.value,
            },
            loaded.record.appliedBy!,
            undefined,
            `migration:${input.id}`,
          );
          const record = {
            ...loaded.record,
            plan: { ...loaded.record.plan, state: "imported" as const },
          };
          yield* save(record, loaded.revision);
          return yield* view(record);
        }),
      );
    }),
    cancel: Effect.fn("VaultMigration.cancel")(function (id) {
      return lock.withPermit(
        Effect.gen(function* () {
          const loaded = yield* recover(yield* load(id));
          if (loaded.record.plan.state === "cancelled") return yield* view(loaded.record);
          if (loaded.record.plan.state !== "prepared") return yield* invalidState();
          const record = {
            ...loaded.record,
            plan: { ...loaded.record.plan, state: "cancelled" as const },
          };
          yield* save(record, loaded.revision);
          return yield* view(record);
        }),
      );
    }),
    archive: Effect.fn("VaultMigration.archive")(function (id, actor) {
      return lock.withPermit(
        Effect.gen(function* () {
          if (!actor.trim() || actor.length > 512) return yield* invalid();
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
          );
          const record = {
            ...loaded.record,
            plan: { ...loaded.record.plan, state: "archived" as const },
          };
          yield* save(record, loaded.revision);
          return yield* view(record);
        }),
      );
    }),
  });
});
export const layer = Layer.effect(VaultMigration, make);
