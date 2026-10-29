import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  ReachLibraryComputer,
  ReachLibraryError,
  ReachLibraryListing,
  type ReachRetireInput,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, Tool } from "effect/ai";
import { McpInvocationContext } from "../../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../../ForkRuntime.ts";
import { ReachLibraryToolkit, reachLibraryHandlers } from "./mcp.ts";
import { ReachProvisioner } from "./ReachProvisioner.ts";

const decodeToolInput = Schema.decodeUnknownEffect(McpSchema.ToolJson);

const RETIRED = Schema.decodeSync(ReachLibraryComputer)({
  environmentId: "environment-studio",
  label: "Studio",
  hostname: "studio-loom.reach.example.test",
  state: "removed",
  lastError: null,
  connection: "down",
  connectors: null,
  leftoverDnsRecordId: null,
  identity: null,
  signIn: "active",
  updatedAt: "2026-10-24T12:00:00.000Z",
  lastEnsuredAt: "2026-10-24T11:00:00.000Z",
});
const LISTING = Schema.decodeSync(ReachLibraryListing)({
  setup: { zone: "reach.example.test", cloudflare: "ready", identity: "missing", edge: null },
  computers: [
    { ...Schema.encodeSync(ReachLibraryComputer)(RETIRED), state: "ready", connectors: 2 },
  ],
});

it.effect("lists reach to read-only agents and retires only with full access", () =>
  Effect.gen(function* () {
    const retired: Array<ReachRetireInput> = [];
    const provisioner = ReachProvisioner.of({
      ensure: () => Effect.die(new Error("Agents never provision reach.")),
      remove: () => Effect.die(new Error("Agents never call the computer's remove.")),
      prepareIdentity: () => Effect.die(new Error("Agents never prepare Loom sign-in.")),
      list: Effect.succeed(LISTING),
      computers: Effect.succeed(LISTING),
      retire: (input) =>
        input.environmentId === "environment-unknown"
          ? Effect.fail(new ReachLibraryError({ reason: "not-found" }))
          : input.environmentId === "environment-keyless"
            ? Effect.fail(new ReachLibraryError({ reason: "identity-key-missing" }))
            : Effect.sync(() => {
                retired.push(input);
                return RETIRED;
              }),
    });
    const toolkit = yield* ReachLibraryToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(reachLibraryHandlers).pipe(
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(
                ReachProvisioner,
                provisioner,
              ) as unknown as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    for (const tool of Object.values(ReachLibraryToolkit.tools)) {
      expect((yield* decodeToolInput(Tool.getJsonSchema(tool))).type).toBe("object");
    }
    const invoke = <A, E, R>(effect: Effect.Effect<A, E, R>, access: "read-only" | "full-access") =>
      effect.pipe(
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("mcp-host"),
          capabilities: new Set(["orchestration", "reach"] as const),
          issuedAt: 0,
          requestNamespace: "test",
          thread: undefined,
          client: { sessionId: "test", label: "Test", access },
        }),
        Effect.provide(Layer.mock(ThreadManagementService)({})),
      );
    const retire = (environmentId: string) =>
      toolkit
        .handle("loom_reach_retire", {
          environmentId: EnvironmentId.make(environmentId),
          endIdentity: true,
        })
        .pipe(Effect.flatMap(Stream.runCollect));

    const listed = yield* invoke(
      toolkit.handle("loom_reach_computers", {}).pipe(Effect.flatMap(Stream.runCollect)),
      "read-only",
    );
    expect(listed[0]?.result).toEqual(LISTING);

    const denied = yield* invoke(retire("environment-studio"), "read-only").pipe(Effect.flip);
    expect(denied).toMatchObject({ code: "capability_denied" });
    expect(retired).toEqual([]);

    const result = yield* invoke(retire("environment-studio"), "full-access");
    expect(result[0]?.result).toEqual(RETIRED);
    expect(retired).toEqual([{ environmentId: "environment-studio", endIdentity: true }]);

    const missing = yield* invoke(retire("environment-unknown"), "full-access").pipe(Effect.flip);
    expect(missing).toMatchObject({ _tag: "ReachLibraryError", reason: "not-found" });

    // The MCP server answers a declared failure with its message, so the agent reads that line.
    const keyless = yield* invoke(retire("environment-keyless"), "full-access").pipe(Effect.flip);
    expect(keyless).toMatchObject({ _tag: "ReachLibraryError", reason: "identity-key-missing" });
    expect(keyless.message).toMatch(/^Nothing was changed\./u);
  }),
);
