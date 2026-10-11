import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type RuntimeMode,
} from "@t3tools/contracts";
import { PcbPreviewError, PcbEditorAction } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
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
const decodeEditorAction = Schema.decodeUnknownSync(PcbEditorAction);
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

it.effect("prints in the caller workspace and defaults agent requests to saving", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { toolkit, threads } = yield* fixture({
        print: (input) => {
          expect(input).toEqual({
            threadId,
            designId: "board.kicad_pcb",
            side: "top",
            paper: "board",
            blackAndWhite: true,
            save: true,
          });
          return Effect.succeed({
            file: {
              relativeUrl: "/api/loom/pcb-preview/f/test/print.pdf",
              expiresAt: 1,
              sizeBytes: 100,
              modifiedAt: "2026-10-10T00:00:00Z",
              revision: "revision",
            },
            fileName: "board-top-revision.pdf",
            workspacePath: "fab/print/board-top-revision.pdf",
            path: "/workspace/fab/print/board-top-revision.pdf",
            sourceHash: "revision",
            side: "top",
            layers: ["F.Cu", "Edge.Cuts"],
            mirrored: false,
            paper: "board",
            boardMm: { width: 50, height: 30 },
            warnings: [],
            log: "",
          });
        },
      });
      const results = yield* toolkit
        .handle("loom_pcb_print", { designId: "board.kicad_pcb" })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      expect(results.length).toBeGreaterThan(0);
    }),
  ),
);
it.effect("honors print options and explicit no-save while retaining typed tool failures", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { toolkit, threads } = yield* fixture({
        print: (input) => {
          expect(input).toEqual({
            threadId,
            designId: "board.kicad_pcb",
            side: "bottom",
            layers: "assembly-back",
            mirror: false,
            paper: "A3",
            blackAndWhite: false,
            save: false,
          });
          return Effect.fail(
            new PcbPreviewError({ reason: "tool-missing", message: "Install KiCad" }),
          );
        },
      });
      const error = yield* toolkit
        .handle("loom_pcb_print", {
          designId: "board.kicad_pcb",
          side: "bottom",
          layers: "assembly-back",
          mirror: false,
          paper: "A3",
          blackAndWhite: false,
          save: false,
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
  "refuses printing before host execution for a caller without full environment authority",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { toolkit, threads } = yield* fixture({}, "auto");
        const error = yield* toolkit
          .handle("loom_pcb_print", {
            designId: "board.tsx",
            save: false,
          })
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
it.effect("requires a calling thread to print rather than an external client", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { toolkit, threads } = yield* fixture({});
      const error = yield* toolkit.handle("loom_pcb_print", { designId: "board.kicad_pcb" }).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(ThreadManagementService, threads),
        Effect.provideService(McpInvocationContext, {
          ...scope,
          thread: undefined,
          client: { sessionId: "external", label: "External", access: "full-access" },
        }),
        Effect.flip,
      );
      expect(error).toMatchObject({ code: "thread_credential_required" });
    }),
  ),
);
it.effect("forwards SVG and scaled PNG capture commands in the calling thread", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commands = [
        { action: "capture", format: "svg", full: true },
        { action: "capture", format: "png", scale: 2 },
      ] as const;
      let calls = 0;
      const { toolkit, threads } = yield* fixture({
        editorAction: (input) => {
          expect(input).toEqual({
            threadId,
            designId: "board.kicad_pcb",
            command: commands[calls],
          });
          calls += 1;
          return Effect.succeed({ message: "Captured" });
        },
      });
      for (const command of commands) {
        const results = yield* toolkit
          .handle("loom_pcb_editor", {
            designId: "board.kicad_pcb",
            command,
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provideService(ThreadManagementService, threads),
          );
        expect(results.length).toBeGreaterThan(0);
      }
      expect(calls).toBe(2);
    }),
  ),
);

it.effect("decodes and forwards finding and marker editor actions through caller access", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commands = [
        { action: "finding", name: "next" },
        { action: "markers", enabled: false },
      ] as const;
      let calls = 0;
      const { toolkit, threads } = yield* fixture({
        editorAction: (input) => {
          expect(input).toMatchObject({
            threadId,
            designId: "board.kicad_pcb",
            command: commands[calls++],
          });
          return Effect.succeed({ message: "done" });
        },
      });
      for (const command of commands) {
        expect(decodeEditorAction(command)).toEqual(command);
        yield* toolkit
          .handle("loom_pcb_editor", { designId: "board.kicad_pcb", command })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provideService(ThreadManagementService, threads),
          );
      }
      expect(calls).toBe(2);
      expect(() => decodeEditorAction({ action: "unknown" })).toThrow();
    }),
  ),
);

it.effect("agent latest checks default to fresh and project settings use the caller thread", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const { toolkit, threads } = yield* fixture({
        latestChecks: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return [];
          }),
        projectSettings: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return { autoChecks: { erc: false, drc: false } };
          }),
        updateProjectSettings: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return { autoChecks: { erc: false, drc: true } };
          }),
      });
      yield* toolkit
        .handle("loom_pcb_latest_checks", { designId: "board.kicad_pro" })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      yield* toolkit
        .handle("loom_pcb_latest_checks", { designId: "board.kicad_pro", ensureFresh: false })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      yield* toolkit
        .handle("loom_pcb_check_settings", {})
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      yield* toolkit
        .handle("loom_pcb_check_settings", { autoChecks: { drc: true } })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      expect(calls).toEqual([
        { threadId, designId: "board.kicad_pro", ensureFresh: true },
        { threadId, designId: "board.kicad_pro", ensureFresh: false },
        { threadId },
        { threadId, autoChecks: { drc: true } },
      ]);
    }),
  ),
);
it.effect("pin map tools apply defaults and scope generation to the caller", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let received: unknown;
      const { toolkit, threads } = yield* fixture({
        pinMap: (input) =>
          Effect.sync(() => {
            received = input;
            return {
              sourceHash: "source",
              map: {
                reference: "J1",
                value: "Connector",
                family: "pins" as const,
                detectedFrom: "default" as const,
                formats: [],
                rows: [],
                warnings: [],
              },
              format: input.format,
              text: "pins",
              saved: null,
            };
          }),
      });
      yield* toolkit
        .handle("loom_pcb_pin_map", { designId: "board.kicad_pro", reference: "J1" })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      expect(received).toEqual({
        threadId,
        designId: "board.kicad_pro",
        reference: "J1",
        format: "markdown",
        includePower: false,
        includeNoConnect: false,
      });
    }),
  ),
);
