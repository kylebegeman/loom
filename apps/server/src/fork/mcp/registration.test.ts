import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/ai";
import { FORK_MCP_TOOLKITS } from "./index.ts";
import { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";

// Some handler layers capture thread management; registering a tool never calls it.
const unusedThreads = new Proxy({} as ThreadManagementService["Service"], {
  get(_target, key) {
    throw new Error(`Unexpected service call during registration: ${String(key)}`);
  },
});

it.effect("registers every fork toolkit without blocking startup", () =>
  Effect.gen(function* () {
    const layer = Layer.mergeAll(
      Layer.empty,
      ...FORK_MCP_TOOLKITS.map((entry) => entry.register(toolkitRegistration)),
    ).pipe(
      Layer.provide(Layer.succeed(ThreadManagementService, unusedThreads)),
      Layer.provideMerge(McpServer.McpServer.layer),
    );
    const context = yield* Layer.build(layer);
    const server = yield* McpServer.McpServer.pipe(Effect.provideContext(context));
    expect(server.tools.map((entry) => entry.tool.name)).toEqual(
      expect.arrayContaining(
        FORK_MCP_TOOLKITS.flatMap((entry) => Object.keys(entry.toolkit.tools)),
      ),
    );
  }).pipe(Effect.scoped),
);
