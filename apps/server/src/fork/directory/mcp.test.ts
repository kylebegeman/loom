import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type AuthMcpClientAccess } from "@t3tools/contracts";
import { DirectoryError, type DirectoryForgetRequest } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { McpSchema, Tool } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { DirectoryService } from "./DirectoryService.ts";
import { DirectoryToolkit, directoryHandlers } from "./mcp.ts";

const decodeToolSchema = Schema.decodeUnknownEffect(McpSchema.ToolJson);

const target = { kind: "environment", environmentId: EnvironmentId.make("old-computer") } as const;
const setup = Effect.fn("test.directoryMcp")(function* (refused = false) {
  const calls: DirectoryForgetRequest[] = [];
  const service = yield* DirectoryService.pipe(
    Effect.provide(
      Layer.mock(DirectoryService)({
        forget: (request) => {
          calls.push(request);
          return refused
            ? Effect.fail(new DirectoryError({ reason: "reach-active" }))
            : Effect.void;
        },
      }),
    ),
  );
  const toolkit = yield* DirectoryToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(directoryHandlers).pipe(
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(DirectoryService, service) as unknown as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );
  const invoke = (access: AuthMcpClientAccess) =>
    toolkit.handle("loom_directory_forget", { entry: target }).pipe(
      Effect.flatMap(Stream.runCollect),
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("library"),
        capabilities: new Set(["orchestration"] as const),
        issuedAt: 0,
        requestNamespace: "test",
        thread: undefined,
        client: { sessionId: "test", label: "Test", access },
      }),
      Effect.provide(Layer.mock(ThreadManagementService)({})),
    );
  return { calls, invoke };
});

describe("directory forget MCP", () => {
  it.effect("advertises an object input schema for MCP registration", () =>
    Effect.gen(function* () {
      const schema = yield* decodeToolSchema(
        Tool.getJsonSchema(DirectoryToolkit.tools.loom_directory_forget),
      );
      expect(schema.type).toBe("object");
    }),
  );
  it.effect("forgets the requested computer with full access", () =>
    Effect.gen(function* () {
      const { calls, invoke } = yield* setup();
      yield* invoke("full-access");
      expect(calls).toEqual([target]);
    }),
  );
  it.effect("keeps the Reach refusal and blocks a read-only caller", () =>
    Effect.gen(function* () {
      const { calls, invoke } = yield* setup(true);
      expect(yield* invoke("read-only").pipe(Effect.flip)).toMatchObject({
        code: "capability_denied",
      });
      expect(calls).toEqual([]);
      expect(yield* invoke("full-access").pipe(Effect.flip)).toMatchObject({
        reason: "reach-active",
      });
      expect(calls).toEqual([target]);
    }),
  );
});
