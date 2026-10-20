import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ThreadId,
  ProviderInstanceId,
  RunId,
  type OrchestrationV2ThreadShell,
  type RuntimeMode,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import { MiniOffloadError, type MiniSubmit } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as Access from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as Mini from "./MiniOffloadService.ts";
import { MiniOffloadToolkit, miniOffloadHandlers } from "./mcp.ts";
const tid = ThreadId.make("mini-caller");
const invocation: McpInvocationScope = {
  environmentId: EnvironmentId.make("test"),
  thread: {
    threadId: tid,
    providerSessionId: "test",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  requestNamespace: "test",
  capabilities: new Set(),
  issuedAt: 0,
};
function partial<A extends object>(value: Partial<A>): A {
  return new Proxy(value as A, {
    get: (target, key) => {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}
const callers = (
  live = true,
  runtimeMode: RuntimeMode = "full-access",
  interactionMode: ProviderInteractionMode = "default",
) =>
  Layer.succeed(
    ThreadManagementService,
    partial<ThreadManagementService["Service"]>({
      getThreadShell: (id) =>
        Effect.succeed(
          partial<OrchestrationV2ThreadShell>({
            id,
            deletedAt: null,
            archivedAt: null,
            activeRunId: live ? RunId.make("active") : null,
            pendingBackgroundTasks: [],
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeMode,
            interactionMode,
          }),
        ),
    }),
  );
const toolkitWith = (service: Partial<Mini.MiniOffloadService["Service"]>) =>
  MiniOffloadToolkit.pipe(
    Effect.provide(
      Access.HandlersLayer.layer(miniOffloadHandlers).pipe(
        Layer.provide(callers()),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(
              Mini.MiniOffloadService,
              partial(service),
            ) as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );
describe("Mini agent tools", () => {
  it.effect(
    "passes declared files through submission and collects outputs as the owning read-only caller",
    () =>
      Effect.gen(function* () {
        const rid = "a".repeat(32);
        const outputs = ["dist/result.bin"];
        let submitted: MiniSubmit | undefined;
        let collected: { threadId: ThreadId; requestId: string } | undefined;
        const toolkit = yield* toolkitWith({
          submit: (input) => {
            submitted = input;
            return Effect.fail(new MiniOffloadError({ reason: "transfer" }));
          },
          agentArtifacts: (input) => {
            collected = input;
            return Effect.succeed({
              bytes: 3,
              sha256: "c".repeat(64),
              files: [],
              missing: outputs,
              artifactsBase64: input.includeBundle ? "YWJj" : null,
            });
          },
        });
        yield* toolkit
          .handle("loom_mini_submit", {
            workerId: "pi",
            requestId: rid,
            label: "Outputs",
            argv: ["true"],
            memoryMiB: 128,
            cpuPercent: 25,
            timeoutSeconds: 1,
            committedOnly: false,
            outputs,
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.exit,
            Effect.provideService(McpInvocationContext, invocation),
            Effect.provide(callers()),
          );
        expect(submitted).toMatchObject({ threadId: tid, outputs });
        const result = yield* toolkit.handle("loom_mini_artifacts", { requestId: rid }).pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, {
            ...invocation,
            client: { sessionId: "readonly", label: "Read only", access: "read-only" as const },
          }),
          Effect.provide(callers()),
        );
        expect(collected).toEqual({ threadId: tid, requestId: rid });
        expect(result[0]?.result).toMatchObject({ missing: outputs, artifactsBase64: null });
      }),
  );
  it.effect("lists only destinations configured by the administrator", () =>
    Effect.gen(function* () {
      const toolkit = yield* toolkitWith({
        workers: Effect.succeed([{ id: "pi", name: "Pi", enabled: true }]),
      });
      const result = yield* toolkit
        .handle("loom_mini_workers", {})
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, invocation),
          Effect.provide(callers()),
        );
      expect(result[0]?.result).toEqual([{ id: "pi", name: "Pi", enabled: true }]);
      expect(Object.keys(MiniOffloadToolkit.tools)).not.toContain("loom_mini_register");
    }),
  );
  it.effect(
    "read-only agents can check registered capacity without a live turn or preparation access",
    () =>
      Effect.gen(function* () {
        let checked: string | undefined;
        const report = {
          workerId: "pi",
          name: "Pi",
          checkedAt: "2026-10-12T00:00:00Z",
          status: "busy" as const,
          architecture: "aarch64",
          cpuCount: 8,
          slots: 2,
          active: 2,
          nativeServerRunning: true,
          outputBundles: true,
          missingTools: [],
          reasons: ["slots_reserved"],
        };
        const toolkit = yield* toolkitWith({
          check: (input) => {
            checked = input.workerId;
            return Effect.succeed(report);
          },
        });
        const result = yield* toolkit.handle("loom_mini_worker_check", { workerId: "pi" }).pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, {
            ...invocation,
            client: { sessionId: "readonly", label: "Read only", access: "read-only" as const },
          }),
          Effect.provide(callers(false, "approval-required", "plan")),
        );
        expect(checked).toBe("pi");
        expect(result[0]?.result).toEqual(report);
        expect(Object.keys(MiniOffloadToolkit.tools)).not.toContain("loom_mini_prepare");
      }),
  );
  it.effect("pins operations to the calling thread, never a client-supplied thread", () =>
    Effect.gen(function* () {
      let seen: ThreadId | undefined;
      const toolkit = yield* toolkitWith({
        list: (threadId) => {
          seen = threadId;
          return Effect.succeed([]);
        },
      });
      yield* toolkit
        .handle("loom_mini_list", {})
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, invocation),
          Effect.provide(callers()),
        );
      expect(seen).toBe(tid);
    }),
  );
  it.effect(
    "refuses submission for a read-only client or a stopped caller before executing work",
    () =>
      Effect.gen(function* () {
        let started = false;
        const toolkit = yield* toolkitWith({
          submit: (_input: MiniSubmit) => {
            started = true;
            return Effect.die("Should be refused");
          },
        });
        const input = {
          workerId: "pi",
          requestId: "a".repeat(32),
          label: "Test",
          argv: ["true"],
          memoryMiB: 128,
          cpuPercent: 25,
          timeoutSeconds: 1,
          committedOnly: false,
        };
        const readonly = {
          ...invocation,
          client: { sessionId: "client", label: "Read only", access: "read-only" as const },
        };
        yield* toolkit
          .handle("loom_mini_submit", input)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.flip,
            Effect.provideService(McpInvocationContext, readonly),
            Effect.provide(callers()),
          );
        yield* toolkit
          .handle("loom_mini_submit", input)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.flip,
            Effect.provideService(McpInvocationContext, invocation),
            Effect.provide(callers(false)),
          );
        expect(started).toBe(false);
      }),
  );
  it.effect("does not bypass approval-required or plan mode when dispatching remote commands", () =>
    Effect.gen(function* () {
      let started = false;
      const toolkit = yield* toolkitWith({
        submit: () => {
          started = true;
          return Effect.die("Should be refused");
        },
        recover: () => {
          started = true;
          return Effect.die("Should be refused");
        },
      });
      const input = {
        workerId: "pi",
        requestId: "a".repeat(32),
        label: "Test",
        argv: ["true"],
        memoryMiB: 128,
        cpuPercent: 25,
        timeoutSeconds: 1,
        committedOnly: false,
      };
      for (const caller of [
        callers(true, "approval-required"),
        callers(true, "full-access", "plan"),
      ]) {
        for (const [tool, params] of [
          ["loom_mini_submit", input],
          ["loom_mini_recover", { requestId: input.requestId }],
        ] as const) {
          const error = yield* toolkit
            .handle(tool, params)
            .pipe(
              Effect.flatMap(Stream.runCollect),
              Effect.flip,
              Effect.provideService(McpInvocationContext, invocation),
              Effect.provide(caller),
            );
          expect(error).toMatchObject({ code: "capability_denied" });
        }
      }
      expect(started).toBe(false);
    }),
  );
  it.effect("refuses access without an owning thread", () =>
    Effect.gen(function* () {
      const toolkit = yield* toolkitWith({});
      const error = yield* toolkit
        .handle("loom_mini_list", {})
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.flip,
          Effect.provideService(McpInvocationContext, { ...invocation, thread: undefined }),
          Effect.provide(callers()),
        );
      expect(error).toMatchObject({ code: "thread_credential_required" });
    }),
  );
  it.effect(
    "changes and removes workers only for a full-access caller, which may be a client",
    () =>
      Effect.gen(function* () {
        const changed: string[] = [];
        const summary = { id: "pi", name: "Pi", enabled: true };
        const toolkit = yield* toolkitWith({
          updateWorker: (input) => {
            changed.push(`update ${input.workerId} ${input.target}`);
            return Effect.succeed(summary);
          },
          removeWorker: (input) => {
            changed.push(`remove ${input.workerId}`);
            return Effect.succeed(summary);
          },
        });
        const update = toolkit
          .handle("loom_mini_worker_update", {
            workerId: "pi",
            target: "pi-moved",
            sshConfig: null,
          })
          .pipe(Effect.flatMap(Stream.runCollect), Effect.asVoid);
        const remove = toolkit
          .handle("loom_mini_worker_remove", { workerId: "pi" })
          .pipe(Effect.flatMap(Stream.runCollect), Effect.asVoid);
        const run = (
          tool: typeof update | typeof remove,
          scope: McpInvocationScope,
          live = callers(),
        ) =>
          tool.pipe(
            Effect.exit,
            Effect.map((exit) => exit._tag),
            Effect.provideService(McpInvocationContext, scope),
            Effect.provide(live),
          );
        // Thread sessions carry the orchestration capability that environment writes check.
        const thread: McpInvocationScope = {
          ...invocation,
          capabilities: new Set(["orchestration"]),
        };
        const readonly = {
          ...thread,
          client: { sessionId: "readonly", label: "Read only", access: "read-only" as const },
        };
        for (const tool of [update, remove]) {
          expect(yield* run(tool, readonly)).toBe("Failure");
          expect(yield* run(tool, thread, callers(true, "approval-required"))).toBe("Failure");
        }
        expect(changed).toEqual([]);
        expect(yield* run(update, thread)).toBe("Success");
        expect(
          yield* run(remove, {
            ...thread,
            thread: undefined,
            client: { sessionId: "admin", label: "Admin", access: "full-access" as const },
          }),
        ).toBe("Success");
        expect(changed).toEqual(["update pi pi-moved", "remove pi"]);
      }),
  );
});
