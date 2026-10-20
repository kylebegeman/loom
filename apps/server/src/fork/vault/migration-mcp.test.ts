import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as VaultMigration from "./VaultMigration.ts";
import { VaultMigrationToolkit, vaultMigrationHandlers } from "./migration-mcp.ts";

it.effect(
  "keeps development migration summaries administrator-only and exposes no private ingress",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("maintenance-acceptance");
      let reads = 0;
      const migration = Layer.mock(VaultMigration.VaultMigration)({
        list: () =>
          Effect.sync(() => {
            reads++;
            return { items: [], nextCursor: null };
          }),
      });
      const services = yield* Layer.build(migration);
      const threads = Layer.mock(ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      });
      const toolkit = yield* VaultMigrationToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultMigrationHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, services as Context.Context<ForkServices>)),
          ),
        ),
      );
      const admin: McpInvocationScope = {
        environmentId: EnvironmentId.make("maintenance-environment"),
        capabilities: new Set(["orchestration"]),
        issuedAt: 0,
        requestNamespace: "maintenance",
        thread: undefined,
        client: { sessionId: "admin", access: "full-access", label: "Admin" },
      };
      const agent: McpInvocationScope = {
        ...admin,
        client: undefined,
        thread: {
          threadId,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: "qa",
        },
      };
      const readonly: McpInvocationScope = {
        ...admin,
        client: { ...admin.client!, access: "read-only" },
      };
      const inspect = (scope: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_migration_plans", { cursor: null })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(threads),
            Effect.provideService(McpInvocationContext, scope),
          );
      expect((yield* inspect(agent).pipe(Effect.flip))._tag).toBe("VaultError");
      expect((yield* inspect(readonly).pipe(Effect.flip))._tag).toBe("VaultError");
      expect(reads).toBe(0);
      expect((yield* inspect(admin))[0]?.result).toEqual({ items: [], nextCursor: null });
      expect(reads).toBe(1);
      expect(Object.keys(VaultMigrationToolkit.tools).sort()).toEqual([
        "loom_vault_migration_plans",
        "loom_vault_migration_status",
      ]);
    }).pipe(Effect.scoped),
);
