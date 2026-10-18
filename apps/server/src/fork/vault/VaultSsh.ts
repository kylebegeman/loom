import {
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultSshTarget,
  VaultSshPublicKey,
  VaultSshGenerate,
  VaultSshTrust,
  VaultSshExecute,
  type VaultSshInfo,
  type VaultSshResult,
  VaultItemId,
  vaultSshDestination,
  vaultSshCommandMessage,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as VaultCore from "./VaultCore.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import * as SshCrypto from "./SshCrypto.ts";
import * as SshTransport from "./SshTransport.ts";

type Failure = VaultError | VaultSshError | VaultWorkloadError;
export class VaultSsh extends Context.Service<
  VaultSsh,
  {
    readonly generate: (
      input: VaultSshGenerate,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultSshInfo, Failure>;
    readonly info: (id: string) => Effect.Effect<VaultSshInfo, Failure>;
    readonly trust: (
      input: VaultSshTrust,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultSshInfo, Failure>;
    readonly execute: (input: VaultSshExecute) => Effect.Effect<VaultSshResult, Failure>;
  }
>()("t3/fork/vault/VaultSsh") {}
const StoredKey = Schema.Struct({
  protocol: Schema.Literal(1),
  privateKey: Schema.RedactedFromValue(Schema.String),
  publicKey: VaultSshPublicKey,
  target: VaultSshTarget,
  generationOperationId: VaultItemId,
  trustOperationId: Schema.NullOr(VaultItemId),
});
const decodeKey = Schema.decodeEffect(Schema.fromJsonString(StoredKey));
const encodeKey = Schema.encodeEffect(Schema.fromJsonString(StoredKey));
const isGenerate = Schema.is(VaultSshGenerate),
  isTrust = Schema.is(VaultSshTrust),
  isExecute = Schema.is(VaultSshExecute);
const invalid = () => new VaultSshError({ reason: "invalid-key" });
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore,
    keys = yield* SshCrypto.SshCrypto,
    workloads = yield* VaultWorkloads.VaultWorkloads,
    transport = yield* SshTransport.SshTransport,
    crypto = yield* Crypto.Crypto;
  const active = yield* Ref.make(0);
  const load = Effect.fnUntraced(function* (id: string) {
    const item = yield* core.inspect(id);
    if (!item) return yield* new VaultError({ reason: "not-found" });
    if (item.kind !== "ssh-key") return yield* invalid();
    const value = yield* core.reveal({ id, expectedVersion: item.version });
    const key = yield* decodeKey(Redacted.value(value.value)).pipe(Effect.mapError(invalid));
    if ((yield* keys.publicKey(key.privateKey)) !== key.publicKey) return yield* invalid();
    if (key.target.hostKey) yield* keys.fingerprint(key.target.hostKey);
    return { item, key };
  });
  const info = Effect.fnUntraced(function* (record: Effect.Success<ReturnType<typeof load>>) {
    return {
      item: record.item,
      target: record.key.target,
      publicKey: record.key.publicKey,
      fingerprint: yield* keys.fingerprint(record.key.publicKey),
      hostFingerprint: record.key.target.hostKey
        ? yield* keys.fingerprint(record.key.target.hostKey)
        : null,
      destination: vaultSshDestination(record.key.target),
    };
  });
  return VaultSsh.of({
    info: Effect.fn("VaultSsh.info")(function* (id) {
      return yield* info(yield* load(id));
    }),
    generate: Effect.fn("VaultSsh.generate")(function* (input, actor, authorize) {
      if (!isGenerate(input)) return yield* invalid();
      yield* authorize;
      if (input.target.hostKey) yield* keys.fingerprint(input.target.hostKey);
      if (yield* core.inspect(input.id)) {
        const record = yield* load(input.id);
        if (
          record.item.state !== "active" ||
          record.key.generationOperationId !== input.operationId ||
          record.item.label !== input.label.trim() ||
          record.key.target.hostname !== input.target.hostname ||
          record.key.target.username !== input.target.username ||
          record.key.target.port !== input.target.port ||
          record.key.target.hostKey !== input.target.hostKey
        )
          return yield* new VaultError({ reason: "conflict" });
        return yield* info(record);
      }
      const key = {
        ...(yield* keys.create),
        protocol: 1 as const,
        target: input.target,
        generationOperationId: input.operationId,
        trustOperationId: null,
      };
      const value = yield* encodeKey(key).pipe(Effect.mapError(invalid));
      const item = yield* core.save(
        {
          id: input.id,
          operationId: input.operationId,
          expectedVersion: 0,
          label: input.label,
          kind: "ssh-key",
          value: Redacted.make(value),
        },
        actor,
        authorize,
      );
      return yield* info({ item, key });
    }),
    trust: Effect.fn("VaultSsh.trust")(function* (input, actor, authorize) {
      if (!isTrust(input)) return yield* invalid();
      yield* authorize;
      if (input.hostKey) yield* keys.fingerprint(input.hostKey);
      const record = yield* load(input.id);
      if (record.item.state !== "active") return yield* new VaultError({ reason: "archived" });
      if (
        record.key.trustOperationId === input.operationId &&
        record.item.version === input.expectedVersion + 1 &&
        record.key.target.hostKey === input.hostKey
      )
        return yield* info(record);
      if (record.item.version !== input.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      const key = {
        ...record.key,
        target: { ...record.key.target, hostKey: input.hostKey },
        trustOperationId: input.operationId,
      };
      const value = yield* encodeKey(key).pipe(Effect.mapError(invalid));
      const item = yield* core.save(
        {
          id: input.id,
          operationId: input.operationId,
          expectedVersion: input.expectedVersion,
          label: record.item.label,
          kind: "ssh-key",
          value: Redacted.make(value),
        },
        actor,
        authorize,
      );
      return yield* info({ item, key });
    }),
    execute: Effect.fn("VaultSsh.execute")(function* (input) {
      if (
        !isExecute(input) ||
        new TextEncoder().encode(vaultSshCommandMessage(input.command)).length > 8192
      )
        return yield* new VaultSshError({ reason: "invalid-operation" });
      const digest = yield* crypto
        .digest("SHA-256", new TextEncoder().encode(vaultSshCommandMessage(input.command)))
        .pipe(
          Effect.map(Hex.encode),
          Effect.mapError(() => new VaultSshError({ reason: "failed" })),
        );
      const session = yield* workloads.acceptSsh(input.proof, digest);
      const record = yield* load(session.itemId);
      if (
        record.item.state !== "active" ||
        record.item.version !== input.command.expectedVersion ||
        vaultSshDestination(record.key.target) !== session.destination
      )
        return yield* new VaultSshError({ reason: "invalid-operation" });
      if (!record.key.target.hostKey) return yield* new VaultSshError({ reason: "untrusted-host" });
      const authorize = Effect.gen(function* () {
        yield* workloads.revalidate(session);
        const current = yield* core.inspect(session.itemId);
        if (
          !current ||
          current.state !== "active" ||
          current.version !== input.command.expectedVersion
        )
          return yield* new VaultError({ reason: "conflict" });
      });
      const result = yield* Effect.acquireUseRelease(
        Ref.modify(active, (count) =>
          count < 4 ? ([true, count + 1] as const) : ([false, count] as const),
        ).pipe(
          Effect.flatMap((ok) =>
            ok ? Effect.void : Effect.fail(new VaultSshError({ reason: "capacity" })),
          ),
        ),
        () =>
          transport.execute({
            target: record.key.target,
            publicKey: record.key.publicKey,
            privateKey: record.key.privateKey,
            command: input.command,
            authorize,
          }),
        () => Ref.update(active, (count) => count - 1),
      );
      return { sessionId: session.id, requestId: input.proof.challenge.requestId, ...result };
    }),
  });
});
export const layer = Layer.effect(VaultSsh, make);
