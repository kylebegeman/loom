import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type SecretReference,
} from "@t3tools/contracts";
import { VaultError, vaultProviderReference, type VaultItemKind } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Settings from "../../serverSettings.ts";
import { decodePolicy, type Policy } from "./AccessPolicy.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultProviderCredentials from "./VaultProviderCredentials.ts";

const environmentId = EnvironmentId.make("provider-vault-environment");
const itemId = "a".repeat(32);
const consumer = { instanceId: ProviderInstanceId.make("claudeWork"), variableName: "API_KEY" };
const reference = vaultProviderReference({ environmentId, itemId, expectedVersion: 1 });
const privateValue = "synthetic-provider-credential";

const fixture = () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = {
    failAudit: false,
    auditConflicts: 0,
    policyWrites: 0,
    replacementPolicy: null as Policy | null,
    readBarrier: null as {
      entered: Deferred.Deferred<void>;
      release: Deferred.Deferred<void>;
    } | null,
  };
  const store = OpenBaoStore.OpenBaoStore.of({
    status: Effect.succeed({
      backend: "openbao",
      state: "ready",
      origin: "https://bao.example.test",
    }),
    read: (key) =>
      Effect.gen(function* () {
        const barrier = key.endsWith("/access-policy") ? state.readBarrier : null;
        if (barrier !== null) {
          state.readBarrier = null;
          yield* Deferred.succeed(barrier.entered, undefined);
          yield* Deferred.await(barrier.release);
        }
        return records.get(key) ?? null;
      }),
    keys: () => Effect.succeed([]),
    write: (key, value, expectedVersion) =>
      Effect.suspend(() => {
        if (key.endsWith("/access-policy")) {
          if (state.replacementPolicy !== null) {
            records.set(key, {
              value: Redacted.make(state.replacementPolicy),
              version: (records.get(key)?.version ?? 0) + 1,
            });
            state.replacementPolicy = null;
            return Effect.fail(new VaultError({ reason: "conflict" }));
          }
          if (state.failAudit) return Effect.fail(new VaultError({ reason: "unavailable" }));
          if (state.auditConflicts > 0) {
            state.auditConflicts--;
            return Effect.fail(new VaultError({ reason: "conflict" }));
          }
          state.policyWrites++;
        }
        const current = records.get(key)?.version ?? 0;
        if (current !== expectedVersion) return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(key, { value, version: current + 1 });
        return Effect.succeed(current + 1);
      }),
  });
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(OpenBaoStore.OpenBaoStore, store),
    Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
    Settings.ServerSettingsService.layerTest({
      providerInstances: {
        [consumer.instanceId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          environment: [{ name: consumer.variableName, value: reference, sensitive: true }],
        },
      },
    }),
  );
  const coreLayer = VaultCore.layer.pipe(Layer.provideMerge(dependencies));
  const layer = VaultProviderCredentials.layer.pipe(Layer.provideMerge(coreLayer));
  const use = <A, E>(
    run: (context: {
      service: VaultProviderCredentials.VaultProviderCredentials["Service"];
      core: VaultCore.VaultCore["Service"];
      settings: Settings.ServerSettingsService["Service"];
      policyPath: string;
    }) => Effect.Effect<A, E>,
    kind: VaultItemKind = "secret",
  ) =>
    Effect.gen(function* () {
      const service = yield* VaultProviderCredentials.VaultProviderCredentials;
      const core = yield* VaultCore.VaultCore;
      const settings = yield* Settings.ServerSettingsService;
      yield* core.save(
        {
          id: itemId,
          operationId: "b".repeat(32),
          expectedVersion: 0,
          label: "Provider API key",
          kind,
          value: Redacted.make(privateValue),
        },
        "human-owner",
      );
      const itemPath = [...records.keys()].find((key) => key.endsWith(`/items/${itemId}`))!;
      const policyPath = itemPath.slice(0, itemPath.indexOf("/items/")) + "/access-policy";
      return yield* run({ service, core, settings, policyPath });
    }).pipe(Effect.provide(layer));
  return { records, state, use };
};

it.effect("releases a saved application binding only after durable safe audit", () => {
  const f = fixture();
  return f.use(({ service, policyPath }) =>
    Effect.gen(function* () {
      const value = yield* service.read(reference, consumer);
      expect(Redacted.value(value)).toBe(privateValue);
      expect(String(value)).not.toContain(privateValue);
      const stored = Redacted.value(f.records.get(policyPath)!.value);
      const decoded = decodePolicy(stored);
      expect(Option.isSome(decoded)).toBe(true);
      if (Option.isNone(decoded)) return;
      expect(decoded.value.audit).toHaveLength(1);
      expect(decoded.value.audit[0]).toMatchObject({
        actor: `provider:${consumer.instanceId}`,
        itemId,
        action: "use",
      });
      expect(JSON.stringify(stored)).toContain(consumer.variableName);
      expect(JSON.stringify(stored)).not.toContain(privateValue);
      expect(f.state.policyWrites).toBe(1);
    }),
  );
});

it.effect.each([
  [
    "other environment",
    {
      ...reference,
      reference: vaultProviderReference({
        environmentId: EnvironmentId.make("another-environment"),
        itemId,
        expectedVersion: 1,
      }).reference,
    },
    "denied",
  ],
  [
    "changed version",
    vaultProviderReference({ environmentId, itemId, expectedVersion: 2 }),
    "denied",
  ],
  ["invalid reference", { ...reference, reference: "invalid-reference" }, "invalid-input"],
] as const)("refuses %s without disclosure", ([_name, candidate, reason]) => {
  const f = fixture();
  return f.use(({ service }) =>
    Effect.gen(function* () {
      expect(
        (yield* service.read(candidate as SecretReference, consumer).pipe(Effect.flip)).reason,
      ).toBe(reason);
      expect(f.state.policyWrites).toBe(0);
    }),
  );
});

it.effect.each(["account", "secure-note", "secure-file", "ssh-key", "service-connection"] as const)(
  "refuses %s items for provider environment delivery",
  (kind) => {
    const f = fixture();
    return f.use(
      ({ service }) =>
        Effect.gen(function* () {
          expect((yield* service.read(reference, consumer).pipe(Effect.flip)).reason).toBe(
            "denied",
          );
          expect(f.state.policyWrites).toBe(0);
        }),
      kind,
    );
  },
);

it.effect.each(["archive", "delete", "replace"] as const)(
  "refuses a binding after item %s",
  (operation) => {
    const f = fixture();
    return f.use(({ service, core }) =>
      Effect.gen(function* () {
        yield* service.validate(reference, consumer);
        if (operation === "replace") {
          yield* core.save(
            {
              id: itemId,
              operationId: "c".repeat(32),
              expectedVersion: 1,
              label: "Provider API key",
              kind: "secret",
              value: Redacted.make("rotated-synthetic-key"),
            },
            "human-owner",
          );
        } else {
          yield* core.change(
            { id: itemId, operationId: "c".repeat(32), expectedVersion: 1, action: operation },
            "human-owner",
          );
        }
        const failure = yield* service.validate(reference, consumer).pipe(Effect.flip);
        expect(failure.reason).toBe(
          operation === "replace" ? "conflict" : operation === "delete" ? "not-found" : "denied",
        );
        expect(f.state.policyWrites).toBe(1);
      }),
    );
  },
);

it.effect("checks saved binding and variable consumer on every use", () => {
  const f = fixture();
  return f.use(({ service, settings }) =>
    Effect.gen(function* () {
      yield* service.validate(reference, consumer);
      expect(
        (yield* service
          .read(reference, { ...consumer, variableName: "OTHER_KEY" })
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      yield* settings.updateProviderInstance({
        operation: "upsert",
        instanceId: consumer.instanceId,
        instance: { driver: ProviderDriverKind.make("claudeAgent"), environment: [] },
      });
      expect((yield* service.validate(reference, consumer).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect(f.state.policyWrites).toBe(1);
    }),
  );
});

it.effect.each(["protected", "unclassified", "unknown-format", "wrong-environment"] as const)(
  "refuses %s policy before delivery",
  (mode) => {
    const f = fixture();
    return f.use(({ service, policyPath }) =>
      Effect.gen(function* () {
        const policy = {
          schemaVersion: mode === "unknown-format" ? 99 : 4,
          revision: 1,
          environmentId: mode === "wrong-environment" ? "another-environment" : environmentId,
          grants: [],
          audit: [],
          omittedAuditEvents: 0,
          receipts: [],
          intents: [],
          credentialModes:
            mode === "unclassified"
              ? []
              : [{ itemId, mode: "one-time", revision: 1, updatedBy: "human-owner", updatedAt: 0 }],
        };
        f.records.set(policyPath, { value: Redacted.make(policy), version: 1 });
        const result = yield* service.read(reference, consumer).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(f.state.policyWrites).toBe(0);
      }),
    );
  },
);

it.effect("preserves owner and ordinary protection policy through audited use", () => {
  const f = fixture();
  return f.use(({ service, policyPath }) =>
    Effect.gen(function* () {
      const policy: Policy = {
        schemaVersion: 4,
        environmentId,
        revision: 2,
        grants: [],
        audit: [],
        omittedAuditEvents: 0,
        receipts: [],
        intents: [],
        credentialModes: [
          { itemId, mode: "ordinary", revision: 1, updatedBy: "human-owner", updatedAt: 0 },
        ],
      };
      const ownerPolicy = {
        environmentId,
        ownerId: "d".repeat(32),
        ownerSubject: "human-owner",
        mode: "restricted",
        updatedBy: "human-owner",
        updatedAt: 0,
      };
      f.records.set(policyPath, {
        value: Redacted.make({
          schemaVersion: 5,
          environmentId,
          ownerPolicy,
          ownerReceipts: [],
          policy,
        }),
        version: 1,
      });
      yield* service.validate(reference, consumer);
      const stored = Redacted.value(f.records.get(policyPath)!.value);
      expect(stored).toMatchObject({ schemaVersion: 5, ownerPolicy, ownerReceipts: [] });
      const decoded = decodePolicy(stored);
      expect(Option.isSome(decoded)).toBe(true);
      if (Option.isNone(decoded)) return;
      expect(decoded.value.schemaVersion).toBe(4);
      expect(decoded.value.revision).toBe(2);
      expect(decoded.value.audit).toHaveLength(1);
    }),
  );
});

it.effect.each(["unavailable", "conflict"] as const)(
  "releases nothing when durable audit is %s",
  (failure) => {
    const f = fixture();
    return f.use(({ service }) =>
      Effect.gen(function* () {
        f.state.failAudit = failure === "unavailable";
        f.state.auditConflicts = failure === "conflict" ? 4 : 0;
        expect((yield* service.read(reference, consumer).pipe(Effect.flip)).reason).toBe(failure);
      }),
    );
  },
);

it.effect("rechecks protection when a concurrent policy write races credential release", () => {
  const f = fixture();
  return f.use(({ service }) =>
    Effect.gen(function* () {
      f.state.replacementPolicy = {
        schemaVersion: 4,
        environmentId,
        revision: 1,
        grants: [],
        audit: [],
        omittedAuditEvents: 0,
        receipts: [],
        intents: [],
        credentialModes: [
          { itemId, mode: "one-time", revision: 1, updatedBy: "human-owner", updatedAt: 0 },
        ],
      };
      expect((yield* service.read(reference, consumer).pipe(Effect.flip)).reason).toBe("denied");
      expect(f.state.policyWrites).toBe(0);
    }),
  );
});

it.effect(
  "allows binding removal while the backend is blocked and refuses the pending release",
  () => {
    const f = fixture();
    return f.use(({ service, settings }) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const removed = yield* Deferred.make<void>();
        f.state.readBarrier = { entered, release };
        const request = yield* service
          .read(reference, consumer)
          .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(entered);
        const removal = yield* settings
          .updateProviderInstance({
            operation: "upsert",
            instanceId: consumer.instanceId,
            instance: { driver: ProviderDriverKind.make("claudeAgent"), environment: [] },
          })
          .pipe(
            Effect.tap(() => Deferred.succeed(removed, undefined)),
            Effect.forkChild({ startImmediately: true }),
          );
        const removedBeforeRelease = yield* Deferred.isDone(removed);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(removal);
        const result = yield* Fiber.join(request);
        expect(removedBeforeRelease).toBe(true);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(result.failure.reason).toBe("denied");
      }),
    );
  },
);
