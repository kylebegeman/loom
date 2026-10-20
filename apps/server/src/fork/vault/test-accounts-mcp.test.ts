import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { type VaultTestAccountDiscovery, VaultError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { VaultTestAccountWorkloads } from "./VaultTestAccountWorkloads.ts";
import { VaultTestAccountToolkit, vaultTestAccountHandlers } from "./test-accounts-mcp.ts";
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("test-account-mcp"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: "test",
  client: undefined,
  thread: {
    threadId: ThreadId.make("authenticated-thread"),
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
};
const request = {
  operationId: "a".repeat(32),
  expectedRevision: 3,
  change: { type: "reserve" as const, id: "b".repeat(32), durationMs: 300_000 as const },
};
const result: VaultTestAccountDiscovery = {
  revision: 3,
  checkedAt: 0,
  accounts: [],
  collections: [],
  loginDelivery: "unsupported",
};

it.effect(
  "requires a thread, preserves trusted identity, and rechecks the runtime before mutation",
  () =>
    Effect.gen(function* () {
      let calls = 0,
        lowered = false;
      const context = yield* Layer.build(
        Layer.mock(VaultTestAccountWorkloads)({
          discover: (caller) =>
            Effect.sync(() => {
              expect(caller).toEqual({
                environmentId: scope.environmentId,
                threadId: scope.thread!.threadId,
                providerInstanceId: scope.thread!.providerInstanceId,
              });
              calls++;
              return result;
            }),
          apply: (input, caller, authorize) =>
            Effect.gen(function* () {
              expect(caller.threadId).toBe(scope.thread!.threadId);
              expect(input.change.type).toBe("reserve");
              yield* authorize;
              lowered = true;
              yield* authorize;
              calls++;
              return result;
            }),
        }),
      );
      const toolkit = yield* VaultTestAccountToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultTestAccountHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
          ),
        ),
      );
      const run = <A, E, R, E2, R2>(
        effect: Effect.Effect<Stream.Stream<A, E2, R2>, E, R>,
        caller: McpInvocationScope = scope,
      ) =>
        effect.pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, caller),
          Effect.provide(
            Layer.mock(ThreadManagementService)({
              getThreadShell: (id) =>
                Effect.sync(() =>
                  liveThreadShell(id, {
                    runtimeMode: lowered ? "approval-required" : "full-access",
                  }),
                ),
            }),
          ),
        );
      for (const access of ["read-only", "full-access"] as const) {
        const client = {
          ...scope,
          thread: undefined,
          client: { access, label: "Outside client", sessionId: "external" },
        };
        expect(
          (yield* run(toolkit.handle("loom_vault_test_accounts_discover", {}), client).pipe(
            Effect.flip,
          ))._tag,
        ).toBe("OrchestratorMcpFailure");
        const failure = yield* run(
          toolkit.handle("loom_vault_test_accounts_apply", request),
          client,
        ).pipe(Effect.flip);
        expect(["VaultError", "OrchestratorMcpFailure"]).toContain(failure._tag);
      }
      expect(calls).toBe(0);
      const discovery = yield* run(toolkit.handle("loom_vault_test_accounts_discover", {}));
      expect(discovery[0]?.result).toEqual(result);
      const failure = yield* run(toolkit.handle("loom_vault_test_accounts_apply", request)).pipe(
        Effect.flip,
      );
      expect(failure).toBeInstanceOf(VaultError);
      expect(calls).toBe(1);
    }).pipe(Effect.scoped),
);
