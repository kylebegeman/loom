import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultCore from "./VaultCore.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as CleanupLedger from "./CleanupLedger.ts";
import * as LifecycleLedger from "./CredentialLifecycleLedger.ts";
import { syntheticCleanupBarrier } from "./testkit/SyntheticCleanupBarrier.ts";

const origin = process.env.LOOM_VAULT_TEST_JOURNAL_URL;
const tokenFile = process.env.LOOM_VAULT_TEST_JOURNAL_TOKEN_FILE;
const configured = Boolean(origin && tokenFile);
const deleted = process.env.LOOM_VAULT_TEST_MAINTENANCE_DELETED === "1";
const restarted = process.env.LOOM_VAULT_TEST_JOURNAL_RESTART === "1";
if (configured && new URL(origin!).hostname !== "127.0.0.1")
  throw new Error("Maintenance proof requires disposable loopback OpenBao");
const environmentId = EnvironmentId.make("journal-integration-proof");
const storeLayer = OpenBaoStore.layer.pipe(
  Layer.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
  Layer.provide(
    Layer.succeed(HostProcess.Environment, {
      LOOM_VAULT_OPENBAO_URL: origin,
      LOOM_VAULT_OPENBAO_TOKEN_FILE: tokenFile,
      LOOM_VAULT_OPENBAO_MOUNT: "loom",
    }),
  ),
);
const dependencies = Layer.mergeAll(
  NodeServices.layer,
  storeLayer,
  Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
  Layer.mock(ThreadManagementService)({ getThreadShell: () => Effect.succeed(null) }),
  Layer.mock(ProjectStoreV2)({ get: () => Effect.succeedNone }),
);
const accessLayer = VaultAccess.layer.pipe(
  Layer.provide(ApprovalNotifications.stub),
  Layer.provide(VaultCore.layer.pipe(Layer.provide(dependencies))),
  Layer.provide(dependencies),
);
const layers = Layer.mergeAll(CleanupLedger.layer, LifecycleLedger.layer, accessLayer).pipe(
  Layer.provideMerge(dependencies),
);
const scope: CleanupLedger.CleanupScope = {
  environmentId,
  itemId: "1".repeat(32),
  itemVersion: 1,
  accountId: "2".repeat(32),
  collectionId: "3".repeat(32),
  machineId: "4".repeat(32),
  application: "Disposable Loom target",
  target: "development",
  origin: "http://127.0.0.1:15713",
};
const prepared: LifecycleLedger.LifecycleRecord = {
  id: "5".repeat(32),
  itemId: "6".repeat(32),
  itemVersion: 1,
  issuer: { itemId: "7".repeat(32), version: 1 },
  generation: 1,
  bindingDigest: "8".repeat(64),
  consumersDigest: "9".repeat(64),
  createdAt: 0,
  expiresAt: Number.MAX_SAFE_INTEGER,
  updatedAt: 0,
  revision: 1,
  phase: "prepared",
  credential: null,
  receiptDigest: null,
};

it.live.skipIf(!configured || deleted)(
  "persists independent maintenance records using only profiles/* and keeps format-3 approvals readable",
  () =>
    Effect.gen(function* () {
      const cleanup = yield* CleanupLedger.CleanupLedger;
      const lifecycle = yield* LifecycleLedger.CredentialLifecycleLedger;
      const access = yield* VaultAccess.VaultAccess;
      const store = yield* OpenBaoStore.OpenBaoStore;
      const policyBefore = yield* access.snapshot;
      expect(policyBefore.grants.length).toBeGreaterThan(0);
      let starts = 0;
      const model = syntheticCleanupBarrier(
        scope,
        cleanup,
        {
          start: () =>
            Effect.sync(() => {
              starts++;
            }),
          fence: (ticket) => Effect.succeed({ ticket, outcome: "fenced" }),
          reset: (intent) => Effect.succeed(intent),
        },
        { start: () => Effect.void, maintain: Effect.void },
      );
      if (!restarted) {
        yield* model.enroll;
        yield* model.reset("bootstrap");
        yield* model.start({
          operationId: "maintenance-operation",
          leaseId: "maintenance-lease",
          runId: "maintenance-run",
        });
        const stale = yield* cleanup.read;
        expect((yield* cleanup.cas(stale.revision - 1, stale).pipe(Effect.flip)).reason).toBe(
          "conflict",
        );
        const now = yield* Clock.currentTimeMillis;
        yield* lifecycle.cas(0, {
          revision: 1,
          entries: [{ ...prepared, createdAt: now, updatedAt: now }],
        });
        const state = yield* lifecycle.read;
        yield* lifecycle.cas(state.revision, {
          revision: state.revision + 1,
          entries: [{ ...state.entries[0]!, phase: "issuing", revision: 2 }],
        });
      } else {
        expect((yield* model.snapshot).phase).toBe("uncertain");
        expect(
          (yield* model
            .start({
              operationId: "another-operation",
              leaseId: "another-lease",
              runId: "another-run",
            })
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        expect(starts).toBe(0);
        yield* model.cleanup;
        expect((yield* model.snapshot).phase).toBe("fenced");
        const state = yield* lifecycle.read;
        expect(state.entries[0]).toMatchObject({ phase: "issuing", id: prepared.id });
      }
      expect(yield* access.snapshot).toEqual(policyBefore);
      expect((yield* access.approvalInbox).requests.length).toBeGreaterThan(0);
      expect(
        (yield* store
          .write("environments/sibling/profiles/_operations/cleanup-reset-v1", Redacted.make({}), 0)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(model.gates).toMatchObject({
        canExecute: false,
        canReset: false,
        canReuse: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
    }).pipe(Effect.provide(layers)),
);

it.live.skipIf(!configured || !deleted)(
  "refuses soft-deleted maintenance records rather than reporting revision zero",
  () =>
    Effect.gen(function* () {
      const cleanup = yield* CleanupLedger.CleanupLedger;
      const lifecycle = yield* LifecycleLedger.CredentialLifecycleLedger;
      expect((yield* cleanup.read.pipe(Effect.flip)).reason).toBe("invalid-response");
      expect((yield* lifecycle.read.pipe(Effect.flip)).reason).toBe("invalid-response");
    }).pipe(Effect.provide(layers)),
);
