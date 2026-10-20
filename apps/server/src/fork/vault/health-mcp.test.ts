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
import * as VaultHealth from "./VaultHealth.ts";
import * as VaultHealthChecks from "./VaultHealthChecks.ts";
import { VaultHealthToolkit, vaultHealthHandlers } from "./health-mcp.ts";

it.effect(
  "keeps maintenance reads and probes administrator-only and returns outage groups without a probe",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("maintenance-acceptance");
      let reads = 0,
        probes = 0;
      const snapshot = {
        revision: 0,
        checkedAt: 0,
        rules: [],
        issues: [],
        omittedIssues: 0,
        outageGroups: [],
      };
      const health = Layer.mock(VaultHealth.VaultHealth)({
        snapshot: Effect.sync(() => {
          reads++;
          return snapshot;
        }),
      });
      const checks = Layer.mock(VaultHealthChecks.VaultHealthChecks)({
        recheck: () =>
          Effect.sync(() => {
            probes++;
            return { snapshot, outcome: "unconfigured" as const };
          }),
      });
      const services = yield* Layer.build(Layer.merge(health, checks));
      const threads = Layer.mock(ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      });
      const toolkit = yield* VaultHealthToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultHealthHandlers).pipe(
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
          .handle("loom_vault_health", {})
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(threads),
            Effect.provideService(McpInvocationContext, scope),
          );
      const recheck = (scope: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_health_recheck", { itemId: "a".repeat(32) })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(threads),
            Effect.provideService(McpInvocationContext, scope),
          );
      expect((yield* inspect(agent).pipe(Effect.flip))._tag).toBe("VaultError");
      expect((yield* inspect(readonly).pipe(Effect.flip))._tag).toBe("VaultError");
      expect((yield* recheck(agent).pipe(Effect.flip))._tag).toBe("VaultError");
      expect((yield* recheck(readonly).pipe(Effect.flip))._tag).toBe("OrchestratorMcpFailure");
      expect(reads).toBe(0);
      expect(probes).toBe(0);
      expect((yield* inspect(admin))[0]?.result).toMatchObject({ outageGroups: [] });
      expect(reads).toBe(1);
      expect(probes).toBe(0);
      expect((yield* recheck(admin))[0]?.result).toMatchObject({ outcome: "unconfigured" });
      expect(probes).toBe(1);
    }).pipe(Effect.scoped),
);
