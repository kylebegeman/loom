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

const registeredTools = Effect.gen(function* () {
  const layer = Layer.mergeAll(
    Layer.empty,
    ...FORK_MCP_TOOLKITS.map((entry) => entry.register(toolkitRegistration)),
  ).pipe(
    Layer.provide(Layer.succeed(ThreadManagementService, unusedThreads)),
    Layer.provideMerge(McpServer.McpServer.layer),
  );
  const context = yield* Layer.build(layer);
  const server = yield* McpServer.McpServer.pipe(Effect.provideContext(context));
  return server.tools.map((entry) => entry.tool);
});

it.effect("registers every fork toolkit without blocking startup", () =>
  Effect.gen(function* () {
    const tools = yield* registeredTools;
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(
        FORK_MCP_TOOLKITS.flatMap((entry) => Object.keys(entry.toolkit.tools)),
      ),
    );
  }).pipe(Effect.scoped),
);

it.effect("lets agents see and take down reach but never turn it on (D10)", () =>
  Effect.gen(function* () {
    const tools = yield* registeredTools;
    const reach = tools.filter((tool) => tool.name.startsWith("loom_reach_"));
    const hints = Object.fromEntries(
      reach.map((tool) => [
        tool.name,
        [tool.annotations?.readOnlyHint, tool.annotations?.destructiveHint],
      ]),
    );
    expect(hints).toEqual({
      loom_reach_status: [true, false],
      loom_reach_off: [false, false],
      loom_reach_remove: [false, true],
      loom_reach_forget: [false, true],
      loom_reach_computers: [true, false],
      loom_reach_retire: [false, true],
    });
    expect(reach.filter((tool) => JSON.stringify(tool.inputSchema).includes("enabled"))).toEqual(
      [],
    );
  }).pipe(Effect.scoped),
);

// MCP clients treat a tool that is not read-only as destructive unless it says otherwise.
it.effect("offers agents push status and a test send, neither of them destructive", () =>
  Effect.gen(function* () {
    const tools = yield* registeredTools;
    const push = tools.filter((tool) => tool.name.startsWith("loom_push_"));
    expect(
      push.map((tool) => [
        tool.name,
        tool.annotations?.readOnlyHint,
        tool.annotations?.destructiveHint,
      ]),
    ).toEqual([
      ["loom_push_status", true, false],
      ["loom_push_test", false, false],
    ]);
  }).pipe(Effect.scoped),
);
