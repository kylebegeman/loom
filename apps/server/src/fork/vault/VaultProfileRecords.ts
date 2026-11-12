import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  AccountProfileRecordRequest,
  type AccountProfileRecordResponse,
  VaultProfileRecordValue,
  VaultError,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as MachineClient from "./AccountVaultMachineClient.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import { decodePolicy } from "./AccessPolicy.ts";
import { encodeRunKey } from "./profile-records.ts";

type Stored = { readonly value: Redacted.Redacted<unknown>; readonly version: number };
type RecordRequest = Exclude<AccountProfileRecordRequest, { readonly kind: "preview" }>;
const decode = Schema.decodeUnknownEffect(VaultProfileRecordValue, { onExcessProperty: "error" });
const encode = Schema.encodeEffect(VaultProfileRecordValue);
const isRequest = Schema.is(AccountProfileRecordRequest);
const failed = (reason: VaultError["reason"]) => new VaultError({ reason });

export class VaultProfileRecords extends Context.Service<
  VaultProfileRecords,
  {
    readonly read: (projectId: ProjectId, key: string) => Effect.Effect<Stored | null, VaultError>;
    readonly write: (
      projectId: ProjectId,
      key: string,
      value: Redacted.Redacted<unknown>,
      expectedVersion: number,
    ) => Effect.Effect<number, VaultError>;
    readonly keys: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<string>, VaultError>;
    readonly forAccount: (
      input: RecordRequest,
      sourceEnvironmentId: EnvironmentId,
      ownerSubject: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<AccountProfileRecordResponse, VaultError>;
  }
>()("t3/fork/vault/VaultProfileRecords") {}

const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Digest.Digest;
  const client = yield* Effect.serviceOption(MachineClient.AccountVaultMachineClient);
  const inventoryId = store.inventoryEnvironmentId ?? (yield* identity.getEnvironmentId);
  const hash = Effect.fn("VaultProfileRecords.hash")(function* (value: string) {
    return Hex.encode(
      yield* crypto
        .digest(Digest.sha256, new TextEncoder().encode(value))
        .pipe(Effect.mapError(() => failed("unavailable"))),
    );
  });
  const root = Effect.fn("VaultProfileRecords.root")(function* (
    environmentId: string,
    projectId: ProjectId,
  ) {
    return `environments/${yield* hash(environmentId)}/profiles/${yield* hash(projectId)}`;
  });
  const policyPath = `environments/${yield* hash(inventoryId)}/access-policy`;
  const remote = Option.isSome(client) ? client.value.available : Effect.succeed(false);
  const request = (input: AccountProfileRecordRequest) =>
    Option.isSome(client) ? client.value.profileRecord(input) : Effect.fail(failed("unavailable"));
  const validate = Effect.fn("VaultProfileRecords.validate")(function* (
    value: typeof VaultProfileRecordValue.Type,
    input: Exclude<RecordRequest, { readonly kind: "keys" }>,
    sourceEnvironmentId: EnvironmentId,
  ) {
    if (input.key === "registry") {
      if (
        !("profiles" in value) ||
        new Set(value.profiles.map((profile) => profile.id)).size !== value.profiles.length ||
        (value.activeProfileId !== null &&
          !value.profiles.some(
            (profile) => profile.id === value.activeProfileId && profile.state === "active",
          ))
      )
        return yield* failed("invalid-input");
      return;
    }
    if (
      "profiles" in value ||
      value.environmentId !== sourceEnvironmentId ||
      (value.schemaVersion === 1 ? value.resolution.projectId : value.projectId) !== input.projectId
    )
      return yield* failed("invalid-input");
    const digest = yield* hash(
      yield* encodeRunKey({ threadId: value.threadId, runId: value.runId }).pipe(
        Effect.mapError(() => failed("invalid-input")),
      ),
    );
    if (input.key !== `runs/${digest}`) return yield* failed("invalid-input");
  });
  return VaultProfileRecords.of({
    read: Effect.fn("VaultProfileRecords.read")(function* (projectId, key) {
      const input = { kind: "read" as const, projectId, key };
      if (!isRequest(input)) return yield* failed("invalid-input");
      if (yield* remote) {
        const response = yield* request(input);
        if (response.kind !== "read") return yield* failed("invalid-response");
        return response.record === null
          ? null
          : { value: Redacted.make(response.record.value), version: response.record.version };
      }
      return yield* store.read(`${yield* root(inventoryId, projectId)}/${key}`);
    }),
    write: Effect.fn("VaultProfileRecords.write")(
      function* (projectId, key, value, expectedVersion) {
        if (yield* remote) {
          const decoded = yield* decode(Redacted.value(value)).pipe(
            Effect.mapError(() => failed("invalid-input")),
          );
          const input = { kind: "write" as const, projectId, key, value: decoded, expectedVersion };
          if (!isRequest(input)) return yield* failed("invalid-input");
          const response = yield* request(input);
          if (response.kind !== "write") return yield* failed("invalid-response");
          return response.version;
        }
        if (!isRequest({ kind: "read", projectId, key })) return yield* failed("invalid-input");
        return yield* store.write(
          `${yield* root(inventoryId, projectId)}/${key}`,
          value,
          expectedVersion,
        );
      },
    ),
    keys: Effect.fn("VaultProfileRecords.keys")(function* (projectId) {
      if (yield* remote) {
        const response = yield* request({ kind: "keys", projectId });
        if (response.kind !== "keys") return yield* failed("invalid-response");
        return response.keys;
      }
      return yield* store.keys(`${yield* root(inventoryId, projectId)}/runs`);
    }),
    forAccount: Effect.fn("VaultProfileRecords.forAccount")(
      function* (input, sourceEnvironmentId, ownerSubject, authorize) {
        if (!isRequest(input)) return yield* failed("invalid-input");
        const guard = Effect.gen(function* () {
          yield* authorize;
          const stored = yield* store.read(policyPath);
          const policy = stored ? decodePolicy(Redacted.value(stored.value)) : Option.none();
          if (
            Option.isNone(policy) ||
            policy.value.ownerPolicy?.environmentId !== inventoryId ||
            policy.value.ownerPolicy?.ownerSubject !== ownerSubject ||
            policy.value.ownerPolicy.mode !== "owner-trusted"
          )
            return yield* failed("denied");
        });
        yield* guard;
        const base =
          sourceEnvironmentId === inventoryId
            ? yield* root(inventoryId, input.projectId)
            : `environments/${yield* hash(inventoryId)}/profiles/_computers/${yield* hash(sourceEnvironmentId)}/${yield* hash(input.projectId)}`;
        if (input.kind === "keys") {
          const keys = yield* store.keys(`${base}/runs`);
          if (keys.some((key) => !/^[a-f0-9]{64}$/u.test(key)))
            return yield* failed("invalid-response");
          yield* guard;
          return { kind: "keys", keys };
        }
        const path = `${base}/${input.key}`;
        if (input.kind === "read") {
          const stored = yield* store.read(path);
          if (stored === null) return { kind: "read", record: null };
          const value = yield* decode(Redacted.value(stored.value)).pipe(
            Effect.mapError(() => failed("invalid-response")),
          );
          yield* validate(value, input, sourceEnvironmentId).pipe(
            Effect.mapError(() => failed("invalid-response")),
          );
          yield* guard;
          return { kind: "read", record: { value, version: stored.version } };
        }
        yield* validate(input.value, input, sourceEnvironmentId);
        const value = yield* encode(input.value).pipe(
          Effect.mapError(() => failed("invalid-input")),
        );
        yield* guard;
        const version = yield* store.write(path, Redacted.make(value), input.expectedVersion);
        yield* guard;
        return { kind: "write", version };
      },
    ),
  });
});
export const layer = Layer.effect(VaultProfileRecords, make);
