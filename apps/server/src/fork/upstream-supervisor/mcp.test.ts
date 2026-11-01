import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AuthMcpClientAccess,
} from "@t3tools/contracts";
import type {
  UpstreamSupervisorConfigInput,
  UpstreamSupervisorReceipt,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as Upstream from "./UpstreamSupervisor.ts";
import { UpstreamToolkit, upstreamHandlers } from "./mcp.ts";

it.effect("hosted chief can request bounded control but cannot grant itself owner authority", () =>
  Effect.gen(function* () {
    const projectId = ProjectId.make("acme-project");
    const input = {
      projectId,
      clientRequestId: "one",
      targetTag: "v1.0.0-nightly.1",
      expectedMainSha: "a".repeat(40),
    };
    const config: UpstreamSupervisorConfigInput = {
      projectId,
      clientSessionId: "chief",
      connection: { id: "c".repeat(32), expectedVersion: 1, repository: "acme/app" },
      enabled: false,
    };
    const receipt: UpstreamSupervisorReceipt = {
      ...input,
      id: "b".repeat(64),
      status: "accepted",
      createdAt: "2026-01-01T00:00:00.000Z",
      httpStatus: 204,
      run: null,
    };
    let configured = false;
    const callers: Array<{ owner: boolean; sessionId: string | null }> = [];
    const runtime = Context.make(
      Upstream.UpstreamSupervisor,
      Upstream.UpstreamSupervisor.of({
        configure: (value) =>
          Effect.sync(() => {
            configured = true;
            return { ...value, updatedAt: "2026-01-01T00:00:00.000Z" };
          }),
        status: () =>
          Effect.succeed({
            config: null,
            workflow: "loom-upstream.yml",
            mainSha: null,
            runs: [],
            receipts: [],
          }),
        retryFailed: (value, actor) =>
          actor.authorize.pipe(
            Effect.andThen(
              Effect.sync(() => {
                callers.push(actor);
                return {
                  ...value,
                  id: "d".repeat(64),
                  status: "accepted" as const,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  httpStatus: 201,
                  run: null,
                };
              }),
            ),
          ),
        dispatch: (_value, actor) =>
          actor.authorize.pipe(
            Effect.andThen(
              Effect.sync(() => {
                callers.push(actor);
                return receipt;
              }),
            ),
          ),
      }),
    );
    const toolkit = yield* UpstreamToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(upstreamHandlers).pipe(
          Layer.provide(Layer.succeed(ForkRuntime, runtime as Context.Context<ForkServices>)),
        ),
      ),
    );
    const invoke = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      access: AuthMcpClientAccess,
      linked = false,
    ) =>
      effect.pipe(
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("host"),
          capabilities: new Set(["orchestration"] as const),
          issuedAt: 0,
          requestNamespace: "test",
          thread: undefined,
          client: { sessionId: "chief", label: "Chief", access, linked },
        }),
        Effect.provide(Layer.mock(ThreadManagementService)({})),
      );
    for (const access of ["read-only", "auto-accept-edits"] as const) {
      const denied = yield* invoke(
        toolkit.handle("loom_upstream_configure", config).pipe(Effect.flatMap(Stream.runCollect)),
        access,
      );
      expect(denied[0]?.result).toMatchObject({ code: "capability_denied" });
    }
    const threadId = ThreadId.make("thread:owner-agent");
    const agentScope = {
      environmentId: EnvironmentId.make("host"),
      capabilities: new Set(["orchestration"] as const),
      issuedAt: 0,
      requestNamespace: "agent",
      client: undefined,
      thread: {
        threadId,
        providerSessionId: "provider-session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
    };
    const agentDenied = yield* toolkit.handle("loom_upstream_configure", config).pipe(
      Effect.flatMap(Stream.runCollect),
      Effect.provideService(McpInvocationContext, agentScope),
      Effect.provide(
        Layer.mock(ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
        }),
      ),
    );
    expect(agentDenied[0]?.result).toMatchObject({ reason: "denied" });
    const agentDispatchDenied = yield* toolkit.handle("loom_upstream_dispatch", input).pipe(
      Effect.flatMap(Stream.runCollect),
      Effect.provideService(McpInvocationContext, agentScope),
      Effect.provide(
        Layer.mock(ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
        }),
      ),
    );
    expect(agentDispatchDenied[0]?.result).toMatchObject({ reason: "denied" });
    expect(callers).toEqual([]);
    expect(configured).toBe(false);
    const result = yield* invoke(
      toolkit.handle("loom_upstream_dispatch", input).pipe(Effect.flatMap(Stream.runCollect)),
      "auto-accept-edits",
    );
    expect(result[0]?.result).toEqual(receipt);
    expect(callers).toMatchObject([{ owner: false, sessionId: "chief" }]);
    yield* invoke(
      toolkit.handle("loom_upstream_dispatch", input).pipe(Effect.flatMap(Stream.runCollect)),
      "read-only",
    );
    yield* invoke(
      toolkit.handle("loom_upstream_dispatch", input).pipe(Effect.flatMap(Stream.runCollect)),
      "auto-accept-edits",
      true,
    );
    expect(callers).toHaveLength(1);
    const retry = {
      projectId,
      clientRequestId: "retry-one",
      runId: 42,
      expectedAttempt: 1,
      expectedMainSha: input.expectedMainSha,
    };
    for (const [access, linked] of [
      ["read-only", false],
      ["auto-accept-edits", true],
      ["auto-accept-edits", false],
    ] as const) {
      const outcome = yield* invoke(
        toolkit.handle("loom_upstream_retry_failed", retry).pipe(Effect.flatMap(Stream.runCollect)),
        access,
        linked,
      );
      if (access === "auto-accept-edits" && !linked)
        expect(outcome[0]?.result).toMatchObject({ runId: 42, status: "accepted" });
    }
    const agentRetryDenied = yield* toolkit.handle("loom_upstream_retry_failed", retry).pipe(
      Effect.flatMap(Stream.runCollect),
      Effect.provideService(McpInvocationContext, agentScope),
      Effect.provide(
        Layer.mock(ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
        }),
      ),
    );
    expect(agentRetryDenied[0]?.result).toMatchObject({ reason: "denied" });
    expect(callers).toHaveLength(2);
  }),
);
