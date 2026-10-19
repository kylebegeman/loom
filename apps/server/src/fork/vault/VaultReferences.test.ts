import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { VaultError, vaultReferenceText } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as VaultReferences from "./VaultReferences.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
import * as SshTransport from "./SshTransport.ts";
const dependencies = Layer.merge(NodeServices.layer, memoryVault);
const search = { query: "", kind: null, includeArchived: false, cursor: null };
it.effect(
  "keeps stable references through renames and archive, without disclosing forbidden records",
  () =>
    Effect.gen(function* () {
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: () => Effect.succeed({ exitCode: 0, stdout: "" }),
        }),
      );
      const r = yield* VaultReferences.VaultReferences.pipe(
        Effect.provide(VaultReferences.layer),
        Effect.provide(f.context),
      );
      expect(yield* r.describe(f.itemId, f.threadId)).toBeNull();
      expect(yield* r.describe("0".repeat(32), f.threadId)).toBeNull();
      expect((yield* r.search(search, f.threadId)).items).toEqual([]);
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 0,
          change: {
            type: "save",
            grant: {
              id: f.grantId,
              label: "Inspect fixture",
              principal: { kind: "thread", id: f.threadId },
              itemIds: [f.itemId],
              actions: ["inspect"],
              projectId: null,
              destination: null,
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "admin",
      );
      const first = yield* r.describe(f.itemId, f.threadId);
      expect(first?.reference).toBe(vaultReferenceText(f.environmentId, f.itemId));
      expect((yield* r.search({ ...search, query: "launch" }, f.threadId)).items[0]).toEqual(first);
      expect(
        (yield* r.search({ ...search, query: first!.reference }, f.threadId)).items[0],
      ).toEqual(first);
      const itemId = yield* f.id;
      yield* f.core.save(
        {
          id: itemId,
          operationId: yield* f.id,
          expectedVersion: 0,
          label: "Old name",
          kind: "secret",
          value: Redacted.make("synthetic-only"),
        },
        "admin",
      );
      const before = yield* r.describe(itemId);
      yield* f.core.save(
        {
          id: itemId,
          operationId: yield* f.id,
          expectedVersion: 1,
          label: "New name",
          kind: "secret",
          value: Redacted.make("synthetic-only"),
        },
        "admin",
      );
      const renamed = yield* r.describe(itemId);
      expect(renamed?.reference).toBe(before?.reference);
      expect(renamed?.item.label).toBe("New name");
      expect(JSON.stringify(renamed)).not.toContain("synthetic-only");
      yield* f.core.change(
        { id: itemId, operationId: yield* f.id, expectedVersion: 2, action: "archive" },
        "admin",
      );
      expect((yield* r.search({ ...search, query: "new name" })).items).toEqual([]);
      expect(
        (yield* r.search({ ...search, query: "new name", includeArchived: true })).items[0]?.item
          .state,
      ).toBe("archived");
      expect((yield* r.search({ ...search, query: "launch", kind: "secret" })).items).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "bounds sparse scans and preserves continuation cursors, propagating backend errors",
  () =>
    Effect.gen(function* () {
      let calls = 0,
        failed = false;
      const list = (input: { cursor: string | null }) =>
        Effect.suspend(() => {
          calls++;
          if (failed) return Effect.fail(new VaultError({ reason: "unavailable" }));
          const n = input.cursor ? parseInt(input.cursor, 16) + 1 : 1;
          return Effect.succeed({ items: [], nextCursor: n.toString(16).padStart(32, "0") });
        });
      const r = yield* VaultReferences.VaultReferences.pipe(
        Effect.provide(VaultReferences.layer),
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(VaultCore.VaultCore)({ list }),
            Layer.mock(VaultAccess.VaultAccess)({ listForThread: list }),
            Layer.succeed(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(EnvironmentId.make("sparse")),
            }),
          ),
        ),
      );
      const first = yield* r.search({ ...search, query: "absent" }, ThreadId.make("caller"));
      expect(calls).toBe(4);
      expect(first.items).toEqual([]);
      expect(first.nextCursor).toBe("4".padStart(32, "0"));
      const next = yield* r.search({ ...search, cursor: first.nextCursor });
      expect(calls).toBe(8);
      expect(next.nextCursor).toBe("8".padStart(32, "0"));
      failed = true;
      expect((yield* r.search(search).pipe(Effect.flip)).reason).toBe("unavailable");
    }),
);
