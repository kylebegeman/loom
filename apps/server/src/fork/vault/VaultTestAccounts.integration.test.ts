import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
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
const dependencies = Layer.mergeAll(
  NodeServices.layer,
  store,
  Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(environmentId) }),
);
const core = Core.layer.pipe(Layer.provide(dependencies));
const layer = Accounts.layer.pipe(Layer.provideMerge(core), Layer.provideMerge(dependencies));
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
