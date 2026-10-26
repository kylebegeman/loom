import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { ProjectLifecycleError, type ProjectLifecycleLane } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
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
