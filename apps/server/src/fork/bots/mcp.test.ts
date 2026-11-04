import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotOperationMode } from "@t3tools/contracts/fork";
import { hostedThreadLink } from "@t3tools/shared/threadLinks";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Context from "effect/Context";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { BotsService, USER_CALLER } from "./BotsService.ts";
import { BotOperations } from "./BotOperations.ts";
import { reviewer, withHarness } from "./testing/BotsHarness.ts";
import { BotsToolkit, botsHandlers } from "./mcp.ts";

const definition = (id: string, scopeProjectId: ProjectId | null): BotDefinition => ({
  id,
  name: id,
  description: "Review one change.",
  instructions: "Review the change.",
  parameters: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "approval-required",
  interactionMode: "plan",
  workspace: { type: "project", projectId: null, worktree: false },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId,
  version: 1,
  createdBy: "user",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
});

it.effect("hosted discovery selects project bots without leaking another project's bots", () =>
  Effect.gen(function* () {
    const first = ProjectId.make("project:first");
    const second = ProjectId.make("project:second");
    const botDefinitions = [
      definition("global", null),
      definition("first", first),
      definition("second", second),
      { ...definition("archived", first), archivedAt: "2026-01-02T00:00:00.000Z" },
    ];
    const runtime = yield* Layer.build(
      Layer.mock(BotsService)({
        list: () => Effect.succeed(botDefinitions),
        activeRunCount: () => 0,
      }),
    );
    const toolkit = yield* BotsToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(botsHandlers).pipe(
          Layer.provide(Layer.succeed(ForkRuntime, runtime as Context.Context<ForkServices>)),
        ),
      ),
    );
    const callerThreadId = ThreadId.make("thread:caller");
    for (const testCase of [
      { internal: false, selected: first, expected: ["global", "first"] },
      { internal: false, selected: second, expected: ["global", "second"] },
      { internal: false, selected: undefined, expected: ["global"] },
      { internal: true, selected: undefined, expected: ["global", "first"] },
    ]) {
      const result = yield* toolkit
        .handle(
          "loom_bots_list",
          testCase.selected === undefined ? {} : { projectId: testCase.selected },
        )
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, {
            environmentId: EnvironmentId.make("environment:test"),
            capabilities: new Set(["orchestration"] as const),
            issuedAt: 0,
            requestNamespace: "client:hosted",
            thread: testCase.internal
              ? {
                  threadId: callerThreadId,
                  providerSessionId: "provider",
                  providerInstanceId: ProviderInstanceId.make("codex"),
                }
              : undefined,
            client: testCase.internal
              ? undefined
              : { sessionId: "hosted", label: "Hosted Bot", access: "read-only" },
          }),
          Effect.provide(
            Layer.mock(ThreadManagementService)({
              getThreadShell: (id) => Effect.succeed({ ...liveThreadShell(id), projectId: first }),
            }),
          ),
        );
      expect(result.at(-1)?.result).toMatchObject({
        bots: testCase.expected.map((id) => ({ id, activeRuns: 0 })),
      });
    }
  }).pipe(Effect.scoped),
);

it.effect(
  "request lookup recovers admitted work after reauthentication and binds internal project context",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        const first = ProjectId.make("project:first");
        const second = ProjectId.make("project:second");
        yield* bots.save(reviewer({ runtimeMode: "approval-required" }), USER_CALLER);
        const requests = [];
        for (const [index, projectId] of [first, second].entries()) {
          requests.push(
            yield* bots.run(
              {
                botId: "reviewer",
                inputs: { file: "cache.ts" },
                projectId,
                clientRequestId: "lost-launch",
              },
              {
                actor: "agent",
                threadId: null,
                projectId: null,
                runtimeMode: "approval-required",
                requestScope: `client:expired-${index}`,
              },
            ),
          );
        }
        const toolkit = yield* BotsToolkit.pipe(
          Effect.provide(
            McpToolAccess.HandlersLayer.layer(botsHandlers).pipe(
              Layer.provide(
                Layer.succeed(
                  ForkRuntime,
                  Context.make(BotsService, bots) as Context.Context<ForkServices>,
                ),
              ),
            ),
          ),
        );
        const callerThreadId = ThreadId.make("thread:caller");
        for (const testCase of [
          { internal: false, projectId: undefined, expected: requests },
          {
            internal: false,
            projectId: first,
            expected: requests.filter((run) => run.projectId === first),
          },
          {
            internal: true,
            projectId: undefined,
            expected: requests.filter((run) => run.projectId === first),
          },
        ]) {
          const result = yield* toolkit
            .handle("loom_bots_find_request", {
              clientRequestId: "lost-launch",
              ...(testCase.projectId === undefined ? {} : { projectId: testCase.projectId }),
            })
            .pipe(
              Effect.flatMap(Stream.runCollect),
              Effect.provideService(McpInvocationContext, {
                environmentId: EnvironmentId.make("environment:test"),
                capabilities: new Set(["orchestration"] as const),
                issuedAt: 0,
                requestNamespace: "client:reauthenticated",
                thread: testCase.internal
                  ? {
                      threadId: callerThreadId,
                      providerSessionId: "provider",
                      providerInstanceId: ProviderInstanceId.make("codex"),
                    }
                  : undefined,
                client: testCase.internal
                  ? undefined
                  : { sessionId: "reauthenticated", label: "Hosted Bot", access: "read-only" },
              }),
              Effect.provide(
                Layer.mock(ThreadManagementService)({
                  getThreadShell: (id) =>
                    Effect.succeed({ ...liveThreadShell(id), projectId: first }),
                }),
              ),
            );
          const response = result.at(-1)?.result;
          expect(response).toMatchObject({ hasMore: false });
          expect(
            (response && "matches" in response ? response.matches : [])
              .map((match) => match.id)
              .toSorted(),
          ).toEqual(testCase.expected.map((run) => run.id).toSorted());
        }
        expect((yield* bots.listRuns({ limit: 10 })).runs).toHaveLength(2);
      }),
    ),
);

it.effect("bot operation tools preserve connector permissions and the leaf-job boundary", () =>
  Effect.gen(function* () {
    let mode: BotOperationMode = "manual";
    const mutations: Array<string> = [];
    const runtime = yield* Layer.build(
      Layer.mock(BotOperations)({
        state: () => Effect.succeed({ mode }),
        setMode: (next) =>
          Effect.sync(() => {
            mutations.push("mode");
            mode = next;
            return { mode };
          }),
        stopAll: () =>
          Effect.sync(() => {
            mutations.push("stop");
            mode = "paused";
            return {
              mode: "paused" as const,
              cancelled: { runs: 1, batches: 0, pipelines: 0 },
              failures: [],
            };
          }),
      }),
    );
    const toolkit = yield* BotsToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(botsHandlers).pipe(
          Layer.provide(Layer.succeed(ForkRuntime, runtime as Context.Context<ForkServices>)),
        ),
      ),
    );
    const invoke = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      access: "read-only" | "approval-required" | "full-access",
      bot = false,
    ) =>
      effect.pipe(
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("environment:test"),
          capabilities: new Set(["orchestration"] as const),
          issuedAt: 0,
          requestNamespace: "client:operations",
          thread: bot
            ? {
                threadId: ThreadId.make("bot-run-leaf"),
                providerSessionId: "provider",
                providerInstanceId: ProviderInstanceId.make("codex"),
              }
            : undefined,
          client: bot ? undefined : { sessionId: "operations", label: "Hosted Bot", access },
        }),
        Effect.provide(
          Layer.mock(ThreadManagementService)({
            getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
          }),
        ),
      );
    const state = yield* invoke(
      toolkit.handle("loom_bots_operation_state", {}).pipe(Effect.flatMap(Stream.runCollect)),
      "read-only",
    );
    expect(state.at(-1)?.result).toEqual({ mode: "manual" });
    const modeRefusal = yield* invoke(
      toolkit
        .handle("loom_bots_set_mode", { mode: "automatic" })
        .pipe(Effect.flatMap(Stream.runCollect)),
      "approval-required",
    ).pipe(Effect.flip);
    expect(modeRefusal).toMatchObject({ code: "capability_denied" });
    const stopRefusal = yield* invoke(
      toolkit.handle("loom_bots_stop_all", {}).pipe(Effect.flatMap(Stream.runCollect)),
      "read-only",
    ).pipe(Effect.flip);
    expect(stopRefusal).toMatchObject({ code: "capability_denied" });
    const leafRefusal = yield* invoke(
      toolkit.handle("loom_bots_stop_all", {}).pipe(Effect.flatMap(Stream.runCollect)),
      "full-access",
      true,
    ).pipe(Effect.flip);
    expect(leafRefusal).toMatchObject({ reason: "permission" });
    expect(mutations).toEqual([]);
    const stopped = yield* invoke(
      toolkit.handle("loom_bots_stop_all", {}).pipe(Effect.flatMap(Stream.runCollect)),
      "approval-required",
    );
    expect(stopped.at(-1)?.result).toMatchObject({
      mode: "paused",
      cancelled: { runs: 1 },
      failures: [],
    });
    yield* invoke(
      toolkit
        .handle("loom_bots_set_mode", { mode: "manual" })
        .pipe(Effect.flatMap(Stream.runCollect)),
      "full-access",
    );
    expect(mode).toBe("manual");
  }).pipe(Effect.scoped),
);

it.effect("remote result links open the execution computer's conversation", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      const bots = yield* harness.service;
      yield* bots.save(reviewer(), USER_CALLER);
      const admitted = yield* bots.run(
        {
          botId: "reviewer",
          inputs: { file: "cache.ts" },
          projectId: ProjectId.make("project:first"),
        },
        USER_CALLER,
      );
      const remote = {
        ...admitted,
        ranOn: { environmentId: EnvironmentId.make("remote-worker"), label: "Worker" },
      };
      const runtime = yield* Layer.build(
        Layer.mock(BotsService)({ activeRunCount: () => 0, getRun: () => Effect.succeed(remote) }),
      );
      const toolkit = yield* BotsToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(botsHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, runtime as Context.Context<ForkServices>)),
          ),
        ),
      );
      const result = yield* toolkit.handle("loom_bots_run_status", { runId: admitted.id }).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("origin-computer"),
          capabilities: new Set(["orchestration"] as const),
          issuedAt: 0,
          requestNamespace: "client:hosted",
          thread: undefined,
          client: {
            sessionId: "hosted",
            label: "Hosted Bot",
            access: "read-only",
            hostedAppUrl: "https://loom.example",
          },
        }),
      );
      const response = result.at(-1)?.result;
      expect(response && "link" in response ? response.link : undefined).toBe(
        hostedThreadLink(
          { environmentId: EnvironmentId.make("remote-worker"), threadId: admitted.threadId },
          "https://loom.example",
        ),
      );
    }),
  ),
);
