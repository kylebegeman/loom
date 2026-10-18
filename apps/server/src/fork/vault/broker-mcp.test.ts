import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { VaultBrokers } from "./VaultBrokers.ts";
import { VaultBrokerToolkit, vaultBrokerHandlers } from "./broker-mcp.ts";
const threadId = ThreadId.make("authenticated-broker-thread");
const result = { revision: 1, machine: null };
const input = {
  operationId: "a".repeat(32),
  expectedRevision: 0,
  change: { type: "cancel" as const, enrollmentId: "b".repeat(32) },
};
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("vault-test"),
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  requestNamespace: "vault-test",
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
};

it.effect("denies agent self-approval and read-only clients before calling broker approval", () =>
  Effect.gen(function* () {
    let mutations = 0;
    const serviceLayer = Layer.mock(VaultBrokers)({
      apply: (_input, actor, authorize) =>
        Effect.gen(function* () {
          yield* authorize!;
          mutations++;
          expect(actor).toBe("client:administrator");
          return result;
        }),
    });
    const serviceContext = yield* Layer.build(serviceLayer);
    const toolkit = yield* VaultBrokerToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(vaultBrokerHandlers).pipe(
          Layer.provide(
            Layer.succeed(ForkRuntime, serviceContext as Context.Context<ForkServices>),
          ),
        ),
      ),
    );
    const invoke = (caller: McpInvocationScope) =>
      toolkit.handle("loom_vault_brokers_apply", input).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, caller),
        Effect.provide(
          Layer.mock(ThreadManagementService)({
            getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
          }),
        ),
      );
    expect((yield* invoke(scope).pipe(Effect.flip))._tag).toBe("VaultError");
    expect(
      (yield* invoke({
        ...scope,
        thread: undefined,
        client: { sessionId: "reader", label: "Reader", access: "read-only" },
      }).pipe(Effect.flip))._tag,
    ).toBe("OrchestratorMcpFailure");
    expect(mutations).toBe(0);
    const response = yield* invoke({
      ...scope,
      thread: undefined,
      client: { sessionId: "administrator", label: "Admin", access: "full-access" },
    });
    expect(response[0]?.result).toEqual(result);
    expect(mutations).toBe(1);
  }).pipe(Effect.scoped),
);
