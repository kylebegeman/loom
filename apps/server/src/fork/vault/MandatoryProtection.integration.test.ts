import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as ApprovalNotifications from "./ApprovalNotifications.ts";
import * as AccessPolicy from "./AccessPolicy.ts";

const origin = process.env.LOOM_VAULT_TEST_JOURNAL_URL;
const tokenFile = process.env.LOOM_VAULT_TEST_JOURNAL_TOKEN_FILE;
const configured = Boolean(origin && tokenFile);
const restarted = process.env.LOOM_VAULT_TEST_PROTECTION_RESTART === "1";

if (configured && new URL(origin!).hostname !== "127.0.0.1")
  throw new Error("Journal proof requires its disposable loopback backend");
const environmentId = EnvironmentId.make("journal-integration-proof");
const threadId = ThreadId.make("journal-integration-thread");
const projectId = ProjectId.make("journal-integration-project");
const itemId = "a".repeat(32),
  requestId = "1".repeat(32);
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

const layers = accessLayer.pipe(Layer.provideMerge(dependencies));
const oldReader = Schema.decodeUnknownOption(AccessPolicy.LegacyPolicy);
it.live.skipIf(!configured || restarted)(
  "preserves format-4 protection and reservations through actual OpenBao CAS with existing rights",
  () =>
    Effect.gen(function* () {
      const access = yield* VaultAccess.VaultAccess;
      const core = yield* VaultCore.VaultCore;
      const store = yield* OpenBaoStore.OpenBaoStore;
      const crypto = yield* Crypto.Crypto;
      const namespace = Hex.encode(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(environmentId)),
      );
      const path = `environments/${namespace}/access-policy`;
      const now = yield* Clock.currentTimeMillis;
      yield* access.apply(
        {
          operationId: "2".repeat(32),
          expectedRevision: (yield* access.snapshot).revision,
          change: {
            type: "save",
            grant: {
              id: "3".repeat(32),
              label: "Synthetic protection grant",
              principal: { kind: "thread", id: threadId },
              projectId,
              itemIds: [itemId],
              actions: ["use"],
              destination: "ssh://qa@qa.invalid:22",
              notBefore: now,
              expiresAt: now + 300_000,
              parentId: null,
            },
          },
        },
        "human",
      );
      yield* access.approvalCreate(
        { id: requestId, threadId, itemId, action: "use", destination: "ssh://qa@qa.invalid:22" },
        `thread:${threadId}`,
        Effect.void,
      );
      const preview = yield* access.protectionMigrationPreview(
        {
          expectedPolicyRevision: (yield* access.snapshot).revision,
          selections: [{ itemId, itemVersion: 1, mode: "one-time" }],
        },
        "human",
        Effect.void,
      );
      const legacy = yield* store.read(path);
      expect(Redacted.value(legacy!.value)).toMatchObject({ schemaVersion: 3 });
      expect(preview.canMigrate).toBe(false);
      // The disposable operator installs the reviewed preview; no runtime migration is exposed.
      yield* store.write(path, Redacted.make(preview.proposal), preview.sourceStorageVersion);
      const protectedRecord = yield* store.read(path);
      expect(Option.isNone(oldReader(Redacted.value(protectedRecord!.value)))).toBe(true);
      expect(
        (yield* core.reveal({ id: itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* access.explain({
          threadId,
          itemId,
          action: "use",
          destination: "ssh://qa@qa.invalid:22",
        })).decision.reason,
      ).toBe("approval-required");
      const proposal: AccessPolicy.IntentProposal = {
        requestId,
        expectedRequestRevision: 1,
        waitingOperationId: requestId,
        operation: {
          kind: "ssh",
          target: { hostname: "qa.invalid", username: "qa", port: 22, hostKey: null },
          input: { id: itemId, command: { expectedVersion: 1, argv: ["true"], timeoutMs: 1000 } },
        },
      };
      const observed = yield* access.intentPreview(proposal, "human", Effect.void);
      const id = "4".repeat(32);
      const reviewed = yield* access.intentReview(
        {
          ...proposal,
          id,
          expectedPolicyRevision: observed.policyRevision,
          reviewedDigest: observed.binding.operationDigest,
          expiresAt: observed.expiresNoLaterThan,
        },
        "human",
        Effect.void,
      );
      const input = {
        ...proposal,
        id,
        expectedPolicyRevision: (yield* access.snapshot).revision,
        expectedIntentRevision: reviewed.intent.revision,
      };
      const reserved = yield* access.intentReserve(input, threadId, Effect.void);
      expect(reserved).toMatchObject({
        intent: { state: "reserved" },
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(
        (yield* access.intentReserve(input, threadId, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(
        (yield* store
          .write(path, Redacted.make(preview.proposal), preview.sourceStorageVersion)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      const rebuilt = yield* VaultAccess.VaultAccess.pipe(Effect.provide(Layer.fresh(layers)));
      expect((yield* rebuilt.intentStatus(id, "human", Effect.void)).intent).toEqual(
        reserved.intent,
      );
      yield* rebuilt.intentClose(
        {
          id,
          expectedIntentRevision: reserved.intent.revision,
          expectedPolicyRevision: (yield* rebuilt.snapshot).revision,
        },
        "human",
        Effect.void,
      );
      const saved = yield* store.read(path);
      expect(Redacted.value(saved!.value)).toMatchObject({
        schemaVersion: 4,
        intents: [{ state: "unknown" }],
      });
      expect(Option.isNone(oldReader(Redacted.value(saved!.value)))).toBe(true);
      expect(
        (yield* access.intentReserve(input, threadId, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }).pipe(Effect.provide(layers)),
);

it.live.skipIf(!configured || !restarted)(
  "retains format-4 unknown reservation and refusal after actual backend restart",
  () =>
    Effect.gen(function* () {
      const access = yield* VaultAccess.VaultAccess;
      const core = yield* VaultCore.VaultCore;
      const observation = yield* access.intentStatus("4".repeat(32), "human", Effect.void);
      expect(observation).toMatchObject({
        intent: { state: "unknown", revision: 3 },
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      expect(
        (yield* core.reveal({ id: itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* access.explain({
          threadId,
          itemId,
          action: "use",
          destination: "ssh://qa@qa.invalid:22",
        })).decision.reason,
      ).toBe("approval-required");
    }).pipe(Effect.provide(layers)),
);
