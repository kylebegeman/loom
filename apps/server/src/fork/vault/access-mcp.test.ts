import { expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { VaultError, type VaultGrant } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { VaultAccess } from "./VaultAccess.ts";
import { VaultAccessToolkit, vaultAccessHandlers } from "./access-mcp.ts";
const threadId = ThreadId.make("authenticated-vault-thread");
const grant: VaultGrant = {
  definition: {
    id: "a".repeat(32),
    label: "Development",
    principal: { kind: "thread", id: threadId },
    itemIds: ["b".repeat(32)],
    actions: ["manage"],
    projectId: null,
    destination: null,
    notBefore: 0,
    expiresAt: null,
    parentId: null,
  },
  revision: 1,
  state: "active",
  createdBy: "human",
  updatedBy: "human",
};
const input = {
  operationId: "c".repeat(32),
  expectedRevision: 0,
  change: { type: "save" as const, grant: grant.definition },
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

it.effect("denies agent self-approval and read-only clients before calling grant mutation", () =>
  Effect.gen(function* () {
    let mutations = 0;
    const serviceLayer = Layer.mock(VaultAccess)({
      apply: (_input, actor, authorize) =>
        Effect.gen(function* () {
          yield* authorize!;
          mutations++;
          expect(actor).toBe("client:administrator");
          return grant;
        }),
    });
    const serviceContext = yield* Layer.build(serviceLayer);
    const toolkit = yield* VaultAccessToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(vaultAccessHandlers).pipe(
          Layer.provide(
            Layer.succeed(ForkRuntime, serviceContext as Context.Context<ForkServices>),
          ),
        ),
      ),
    );
    const invoke = (caller: McpInvocationScope) =>
      toolkit.handle("loom_vault_grants_apply", input).pipe(
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
    const result = yield* invoke({
      ...scope,
      thread: undefined,
      client: { sessionId: "administrator", label: "Admin", access: "full-access" },
    });
    expect(result[0]?.result).toEqual(grant);
    expect(mutations).toBe(1);
  }).pipe(Effect.scoped),
);
it.effect(
  "binds self explanations to the authenticated caller even with injected identity fields",
  () =>
    Effect.gen(function* () {
      const serviceContext = yield* Layer.build(
        Layer.mock(VaultAccess)({
          explain: (request, restrictMetadata) =>
            Effect.gen(function* () {
              expect(request.threadId).toBe(threadId);
              expect(restrictMetadata).toBe(true);
              return yield* new VaultError({ reason: "unavailable" });
            }),
        }),
      );
      const toolkit = yield* VaultAccessToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultAccessHandlers).pipe(
            Layer.provide(
              Layer.succeed(ForkRuntime, serviceContext as Context.Context<ForkServices>),
            ),
          ),
        ),
      );
      const failed = yield* toolkit
        .handle("loom_vault_access_explain", {
          itemId: "b".repeat(32),
          action: "manage",
          destination: null,
          threadId: "spoofed-thread",
        } as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provide(Layer.mock(ThreadManagementService)({})),
          Effect.flip,
        );
      expect(failed).toMatchObject({ _tag: "VaultError", reason: "unavailable" });
    }).pipe(Effect.scoped),
);
