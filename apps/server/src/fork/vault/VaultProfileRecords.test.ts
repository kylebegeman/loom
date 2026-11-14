import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as MachineClient from "./AccountVaultMachineClient.ts";
import * as Records from "./VaultProfileRecords.ts";

const source = EnvironmentId.make("source");
const projectId = ProjectId.make("project");
const registry = { schemaVersion: 1 as const, activeProfileId: null, profiles: [], receipts: [] };
const write = {
  kind: "write" as const,
  projectId,
  key: "registry",
  value: registry,
  expectedVersion: 0,
};
const fixture = Effect.gen(function* () {
  const values = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = { remote: false, unavailable: false, localReads: 0 };
  const store = Layer.succeed(OpenBaoStore.OpenBaoStore, {
    inventoryEnvironmentId: source,
    status: Effect.succeed({ backend: "openbao" as const, state: "ready" as const, origin: null }),
    read: (path) =>
      Effect.sync(() => {
        state.localReads++;
        if (path.endsWith("/access-policy"))
          return {
            version: 1,
            value: Redacted.make({
              schemaVersion: 5,
              environmentId: source,
              ownerPolicy: {
                environmentId: source,
                ownerSubject: "local-owner",
                accountOwnerSubject:
                  "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                ownerId: "a".repeat(32),
                mode: "owner-trusted",
                updatedBy: "local-owner",
                updatedAt: 0,
              },
              ownerReceipts: [],
              policy: {
                schemaVersion: 4,
                environmentId: source,
                revision: 1,
                grants: [],
                audit: [],
                omittedAuditEvents: 0,
                receipts: [],
                intents: [],
                credentialModes: [],
              },
            }),
          };
        return values.get(path) ?? null;
      }),
    write: (path, value, expectedVersion) =>
      Effect.suspend(() => {
        const version = values.get(path)?.version ?? 0;
        if (version !== expectedVersion) return Effect.fail(new VaultError({ reason: "conflict" }));
        values.set(path, { value, version: version + 1 });
        return Effect.succeed(version + 1);
      }),
    keys: (prefix) =>
      Effect.sync(() =>
        [...values.keys()]
          .filter((path) => path.startsWith(`${prefix}/`))
          .map((path) => path.slice(prefix.length + 1)),
      ),
  });
  let authority: Records.VaultProfileRecords["Service"];
  const make = (remote: boolean) =>
    Records.VaultProfileRecords.pipe(
      Effect.provide(
        Records.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              store,
              Layer.succeed(ServerEnvironmentIdentity, {
                getEnvironmentId: Effect.succeed(remote ? source : EnvironmentId.make("library")),
              }),
              Layer.mock(MachineClient.AccountVaultMachineClient)({
                available: Effect.succeed(remote),
                profileRecord: (input) =>
                  Effect.suspend(() =>
                    state.unavailable
                      ? Effect.fail(new VaultError({ reason: "unavailable" }))
                      : input.kind === "preview"
                        ? Effect.die("Unexpected preview")
                        : authority.forAccount(
                            input,
                            source,
                            "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            Effect.void,
                          ),
                  ),
              }),
            ),
          ),
        ),
      ),
    );
  authority = yield* make(false);
  const client = yield* make(true);
  return { values, state, authority, client };
});

it.effect(
  "preserves an adopted namespace and CAS versions while separating computers and projects",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(
        yield* f.authority.forAccount(
          write,
          source,
          "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          Effect.void,
        ),
      ).toEqual({
        kind: "write",
        version: 1,
      });
      const recovered = yield* f.client.read(projectId, "registry");
      expect(recovered?.version).toBe(1);
      expect(Redacted.value(recovered!.value)).toEqual(registry);
      expect(
        (yield* f.client.write(projectId, "registry", Redacted.make(registry), 0).pipe(Effect.flip))
          .reason,
      ).toBe("conflict");
      expect(yield* f.client.write(projectId, "registry", Redacted.make(registry), 1)).toBe(2);
      const pin = "0c156e4717d2512a7c70094ac0f280727c346a934d99e653f1f57b1681d5ca88";
      const retired = {
        schemaVersion: 2 as const,
        environmentId: source,
        projectId,
        threadId: "thread",
        runId: "run",
        createdAt: null,
        retiredAt: "2026-11-12T00:00:00Z",
        operationId: "b".repeat(32),
        actor: "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      };
      expect(yield* f.client.write(projectId, `runs/${pin}`, Redacted.make(retired), 0)).toBe(1);
      expect(yield* f.client.keys(projectId)).toEqual([pin]);
      expect(Redacted.value((yield* f.client.read(projectId, `runs/${pin}`))!.value)).toEqual(
        retired,
      );
      expect(
        yield* f.authority.forAccount(
          { kind: "read", projectId, key: "registry" },
          EnvironmentId.make("another-computer"),
          "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          Effect.void,
        ),
      ).toEqual({ kind: "read", record: null });
      expect(yield* f.client.read(ProjectId.make("another-project"), "registry")).toBeNull();
      expect(f.values.size).toBe(2);
    }).pipe(Effect.provide(NodeCrypto.layer)),
);

it.effect("refuses another owner, ended enrollment, namespace paths and forged run records", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    expect(
      (yield* f.authority.forAccount(write, source, "other-owner", Effect.void).pipe(Effect.flip))
        .reason,
    ).toBe("denied");
    expect(
      (yield* f.authority
        .forAccount(
          write,
          source,
          "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          Effect.fail(new VaultError({ reason: "denied" })),
        )
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(
      (yield* f.authority
        .forAccount(
          { ...write, key: "../items/key" },
          source,
          "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          Effect.void,
        )
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-input");
    const value = {
      schemaVersion: 2 as const,
      environmentId: "another-computer",
      projectId,
      threadId: "thread",
      runId: "run",
      createdAt: null,
      retiredAt: "now",
      operationId: "a".repeat(32),
      actor: "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    expect(
      (yield* f.authority
        .forAccount(
          { ...write, key: `runs/${"a".repeat(64)}`, value },
          source,
          "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          Effect.void,
        )
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-input");
    expect(
      (yield* f.authority
        .forAccount(
          { ...write, key: `runs/${"a".repeat(64)}`, value: { ...value, environmentId: source } },
          source,
          "identity-principal:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          Effect.void,
        )
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-input");
    expect(f.values.size).toBe(0);
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it.effect("keeps a selected account store unavailable without falling back to local records", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.state.unavailable = true;
    for (const operation of [
      f.client.read(projectId, "registry").pipe(Effect.asVoid),
      f.client.write(projectId, "registry", Redacted.make(registry), 0).pipe(Effect.asVoid),
      f.client.keys(projectId).pipe(Effect.asVoid),
    ]) {
      expect((yield* operation.pipe(Effect.flip)).reason).toBe("unavailable");
    }
    expect(f.state.localReads).toBe(0);
  }).pipe(Effect.provide(NodeCrypto.layer)),
);
