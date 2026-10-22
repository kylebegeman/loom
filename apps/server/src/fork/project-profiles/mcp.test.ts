import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { ProjectProfileError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext, type McpThreadCaller } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ProjectProfileService } from "./ProjectProfileService.ts";
import { ProjectProfilesToolkit, projectProfilesHandlers } from "./mcp.ts";

it.effect("scopes MCP reads to the caller's project and propagates a sharing refusal", () =>
  Effect.gen(function* () {
    let shared = true;
    const calls: Array<[ThreadId, boolean]> = [];
    const service = {
      forAgent: (threadId: ThreadId, includeEnv: boolean) =>
        Effect.suspend(() => {
          calls.push([threadId, includeEnv]);
          return shared
            ? Effect.succeed(
                "Project notes:\nPrivate context\nEnv status (values omitted):\nTOKEN missing",
              )
            : Effect.fail(new ProjectProfileError({ reason: "sharing-disabled" }));
        }),
    } as ProjectProfileService["Service"];
    const toolkit = yield* ProjectProfilesToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(projectProfilesHandlers).pipe(
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(ProjectProfileService, service) as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    const thread: McpThreadCaller = {
      threadId: ThreadId.make("caller"),
      providerSessionId: "session",
      providerInstanceId: ProviderInstanceId.make("codex"),
    };
    const invoke = (caller: McpThreadCaller | undefined, includeEnv?: boolean) =>
      toolkit
        .handle("loom_project_profiles_get", includeEnv === undefined ? {} : { includeEnv })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, {
            environmentId: EnvironmentId.make("host"),
            capabilities: new Set(["orchestration"] as const),
            issuedAt: 0,
            requestNamespace: "test",
            client: undefined,
            thread: caller,
          }),
        );
    const result = yield* invoke(thread);
    expect(result[0]?.result).toContain("TOKEN missing");
    yield* invoke(thread, false);
    expect(calls).toEqual([
      [thread.threadId, true],
      [thread.threadId, false],
    ]);
    shared = false;
    expect((yield* Effect.flip(invoke(thread))).reason).toBe("sharing-disabled");
    expect((yield* Effect.flip(invoke(undefined))).reason).toBe("thread-not-found");
    expect(calls).toHaveLength(3);
  }),
);
