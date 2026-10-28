import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthSessionId,
  EnvironmentId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { ATTENTION_STATUS_WS_METHODS as A } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { AttentionRetry } from "./AttentionRetry.ts";
import { AttentionToolkit, attentionHandlers } from "./mcp.ts";
import { makeAttentionRpcHandlers } from "./rpc.ts";

it.effect("requires write permission for both transports before retrying a run", () =>
  Effect.gen(function* () {
    let calls = 0;
    const input = { threadId: ThreadId.make("target"), runId: RunId.make("failed") };
    const service = AttentionRetry.of({
      retry: () =>
        Effect.sync(() => {
          calls++;
          return { sequence: 2 };
        }),
    });
    const rpc = (write: boolean) =>
      makeAttentionRpcHandlers(
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("test"),
          subject: "test",
          method: "bearer-access-token",
          scopes: write ? [AuthOrchestrationOperateScope] : [],
        }),
      ).pipe(Effect.provideService(AttentionRetry, service));
    const denied = yield* rpc(false);
    expect((yield* denied[A.retry](input).pipe(Effect.flip))._tag).toBe(
      "EnvironmentAuthorizationError",
    );
    const toolkit = yield* AttentionToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(attentionHandlers).pipe(
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(AttentionRetry, service) as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    const invoke = (access: "read-only" | "full-access") =>
      toolkit.handle("loom_thread_retry_failed_run", input).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("test"),
          thread: undefined,
          client: { sessionId: "test", label: "Test", access },
          requestNamespace: "test",
          capabilities: new Set(["orchestration"] as const),
          issuedAt: 0,
        }),
        Effect.provide(
          Layer.mock(ThreadManagementService)({ getThreadShell: () => Effect.succeed(null) }),
        ),
      );
    expect(yield* invoke("read-only").pipe(Effect.flip)).toMatchObject({
      code: "capability_denied",
    });
    expect(calls).toBe(0);
    expect((yield* invoke("full-access"))[0]?.result).toEqual({ sequence: 2 });
    const allowed = yield* rpc(true);
    expect(yield* allowed[A.retry](input)).toEqual({ sequence: 2 });
    expect(calls).toBe(2);
  }),
);
