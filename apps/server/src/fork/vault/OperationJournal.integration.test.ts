import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import type { VaultApprovalRetryInput } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as OperationJournal from "./OperationJournal.ts";

const origin = process.env.LOOM_VAULT_TEST_JOURNAL_URL;
const tokenFile = process.env.LOOM_VAULT_TEST_JOURNAL_TOKEN_FILE;
const configured = Boolean(origin && tokenFile);
const restarted = process.env.LOOM_VAULT_TEST_JOURNAL_RESTART === "1";
if (configured && new URL(origin!).hostname !== "127.0.0.1")
  throw new Error("Journal proof requires its disposable loopback backend");
const environmentId = EnvironmentId.make("journal-integration-proof");
const threadId = ThreadId.make("journal-integration-thread");
const projectId = ProjectId.make("journal-integration-project");
const itemId = "a".repeat(32),
  requestId = "e".repeat(32);
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
  Layer.mock(ProjectStoreV2)({ get: () => Effect.succeedNone }),
  Layer.mock(ThreadManagementService)({
    getThreadShell: () =>
      Effect.succeed({
        id: threadId,
        projectId,
        archivedAt: null,
        deletedAt: null,
        activeRunId: RunId.make("journal-run"),
        status: "running",
        runtimeMode: "full-access",
        interactionMode: "default",
      } as never),
  }),
);
const coreLayer = VaultCore.layer.pipe(Layer.provide(dependencies));
const accessLayer = VaultAccess.layer.pipe(
  Layer.provide(ApprovalNotifications.stub),
  Layer.provideMerge(coreLayer),
  Layer.provide(dependencies),
);
const journalLayer = OperationJournal.layer.pipe(
  Layer.provideMerge(accessLayer),
  Layer.provideMerge(dependencies),
);

it.live.skipIf(!configured || restarted)(
  "uses only the existing minimal service policy with CAS and independent format-3 approval reads",
  () =>
    Effect.gen(function* () {
      const core = yield* VaultCore.VaultCore,
        access = yield* VaultAccess.VaultAccess;
      const store = yield* OpenBaoStore.OpenBaoStore,
        journal = yield* OperationJournal.OperationJournal;
      expect((yield* store.status).state).toBe("ready");
      yield* core.save(
        {
          id: itemId,
          operationId: "b".repeat(32),
          expectedVersion: 0,
          label: "Synthetic journal key",
          kind: "ssh-key",
          value: Redacted.make("synthetic-journal-canary"),
        },
        "human",
      );
      yield* access.approvalCreate(
        { id: requestId, threadId, itemId, action: "use", destination: "ssh://qa@qa.invalid:22" },
        `thread:${threadId}`,
        Effect.void,
      );
      yield* access.approvalChange(
        {
          id: requestId,
          operationId: "c".repeat(32),
          expectedRevision: 1,
          expectedPolicyRevision: 0,
          decision: "approve",
          durationMs: 300_000,
        },
        "human",
        Effect.void,
      );
      const input: VaultApprovalRetryInput = {
        id: requestId,
        waitingOperationId: requestId,
        expectedRevision: 2,
        previousOutcome: "not-started",
        operation: {
          kind: "ssh",
          target: { hostname: "qa.invalid", username: "qa", port: 22, hostKey: null },
          input: { id: itemId, command: { expectedVersion: 1, argv: ["true"], timeoutMs: 1000 } },
        },
      };
      const crypto = yield* Crypto.Crypto;
      const namespace = Hex.encode(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(environmentId)),
      );
      const root = `environments/${namespace}`;
      const path = `${root}/profiles/_operations/approval-journal-v1`;
      const policyBefore = yield* store.read(`${root}/access-policy`);
      expect(Redacted.value(policyBefore!.value)).toMatchObject({ schemaVersion: 3 });
      expect(yield* journal.previewRetry(input, threadId)).toMatchObject({
        retryState: "policy-valid-recheck-adapter",
        recovery: { journal: null },
        canExecute: false,
      });
      expect(yield* store.read(path)).toBeNull();
      expect((yield* journal.prepare(input, threadId)).entry.state).toBe("prepared");
      const saved = yield* store.read(path);
      expect(saved?.version).toBe(1);
      expect((yield* store.write(path, saved!.value, 0).pipe(Effect.flip)).reason).toBe("conflict");
      const acquired = yield* journal.acquire(
        input,
        { id: requestId, expectedRevision: 1, reservationId: "d".repeat(32) },
        threadId,
      );
      const reservedRecord = yield* store.read(path);
      expect(yield* journal.previewRetry(input, threadId)).toMatchObject({
        retryState: "requires-outcome-review",
        recovery: { journal: { state: "reserved" } },
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(yield* store.read(path)).toEqual(reservedRecord);
      const rebuilt = yield* OperationJournal.OperationJournal.pipe(
        Effect.provide(Layer.fresh(journalLayer)),
      );
      expect(
        (yield* rebuilt.checkAcquisition(acquired.acquisition, threadId).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(yield* journal.checkAcquisition(acquired.acquisition, threadId)).toMatchObject({
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(
        (yield* journal.checkAcquisition(acquired.acquisition, threadId).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* rebuilt
          .acquire(
            input,
            { id: requestId, expectedRevision: 1, reservationId: "d".repeat(32) },
            threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(yield* rebuilt.reconcile(requestId, threadId)).toMatchObject({
        entry: { state: "unknown" },
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      const reconciledRecord = yield* store.read(path);
      expect(reconciledRecord?.version).toBe(3);
      expect(yield* store.read(`${root}/access-policy`)).toEqual(policyBefore);
      expect((yield* access.approvalInbox).requests[0]?.state).toBe("approved");
      expect(
        (yield* store
          .write(`${root}/approval-journal-v1`, Redacted.make({ forbidden: true }), 0)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      yield* store.write(path, Redacted.make({ schemaVersion: 99 }), 3);
      expect((yield* journal.reconcile(requestId, threadId).pipe(Effect.flip)).reason).toBe(
        "invalid-response",
      );
      expect((yield* access.approvalInbox).requests[0]?.state).toBe("approved");
      yield* access.approvalChange(
        {
          id: requestId,
          operationId: "f".repeat(32),
          expectedRevision: 2,
          expectedPolicyRevision: 1,
          decision: "revoke",
          durationMs: 300_000,
        },
        "human",
        Effect.void,
      );
      expect((yield* access.approvalInbox).requests[0]?.state).toBe("revoked");
      yield* store.write(path, reconciledRecord!.value, 4);
    }).pipe(Effect.provide(journalLayer)),
);

it.live.skipIf(!configured || !restarted)(
  "retains unknown journal outcome and revoked format-3 approval after backend restart",
  () =>
    Effect.gen(function* () {
      const journal = yield* OperationJournal.OperationJournal;
      const access = yield* VaultAccess.VaultAccess;
      expect(yield* journal.reconcile(requestId, threadId)).toMatchObject({
        entry: { state: "unknown", outcome: "unknown" },
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(yield* journal.status(requestId, threadId)).toMatchObject({
        recoveryState: "requires-outcome-review",
        journal: { state: "unknown" },
        status: { request: { state: "revoked" } },
        canExecute: false,
      });
      expect((yield* access.approvalStatus(requestId, threadId)).request.state).toBe("revoked");
    }).pipe(Effect.provide(journalLayer)),
);
