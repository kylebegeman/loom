import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import { EnvironmentId, ThreadId, ProjectId, RunId } from "@t3tools/contracts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultCore from "./VaultCore.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const configured = Boolean(
  process.env.LOOM_VAULT_TEST_OPENBAO_URL && process.env.LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE,
);
const restoring = process.env.LOOM_VAULT_TEST_OPENBAO_RESTORE === "1";
const key = "integration/persistent-record";
const secret = "synthetic-backup-recovery-canary";
const layer = OpenBaoStore.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  Layer.provide(
    Layer.succeed(HostProcess.Environment, {
      LOOM_VAULT_OPENBAO_URL: process.env.LOOM_VAULT_TEST_OPENBAO_URL,
      LOOM_VAULT_OPENBAO_TOKEN_FILE: process.env.LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE,
    }),
  ),
);

it.live.skipIf(!configured || restoring)(
  "stores encrypted KV versions and enforces CAS in real OpenBao",
  () =>
    Effect.gen(function* () {
      const store = yield* OpenBaoStore.OpenBaoStore;
      expect((yield* store.status).state).toBe("ready");
      expect(yield* store.write(key, Redacted.make({ value: secret, revision: 1 }), 0)).toBe(1);
      expect(
        (yield* store.write(key, Redacted.make({ value: "stale" }), 0).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(yield* store.write(key, Redacted.make({ value: secret, revision: 2 }), 1)).toBe(2);
      const stored = yield* store.read(key);
      expect(stored?.version).toBe(2);
      expect(Redacted.value(stored!.value)).toEqual({ value: secret, revision: 2 });
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(yield* store.keys("integration")).toContain("persistent-record");
    }).pipe(Effect.provide(layer)),
);

it.live.skipIf(!configured || !restoring)(
  "reads the same encrypted versions after backup, clean restore and unseal",
  () =>
    Effect.gen(function* () {
      const store = yield* OpenBaoStore.OpenBaoStore;
      expect((yield* store.status).state).toBe("ready");
      const record = yield* store.read(key);
      expect(record?.version).toBe(2);
      expect(Redacted.value(record!.value)).toEqual({ value: secret, revision: 2 });
    }).pipe(Effect.provide(layer)),
);

// The policy and encrypted item share a real backend but retain independent CAS records.
const policyEnvironment = EnvironmentId.make("openbao-policy-integration");
const policyThread = ThreadId.make("openbao-policy-thread");
const policyItem = "7".repeat(32),
  policyGrant = "8".repeat(32);
const policyDependencies = Layer.mergeAll(
  NodeServices.layer,
  layer,
  Layer.succeed(ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(policyEnvironment),
  }),
  Layer.mock(ProjectStoreV2)({ get: () => Effect.succeedNone }),
  Layer.mock(ThreadManagementService)({
    getThreadShell: () =>
      Effect.succeed({
        id: policyThread,
        projectId: ProjectId.make("openbao-project"),
        archivedAt: null,
        deletedAt: null,
        activeRunId: RunId.make("openbao-run"),
      } as never),
  }),
);
const policyCore = VaultCore.layer.pipe(Layer.provide(policyDependencies));
const policyLayer = VaultAccess.layer.pipe(
  Layer.provide(ApprovalNotifications.stub),
  Layer.provideMerge(policyCore),
  Layer.provide(policyDependencies),
);

it.live.skipIf(!configured || restoring)(
  "persists an access grant, decision history and revocation in real OpenBao",
  () =>
    Effect.gen(function* () {
      const core = yield* VaultCore.VaultCore;
      yield* core.save(
        {
          id: policyItem,
          operationId: "9".repeat(32),
          expectedVersion: 0,
          label: "Synthetic service identity",
          kind: "secret",
          value: Redacted.make(secret),
        },
        "fixture-admin",
      );
      const access = yield* VaultAccess.VaultAccess;
      yield* access.apply(
        {
          operationId: "a".repeat(32),
          expectedRevision: 0,
          change: {
            type: "save",
            grant: {
              id: policyGrant,
              label: "Synthetic grant",
              principal: { kind: "thread", id: policyThread },
              itemIds: [policyItem],
              actions: ["inspect"],
              projectId: "openbao-project",
              destination: null,
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "fixture-admin",
      );
      yield* access.require(policyThread, policyItem, "inspect", null);
      yield* access.apply(
        {
          operationId: "b".repeat(32),
          expectedRevision: 1,
          change: { type: "state", id: policyGrant, state: "revoked" },
        },
        "fixture-admin",
      );
      expect(
        (yield* access.require(policyThread, policyItem, "inspect", null).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect((yield* access.snapshot).audit[0]?.reason).toBe("not-active");
    }).pipe(Effect.provide(policyLayer)),
);
it.live.skipIf(!configured || !restoring)(
  "retains policy revocation and safe decision history after clean restore",
  () =>
    Effect.gen(function* () {
      const access = yield* VaultAccess.VaultAccess;
      const snapshot = yield* access.snapshot;
      expect(snapshot.revision).toBe(2);
      expect(snapshot.grants[0]?.state).toBe("revoked");
      expect(
        snapshot.audit.some((event) => event.type === "decision" && event.reason === "allowed"),
      ).toBe(true);
      expect(
        (yield* access.require(policyThread, policyItem, "inspect", null).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(JSON.stringify(snapshot)).not.toContain(secret);
    }).pipe(Effect.provide(policyLayer)),
);
