import { describe, expect, it } from "@effect/vitest";
import { type AuthMcpClientAccess, EnvironmentId } from "@t3tools/contracts";
import type { LibraryPushDevice, LibraryPushTestRequest } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpSchema, Tool } from "effect/ai";

import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as LibraryConnection from "../project-library/LibraryConnection.ts";
import * as LibraryPushReadiness from "./LibraryPushReadiness.ts";
import { AGENT_CALLER, type LibraryPushCaller, LibraryPushService } from "./LibraryPushService.ts";
import { LibraryPushToolkit, libraryPushHandlers } from "./mcp.ts";
import { libraryPushRowId } from "./registry.ts";

const decodeToolInput = Schema.decodeUnknownEffect(McpSchema.ToolJson);

const ROW_ID = libraryPushRowId({ issuer: "https://id.example.test", subject: "alice" }, "phone-1");
const LABEL = "Kyle's iPhone";
const DEVICE: LibraryPushDevice = {
  id: ROW_ID,
  deviceId: "per-install-device-id",
  label: LABEL,
  bundleId: "com.kylebegeman.loom",
  apsEnvironment: "production",
  appVersion: "1.2.3",
  registeredAt: "2026-10-24T12:00:00.000Z",
  refreshedAt: "2026-10-24T12:00:00.000Z",
  expiresAt: "2026-11-23T12:00:00.000Z",
  mine: false,
  lastDelivery: null,
};

const DEV_BUILD = { bundleId: "com.kylebegeman.loom.dev", apsEnvironment: "sandbox" } as const;

const setup = Effect.fn("test.setup")(function* (topics?: ReadonlyArray<typeof DEV_BUILD>) {
  const tests: Array<{
    readonly caller: LibraryPushCaller;
    readonly request: LibraryPushTestRequest;
  }> = [];
  const service = LibraryPushService.of({
    status: () =>
      Effect.succeed({
        state: "ready",
        reason: null,
        key: { teamId: "TEAM123456", keyId: "KEY1234567" },
        devices: [DEVICE],
        ...(topics === undefined ? {} : { topics }),
      }),
    register: () => Effect.die("unused"),
    unregister: () => Effect.die("unused"),
    test: (caller, request) =>
      Effect.sync(() => {
        tests.push({ caller, request });
        return { deliveries: [{ id: ROW_ID, label: LABEL, outcome: "sent", reason: null }] };
      }),
    alerts: true,
    alert: () => Effect.die("unused"),
  });
  // The real readiness service, on the Library itself.
  const readiness = yield* LibraryPushReadiness.LibraryPushReadinessService.pipe(
    Effect.provide(
      LibraryPushReadiness.layer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(LibraryPushService, service),
            Layer.mock(LibraryConnection.LibraryConnectionService)({
              current: Effect.succeed({ kind: "authority" }),
            }),
          ),
        ),
      ),
    ),
  );
  const toolkit = yield* LibraryPushToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(libraryPushHandlers).pipe(
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            // Only push; the tools never read any other fork service.
            Context.make(LibraryPushService, service).pipe(
              Context.add(LibraryPushReadiness.LibraryPushReadinessService, readiness),
            ) as unknown as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );
  const invoke = <A, E, R>(effect: Effect.Effect<A, E, R>, access: AuthMcpClientAccess) =>
    effect.pipe(
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("mcp-library"),
        capabilities: new Set(["orchestration"] as const),
        issuedAt: 0,
        requestNamespace: "test",
        thread: undefined,
        client: { sessionId: "test", label: "Test", access },
      }),
      Effect.provide(Layer.mock(ThreadManagementService)({})),
    );
  return { toolkit, invoke, tests };
});

describe("library push MCP tools", () => {
  it.effect("publish object input schemas", () =>
    Effect.gen(function* () {
      for (const tool of Object.values(LibraryPushToolkit.tools)) {
        expect((yield* decodeToolInput(Tool.getJsonSchema(tool))).type).toBe("object");
      }
    }),
  );

  it.effect("report push health with a device count, alerts and no device details", () =>
    Effect.gen(function* () {
      const { toolkit, invoke } = yield* setup();
      const result = yield* invoke(
        toolkit.handle("loom_push_status", {}).pipe(Effect.flatMap(Stream.runCollect)),
        "read-only",
      );
      expect(result[0]?.result).toEqual({
        state: "ready",
        reason: null,
        key: { teamId: "TEAM123456", keyId: "KEY1234567" },
        deviceCount: 1,
        alerts: true,
      });
      const output = JSON.stringify(result);
      expect(output).not.toContain(LABEL);
      expect(output).not.toContain(DEVICE.deviceId);
      expect(output).not.toContain(ROW_ID);
    }),
  );

  it.effect("report the builds the Library sends to, including none", () =>
    Effect.gen(function* () {
      for (const topics of [[DEV_BUILD], []]) {
        const { toolkit, invoke } = yield* setup(topics);
        const result = yield* invoke(
          toolkit.handle("loom_push_status", {}).pipe(Effect.flatMap(Stream.runCollect)),
          "read-only",
        );
        expect(result[0]?.result).toMatchObject({ state: "ready", topics });
      }
    }),
  );

  it.effect.each<AuthMcpClientAccess>(["read-only", "approval-required"])(
    "refuse a test push to a %s client before reaching the service",
    (access) =>
      Effect.gen(function* () {
        const { toolkit, invoke, tests } = yield* setup();
        const denied = yield* invoke(
          toolkit.handle("loom_push_test", { id: ROW_ID }).pipe(Effect.flatMap(Stream.runCollect)),
          access,
        ).pipe(Effect.flip);
        expect(denied).toMatchObject({ code: "capability_denied" });
        expect(tests).toEqual([]);
      }),
  );

  it.effect(
    "send a test push to one named device for a full-access client, without its label",
    () =>
      Effect.gen(function* () {
        const { toolkit, invoke, tests } = yield* setup();
        const result = yield* invoke(
          toolkit.handle("loom_push_test", { id: ROW_ID }).pipe(Effect.flatMap(Stream.runCollect)),
          "full-access",
        );
        expect(result[0]?.result).toEqual({
          deliveries: [{ id: ROW_ID, outcome: "sent", reason: null }],
        });
        expect(JSON.stringify(result)).not.toContain(LABEL);
        expect(tests).toEqual([{ caller: AGENT_CALLER, request: { id: ROW_ID } }]);

        const unnamed = yield* invoke(
          toolkit
            .handle("loom_push_test", {} as { readonly id: string })
            .pipe(Effect.flatMap(Stream.runCollect)),
          "full-access",
        ).pipe(Effect.exit);
        expect(Exit.isFailure(unnamed)).toBe(true);
        expect(tests).toHaveLength(1);
      }),
  );
});
