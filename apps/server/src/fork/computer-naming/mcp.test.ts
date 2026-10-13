import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, Tool } from "effect/ai";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as ComputerNaming from "./ComputerNaming.ts";
import { ComputerNamingToolkit, computerNamingHandlers } from "./mcp.ts";

const decodeToolInput = Schema.decodeUnknownEffect(McpSchema.ToolJson);

it.effect("exports computer names through MCP and refuses read-only writes before mutation", () =>
  Effect.gen(function* () {
    let renamed = false;
    const state = { name: null, label: "Dorothy", defaultLabel: "Dorothy" };
    const service = ComputerNaming.ComputerNaming.of({
      current: Effect.succeed(state),
      changes: Stream.make(state),
      rename: ({ name }) =>
        Effect.sync(() => {
          renamed = true;
          return { ...state, name, label: name ?? state.defaultLabel };
        }),
    });
    const toolkit = yield* ComputerNamingToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(computerNamingHandlers).pipe(
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(ComputerNaming.ComputerNaming, service) as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    for (const tool of Object.values(ComputerNamingToolkit.tools)) {
      expect((yield* decodeToolInput(Tool.getJsonSchema(tool))).type).toBe("object");
    }
    const invoke = <A, E, R>(effect: Effect.Effect<A, E, R>, access: "read-only" | "full-access") =>
      effect.pipe(
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("mcp-host"),
          capabilities: new Set(["orchestration"] as const),
          issuedAt: 0,
          requestNamespace: "test",
          thread: undefined,
          client: { sessionId: "test", label: "Test", access },
        }),
        Effect.provide(Layer.mock(ThreadManagementService)({})),
      );
    const read = yield* invoke(
      toolkit.handle("loom_computer_name", {}).pipe(Effect.flatMap(Stream.runCollect)),
      "read-only",
    );
    expect(read[0]?.result).toEqual(state);
    const denied = yield* invoke(
      toolkit
        .handle("loom_computer_rename", { name: "Rack Mac" })
        .pipe(Effect.flatMap(Stream.runCollect)),
      "read-only",
    ).pipe(Effect.flip);
    expect(denied).toMatchObject({ code: "capability_denied" });
    expect(renamed).toBe(false);
    const result = yield* invoke(
      toolkit
        .handle("loom_computer_rename", { name: "Rack Mac" })
        .pipe(Effect.flatMap(Stream.runCollect)),
      "full-access",
    );
    expect(result[0]?.result).toMatchObject({ label: "Rack Mac" });
    expect(renamed).toBe(true);
  }),
);
