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
  capabilities: new Set(["orchestration", "hardware"]),
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
          linkOrigin: undefined,
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
            return {
              autoChecks: { erc: false, drc: false, review: false },
              review: { rules: {}, params: {}, waivers: [] },
            };
          }),
        updateProjectSettings: (input) =>
          Effect.sync(() => {
            calls.push(input);
            return {
              autoChecks: { erc: false, drc: true, review: false },
              review: { rules: {}, params: {}, waivers: [] },
            };
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

it.effect(
  "lists bounded request context without images and enforces agent status permissions",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { toolkit, threads } = yield* fixture({
          listRequests: (input, status) => {
            expect(input.threadId).toBe(threadId);
            expect(status).toBe("review");
            return Effect.succeed([]);
          },
          getWorkspace: () =>
            Effect.succeed({
              version: 4,
              views: [],
              layerSets: [],
              measurements: [],
              annotations: [],
              simulations: [],
              variants: [],
              requests: [],
            }),
          changeRequest: (input, actor) => {
            expect(actor).toBe("agent");
            expect(input.expectedVersion).toBe(4);
            expect(input.operation).toMatchObject({ op: "status", id: "one", status: "accepted" });
            return Effect.fail(
              new PcbPreviewError({
                reason: "invalid-parameters",
                message: "Only the user can accept.",
              }),
            );
          },
        });
        const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          effect.pipe(
            Effect.provideService(McpInvocationContext, scope),
            Effect.provideService(ThreadManagementService, threads),
          );
        expect(
          (yield* provide(
            toolkit
              .handle("loom_pcb_change_requests", { designId: "board.kicad_pcb", status: "review" })
              .pipe(Effect.flatMap(Stream.runCollect)),
          )).length,
        ).toBeGreaterThan(0);
        const error = yield* provide(
          toolkit
            .handle("loom_pcb_update_change_request", {
              designId: "board.kicad_pcb",
              requestId: "one",
              status: "accepted",
            })
            .pipe(Effect.flatMap(Stream.runCollect), Effect.flip),
        );
        expect(error).toMatchObject({
          reason: "invalid-parameters",
          message: "Only the user can accept.",
        });
      }),
    ),
);

it.effect("review and waiver settings reach the caller's service", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let called = false;
      const { toolkit, threads } = yield* fixture({
        review: (input) => {
          expect(input).toEqual({ threadId, designId: "board.kicad_pro" });
          called = true;
          return Effect.fail(new PcbPreviewError({ reason: "invalid-report", message: "fixture" }));
        },
        updateProjectSettings: (input) => {
          expect(input.review?.waive?.[0]).toMatchObject({
            findingId: "review:a:1",
            designId: "board.kicad_pro",
          });
          return Effect.succeed({
            autoChecks: { erc: false, drc: false, review: false },
            review: { rules: {}, params: {}, waivers: [] },
          });
        },
      });
      const provide = <A, E, R>(e: Effect.Effect<A, E, R>) =>
        e.pipe(
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      yield* provide(
        toolkit
          .handle("loom_pcb_review", { designId: "board.kicad_pro" })
          .pipe(Effect.flatMap(Stream.runCollect), Effect.flip),
      );
      expect(called).toBe(true);
      yield* provide(
        toolkit
          .handle("loom_pcb_check_settings", {
            review: { waive: [{ designId: "board.kicad_pro", findingId: "review:a:1" }] },
          })
          .pipe(Effect.flatMap(Stream.runCollect)),
      );
    }),
  ),
);

it.effect("fab tools preserve the caller and catalog save needs environment write", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const catalog = {
        version: 0,
        builtIns: [],
        entries: [],
        defaultId: "jlcpcb-standard",
        skipped: [],
      };
      const { toolkit, threads } = yield* fixture({
        fabCapabilities: () => Effect.succeed(catalog),
        updateFabCapabilities: (input) => {
          expect(input.expectedVersion).toBe(0);
          return Effect.succeed(catalog);
        },
        fabCheck: (input) => {
          expect(input).toEqual({
            threadId,
            designId: "board.kicad_pro",
            fabId: "jlcpcb-standard",
          });
          return Effect.fail(new PcbPreviewError({ reason: "invalid-report", message: "fixture" }));
        },
        latestFabCheck: (input) => {
          expect(input.threadId).toBe(threadId);
          return Effect.succeed(null);
        },
      });
      const invoke = (name: Parameters<typeof toolkit.handle>[0], input: Record<string, unknown>) =>
        toolkit
          .handle(name, input)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provideService(ThreadManagementService, threads),
          );
      yield* invoke("loom_pcb_fab_capabilities", {});
      yield* invoke("loom_pcb_save_fab_capabilities", {
        expectedVersion: 0,
        entries: [],
        defaultId: null,
      });
      yield* invoke("loom_pcb_fab_check", {
        designId: "board.kicad_pro",
        fabId: "jlcpcb-standard",
      }).pipe(Effect.flip);
      yield* invoke("loom_pcb_latest_fab_check", { designId: "board.kicad_pro" });
      const denied = yield* fixture(
        { updateFabCapabilities: () => Effect.die("must not save") },
        "approval-required",
      );
      const error = yield* denied.toolkit
        .handle("loom_pcb_save_fab_capabilities", {
          expectedVersion: 0,
          entries: [],
          defaultId: null,
        })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, denied.threads),
          Effect.flip,
        );
      expect(error._tag).toBe("OrchestratorMcpFailure");
    }),
  ),
);

it.effect(
  "fabrication tools preserve defaults, list packages and omit signed URLs for agents",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const manifest = {
          id: "board-A-2026-10-10",
          workspacePath: "fab/board-A-2026-10-10",
          designId: "board.kicad_pro",
          sourceHash: "one",
          inputHash: "one",
          profile: "generic" as const,
          fabId: null,
          verdict: "ready" as const,
          createdAt: "2026-10-10T12:00:00Z",
          assembly: true,
          outputs: [],
          checklist: [],
          previewLayers: [],
          warnings: [],
          log: "",
        };
        const { toolkit, threads } = yield* fixture({
          fabPackage: (input) => {
            expect(input).toEqual({
              threadId,
              designId: manifest.designId,
              profile: "generic",
              assembly: true,
              force: false,
            });
            return Effect.succeed({
              ...manifest,
              path: "/workspace/" + manifest.workspacePath,
              reused: false,
              zip: {
                relativeUrl: "private-url",
                expiresAt: 1,
                sizeBytes: 1,
                modifiedAt: manifest.createdAt,
                revision: "one",
              },
            });
          },
          fabPackages: (input) => {
            expect(input.threadId).toBe(threadId);
            return Effect.succeed([manifest]);
          },
          deleteFabPackage: (input) => {
            expect(input).toEqual({
              threadId,
              designId: manifest.designId,
              packageId: manifest.id,
            });
            return Effect.void;
          },
        });
        const invoke = (
          name: Parameters<typeof toolkit.handle>[0],
          input: Record<string, unknown>,
        ) =>
          toolkit
            .handle(name, input)
            .pipe(
              Effect.flatMap(Stream.runCollect),
              Effect.provideService(McpInvocationContext, scope),
              Effect.provideService(ThreadManagementService, threads),
            );
        const built = yield* invoke("loom_pcb_fab_package", { designId: manifest.designId });
        expect(JSON.stringify(built)).not.toContain("private-url");
        expect(JSON.stringify(built)).toContain(manifest.workspacePath);
        yield* invoke("loom_pcb_fab_packages", { designId: manifest.designId });
        yield* invoke("loom_pcb_delete_fab_package", {
          designId: manifest.designId,
          packageId: manifest.id,
        });
      }),
    ),
);

it.effect(
  "history restore requires a checkpoint or undo id and preserves agent conflict choices",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let checked: boolean | undefined;
        const { toolkit, threads } = yield* fixture({
          historyRestore: (input, options) => {
            checked = options?.checkContent;
            expect(input.threadId).toBe(threadId);
            return Effect.succeed({
              plan: { design: [], supporting: [], added: [], editorLocks: [] },
              undoId: null,
              written: [],
              removed: [],
            });
          },
        });
        const invoke = (input: {
          designId: string;
          action: "plan" | "restore" | "undo";
          checkpointId?: string;
          expectedContentKey?: string;
        }) =>
          toolkit
            .handle("loom_pcb_restore_version", input)
            .pipe(
              Effect.flatMap(Stream.runCollect),
              Effect.provideService(McpInvocationContext, scope),
              Effect.provideService(ThreadManagementService, threads),
            );
        expect(
          JSON.stringify(
            yield* invoke({ designId: "main.kicad_pro", action: "plan" }).pipe(Effect.flip),
          ),
        ).toContain("invalid-parameters");
        expect(
          JSON.stringify(
            yield* invoke({ designId: "main.kicad_pro", action: "undo" }).pipe(Effect.flip),
          ),
        ).toContain("invalid-parameters");
        yield* invoke({ designId: "main.kicad_pro", action: "restore", checkpointId: "cp" });
        expect(checked).toBe(false);
        yield* invoke({
          designId: "main.kicad_pro",
          action: "restore",
          checkpointId: "cp",
          expectedContentKey: "key",
        });
        expect(checked).toBe(true);
      }),
    ),
);

it.effect("agent proposals reach the workspace service in the caller thread", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const workspace = {
        version: 1,
        views: [],
        layerSets: [],
        measurements: [],
        annotations: [],
        simulations: [],
        variants: [],
        requests: [],
      };
      const { toolkit, threads } = yield* fixture({
        proposeVariants: (input, variants) => {
          expect(input).toEqual({ threadId, designId: "blink.circuit.tsx" });
          expect(variants).toEqual([{ name: "Wide", values: { width: 30 } }]);
          return Effect.succeed(workspace);
        },
      });
      const results = yield* toolkit
        .handle("loom_pcb_propose_variants", {
          designId: "blink.circuit.tsx",
          variants: [{ name: "Wide", values: { width: 30 } }],
        })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, scope),
          Effect.provideService(ThreadManagementService, threads),
        );
      expect(results[0]?.isFailure).toBe(false);
    }),
  ),
);
