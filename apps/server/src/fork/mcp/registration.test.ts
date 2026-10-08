import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/ai";
import { FORK_MCP_TOOLKITS } from "./index.ts";
import { toolkitRegistration } from "../../mcp/McpHttpServer.ts";

it.effect("registers both fork toolkits without blocking startup", () =>
  Effect.gen(function* () {
    const layer = Layer.mergeAll(
      Layer.empty,
      ...FORK_MCP_TOOLKITS.map((entry) => entry.register(toolkitRegistration)),
    ).pipe(Layer.provideMerge(McpServer.McpServer.layer));
    const context = yield* Layer.build(layer);
    const server = yield* McpServer.McpServer.pipe(Effect.provideContext(context));
    expect(server.tools.map((entry) => entry.tool.name)).toEqual(
      expect.arrayContaining(
        FORK_MCP_TOOLKITS.flatMap((entry) => Object.keys(entry.toolkit.tools)),
      ),
    );
  }).pipe(Effect.scoped),
);
