import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type RuntimeMode,
} from "@t3tools/contracts";
import { PcbPreviewError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { PcbPreviewService } from "./PcbPreviewService.ts";
import { PcbToolkit, pcbHandlers } from "./mcp.ts";
const partial = <A extends object>(methods: Partial<A>): A =>
  new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected service call: ${String(key)}`);
    },
  });
const threadId = ThreadId.make("pcb-caller"),
  targetId = ThreadId.make("pcb-destination");
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("pcb-test"),
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  requestNamespace: "pcb-test",
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};
const fixture = Effect.fn(function* (
  service: Partial<PcbPreviewService["Service"]>,
  runtimeMode: RuntimeMode = "full-access",
) {
  const threads = partial<ThreadManagementService["Service"]>({
    getThreadShell: (id) =>
      Effect.succeed(
        partial<OrchestrationV2ThreadShell>({
          id,
          deletedAt: null,
          archivedAt: null,
          activeRunId: RunId.make("run"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: id === targetId ? "full-access" : runtimeMode,
          interactionMode: "default",
        }),
      ),
  });
  const toolkit = yield* PcbToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(pcbHandlers).pipe(
        Layer.provide(Layer.succeed(ThreadManagementService, threads)),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(
              PcbPreviewService,
              partial<PcbPreviewService["Service"]>(service),
            ) as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );
  return { toolkit, threads };
});
it.effect(
  "invokes the retained fork service in the calling thread and preserves typed CAD errors",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { toolkit, threads } = yield* fixture({
          render: (input) => {
            expect(input).toEqual({
              threadId,
              designId: "board.kicad_pcb",
              view: "pcb",
              layerNames: ["In1.Cu"],
            });
            return Effect.fail(
              new PcbPreviewError({ reason: "tool-missing", message: "Install KiCad" }),
            );
          },
        });
        const error = yield* toolkit
          .handle("loom_pcb_render", {
            designId: "board.kicad_pcb",
            view: "pcb",
            layerNames: ["In1.Cu"],
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provideService(ThreadManagementService, threads),
            Effect.flip,
          );
        expect(error).toMatchObject({ reason: "tool-missing" });
      }),
    ),
);
it.effect(
  "refuses reference exports into a destination above the caller's modes before writing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { toolkit, threads } = yield* fixture({}, "auto");
        const error = yield* toolkit
          .handle("loom_pcb_export_reference", {
            designId: "board.kicad_pcb",
            targetThreadId: targetId,
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provideService(ThreadManagementService, threads),
            Effect.flip,
          );
        expect(error).toMatchObject({ code: "runtime_mode_escalation_denied" });
      }),
    ),
);
it.effect("exports to an authorized destination and passes that thread to the service", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { toolkit, threads } = yield* fixture({
        exportReference: (input) => {
          expect(input).toEqual({
            threadId,
            targetThreadId: targetId,
            designId: "board.kicad_pcb",
          });
          return Effect.succeed({
            path: "/destination/board.glb",
            metadataPath: "/destination/board.json",
            sourceHash: "revision",
            targetThreadId: targetId,
          });
        },
      });
      expect(
        (yield* toolkit
          .handle("loom_pcb_export_reference", {
            designId: "board.kicad_pcb",
            targetThreadId: targetId,
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provideService(ThreadManagementService, threads),
          )).length,
      ).toBeGreaterThan(0);
    }),
  ),
);
it.effect("requires full environment authority to change the shared hardware catalog", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { toolkit, threads } = yield* fixture({}, "auto");
      const error = yield* toolkit
        .handle("loom_pcb_save_library", { expectedVersion: 0, library: { version: 0, items: [] } })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
          Effect.flip,
        );
      expect(error).toMatchObject({ code: "capability_denied" });
    }),
  ),
);
it.effect("rejects editor actions from an external read-only client", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { toolkit, threads } = yield* fixture({});
      const error = yield* toolkit
        .handle("loom_pcb_editor", { designId: "board.kicad_pcb", command: { action: "capture" } })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(ThreadManagementService, threads),
          Effect.provideService(McpInvocationContext, {
            ...scope,
            thread: undefined,
            client: { sessionId: "external", label: "External", access: "read-only" },
          }),
          Effect.flip,
        );
      expect(error).toMatchObject({ code: "thread_credential_required" });
    }),
  ),
);
