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
import * as OperationJournal from "./OperationJournal.ts";
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

it.effect(
  "binds approval requests to the authenticated thread and cannot expose a decision tool",
  () =>
    Effect.gen(function* () {
      let called = false;
      const serviceContext = yield* Layer.build(
        Layer.mock(VaultAccess)({
          approvalCreate: (request, actor, authorize) =>
            Effect.gen(function* () {
              yield* authorize;
              called = true;
              expect(request.threadId).toBe(threadId);
              expect(actor).toBe(`thread:${threadId}`);
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
        .handle("loom_vault_access_request", {
          id: "e".repeat(32),
          threadId: "spoofed",
          itemId: "b".repeat(32),
          action: "use",
          destination: null,
        } as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provide(
            Layer.mock(ThreadManagementService)({
              getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
            }),
          ),
          Effect.flip,
        );
      expect(failed).toMatchObject({ _tag: "VaultError", reason: "unavailable" });
      expect(called).toBe(true);
      expect(
        Object.keys(VaultAccessToolkit.tools).some((name) => name.includes("approvals_decide")),
      ).toBe(false);
    }).pipe(Effect.scoped),
);

it.effect(
  "scopes requester status and cancellation to the invocation identity, ignoring injected target and decision fields",
  () =>
    Effect.gen(function* () {
      let statusCalls = 0,
        cancelCalls = 0,
        prepareCalls = 0;
      const serviceContext = yield* Layer.build(
        Layer.merge(
          Layer.mock(OperationJournal.OperationJournal)({
            previewRetry: (_input, requester) =>
              Effect.gen(function* () {
                prepareCalls++;
                expect(requester).toBe(threadId);
                return yield* new VaultError({ reason: "not-found" });
              }),
          }),
          Layer.mock(VaultAccess)({
            approvalStatus: (id, requester) =>
              Effect.gen(function* () {
                statusCalls++;
                expect(id).toBe("e".repeat(32));
                expect(requester).toBe(threadId);
                return yield* new VaultError({ reason: "not-found" });
              }),
            approvalCancel: (input, requester, authorize) =>
              Effect.gen(function* () {
                yield* authorize;
                cancelCalls++;
                expect(requester).toBe(threadId);
                expect(input.id).toBe("e".repeat(32));
                return yield* new VaultError({ reason: "not-found" });
              }),
          }),
        ),
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
      const dependencies = Layer.mock(ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      });
      const injected = {
        id: "e".repeat(32),
        threadId: "other-thread",
        decision: "approve",
        operationId: "f".repeat(32),
        expectedRevision: 1,
      };
      const retry = {
        ...injected,
        waitingOperationId: "e".repeat(32),
        previousOutcome: "not-started",
        operation: {
          kind: "github-api",
          input: {
            id: "b".repeat(32),
            expectedVersion: 1,
            repository: "org/repo",
            operation: { action: "repo-view" },
          },
        },
      };
      yield* toolkit
        .handle("loom_vault_access_retry_prepare", retry as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provide(dependencies),
          Effect.flip,
        );
      expect(prepareCalls).toBe(1);
      const status = yield* toolkit
        .handle("loom_vault_access_request_status", injected as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provide(dependencies),
          Effect.flip,
        );
      expect(status).toMatchObject({ _tag: "VaultError", reason: "not-found" });
      const cancel = yield* toolkit
        .handle("loom_vault_access_request_cancel", injected as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provide(dependencies),
          Effect.flip,
        );
      expect(cancel).toMatchObject({ _tag: "VaultError", reason: "not-found" });
      expect(statusCalls).toBe(1);
      expect(cancelCalls).toBe(1);
      const outside = {
        ...scope,
        thread: undefined,
        client: { sessionId: "reader", label: "Reader", access: "read-only" as const },
      };
      yield* toolkit
        .handle("loom_vault_access_request_status", injected as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, outside),
          Effect.provide(dependencies),
          Effect.flip,
        );
      yield* toolkit
        .handle("loom_vault_access_request_cancel", injected as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, outside),
          Effect.provide(dependencies),
          Effect.flip,
        );
      yield* toolkit
        .handle("loom_vault_access_retry_prepare", retry as never)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, outside),
          Effect.provide(dependencies),
          Effect.flip,
        );
      expect(prepareCalls).toBe(1);
      expect(statusCalls).toBe(1);
      expect(cancelCalls).toBe(1);
    }).pipe(Effect.scoped),
);

it.effect(
  "restricts read-only journal recovery to the authenticated requester without exposing mutations",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      const serviceContext = yield* Layer.build(
        Layer.mock(OperationJournal.OperationJournal)({
          status: (id, requester) =>
            Effect.gen(function* () {
              calls++;
              expect(id).toBe("e".repeat(32));
              expect(requester).toBe(threadId);
              return yield* new VaultError({ reason: "not-found" });
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
      const invoke = (caller: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_access_recovery_status", {
            id: "e".repeat(32),
            threadId: "spoofed",
            reconcile: true,
            canExecute: true,
          } as never)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, caller),
            Effect.provide(
              Layer.mock(ThreadManagementService)({
                getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
              }),
            ),
            Effect.flip,
          );
      expect(yield* invoke(scope)).toMatchObject({ _tag: "VaultError", reason: "not-found" });
      expect(calls).toBe(1);
      for (const access of ["read-only", "full-access"] as const) {
        expect(
          yield* invoke({
            ...scope,
            thread: undefined,
            client: { sessionId: "human", label: "Human", access },
          }),
        ).toMatchObject({ _tag: "OrchestratorMcpFailure", code: "thread_credential_required" });
      }
      expect(calls).toBe(1);
      expect(
        Object.keys(VaultAccessToolkit.tools).some((name) =>
          /journal.*(reserve|finish|reconcile|cancel|prepare)/.test(name),
        ),
      ).toBe(false);
    }).pipe(Effect.scoped),
);
