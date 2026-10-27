import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { ReachError, type ReachStatus } from "@t3tools/contracts/fork";
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
import { ReachService } from "./ReachService.ts";
import { ReachToolkit, reachHandlers } from "./mcp.ts";

const decodeToolInput = Schema.decodeUnknownEffect(McpSchema.ToolJson);

const CONNECTED: ReachStatus = {
  state: "connected",
  enabled: true,
  blocked: null,
  url: "https://studio-loom.example.com/",
  message: null,
  warnings: [],
  prepared: null,
};

const makeHarness = Effect.fn("ReachMcpTest.makeHarness")(function* (
  overrides: Partial<ReachService["Service"]>,
) {
  const calls: Array<string> = [];
  let status = CONNECTED;
  const reach = ReachService.of({
    applyIdentity: () => Effect.void,
    prepareIdentity: () => Effect.die(new Error("No tool prepares Loom sign-in.")),
    status: Effect.sync(() => status),
    changes: Stream.make(status),
    setEnabled: (enabled) =>
      Effect.sync(() => {
        calls.push(`set:${enabled}`);
        status = { ...status, enabled, state: enabled ? "provisioning" : "off" };
        return status;
      }),
    remove: () =>
      Effect.sync(() => {
        calls.push("remove");
        status = { ...status, enabled: false, state: "removing" };
        return status;
      }),
    forget: () =>
      Effect.sync(() => {
        calls.push("forget");
        status = { ...status, enabled: false, state: "off", url: null };
        return status;
      }),
    guardState: () => ({ hostname: null, serving: false }),
    ownPorts: () => [],
    ...overrides,
  });
  const toolkit = yield* ReachToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(reachHandlers).pipe(
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(ReachService, reach) as unknown as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );
  const call = (name: keyof typeof ReachToolkit.tools, access: "read-only" | "full-access") =>
    toolkit.handle(name, {}).pipe(
      Effect.flatMap(Stream.runCollect),
      Effect.map((chunks) => chunks[0]?.result),
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
  return { calls, call };
});

it.effect("D10: agents read reach and take it down, and read-only callers change nothing", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({});
    for (const tool of Object.values(ReachToolkit.tools)) {
      expect((yield* decodeToolInput(Tool.getJsonSchema(tool))).type).toBe("object");
    }
    expect(Object.keys(ReachToolkit.tools).toSorted()).toEqual([
      "loom_reach_forget",
      "loom_reach_off",
      "loom_reach_remove",
      "loom_reach_status",
    ]);

    expect(yield* h.call("loom_reach_status", "read-only")).toEqual(CONNECTED);
    for (const name of ["loom_reach_off", "loom_reach_remove", "loom_reach_forget"] as const) {
      expect(yield* Effect.flip(h.call(name, "read-only"))).toMatchObject({
        code: "capability_denied",
      });
    }
    expect(h.calls).toEqual([]);

    expect(yield* h.call("loom_reach_off", "full-access")).toMatchObject({
      enabled: false,
      state: "off",
    });
    expect(yield* h.call("loom_reach_remove", "full-access")).toMatchObject({
      state: "removing",
    });
    expect(yield* h.call("loom_reach_forget", "full-access")).toMatchObject({
      state: "off",
      url: null,
    });
    expect(h.calls).toEqual(["set:false", "remove", "forget"]);
  }),
);

it.effect("hands a reach refusal back as the typed error", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({
      remove: () => Effect.fail(new ReachError({ reason: "busy" })),
    });
    expect(yield* Effect.flip(h.call("loom_reach_remove", "full-access"))).toMatchObject({
      _tag: "ReachError",
      reason: "busy",
    });
  }),
);
