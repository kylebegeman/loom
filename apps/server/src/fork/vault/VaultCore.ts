import {
  VaultError,
  VaultItemSave,
  type VaultPrivateSave,
  VaultItemChange,
  VaultItemList,
  VaultItemReveal,
  type VaultItemValue,
  VaultItemSummary,
  type VaultCoreStatus,
  type VaultItemPage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import { decodePolicy, credentialUseRefusal } from "./AccessPolicy.ts";

export class VaultCore extends Context.Service<
  VaultCore,
  {
    readonly status: Effect.Effect<VaultCoreStatus>;
    readonly inspect: (id: string) => Effect.Effect<VaultItemSummary | null, VaultError>;
    readonly list: (input: VaultItemList) => Effect.Effect<VaultItemPage, VaultError>;
    readonly reveal: (input: VaultItemReveal) => Effect.Effect<VaultItemValue, VaultError>;
    readonly savedPrivate: (
      input: VaultPrivateSave,
      actorId: string,
    ) => Effect.Effect<VaultItemSummary | null, VaultError>;
    readonly save: (
      input: VaultItemSave,
      actorId: string,
      authorize?: Effect.Effect<void, VaultError>,
      sourceRef?: string,
    ) => Effect.Effect<VaultItemSummary, VaultError>;
    readonly change: (
      input: VaultItemChange,
      actorId: string,
      authorize?: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultItemSummary, VaultError>;
  }
>()("t3/fork/vault/VaultCore") {}

const StoredItem = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: VaultItemSummary.fields.id,
  label: VaultItemSummary.fields.label,
  kind: VaultItemSummary.fields.kind,
  state: VaultItemSummary.fields.state,
  value: Schema.RedactedFromValue(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  mutation: Schema.Struct({
    operationId: VaultItemSummary.fields.id,
    fingerprint: Schema.String,
    sourceRefFingerprint: Schema.NullOr(Schema.String),
    actorId: Schema.String,
    action: Schema.Literals(["save", "archive", "restore", "delete"]),
  }),
});
type StoredItem = typeof StoredItem.Type;
const decodeStored = Schema.decodeUnknownOption(StoredItem);
const encodeStored = Schema.encodeEffect(StoredItem);
const encodeSaveOperation = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ request: VaultItemSave, actorId: Schema.String })),
);
const encodeChangeOperation = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ request: VaultItemChange, actorId: Schema.String })),
);
const decodeSave = Schema.decodeUnknownOption(Schema.toType(VaultItemSave));
const decodeChange = Schema.decodeUnknownOption(Schema.toType(VaultItemChange));
const decodeReveal = Schema.decodeUnknownOption(VaultItemReveal);
const decodeList = Schema.decodeUnknownOption(VaultItemList);
const MAX_VALUE_BYTES = 1024 * 1024;
const PAGE_SIZE = 25;

const summary = (item: StoredItem, version: number): VaultItemSummary => ({
  id: item.id,
  label: item.label,
  kind: item.kind,
  state: item.state,
  version,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});
const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Crypto.Crypto;
  const environmentId = yield* identity.getEnvironmentId;
  const digest = (value: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
    );
  const namespace = yield* digest(environmentId);
  const prefix = `environments/${namespace}/items`;
  const load = Effect.fnUntraced(function* (id: string) {
    const stored = yield* store.read(`${prefix}/${id}`);
    if (stored === null) return null;
    const decoded = decodeStored(Redacted.value(stored.value));
    if (Option.isNone(decoded) || decoded.value.id !== id) {
      return yield* new VaultError({ reason: "invalid-response" });
    }
    return { item: decoded.value, version: stored.version };
  });
  const persist = Effect.fnUntraced(function* (item: StoredItem, expectedVersion: number) {
    const encoded = yield* encodeStored(item).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    const version = yield* store.write(
      `${prefix}/${item.id}`,
      Redacted.make(encoded),
      expectedVersion,
    );
    return summary(item, version);
  });
  return VaultCore.of({
    status: store.status,
    inspect: Effect.fn("VaultCore.inspect")(function* (id) {
      if (!/^[a-f0-9]{32}$/.test(id)) return yield* new VaultError({ reason: "invalid-input" });
      const record = yield* load(id);
      return record === null || record.item.state === "deleted"
        ? null
        : summary(record.item, record.version);
    }),
    savedPrivate: Effect.fn("VaultCore.savedPrivate")(function* (input, actorId) {
      const current = yield* load(input.id);
      if (current === null || current.item.mutation.operationId !== input.operationId) return null;
      const source = yield* digest(input.secretRef);
      if (
        current.item.mutation.sourceRefFingerprint !== source ||
        current.item.mutation.actorId !== actorId ||
        current.item.mutation.action !== "save" ||
        current.version !== input.expectedVersion + 1 ||
        current.item.label !== input.label.trim() ||
        current.item.kind !== input.kind
      ) {
        return yield* new VaultError({ reason: "conflict" });
      }
      return summary(current.item, current.version);
    }),
    reveal: Effect.fn("VaultCore.reveal")(function* (raw) {
      const decoded = decodeReveal(raw);
      if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-input" });
      const current = yield* load(decoded.value.id);
      if (current === null || current.item.state === "deleted")
        return yield* new VaultError({ reason: "not-found" });
      if (current.version !== decoded.value.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      // Admin reveal, probes and secret-decoding adapters bypass the thread evaluator. Until a
      // protected dispatcher exists, none may release a protected or unclassified credential.
      const storedPolicy = yield* store.read(`environments/${namespace}/access-policy`);
      if (storedPolicy) {
        const policy = decodePolicy(Redacted.value(storedPolicy.value));
        if (
          Option.isNone(policy) ||
          (policy.value.schemaVersion === 4 && policy.value.environmentId !== environmentId) ||
          (policy.value.ownerPolicy !== undefined &&
            policy.value.ownerPolicy.environmentId !== environmentId)
        )
          return yield* new VaultError({ reason: "invalid-response" });
        if (credentialUseRefusal(policy.value, decoded.value.id))
          return yield* new VaultError({ reason: "denied" });
      }
      return { item: summary(current.item, current.version), value: current.item.value };
    }),
    list: Effect.fn("VaultCore.list")(function* (raw) {
      const decoded = decodeList(raw);
      if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-input" });
      const input = decoded.value;
      const keys = [...(yield* store.keys(prefix))].sort();
      if (keys.some((key) => !/^[a-f0-9]{32}$/.test(key))) {
        return yield* new VaultError({ reason: "invalid-response" });
      }
      const remaining = keys.filter((id) => input.cursor === null || id > input.cursor);
      const page = remaining.slice(0, PAGE_SIZE);
      const records = yield* Effect.forEach(page, load, { concurrency: 4 });
      return {
        items: records.flatMap((record) =>
          record !== null &&
          record.item.state !== "deleted" &&
          (input.includeArchived || record.item.state === "active")
            ? [summary(record.item, record.version)]
            : [],
        ),
        nextCursor: remaining.length > page.length ? page[page.length - 1]! : null,
      };
    }),
    save: Effect.fn("VaultCore.save")(function* (raw, actorId, authorize, sourceRef) {
      const decoded = decodeSave(raw);
      if (Option.isNone(decoded) || !actorId.trim() || actorId.length > 512) {
        return yield* new VaultError({ reason: "invalid-input" });
      }
      const input = decoded.value;
      const value = input.value === undefined ? null : Redacted.value(input.value);
      if (value !== null && new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
        return yield* new VaultError({ reason: "invalid-input" });
      }
      const operation = yield* encodeSaveOperation({ request: input, actorId }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const fingerprint = yield* digest(operation);
      const current = yield* load(input.id);
      if (current?.item.mutation.operationId === input.operationId) {
        if (current.item.mutation.fingerprint !== fingerprint)
          return yield* new VaultError({ reason: "conflict" });
        return summary(current.item, current.version);
      }
      if ((current?.version ?? 0) !== input.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      if (current?.item.state === "deleted") return yield* new VaultError({ reason: "not-found" });
      if (current?.item.state === "archived") return yield* new VaultError({ reason: "archived" });
      const nextValue = input.value ?? current?.item.value;
      if (
        nextValue === undefined ||
        (input.value === undefined && current?.item.kind !== input.kind)
      ) {
        return yield* new VaultError({ reason: "invalid-input" });
      }
      const sourceRefFingerprint = sourceRef === undefined ? null : yield* digest(sourceRef);
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* authorize ?? Effect.void;
      return yield* persist(
        {
          schemaVersion: 1,
          id: input.id,
          label: input.label.trim(),
          kind: input.kind,
          state: "active",
          value: nextValue,
          createdAt: current?.item.createdAt ?? now,
          updatedAt: now,
          mutation: {
            operationId: input.operationId,
            fingerprint,
            sourceRefFingerprint,
            actorId,
            action: "save",
          },
        },
        input.expectedVersion,
      );
    }),
    change: Effect.fn("VaultCore.change")(function* (raw, actorId, authorize) {
      const decoded = decodeChange(raw);
      if (Option.isNone(decoded) || !actorId.trim() || actorId.length > 512) {
        return yield* new VaultError({ reason: "invalid-input" });
      }
      const input = decoded.value;
      const operation = yield* encodeChangeOperation({ request: input, actorId }).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const fingerprint = yield* digest(operation);
      const current = yield* load(input.id);
      if (current === null) return yield* new VaultError({ reason: "not-found" });
      if (current.item.mutation.operationId === input.operationId) {
        if (current.item.mutation.fingerprint !== fingerprint)
          return yield* new VaultError({ reason: "conflict" });
        return summary(current.item, current.version);
      }
      if (current.version !== input.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      if (current.item.state === "deleted") return yield* new VaultError({ reason: "not-found" });
      const state =
        input.action === "archive" ? "archived" : input.action === "restore" ? "active" : "deleted";
      yield* authorize ?? Effect.void;
      return yield* persist(
        {
          ...current.item,
          state,
          value: state === "deleted" ? Redacted.make("") : current.item.value,
          updatedAt: DateTime.formatIso(yield* DateTime.now),
          mutation: {
            operationId: input.operationId,
            fingerprint,
            sourceRefFingerprint: null,
            actorId,
            action: input.action,
          },
        },
        input.expectedVersion,
      );
    }),
  });
});
export const layer = Layer.effect(VaultCore, make);
