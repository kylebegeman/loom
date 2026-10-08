import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  LaneFreeScope,
  ProjectLifecycleError,
  ProjectLifecycleLane,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { ProjectLifecycleService } from "./ProjectLifecycleService.ts";

const failure = Schema.Union([ProjectLifecycleError, OrchestratorMcpFailure]);

export const ProjectLifecycleToolkit = Toolkit.make(
  Tool.make("loom_project_lifecycle_status", {
    description:
      "Show this thread's lane: a capped space for scratch files, build output and large temporary data. Put scratch in tmpPath, build output in buildPath and data worth keeping in dataPath instead of /tmp or the home folder.",
    parameters: Tool.EmptyParams,
    success: ProjectLifecycleLane,
    failure,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Title, "Lane: status")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_lifecycle_free", {
    description:
      'Delete everything in this thread\'s lane folder for the scope: "tmp" (scratch), "build" (DerivedData, package checkouts, build output) or "all" (tmp, build and data). The checkout is never touched.',
    parameters: Schema.Struct({ scope: LaneFreeScope }),
    success: ProjectLifecycleLane,
    failure,
    // Acting as the caller checks its run is live.
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Lane: free space")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_project_lifecycle_grow", {
    description:
      "Raise this thread's lane cap by half, keeping the machine's free space reserve. Fails while processes hold files open in the lane; stop them first.",
    parameters: Tool.EmptyParams,
    success: ProjectLifecycleLane,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Lane: grow")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);

/** Runs `use` against the calling thread's lane, creating the lane if it does not exist yet. */
const onCallerLane = <A, E>(
  use: (
    service: ProjectLifecycleService["Service"],
    laneId: string,
  ) => Effect.Effect<A, E | ProjectLifecycleError>,
) =>
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext;
    if (invocation.thread === undefined)
      return yield* new ProjectLifecycleError({
        reason: "not-found",
        message: "Use lane tools from an agent running in a Loom project thread.",
      });
    const threadId = invocation.thread.threadId;
    return yield* withForkRuntime(
      Effect.gen(function* () {
        const service = yield* ProjectLifecycleService;
        const lane = yield* service.ensureForThread(threadId);
        return yield* use(service, lane.id);
      }),
    );
  });

export const projectLifecycleHandlers = McpToolAccess.toLayer(
  ProjectLifecycleToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const withRuntime = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_project_lifecycle_status: McpToolAccess.readsAsCaller(() =>
        withRuntime(onCallerLane((service, laneId) => service.laneView(laneId))),
      ),
      loom_project_lifecycle_free: McpToolAccess.actsAsCaller((input) =>
        withRuntime(onCallerLane((service, laneId) => service.free(laneId, input.scope))),
      ),
      loom_project_lifecycle_grow: McpToolAccess.actsAsCaller(() =>
        withRuntime(onCallerLane((service, laneId) => service.grow(laneId))),
      ),
    };
  }),
);
