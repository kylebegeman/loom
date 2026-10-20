import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  RuntimeRequestId,
} from "@t3tools/contracts";
import {
  VaultError,
  vaultTestAccountDestination,
  vaultTestAccountLoginDestination,
  type VaultGrantDefinition,
  type VaultTestAccountChange,
} from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as Store from "./OpenBaoStore.ts";
import * as Core from "./VaultCore.ts";
import * as Access from "./VaultAccess.ts";
import * as Notifications from "./ApprovalNotifications.ts";
import * as Accounts from "./VaultTestAccounts.ts";
import * as Workloads from "./VaultTestAccountWorkloads.ts";
import {
  syntheticLoginDelivery,
  type SyntheticLoginAdapter,
} from "./testkit/SyntheticLoginDelivery.ts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";

const caller = {
  environmentId: EnvironmentId.make("account-workloads"),
  threadId: ThreadId.make("worker"),
  providerInstanceId: ProviderInstanceId.make("codex"),
};
const projectId = ProjectId.make("test-project");
const collection = {
  id: "a".repeat(32),
  label: "Editors",
  application: "Disposable app",
  target: "test" as const,
};
const account = {
  id: "b".repeat(32),
  collectionId: collection.id,
  label: "Dedicated editor",
  role: "editor",
  itemId: "c".repeat(32),
  itemVersion: 1,
};
const fixture = () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  const state = {
    runId: RunId.make("run-one"),
    active: true,
    status: "running",
    pendingRuntimeRequest: null as ReturnType<typeof liveThreadShell>["pendingRuntimeRequest"],
    pendingBackgroundTasks: [] as NonNullable<
      ReturnType<typeof liveThreadShell>["pendingBackgroundTasks"]
    >,
    archived: false,
    deleted: false,
    project: true,
    provider: caller.providerInstanceId,
    runtimeMode: "full-access",
    interactionMode: "default",
    readsFail: false,
    beforeRegistryWrite: null as null | (() => Effect.Effect<void>),
    beforePolicyWrite: null as null | (() => Effect.Effect<void, VaultError>),
    loseReply: false,
  };
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(caller.environmentId),
    }),
    Layer.mock(ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.sync(
          () =>
            ({
              ...liveThreadShell(id),
              projectId,
              status: state.active || state.status === "waiting" ? state.status : "idle",
              pendingRuntimeRequest: state.pendingRuntimeRequest,
              pendingBackgroundTasks: state.pendingBackgroundTasks,
              activeRunId: state.active ? state.runId : null,
              providerInstanceId: state.provider,
              runtimeMode: state.runtimeMode,
              interactionMode: state.interactionMode,
              archivedAt: state.archived ? "2026-10-20T00:00:00Z" : null,
              deletedAt: state.deleted ? "2026-10-20T00:00:00Z" : null,
            }) as never,
        ),
    }),
    Layer.mock(ProjectStoreV2)({
      get: () =>
        Effect.sync(() =>
          state.project ? Option.some({ id: projectId } as never) : Option.none(),
        ),
    }),
    Layer.succeed(Store.OpenBaoStore, {
      status: Effect.succeed({
        backend: "openbao" as const,
        state: "ready" as const,
        origin: null,
      }),
      keys: () => Effect.succeed([]),
      read: (path) =>
        Effect.suspend(() =>
          state.readsFail
            ? Effect.fail(new VaultError({ reason: "unavailable" }))
            : Effect.succeed(records.get(path) ?? null),
        ),
      write: (path, value, expected) =>
        Effect.gen(function* () {
          if (path.endsWith("access-policy") && state.beforePolicyWrite)
            yield* state.beforePolicyWrite();
          if (path.endsWith("registry-v1") && state.beforeRegistryWrite)
            yield* state.beforeRegistryWrite();
          const version = records.get(path)?.version ?? 0;
          if (version !== expected) return yield* new VaultError({ reason: "conflict" });
          records.set(path, { value, version: version + 1 });
          if (path.endsWith("registry-v1") && state.loseReply) {
            state.loseReply = false;
            return yield* new VaultError({ reason: "unavailable" });
          }
          return version + 1;
        }),
    }),
  );
  const core = Core.layer.pipe(Layer.provide(dependencies));
  const access = Access.layer.pipe(
    Layer.provide(Notifications.stub),
    Layer.provide(core),
    Layer.provide(dependencies),
  );
  const accounts = Accounts.layer.pipe(Layer.provide(core), Layer.provide(dependencies));
  const services = Layer.mergeAll(core, access, accounts);
  const layer = Workloads.layer.pipe(
    Layer.provideMerge(services),
    Layer.provideMerge(dependencies),
  );
  return { records, state, layer };
};
const setup = Effect.gen(function* () {
  const service = yield* Workloads.VaultTestAccountWorkloads,
    manager = yield* Accounts.VaultTestAccounts,
    core = yield* Core.VaultCore,
    access = yield* Access.VaultAccess;
  let sequence = 1;
  const id = () => (sequence++).toString(16).padStart(32, "0");
  const manage = Effect.fnUntraced(function* (change: VaultTestAccountChange) {
    return yield* manager.apply(
      {
        operationId: id(),
        expectedRevision: (yield* manager.snapshot("client:manager")).revision,
        change,
      },
      "client:manager",
      Effect.void,
    );
  });
  const grant = Effect.fnUntraced(function* (overrides: Partial<VaultGrantDefinition> = {}) {
    const definition: VaultGrantDefinition = {
      id: id(),
      label: "QA pool use",
      principal: { kind: "project", id: projectId },
      projectId,
      itemIds: [account.itemId],
      actions: ["inspect", "use"],
      destination: vaultTestAccountDestination(collection.id),
      notBefore: 0,
      expiresAt: null,
      parentId: null,
      ...overrides,
    };
    return yield* access.apply(
      {
        operationId: id(),
        expectedRevision: (yield* access.snapshot).revision,
        change: { type: "save", grant: definition },
      },
      "client:manager",
    );
  });
  const input = Effect.fnUntraced(function* () {
    return {
      operationId: id(),
      expectedRevision: (yield* service.discover(caller)).revision,
      change: { type: "reserve" as const, id: account.id, durationMs: 300_000 as const },
    };
  });
  const reserve = Effect.fnUntraced(function* () {
    return yield* service.apply(yield* input(), caller, Effect.void);
  });
  yield* core.save(
    {
      id: account.itemId,
      operationId: id(),
      expectedVersion: 0,
      label: account.label,
      kind: "account",
      value: Redacted.make("synthetic-account-secret"),
    },
    "human",
  );
  yield* manage({ type: "collection-save", collection });
  yield* manage({ type: "account-save", account, developmentOnly: true });
  yield* manage({ type: "mark-clean", id: account.id, confirmedReset: true });
  return { service, manager, core, access, manage, grant, id, input, reserve };
});
const withFixture = <A, E, R>(
  use: (f: Effect.Success<typeof setup> & ReturnType<typeof fixture>) => Effect.Effect<A, E, R>,
) => {
  const f = fixture();
  return setup.pipe(
    Effect.flatMap((services) => use({ ...services, ...f })),
    Effect.provide(f.layer),
  );
};

it.effect(
  "discovers only item-use and metadata-authorized accounts without writing or leaking other owners",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const before = [...f.records.values()];
        expect((yield* f.service.discover(caller)).accounts).toEqual([]);
        expect([...f.records.values()]).toEqual(before);
        yield* f.grant({ actions: ["inspect"] });
        expect((yield* f.service.discover(caller)).collections).toEqual([]);
        yield* f.grant({ actions: ["use"], destination: "loom:test-accounts:other" });
        expect((yield* f.service.discover(caller)).accounts).toEqual([]);
        yield* f.grant({ actions: ["use"] });
        const snapshot = yield* f.service.discover(caller);
        expect(snapshot.accounts.map((a) => a.id)).toEqual([account.id]);
        expect(snapshot.loginDelivery).toBe("unsupported");
        expect(JSON.stringify(snapshot)).not.toContain("synthetic-account-secret");
        yield* f.reserve();
        const other = yield* f.service.discover({
          ...caller,
          threadId: ThreadId.make("another-worker"),
        });
        expect(other.accounts).toEqual([]);
        expect(JSON.stringify(other)).not.toContain("worker");
      }),
    ),
);

it.effect("uses audited grants to reserve and binds renewal/release to the exact current run", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const request = yield* f.input();
      expect((yield* f.service.apply(request, caller, Effect.void).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      yield* f.grant();
      const snapshot = yield* f.service.apply(request, caller, Effect.void),
        lease = snapshot.accounts[0]!.lease!;
      expect(lease.owner).toContain("run-one");
      expect(
        (yield* f.access.snapshot).audit.some((a) => a.type === "decision" && a.action === "use"),
      ).toBe(true);
      const release = {
        operationId: f.id(),
        expectedRevision: snapshot.revision,
        change: { type: "release" as const, id: account.id, leaseId: lease.id },
      };
      expect(
        (yield* f.service
          .apply(release, { ...caller, threadId: ThreadId.make("other") }, Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      f.state.runId = RunId.make("run-two");
      expect((yield* f.service.apply(release, caller, Effect.void).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect((yield* f.service.discover(caller)).accounts).toEqual([]);
      yield* f.service.reconcile;
      expect((yield* f.manager.snapshot("client:manager")).accounts[0]).toMatchObject({
        state: "quarantined",
        lease: null,
      });
    }),
  ),
);

it.effect("allows exact-owner release after grant withdrawal without opening login delivery", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const grant = yield* f.grant(),
        reserved = yield* f.reserve(),
        lease = reserved.accounts[0]!.lease!;
      yield* f.access.apply(
        {
          operationId: f.id(),
          expectedRevision: (yield* f.access.snapshot).revision,
          change: { type: "state", id: grant.definition.id, state: "revoked" },
        },
        "client:manager",
      );
      expect((yield* f.service.discover(caller)).accounts).toEqual([]);
      const result = yield* f.service.apply(
        {
          operationId: f.id(),
          expectedRevision: reserved.revision,
          change: { type: "release", id: account.id, leaseId: lease.id },
        },
        caller,
        Effect.void,
      );
      expect(result.accounts).toEqual([]);
      expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe("quarantined");
    }),
  ),
);

it.effect(
  "rechecks identity and grants after async waits and refuses agent administration or injected identity",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        const request = yield* f.input();
        let checks = 0;
        const authorize = Effect.sync(() => {
          if (++checks === 3) f.state.runId = RunId.make("replacement");
        });
        expect((yield* f.service.apply(request, caller, authorize).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.lease).toBe(null);
        expect(
          (yield* f.service
            .apply(
              {
                ...request,
                change: { type: "mark-clean", id: account.id, confirmedReset: true },
              } as never,
              caller,
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        expect(
          (yield* f.service
            .apply({ ...request, owner: "client:manager" } as never, caller, Effect.void)
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        expect(
          (yield* f.service
            .apply(request, caller, Effect.fail(new VaultError({ reason: "denied" })))
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);

it.effect(
  "denies inactive, archived, deleted, restricted, foreign provider/environment and missing-project callers",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        for (const change of [
          { active: false },
          { archived: true },
          { deleted: true },
          { runtimeMode: "approval-required" },
          { interactionMode: "plan" },
          { project: false },
          { provider: ProviderInstanceId.make("claude") },
        ]) {
          const previous = { ...f.state };
          Object.assign(f.state, change);
          expect((yield* f.service.discover(caller).pipe(Effect.flip)).reason).toBe("denied");
          Object.assign(f.state, previous);
        }
        expect(
          (yield* f.service
            .discover({ ...caller, environmentId: EnvironmentId.make("foreign") })
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);

it.effect(
  "recovers lost replies without extending a lease and never replays it into a replacement run",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        const request = yield* f.input();
        f.state.loseReply = true;
        expect(
          (yield* f.service.apply(request, caller, Effect.void).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        const first = yield* f.service.discover(caller);
        yield* TestClock.adjust("1 minute");
        expect((yield* f.service.apply(request, caller, Effect.void)).accounts[0]!.lease).toEqual(
          first.accounts[0]!.lease,
        );
        f.state.runId = RunId.make("replacement");
        yield* f.service.reconcile;
        expect(
          (yield* f.service.apply(request, caller, Effect.void).pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.lease).toBeNull();
      }),
    ),
);

it.effect(
  "durably quarantines stopped runs, provider changes, withdrawn use and stale account versions",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const grant = yield* f.grant();
        for (const change of [
          { active: false },
          { provider: ProviderInstanceId.make("claude") },
          { project: false },
        ]) {
          yield* f.reserve();
          const previous = { ...f.state };
          Object.assign(f.state, change);
          yield* f.service.reconcile;
          expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe(
            "quarantined",
          );
          Object.assign(f.state, previous);
          yield* f.manage({ type: "mark-clean", id: account.id, confirmedReset: true });
        }
        yield* f.reserve();
        yield* f.access.apply(
          {
            operationId: f.id(),
            expectedRevision: (yield* f.access.snapshot).revision,
            change: { type: "state", id: grant.definition.id, state: "revoked" },
          },
          "human",
        );
        yield* f.service.reconcile;
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.lease).toBeNull();
        yield* f.grant();
        yield* f.manage({ type: "mark-clean", id: account.id, confirmedReset: true });
        yield* f.reserve();
        yield* f.core.save(
          {
            id: account.itemId,
            operationId: f.id(),
            expectedVersion: 1,
            label: account.label,
            kind: "account",
            value: Redacted.make("synthetic-replacement"),
          },
          "human",
        );
        yield* f.service.reconcile;
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe(
          "quarantined",
        );
      }),
    ),
);

it.effect("persists expiry on cleanup while read-only discovery derives it without writes", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant();
      yield* f.reserve();
      yield* TestClock.adjust("5 minutes");
      const before = [...f.records.values()];
      expect((yield* f.service.discover(caller)).accounts).toEqual([]);
      expect([...f.records.values()]).toEqual(before);
      yield* f.service.reconcile;
      const stored = [...f.records.entries()].find(([key]) => key.endsWith("registry-v1"))![1];
      expect(Redacted.value(stored.value)).toMatchObject({
        schemaVersion: 1,
        accounts: [{ state: "quarantined", lease: null }],
      });
      const after = [...f.records.values()];
      yield* f.service.reconcile;
      expect([...f.records.values()]).toEqual(after);
    }),
  ),
);

it.effect("never clears a newer reservation when cleanup loses a CAS race", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant();
      yield* f.reserve();
      f.state.active = false;
      const arrived = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      f.state.beforeRegistryWrite = () =>
        Effect.gen(function* () {
          f.state.beforeRegistryWrite = null;
          yield* Deferred.succeed(arrived, undefined);
          yield* Deferred.await(release);
        });
      const cleanup = yield* f.service.reconcile.pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(arrived);
      yield* f.manage({ type: "quarantine", id: account.id });
      yield* f.manage({ type: "mark-clean", id: account.id, confirmedReset: true });
      f.state.active = true;
      f.state.runId = RunId.make("new-owner-run");
      const newer = yield* f.reserve();
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(cleanup))._tag).toBe("Failure");
      expect((yield* f.service.discover(caller)).accounts[0]!.lease).toEqual(
        newer.accounts[0]!.lease,
      );
    }),
  ),
);

it.effect(
  "leaves durable leases untouched on backend outage and reconciles after service restart",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        yield* f.reserve();
        const before = [...f.records.values()];
        f.state.readsFail = true;
        expect((yield* f.service.reconcile.pipe(Effect.flip)).reason).toBe("unavailable");
        expect([...f.records.values()]).toEqual(before);
        f.state.readsFail = false;
        f.state.active = false;
        const restarted = yield* Workloads.VaultTestAccountWorkloads.pipe(
          Effect.provide(Workloads.layer),
        );
        yield* restarted.reconcile;
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe(
          "quarantined",
        );
      }),
    ),
);

it.effect(
  "renews only the owned live lease and refuses credential rotation during authorization",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        const first = yield* f.reserve(),
          lease = first.accounts[0]!.lease!;
        yield* TestClock.adjust("1 minute");
        const renewed = yield* f.service.apply(
          {
            operationId: f.id(),
            expectedRevision: first.revision,
            change: { type: "renew", id: account.id, leaseId: lease.id },
          },
          caller,
          Effect.void,
        );
        expect(renewed.accounts[0]!.lease!.id).toBe(lease.id);
        expect(renewed.accounts[0]!.lease!.expiresAt).toBeGreaterThan(lease.expiresAt);
        yield* TestClock.adjust("1 minute");
        let checks = 0;
        const authorize = Effect.gen(function* () {
          if (++checks === 3)
            yield* f.core.save(
              {
                id: account.itemId,
                operationId: f.id(),
                expectedVersion: 1,
                label: account.label,
                kind: "account",
                value: Redacted.make("synthetic-rotated"),
              },
              "human",
            );
        });
        expect(
          (yield* f.service
            .apply(
              {
                operationId: f.id(),
                expectedRevision: renewed.revision,
                change: { type: "renew", id: account.id, leaseId: lease.id },
              },
              caller,
              authorize,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(checks).toBe(3);
        expect((yield* f.core.inspect(account.itemId))!.version).toBe(2);
        expect((yield* f.manager.snapshot("client:manager")).revision).toBe(renewed.revision);
      }),
    ),
);

it.effect(
  "refuses grants withdrawn during the final write check and quarantines malformed run owners",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const grant = yield* f.grant(),
          request = yield* f.input();
        let checks = 0;
        const authorize = Effect.gen(function* () {
          if (++checks === 3)
            yield* f.access.apply(
              {
                operationId: f.id(),
                expectedRevision: (yield* f.access.snapshot).revision,
                change: { type: "state", id: grant.definition.id, state: "revoked" },
              },
              "human",
            );
        });
        expect((yield* f.service.apply(request, caller, authorize).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        yield* f.grant();
        yield* f.reserve();
        const [key, record] = [...f.records.entries()].find(([key]) =>
          key.endsWith("registry-v1"),
        )!;
        const ledger = Redacted.value(record.value) as {
          accounts: Array<{ lease: { owner: string } }>;
        };
        f.records.set(key, {
          version: record.version + 1,
          value: Redacted.make({
            ...ledger,
            accounts: ledger.accounts.map((a) => ({
              ...a,
              lease: { ...a.lease, owner: "run-v1:malformed" },
            })),
          }),
        });
        yield* f.service.reconcile;
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe(
          "quarantined",
        );
      }),
    ),
);

const loginOrigin = "https://synthetic-app.example.test";
it.effect("prepares a reference-only login guard requiring a separate exact-origin grant", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant();
      const reserved = yield* f.reserve(),
        lease = reserved.accounts[0]!.lease!;
      const input = { accountId: account.id, leaseId: lease.id, origin: loginOrigin };
      expect((yield* f.service.prepareLogin(input, caller).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      yield* f.grant({
        destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
        actions: ["use"],
      });
      const before = [...f.records.values()];
      const prepared = yield* f.service.prepareLogin(input, caller);
      expect([...f.records.values()]).toEqual(before);
      expect(prepared.report).toMatchObject({
        canDeliver: false,
        automaticResumption: false,
        allowOnceConsumption: false,
        origin: loginOrigin,
        expiresAt: lease.expiresAt,
        account,
        collection,
      });
      expect(JSON.stringify(prepared.report)).not.toContain("synthetic-account-secret");
      yield* prepared.revalidate;
      expect(
        (yield* f.access.snapshot).audit.some((a) => a.type === "decision" && a.action === "use"),
      ).toBe(true);
      expect(
        (yield* f.service
          .prepareLogin({ ...input, origin: "https://other.example.test" }, caller)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* f.service
          .prepareLogin(input, { ...caller, threadId: ThreadId.make("other") })
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
    }),
  ),
);
it.effect(
  "rejects noncanonical login origins, raw credential fields and wrong lease identity",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        const reserved = yield* f.reserve(),
          leaseId = reserved.accounts[0]!.lease!.id;
        for (const origin of [
          "http://remote.example.test",
          "https://synthetic-app.example.test/",
          "https://user:pass@synthetic-app.example.test",
          "file:///tmp/test",
          "https://synthetic-app.example.test/path?token=private",
        ]) {
          expect(
            (yield* f.service
              .prepareLogin({ accountId: account.id, leaseId, origin }, caller)
              .pipe(Effect.flip)).reason,
          ).toBe("invalid-input");
        }
        expect(
          (yield* f.service
            .prepareLogin(
              {
                accountId: account.id,
                leaseId,
                origin: loginOrigin,
                password: "must-not-be-accepted",
              } as never,
              caller,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-input");
        yield* f.grant({
          destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
          actions: ["use"],
        });
        yield* f.service.prepareLogin(
          { accountId: account.id, leaseId, origin: loginOrigin },
          caller,
        );
        expect(
          (yield* f.service
            .prepareLogin({ accountId: account.id, leaseId: f.id(), origin: loginOrigin }, caller)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);
it.effect("keeps the prepared deadline even after lease renewal", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant();
      yield* f.grant({
        destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
        actions: ["use"],
      });
      const reserved = yield* f.reserve(),
        leaseId = reserved.accounts[0]!.lease!.id;
      const prepared = yield* f.service.prepareLogin(
        { accountId: account.id, leaseId, origin: loginOrigin },
        caller,
      );
      yield* TestClock.adjust("1 minute");
      yield* f.service.apply(
        {
          operationId: f.id(),
          expectedRevision: reserved.revision,
          change: { type: "renew", id: account.id, leaseId },
        },
        caller,
        Effect.void,
      );
      yield* TestClock.adjust("4 minutes");
      expect((yield* prepared.revalidate.pipe(Effect.flip)).reason).toBe("denied");
    }),
  ),
);
it.effect(
  "quarantines and cleans a synthetic login when a callback loses current access, without resuming or reminting",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        const loginGrant = yield* f.grant({
          destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
          actions: ["use"],
        });
        const reserved = yield* f.reserve(),
          leaseId = reserved.accounts[0]!.lease!.id;
        const prepared = yield* f.service.prepareLogin(
          { accountId: account.id, leaseId, origin: loginOrigin },
          caller,
        );
        let opens = 0,
          cleanups = 0,
          callbacks = 0;
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* prepared.revalidate;
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                opens++;
                return "synthetic-session";
              }),
              () =>
                Effect.sync(() => {
                  cleanups++;
                }),
            );
            yield* f.access.apply(
              {
                operationId: f.id(),
                expectedRevision: (yield* f.access.snapshot).revision,
                change: { type: "state", id: loginGrant.definition.id, state: "revoked" },
              },
              "human",
            );
            yield* prepared.revalidate;
            callbacks++;
          }),
        ).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect({ opens, cleanups, callbacks }).toEqual({ opens: 1, cleanups: 1, callbacks: 0 });
        // Origin access is separate from pool use. Explicitly releasing the pool lease needs no login grant.
        yield* f.service.apply(
          {
            operationId: f.id(),
            expectedRevision: reserved.revision,
            change: { type: "release", id: account.id, leaseId },
          },
          caller,
          Effect.void,
        );
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe(
          "quarantined",
        );
      }),
    ),
);
it.effect(
  "revalidates run identity after a synthetic adapter wait and refuses pre-start after a lost lease",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        yield* f.grant({
          destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
          actions: ["use"],
        });
        const reserved = yield* f.reserve(),
          leaseId = reserved.accounts[0]!.lease!.id;
        const prepared = yield* f.service.prepareLogin(
          { accountId: account.id, leaseId, origin: loginOrigin },
          caller,
        );
        yield* prepared.revalidate;
        f.state.runId = RunId.make("replaced-during-adapter-wait");
        expect((yield* prepared.revalidate.pipe(Effect.flip)).reason).toBe("denied");
        yield* f.service.reconcile;
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.lease).toBeNull();
      }),
    ),
);

it.effect("refuses a lease released while the login access audit is committing", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant();
      yield* f.grant({
        destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
        actions: ["use"],
      });
      const reserved = yield* f.reserve(),
        leaseId = reserved.accounts[0]!.lease!.id;
      const prepared = yield* f.service.prepareLogin(
        { accountId: account.id, leaseId, origin: loginOrigin },
        caller,
      );
      f.state.beforePolicyWrite = () =>
        Effect.gen(function* () {
          f.state.beforePolicyWrite = null;
          yield* f.service.apply(
            {
              operationId: f.id(),
              expectedRevision: reserved.revision,
              change: { type: "release", id: account.id, leaseId },
            },
            caller,
            Effect.void,
          );
        });
      expect((yield* prepared.revalidate.pipe(Effect.flip)).reason).toBe("denied");
      expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe("quarantined");
    }),
  ),
);

it.effect.each(["queued", "pending-approval"])(
  "preserves the reserving run's lease while its thread is %s",
  (status) =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        const reserved = yield* f.reserve(),
          lease = reserved.accounts[0]!.lease!;
        f.state.status = status === "queued" ? "queued" : "running";
        f.state.pendingRuntimeRequest =
          status === "pending-approval"
            ? {
                id: RuntimeRequestId.make("approval"),
                kind: "user_input",
                createdAt: DateTime.makeUnsafe(0),
              }
            : null;
        const observed = yield* f.service.discover(caller);
        expect(observed.accounts[0]!.lease).toEqual(lease);
        const before = (yield* f.manager.snapshot("client:manager")).revision;
        yield* f.service.reconcile;
        expect((yield* f.manager.snapshot("client:manager")).revision).toBe(before);
        yield* TestClock.adjust("1 minute");
        const renewed = yield* f.service.apply(
          {
            operationId: f.id(),
            expectedRevision: before,
            change: { type: "renew", id: account.id, leaseId: lease.id },
          },
          caller,
          Effect.void,
        );
        expect(renewed.accounts[0]!.lease!.expiresAt).toBeGreaterThan(lease.expiresAt);
        const released = yield* f.service.apply(
          {
            operationId: f.id(),
            expectedRevision: renewed.revision,
            change: { type: "release", id: account.id, leaseId: lease.id },
          },
          caller,
          Effect.void,
        );
        expect(released.accounts).toEqual([]);
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe(
          "quarantined",
        );
      }),
    ),
);

it.effect("refuses released and replaced leases before the original prepared deadline", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant();
      yield* f.grant({
        destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
        actions: ["use"],
      });
      const reserved = yield* f.reserve(),
        leaseId = reserved.accounts[0]!.lease!.id;
      const prepared = yield* f.service.prepareLogin(
        { accountId: account.id, leaseId, origin: loginOrigin },
        caller,
      );
      yield* TestClock.adjust("1 minute");
      yield* prepared.revalidate;
      yield* f.service.apply(
        {
          operationId: f.id(),
          expectedRevision: reserved.revision,
          change: { type: "release", id: account.id, leaseId },
        },
        caller,
        Effect.void,
      );
      expect((yield* prepared.revalidate.pipe(Effect.flip)).reason).toBe("denied");
      yield* f.manage({ type: "mark-clean", id: account.id, confirmedReset: true });
      const fresh = yield* f.reserve(),
        freshLeaseId = fresh.accounts[0]!.lease!.id;
      expect(freshLeaseId).not.toBe(leaseId);
      expect(fresh.accounts[0]!.lease!.owner).toBe(reserved.accounts[0]!.lease!.owner);
      // Both leases are within their deadlines; the old preparation must reject only the replacement identity.
      expect((yield* prepared.revalidate.pipe(Effect.flip)).reason).toBe("denied");
      const current = yield* f.service.prepareLogin(
        { accountId: account.id, leaseId: freshLeaseId, origin: loginOrigin },
        caller,
      );
      yield* current.revalidate;
    }),
  ),
);
it.effect.each(["run", "item", "deadline"] as const)(
  "refuses %s drift during the awaited login audit write",
  (drift) =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        yield* f.grant({
          destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
          actions: ["use"],
        });
        const reserved = yield* f.reserve(),
          leaseId = reserved.accounts[0]!.lease!.id;
        const prepared = yield* f.service.prepareLogin(
          { accountId: account.id, leaseId, origin: loginOrigin },
          caller,
        );
        let interleaved = false;
        f.state.beforePolicyWrite = () =>
          Effect.gen(function* () {
            f.state.beforePolicyWrite = null;
            interleaved = true;
            if (drift === "run") f.state.runId = RunId.make("changed-during-policy-write");
            else if (drift === "item")
              yield* f.core.change(
                { id: account.itemId, expectedVersion: 1, operationId: f.id(), action: "archive" },
                "human",
              );
            else yield* TestClock.adjust("5 minutes");
          });
        expect((yield* prepared.revalidate.pipe(Effect.flip)).reason).toBe("denied");
        expect(interleaved).toBe(true);
      }),
    ),
);

const syntheticDelivery = Effect.fnUntraced(function* (
  f: Effect.Success<typeof setup> & ReturnType<typeof fixture>,
) {
  yield* f.grant();
  const loginGrant = yield* f.grant({
    destination: vaultTestAccountLoginDestination(collection.id, loginOrigin),
    actions: ["use"],
  });
  const reserved = yield* f.reserve(),
    leaseId = reserved.accounts[0]!.lease!.id;
  const prepared = yield* f.service.prepareLogin(
    { accountId: account.id, leaseId, origin: loginOrigin },
    caller,
  );
  const operationId = f.id(),
    machineId = f.id();
  const control = {
    broker: {
      environmentId: caller.environmentId as string,
      machineId,
      application: collection.application,
      target: collection.target as string,
      origin: loginOrigin,
      online: true,
      leaseUntil: (yield* Clock.currentTimeMillis) + 900_000,
    },
    starts: 0,
    mints: 0,
    cleanups: 0,
    cleanupIds: [] as string[],
    active: false,
    fenced: false,
    loseReply: false,
    failCleanup: false,
    beforeStart: Effect.void as Effect.Effect<void>,
    afterStart: Effect.void as Effect.Effect<void, VaultError>,
    beforeCleanup: Effect.void as Effect.Effect<void, VaultError>,
    forged: false,
  };
  const adapter: SyntheticLoginAdapter = {
    observe: Effect.sync(() => ({ ...control.broker })),
    start: ({ operationId: id, admission }) =>
      Effect.gen(function* () {
        control.starts++;
        yield* control.beforeStart;
        // This synthetic adapter checks its own boundary and honors cleanup's terminal fence.
        if (
          control.fenced ||
          !control.broker.online ||
          control.broker.environmentId !== caller.environmentId ||
          control.broker.machineId !== machineId ||
          control.broker.application !== admission.collection.application ||
          control.broker.target !== admission.collection.target ||
          control.broker.origin !== admission.origin ||
          (yield* Clock.currentTimeMillis) >=
            Math.min(control.broker.leaseUntil, admission.expiresAt)
        )
          return yield* new VaultError({ reason: "denied" });
        control.active = true;
        control.mints++;
        yield* control.afterStart;
        if (control.loseReply) return yield* new VaultError({ reason: "unavailable" });
        return {
          operationId: control.forged ? "foreign-operation" : id,
          machineId,
          leaseId: admission.leaseId,
          origin: admission.origin,
          sessionId: "synthetic-session",
        };
      }),
    cleanup: (id) =>
      Effect.gen(function* () {
        yield* control.beforeCleanup;
        control.cleanups++;
        control.cleanupIds.push(id);
        if (id !== operationId || control.failCleanup) return "unknown" as const;
        control.fenced = true;
        control.active = false;
        return "fenced" as const;
      }),
  };
  const delivery = yield* syntheticLoginDelivery(
    operationId,
    { environmentId: caller.environmentId, machineId },
    prepared,
    adapter,
  );
  return { control, delivery, loginGrant, leaseId, adapter, prepared, operationId, machineId };
});
it.effect(
  "scopes a synthetic broker session to its admission and fences it without cleaning the reserved account",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const { control, delivery } = yield* syntheticDelivery(f);
        let callbacks = 0;
        yield* delivery.run((id) =>
          Effect.sync(() => {
            expect(id).toBe("synthetic-session");
            callbacks++;
          }),
        );
        expect({
          starts: control.starts,
          cleanups: control.cleanups,
          active: control.active,
          callbacks,
        }).toEqual({ starts: 1, cleanups: 1, active: false, callbacks: 1 });
        expect(yield* delivery.snapshot).toBe("closed");
        expect(delivery.gates).toEqual({
          canDeliver: false,
          automaticResumption: false,
          allowOnceConsumption: false,
        });
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe("reserved");
        expect((yield* delivery.run(() => Effect.void).pipe(Effect.flip)).reason).toBe("denied");
        expect(control.starts).toBe(1);
      }),
    ),
);
it.effect.each([
  "environmentId",
  "machineId",
  "application",
  "target",
  "origin",
  "offline",
  "expired",
] as const)("refuses mismatched or unavailable synthetic broker %s before start", (field) =>
  withFixture((f) =>
    Effect.gen(function* () {
      const { control, delivery } = yield* syntheticDelivery(f);
      if (field === "offline") control.broker.online = false;
      else if (field === "expired") control.broker.leaseUntil = 0;
      else control.broker[field] = "mismatched";
      expect(
        (yield* delivery.run(() => Effect.die("No callback permitted")).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(yield* delivery.snapshot).toBe("refused");
      expect(control.starts).toBe(0);
      expect(control.cleanups).toBe(0);
    }),
  ),
);
it.effect.each(["revoked", "run", "expired", "forged", "broker", "released"] as const)(
  "cleans synthetic start and refuses callback after %s drift",
  (drift) =>
    withFixture((f) =>
      Effect.gen(function* () {
        const { control, delivery, loginGrant, leaseId, operationId } = yield* syntheticDelivery(f);
        control.afterStart = Effect.gen(function* () {
          if (drift === "revoked")
            yield* f.access
              .apply(
                {
                  operationId: f.id(),
                  expectedRevision: (yield* f.access.snapshot).revision,
                  change: { type: "state", id: loginGrant.definition.id, state: "revoked" },
                },
                "human",
              )
              .pipe(Effect.orDie);
          else if (drift === "run") f.state.runId = RunId.make("changed-after-start");
          else if (drift === "expired") yield* TestClock.adjust("5 minutes");
          else if (drift === "forged") control.forged = true;
          else if (drift === "broker") control.broker.online = false;
          else
            yield* f.service.apply(
              {
                operationId: f.id(),
                expectedRevision: (yield* f.manager.snapshot("client:manager")).revision,
                change: { type: "release", id: account.id, leaseId: leaseId },
              },
              caller,
              Effect.void,
            );
        });
        expect(
          (yield* delivery.run(() => Effect.die("No callback permitted")).pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(yield* delivery.snapshot).toBe("closed");
        expect(control.active).toBe(false);
        expect(control.cleanups).toBe(1);
        expect(control.cleanupIds).toEqual([operationId]);
      }),
    ),
);
it.effect(
  "reconciles unknown start and cleanup without minting twice or declaring the account clean",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const { control, delivery } = yield* syntheticDelivery(f);
        control.loseReply = true;
        control.failCleanup = true;
        expect(
          (yield* delivery.run(() => Effect.die("No callback permitted")).pipe(Effect.flip)).reason,
        ).toBe("unavailable");
        expect(yield* delivery.snapshot).toBe("cleanup-required");
        expect(control.active).toBe(true);
        expect((yield* delivery.run(() => Effect.void).pipe(Effect.flip)).reason).toBe("denied");
        control.failCleanup = false;
        yield* delivery.reconcile;
        yield* delivery.reconcile;
        expect(yield* delivery.snapshot).toBe("closed");
        expect(control.active).toBe(false);
        expect(control.starts).toBe(1);
        expect(control.cleanups).toBe(2);
        expect((yield* f.manager.snapshot("client:manager")).accounts[0]!.state).toBe("reserved");
      }),
    ),
);
it.effect("fences interrupted starts and refuses concurrent dispatch without a second mint", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const { control, delivery } = yield* syntheticDelivery(f);
      const waiting = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      control.beforeStart = Deferred.succeed(waiting, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      );
      const first = yield* delivery.run(() => Effect.void).pipe(Effect.forkChild);
      yield* Deferred.await(waiting);
      expect((yield* delivery.run(() => Effect.void).pipe(Effect.flip)).reason).toBe("denied");
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(release, undefined);
      expect(yield* delivery.snapshot).toBe("closed");
      expect(control.fenced).toBe(true);
      expect(control.starts).toBe(1);
      expect(control.active).toBe(false);
    }),
  ),
);

it.effect("does not let a concurrent refusal change another caller's in-flight admission", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const { delivery } = yield* syntheticDelivery(f);
      const waiting = yield* Deferred.make<void>(),
        resume = yield* Deferred.make<void>();
      f.state.beforePolicyWrite = () =>
        Effect.gen(function* () {
          f.state.beforePolicyWrite = null;
          yield* Deferred.succeed(waiting, undefined);
          yield* Deferred.await(resume);
        });
      const first = yield* delivery.run(() => Effect.void).pipe(Effect.forkChild);
      yield* Deferred.await(waiting);
      expect((yield* delivery.run(() => Effect.void).pipe(Effect.flip)).reason).toBe("denied");
      expect(yield* delivery.snapshot).toBe("admitting");
      yield* Deferred.succeed(resume, undefined);
      yield* Fiber.join(first);
      expect(yield* delivery.snapshot).toBe("closed");
    }),
  ),
);
it.effect(
  "a fenced cancellation blocks a late synthetic remote mint, even after its client wait was interrupted",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const { control, adapter, prepared, operationId, machineId } = yield* syntheticDelivery(f);
        const sent = yield* Deferred.make<void>(),
          permitRemote = yield* Deferred.make<void>();
        const reply =
          yield* Deferred.make<Effect.Success<ReturnType<SyntheticLoginAdapter["start"]>>>();
        let refusedLateMint = false;
        const remote = yield* Effect.gen(function* () {
          yield* Deferred.await(sent);
          yield* Deferred.await(permitRemote);
          if (control.fenced) refusedLateMint = true;
          else control.active = true;
          yield* Deferred.succeed(reply, {
            operationId,
            machineId,
            leaseId: prepared.report.leaseId,
            origin: loginOrigin,
            sessionId: "late-synthetic-session",
          });
        }).pipe(Effect.forkChild);
        const delivery = yield* syntheticLoginDelivery(
          operationId,
          { environmentId: caller.environmentId, machineId },
          prepared,
          {
            ...adapter,
            start: () =>
              Deferred.succeed(sent, undefined).pipe(Effect.andThen(Deferred.await(reply))),
          },
        );
        const client = yield* delivery
          .run(() => Effect.die("No callback permitted"))
          .pipe(Effect.forkChild);
        yield* Deferred.await(sent);
        yield* Fiber.interrupt(client);
        expect(yield* delivery.snapshot).toBe("closed");
        yield* Deferred.succeed(permitRemote, undefined);
        yield* Fiber.join(remote);
        expect(refusedLateMint).toBe(true);
        expect(control.active).toBe(false);
        expect(control.cleanups).toBe(1);
      }),
    ),
);

it.effect("adapter-side binding validation refuses a reconfigured origin after admission", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const { control, delivery } = yield* syntheticDelivery(f);
      control.beforeStart = Effect.sync(() => {
        control.broker.origin = "https://changed.example.test";
      });
      expect(
        (yield* delivery.run(() => Effect.die("No callback permitted")).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(control.mints).toBe(0);
      expect(yield* delivery.snapshot).toBe("closed");
    }),
  ),
);
it.effect(
  "retains unknown cleanup on adapter errors and fences replay after model reconstruction",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const { control, delivery, adapter, prepared, operationId, machineId } =
          yield* syntheticDelivery(f);
        control.beforeCleanup = Effect.fail(new VaultError({ reason: "unavailable" }));
        yield* delivery.run(() => Effect.void);
        expect(yield* delivery.snapshot).toBe("cleanup-required");
        expect(control.active).toBe(true);
        control.beforeCleanup = Effect.void;
        yield* delivery.reconcile;
        const restored = yield* syntheticLoginDelivery(
          operationId,
          { environmentId: caller.environmentId, machineId },
          prepared,
          adapter,
        );
        expect(
          (yield* restored.run(() => Effect.die("No callback permitted")).pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(control.mints).toBe(1);
        expect(control.active).toBe(false);
      }),
    ),
);
it.effect.each(["failure", "run"] as const)(
  "cleans callback %s and refuses authority lost inside a successful callback",
  (outcome) =>
    withFixture((f) =>
      Effect.gen(function* () {
        const { control, delivery } = yield* syntheticDelivery(f);
        const callback =
          outcome === "failure"
            ? Effect.fail(new VaultError({ reason: "unavailable" }))
            : Effect.sync(() => {
                f.state.active = false;
              });
        expect((yield* delivery.run(() => callback).pipe(Effect.flip)).reason).toBe(
          outcome === "failure" ? "unavailable" : "denied",
        );
        expect(control.active).toBe(false);
        expect(yield* delivery.snapshot).toBe("closed");
      }),
    ),
);

it.effect.each(["complete", "interrupt"] as const)(
  "keeps concurrent cleanup ownership and leaves interruption unresolved (%s)",
  (outcome) =>
    withFixture((f) =>
      Effect.gen(function* () {
        const { control, delivery } = yield* syntheticDelivery(f);
        control.failCleanup = true;
        yield* delivery.run(() => Effect.void);
        expect(yield* delivery.snapshot).toBe("cleanup-required");
        const waiting = yield* Deferred.make<void>(),
          resume = yield* Deferred.make<void>();
        control.failCleanup = false;
        control.beforeCleanup = Deferred.succeed(waiting, undefined).pipe(
          Effect.andThen(Deferred.await(resume)),
        );
        const first = yield* delivery.reconcile.pipe(Effect.forkChild);
        yield* Deferred.await(waiting);
        yield* delivery.reconcile;
        expect(yield* delivery.snapshot).toBe("closing");
        if (outcome === "interrupt") {
          yield* Fiber.interrupt(first);
          expect(yield* delivery.snapshot).toBe("cleanup-required");
          expect(control.active).toBe(true);
          control.beforeCleanup = Effect.void;
          yield* delivery.reconcile;
        } else {
          yield* Deferred.succeed(resume, undefined);
          yield* Fiber.join(first);
        }
        expect(yield* delivery.snapshot).toBe("closed");
        expect(control.active).toBe(false);
        expect(control.starts).toBe(1);
      }),
    ),
);

it.effect("ends root-owned leases when a real waiting thread has no active run", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant();
      yield* f.reserve();
      f.state.status = "waiting";
      f.state.pendingBackgroundTasks = [
        {
          kind: "subagent",
          taskId: "background-worker",
          providerInstanceId: caller.providerInstanceId,
        },
      ];
      f.state.active = false;
      expect((yield* f.service.discover(caller).pipe(Effect.flip)).reason).toBe("denied");
      yield* f.service.reconcile;
      expect((yield* f.manager.snapshot("client:manager")).accounts[0]).toMatchObject({
        state: "quarantined",
        lease: null,
      });
    }),
  ),
);

it.effect(
  "refuses reservation when the root run changes during the access audit before registry CAS",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant();
        const request = yield* f.input();
        f.state.beforePolicyWrite = () =>
          Effect.sync(() => {
            f.state.beforePolicyWrite = null;
            f.state.runId = RunId.make("changed-during-reservation-audit");
          });
        expect(
          (yield* f.service.apply(request, caller, Effect.void).pipe(Effect.flip)).reason,
        ).toBe("denied");
        const snapshot = yield* f.manager.snapshot("client:manager");
        expect(snapshot.revision).toBe(request.expectedRevision);
        expect(snapshot.accounts[0]!.lease).toBeNull();
      }),
    ),
);
