import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as Store from "./OpenBaoStore.ts";
import * as Core from "./VaultCore.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import {
  vaultTestAccountDestination,
  vaultTestAccountLoginDestination,
} from "@t3tools/contracts/fork";
import * as Access from "./VaultAccess.ts";
import * as Notifications from "./ApprovalNotifications.ts";
import * as Workloads from "./VaultTestAccountWorkloads.ts";
import * as Accounts from "./VaultTestAccounts.ts";
const origin = process.env.LOOM_VAULT_TEST_ACCOUNTS_URL;
const tokenFile = process.env.LOOM_VAULT_TEST_ACCOUNTS_TOKEN_FILE;
const configured = Boolean(origin && tokenFile);
const restarted = process.env.LOOM_VAULT_TEST_ACCOUNTS_RESTART === "1";
if (configured && new URL(origin!).hostname !== "127.0.0.1")
  throw new Error("Account proof requires its disposable loopback backend");
const environmentId = EnvironmentId.make("test-accounts-integration-proof");
const store = Store.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      NodeServices.layer,
      FetchHttpClient.layer,
      Layer.succeed(HostProcess.Environment, {
        LOOM_VAULT_OPENBAO_URL: origin,
        LOOM_VAULT_OPENBAO_TOKEN_FILE: tokenFile,
        LOOM_VAULT_OPENBAO_MOUNT: "loom",
      }),
    ),
  ),
);
const caller = {
  environmentId,
  threadId: ThreadId.make("test-account-proof-worker"),
  providerInstanceId: ProviderInstanceId.make("codex"),
};
const projectId = ProjectId.make("test-account-proof-project");
const dependencies = Layer.mergeAll(
  Layer.mock(ThreadManagementService)({
    getThreadShell: (id) =>
      Effect.succeed({
        ...liveThreadShell(id),
        projectId,
        activeRunId: restarted ? null : RunId.make("account-proof-run"),
        status: restarted ? "idle" : "running",
      } as never),
  }),
  Layer.mock(ProjectStoreV2)({
    get: () => Effect.succeedSome({ id: projectId } as never),
  }),
  NodeServices.layer,
  store,
  Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
);
const core = Core.layer.pipe(Layer.provide(dependencies));
const accounts = Accounts.layer.pipe(Layer.provide(core), Layer.provide(dependencies));
const access = Access.layer.pipe(
  Layer.provide(Notifications.stub),
  Layer.provide(core),
  Layer.provide(dependencies),
);
const layer = Workloads.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(accounts, access, core)),
  Layer.provideMerge(dependencies),
);
const itemId = "a".repeat(32),
  collectionId = "b".repeat(32),
  accountId = "c".repeat(32);
it.live.skipIf(!configured || restarted)(
  "uses the existing scoped policy for account CAS without exposing or copying credential values",
  () =>
    Effect.gen(function* () {
      const service = yield* Accounts.VaultTestAccounts,
        vault = yield* Core.VaultCore,
        backend = yield* Store.OpenBaoStore;
      const crypto = yield* Crypto.Crypto;
      const namespace = Hex.encode(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(environmentId)),
      );
      const policyPath = `environments/${namespace}/access-policy`;
      const policy = {
        schemaVersion: 3,
        revision: 0,
        grants: [],
        audit: [],
        omittedAuditEvents: 0,
        receipts: [],
      };
      yield* backend.write(policyPath, Redacted.make(policy), 0);
      yield* vault.save(
        {
          id: itemId,
          operationId: "1".repeat(32),
          expectedVersion: 0,
          label: "Synthetic QA account",
          kind: "account",
          value: Redacted.make("test-account-plaintext-canary-6284"),
        },
        "human",
      );
      yield* service.apply(
        {
          operationId: "2".repeat(32),
          expectedRevision: 0,
          change: {
            type: "collection-save",
            collection: {
              id: collectionId,
              label: "QA",
              application: "Disposable app",
              target: "test",
            },
          },
        },
        "human",
        Effect.void,
      );
      yield* service.apply(
        {
          operationId: "3".repeat(32),
          expectedRevision: 1,
          change: {
            type: "account-save",
            account: {
              id: accountId,
              collectionId,
              label: "Editor",
              role: "editor",
              itemId,
              itemVersion: 1,
            },
            developmentOnly: true,
          },
        },
        "human",
        Effect.void,
      );
      yield* service.apply(
        {
          operationId: "4".repeat(32),
          expectedRevision: 2,
          change: { type: "mark-clean", id: accountId, confirmedReset: true },
        },
        "human",
        Effect.void,
      );
      const input = {
        operationId: "5".repeat(32),
        expectedRevision: 3,
        change: { type: "reserve" as const, id: accountId, durationMs: 300_000 as const },
      };
      const results = yield* Effect.all(
        [
          service.apply(input, "human", Effect.void).pipe(Effect.result),
          service
            .apply({ ...input, operationId: "6".repeat(32) }, "other", Effect.void)
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
      expect(results.filter((r) => r._tag === "Failure")).toHaveLength(1);
      const snapshot = yield* service.snapshot("human");
      expect(snapshot.accounts[0]!.state).toBe("reserved");
      expect(JSON.stringify(snapshot)).not.toContain("test-account-plaintext-canary");
      expect(Redacted.value((yield* backend.read(policyPath))!.value)).toEqual(policy);
      expect((yield* vault.list({ cursor: null, includeArchived: true })).items).toHaveLength(1);
      expect(
        (yield* backend
          .write(
            `environments/${"0".repeat(64)}/profiles/_test_accounts/registry-v1`,
            Redacted.make({}),
            0,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
    }).pipe(Effect.provide(layer)),
);
it.live.skipIf(!configured || !restarted)(
  "retains reservations after backend restart and releases only the matching owner into quarantine",
  () =>
    Effect.gen(function* () {
      const service = yield* Accounts.VaultTestAccounts;
      const snapshot = yield* service.snapshot("human"),
        account = snapshot.accounts[0]!;
      expect(account.state).toBe("reserved");
      const lease = account.lease!;
      const input = {
        operationId: "7".repeat(32),
        expectedRevision: snapshot.revision,
        change: { type: "release" as const, id: accountId, leaseId: lease.id },
      };
      expect((yield* service.apply(input, "intruder", Effect.void).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect((yield* service.apply(input, lease.owner, Effect.void)).accounts[0]).toMatchObject({
        state: "quarantined",
        lease: null,
      });
    }).pipe(Effect.provide(layer)),
);

it.live.skipIf(!configured || restarted)(
  "reserves an authenticated run lease with the existing scoped policy and registry version",
  () =>
    Effect.gen(function* () {
      const service = yield* Workloads.VaultTestAccountWorkloads,
        manager = yield* Accounts.VaultTestAccounts,
        vault = yield* Core.VaultCore,
        policy = yield* Access.VaultAccess;
      const itemId = "d".repeat(32),
        id = "e".repeat(32);
      yield* vault.save(
        {
          id: itemId,
          operationId: "8".repeat(32),
          expectedVersion: 0,
          label: "Synthetic runner account",
          kind: "account",
          value: Redacted.make("test-account-plaintext-canary-6284"),
        },
        "human",
      );
      const manage = Effect.fnUntraced(function* (
        change: import("@t3tools/contracts/fork").VaultTestAccountChange,
        operationId: string,
      ) {
        return yield* manager.apply(
          { operationId, expectedRevision: (yield* manager.snapshot("human")).revision, change },
          "human",
          Effect.void,
        );
      });
      yield* manage(
        {
          type: "account-save",
          account: { id, collectionId, label: "Runner", role: "editor", itemId, itemVersion: 1 },
          developmentOnly: true,
        },
        "9".repeat(32),
      );
      yield* manage({ type: "mark-clean", id, confirmedReset: true }, "a".repeat(32));
      yield* policy.apply(
        {
          operationId: "b".repeat(32),
          expectedRevision: (yield* policy.snapshot).revision,
          change: {
            type: "save",
            grant: {
              id: "f".repeat(32),
              label: "Disposable QA pool use",
              principal: { kind: "thread", id: caller.threadId },
              projectId,
              itemIds: [itemId],
              actions: ["inspect", "use"],
              destination: vaultTestAccountDestination(collectionId),
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "human",
      );
      const found = yield* service.discover(caller);
      expect(found.accounts.map((a) => a.id)).toEqual([id]);
      const reserved = yield* service.apply(
        {
          operationId: "c".repeat(32),
          expectedRevision: found.revision,
          change: { type: "reserve", id, durationMs: 900_000 },
        },
        caller,
        Effect.void,
      );
      expect(reserved.accounts[0]!.lease!.owner).toContain("account-proof-run");
      const origin = "https://synthetic-app.example.test";
      yield* policy.apply(
        {
          operationId: "d".repeat(32),
          expectedRevision: (yield* policy.snapshot).revision,
          change: {
            type: "save",
            grant: {
              id: "1".repeat(32),
              label: "Synthetic login origin",
              principal: { kind: "thread", id: caller.threadId },
              projectId,
              itemIds: [itemId],
              actions: ["use"],
              destination: vaultTestAccountLoginDestination(collectionId, origin),
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "human",
      );
      const admission = yield* service.prepareLogin(
        { accountId: id, leaseId: reserved.accounts[0]!.lease!.id, origin },
        caller,
      );
      expect(admission.report.canDeliver).toBe(false);
      yield* admission.revalidate;

      expect(JSON.stringify(reserved)).not.toContain("plaintext-canary");
      yield* service.reconcile;
      expect((yield* service.discover(caller)).accounts[0]!.lease!.id).toBe("c".repeat(32));
    }).pipe(Effect.provide(layer)),
);
it.live.skipIf(!configured || !restarted)(
  "quarantines the durable abandoned run lease after restart without resetting policy3 or registry1",
  () =>
    Effect.gen(function* () {
      const service = yield* Workloads.VaultTestAccountWorkloads,
        manager = yield* Accounts.VaultTestAccounts,
        store = yield* Store.OpenBaoStore,
        crypto = yield* Crypto.Crypto;
      const namespace = Hex.encode(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(environmentId)),
      );
      const before = yield* manager.snapshot("human");
      expect(before.accounts.find((a) => a.id === "e".repeat(32))!.lease!.owner).toContain(
        "account-proof-run",
      );
      yield* service.reconcile;
      const after = yield* manager.snapshot("human");
      expect(after.accounts.find((a) => a.id === "e".repeat(32))).toMatchObject({
        state: "quarantined",
        lease: null,
      });
      expect(
        Redacted.value((yield* store.read(`environments/${namespace}/access-policy`))!.value),
      ).toMatchObject({ schemaVersion: 3 });
      expect(
        Redacted.value(
          (yield* store.read(`environments/${namespace}/profiles/_test_accounts/registry-v1`))!
            .value,
        ),
      ).toMatchObject({ schemaVersion: 1 });
    }).pipe(Effect.provide(layer)),
);
