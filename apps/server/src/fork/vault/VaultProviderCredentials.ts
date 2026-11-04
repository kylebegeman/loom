import {
  ProviderInstanceEnvironmentVariableName,
  ProviderInstanceId,
  type SecretReference,
} from "@t3tools/contracts";
import { VaultError, vaultProviderBinding, type VaultAuditEvent } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Settings from "../../serverSettings.ts";
import { credentialUseRefusal, decodePolicy, encodePolicy, type Policy } from "./AccessPolicy.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";

const Consumer = Schema.Struct({
  instanceId: ProviderInstanceId,
  variableName: ProviderInstanceEnvironmentVariableName,
});
type Consumer = typeof Consumer.Type;
const isConsumer = Schema.is(Consumer);
const EMPTY_POLICY: Policy = {
  schemaVersion: 1,
  revision: 0,
  grants: [],
  audit: [],
  omittedAuditEvents: 0,
  receipts: [],
};
const MAX_AUDIT_EVENTS = 256;
const MAX_AUDIT_ATTEMPTS = 4;

export class VaultProviderCredentials extends Context.Service<
  VaultProviderCredentials,
  {
    readonly read: (
      reference: SecretReference,
      consumer: Consumer,
    ) => Effect.Effect<Redacted.Redacted<string>, VaultError>;
    readonly validate: (
      reference: SecretReference,
      consumer: Consumer,
    ) => Effect.Effect<void, VaultError>;
  }
>()("t3/fork/vault/VaultProviderCredentials") {}

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const core = yield* VaultCore.VaultCore;
  const store = yield* OpenBaoStore.OpenBaoStore;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Digest.Digest,
    secureRandom = yield* SecureRandom.SecureRandom;
  const environmentId = yield* identity.getEnvironmentId;
  const namespace = Hex.encode(
    yield* crypto.digest(Digest.sha256, new TextEncoder().encode(environmentId)).pipe(
      Effect.mapError(() => new VaultError({ reason: "unavailable" })),
      Effect.orDie,
    ),
  );
  const policyPath = `environments/${namespace}/access-policy`;
  const requireBinding = (reference: SecretReference, consumer: Consumer) =>
    settings
      .withSettingsSnapshot((current) => {
        const variables = current.providerInstances[consumer.instanceId]?.environment ?? [];
        const matching = variables.filter((variable) => variable.name === consumer.variableName);
        const saved = matching[0]?.value;
        return matching.length === 1 &&
          typeof saved === "object" &&
          saved.provider === reference.provider &&
          saved.reference === reference.reference
          ? Effect.void
          : Effect.fail(new VaultError({ reason: "denied" }));
      })
      .pipe(
        Effect.catchTags({
          ServerSettingsError: () => Effect.fail(new VaultError({ reason: "unavailable" })),
        }),
      );
  const bind = Effect.fn("VaultProviderCredentials.bind")(function* (
    reference: SecretReference,
    consumer: Consumer,
  ) {
    const binding = vaultProviderBinding(reference);
    if (binding === null || !isConsumer(consumer))
      return yield* new VaultError({ reason: "invalid-input" });
    if (binding.environmentId !== environmentId) return yield* new VaultError({ reason: "denied" });
    yield* requireBinding(reference, consumer);
    return binding;
  });
  const authorize = Effect.fn("VaultProviderCredentials.authorize")(function* (
    binding: NonNullable<ReturnType<typeof vaultProviderBinding>>,
  ) {
    const stored = yield* store.read(policyPath);
    const decoded =
      stored === null ? Option.some(EMPTY_POLICY) : decodePolicy(Redacted.value(stored.value));
    if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-response" });
    const policy = decoded.value;
    if (
      (policy.schemaVersion === 4 && policy.environmentId !== environmentId) ||
      (policy.ownerPolicy !== undefined && policy.ownerPolicy.environmentId !== environmentId)
    )
      return yield* new VaultError({ reason: "invalid-response" });
    if (credentialUseRefusal(policy, binding.itemId))
      return yield* new VaultError({ reason: "denied" });
    const item = yield* core.inspect(binding.itemId);
    if (item === null) return yield* new VaultError({ reason: "not-found" });
    if (item.kind !== "secret" || item.state !== "active")
      return yield* new VaultError({ reason: "denied" });
    if (item.version !== binding.expectedVersion)
      return yield* new VaultError({ reason: "conflict" });
    return { stored, policy };
  });
  const read = Effect.fn("VaultProviderCredentials.read")(function* (
    reference: SecretReference,
    consumer: Consumer,
  ) {
    const binding = yield* bind(reference, consumer);
    for (let attempt = 0; attempt < MAX_AUDIT_ATTEMPTS; attempt++) {
      const { stored, policy } = yield* authorize(binding);
      const value = yield* core.reveal(
        { id: binding.itemId, expectedVersion: binding.expectedVersion },
        stored === null ? null : policy,
      );
      if (value.item.kind !== "secret" || value.item.state !== "active")
        return yield* new VaultError({ reason: "denied" });
      const event: VaultAuditEvent = {
        id: (yield* secureRandom
          .uuidV4()
          .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })))).replaceAll(
          "-",
          "",
        ),
        at: yield* Clock.currentTimeMillis,
        actor: `provider:${consumer.instanceId}`,
        type: "decision",
        itemId: binding.itemId,
        grantId: null,
        action: "use",
        reason: `Application binding for environment variable ${consumer.variableName}, item version ${binding.expectedVersion}`,
        policyRevision: policy.revision,
      };
      const encoded = yield* encodePolicy({
        ...policy,
        audit: [...policy.audit, event].slice(-MAX_AUDIT_EVENTS),
        omittedAuditEvents:
          policy.omittedAuditEvents + (policy.audit.length === MAX_AUDIT_EVENTS ? 1 : 0),
      }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" })));
      // The policy CAS commits this use; a concurrent protection change restarts authorization.
      const persisted = yield* store
        .write(policyPath, Redacted.make(encoded), stored?.version ?? 0)
        .pipe(Effect.result);
      if (persisted._tag === "Failure") {
        if (persisted.failure.reason === "conflict") continue;
        return yield* persisted.failure;
      }
      const currentItem = yield* core.inspect(binding.itemId);
      if (currentItem === null) return yield* new VaultError({ reason: "not-found" });
      if (currentItem.state !== "active" || currentItem.kind !== "secret")
        return yield* new VaultError({ reason: "denied" });
      if (currentItem.version !== binding.expectedVersion)
        return yield* new VaultError({ reason: "conflict" });
      yield* requireBinding(reference, consumer);
      return value.value;
    }
    // Busy policy writes, not a changed item: "conflict" would send the user to rebind.
    return yield* new VaultError({ reason: "unavailable" });
  });
  return VaultProviderCredentials.of({
    read,
    // Guards check on every spawn and probe; only a released value is a durable "use".
    validate: Effect.fn("VaultProviderCredentials.validate")(function* (reference, consumer) {
      yield* authorize(yield* bind(reference, consumer));
    }),
  });
});

export const layer = Layer.effect(VaultProviderCredentials, make);
