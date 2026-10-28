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
  vaultReferenceText,
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
import { decodePolicy, credentialUseRefusal, type Policy } from "./AccessPolicy.ts";

export class VaultCore extends Context.Service<
  VaultCore,
  {
    readonly status: Effect.Effect<VaultCoreStatus>;
    readonly inspect: (id: string) => Effect.Effect<VaultItemSummary | null, VaultError>;
    readonly list: (input: VaultItemList) => Effect.Effect<VaultItemPage, VaultError>;
    /**
     * `accessPolicy` is the access policy this call has already read and validated, or `null`
     * when it found none, and the caller's next write is conditional on that read's version.
     * Omit it to read the policy here.
     */
    readonly reveal: (
      input: VaultItemReveal,
      accessPolicy?: Policy | null,
    ) => Effect.Effect<VaultItemValue, VaultError>;
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
  const accessPolicy = Effect.fnUntraced(function* () {
    const stored = yield* store.read(`environments/${namespace}/access-policy`);
    if (stored === null) return null;
    const policy = decodePolicy(Redacted.value(stored.value));
    if (
      Option.isNone(policy) ||
      (policy.value.schemaVersion === 4 && policy.value.environmentId !== environmentId) ||
      (policy.value.ownerPolicy !== undefined &&
        policy.value.ownerPolicy.environmentId !== environmentId)
    )
      return yield* new VaultError({ reason: "invalid-response" });
    return policy.value;
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
    reveal: Effect.fn("VaultCore.reveal")(function* (raw, known) {
      const decoded = decodeReveal(raw);
      if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-input" });
      const current = yield* load(decoded.value.id);
      if (current === null || current.item.state === "deleted")
        return yield* new VaultError({ reason: "not-found" });
      if (current.version !== decoded.value.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      // Admin reveal, probes and decoding adapters bypass the thread evaluator, so none may release
      // a protected or unclassified credential. A caller that already read the policy passes it,
      // and its own write must be conditional on that read's version.
      const policy = known === undefined ? yield* accessPolicy() : known;
      if (policy !== null && credentialUseRefusal(policy, decoded.value.id))
        return yield* new VaultError({ reason: "denied" });
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
      const records = yield* Effect.forEach(keys, load, { concurrency: 4 });
      const query = input.query?.trim().toLocaleLowerCase() ?? "";
      const summaries = records.flatMap((record) =>
        record === null ? [] : [summary(record.item, record.version)],
      );
      const matches = summaries.filter(
        (item) =>
          item.state !== "deleted" &&
          (input.kind === undefined || item.kind === input.kind) &&
          (query.startsWith("loom-vault:")
            ? vaultReferenceText(environmentId, item.id).toLocaleLowerCase().startsWith(query)
            : [item.label, item.kind, item.id].some((value) =>
                value.toLocaleLowerCase().includes(query),
              )),
      );
      const compare = (left: VaultItemSummary, right: VaultItemSummary) => {
        if (input.sort === undefined) return left.id.localeCompare(right.id);
        const updated =
          input.sort === "updated" ? right.updatedAt.localeCompare(left.updatedAt) : 0;
        return (
          updated ||
          left.label.localeCompare(right.label, undefined, {
            sensitivity: "base",
            numeric: true,
          }) ||
          left.id.localeCompare(right.id)
        );
      };
      const items = matches
        .filter((item) => input.includeArchived || item.state === "active")
        .sort(compare);
      const cursor = input.cursor;
      let remaining = items;
      if (cursor !== null) {
        if (input.sort === undefined) remaining = items.filter((item) => item.id > cursor);
        else {
          const previous = summaries.find((item) => item.id === cursor);
          if (!previous) return yield* new VaultError({ reason: "invalid-input" });
          remaining = items.filter((item) => compare(item, previous) > 0);
        }
      }
      const page = remaining.slice(0, PAGE_SIZE);
      return {
        items: page,
        nextCursor: remaining.length > page.length ? page[page.length - 1]!.id : null,
        ...(input.query !== undefined || input.kind !== undefined || input.sort !== undefined
          ? { archivedCount: matches.filter((item) => item.state === "archived").length }
          : {}),
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
