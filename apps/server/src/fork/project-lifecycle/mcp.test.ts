import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type StorageCleanupReportEntry,
  ThreadId,
} from "@t3tools/contracts";
import { ProjectLifecycleError, type ProjectLifecycleLane } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as StorageCleanup from "../../storageCleanup.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ProjectLifecycleToolkit, projectLifecycleHandlers } from "./mcp.ts";
import { ProjectLifecycleService } from "./ProjectLifecycleService.ts";

const lane: ProjectLifecycleLane = {
  id: "lane-1",
  projectId: ProjectId.make("project"),
  projectName: "App",
  name: "main",
  checkoutPath: "/src/app",
  laneDir: "/lanes/app/main",
  spacePath: "/lanes/app/main/space",
  tmpPath: "/lanes/app/main/space/tmp",
  buildPath: "/lanes/app/main/space/build",
  dataPath: "/lanes/app/main/space/data",
  backend: "folder",
  state: "ready",
  capBytes: 1,
  usedBytes: null,
  imageBytes: null,
  threadIds: [],
  running: false,
  createdAt: "2026-10-26T00:00:00.000Z",
  message: null,
  ports: null,
  leases: [],
  helpers: { run: "/lanes/.loom/shims/lane-run", slot: "/lanes/.loom/shims/lane-slot" },
  checkoutMissing: null,
};

it.effect("reports the caller's lane without creating one", () =>
  Effect.gen(function* () {
    const ensured: Array<ThreadId> = [];
    const lanes = new Map<ThreadId, ProjectLifecycleLane>();
    const service = {
      ensureForThread: (threadId: ThreadId) =>
        Effect.sync(() => {
          ensured.push(threadId);
          return {} as never;
        }),
      currentLaneView: (threadId: ThreadId) => {
        const lane = lanes.get(threadId);
        return lane === undefined
          ? Effect.fail(new ProjectLifecycleError({ reason: "not-found", message: "No lane." }))
          : Effect.succeed(lane);
      },
    } as unknown as ProjectLifecycleService["Service"];
    const toolkit = yield* ProjectLifecycleToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(projectLifecycleHandlers).pipe(
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(ProjectLifecycleService, service) as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    const threadId = ThreadId.make("lane-caller");
    const status = toolkit.handle("loom_project_lifecycle_status", {}).pipe(
      Effect.flatMap(Stream.runCollect),
      Effect.provideService(McpInvocationContext, {
        environmentId: EnvironmentId.make("test"),
        thread: {
          threadId,
          providerSessionId: "test",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        requestNamespace: "test",
        capabilities: new Set(["orchestration"] as const),
        issuedAt: 0,
      }),
      Effect.provide(Layer.mock(ThreadManagementService)({})),
    );

    const missing = yield* status.pipe(Effect.flip);
    expect(missing).toMatchObject({ reason: "not-found" });
    lanes.set(threadId, lane);
    const found = yield* status;
    expect(found[0]?.result).toMatchObject({ id: "lane-1" });
    expect(ensured).toEqual([]);
  }),
);

it.effect("releases and restores checkouts only for a caller that can control threads", () =>
  Effect.gen(function* () {
    const released: Array<ThreadId> = [];
    const restored: Array<ThreadId> = [];
    const entry: StorageCleanupReportEntry = {
      kind: "worktree",
      outcome: "removed",
      reason: "Checkout released; landed on main; branch deleted",
      path: "/worktrees/app/feature",
      projectPath: "/src/app",
      threadId: ThreadId.make("landed"),
      threadTitle: "Feature",
      bytes: 1,
      files: null,
    };
    const toolkit = yield* ProjectLifecycleToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(projectLifecycleHandlers).pipe(
          Layer.provide(
            Layer.succeed(
              ForkRuntime,
              Context.make(ProjectLifecycleService, {
                refreshCheckouts: () => Effect.void,
                restoreCheckout: (threadId: ThreadId) =>
                  Effect.sync(() => {
                    restored.push(threadId);
                  }),
              } as unknown as ProjectLifecycleService["Service"]) as Context.Context<ForkServices>,
            ),
          ),
        ),
      ),
    );
    const release = (capabilities: ReadonlySet<"orchestration">) =>
      toolkit.handle("loom_project_lifecycle_release_checkout", { threadId: entry.threadId! }).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("test"),
          thread: undefined,
          client: undefined,
          requestNamespace: "test",
          capabilities,
          issuedAt: 0,
        }),
        Effect.provide(
          Layer.merge(
            Layer.mock(ThreadManagementService)({}),
            Layer.mock(StorageCleanup.StorageCleanup)({
              releaseCheckout: (threadId: ThreadId) =>
                Effect.sync(() => {
                  released.push(threadId);
                  return entry;
                }),
            }),
          ),
        ),
      );

    const refused = yield* release(new Set()).pipe(Effect.flip);
    expect(refused).toMatchObject({ code: "capability_denied" });
    expect(released).toEqual([]);
    const result = yield* release(new Set(["orchestration"]));
    expect(result[0]?.result).toEqual(entry);
    expect(released).toEqual([entry.threadId]);
    const restore = (capabilities: ReadonlySet<"orchestration">) =>
      toolkit.handle("loom_project_lifecycle_restore_checkout", { threadId: entry.threadId! }).pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, {
          environmentId: EnvironmentId.make("test"),
          thread: undefined,
          client: undefined,
          requestNamespace: "test",
          capabilities,
          issuedAt: 0,
        }),
        Effect.provide(Layer.mock(ThreadManagementService)({})),
      );
    expect(yield* restore(new Set()).pipe(Effect.flip)).toMatchObject({
      code: "capability_denied",
    });
    expect(restored).toEqual([]);
    yield* restore(new Set(["orchestration"]));
    expect(restored).toEqual([entry.threadId]);
  }),
);
