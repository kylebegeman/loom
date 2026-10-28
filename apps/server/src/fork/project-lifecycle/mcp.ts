import { OrchestratorMcpFailure, StorageCleanupReportEntry, ThreadId } from "@t3tools/contracts";
import {
  AdoptableLeaseKind,
  LaneFreeScope,
  LaneLeaseKind,
  ProjectLifecycleError,
  ProjectLifecycleLane,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as StorageCleanup from "../../storageCleanup.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { ProjectLifecycleService } from "./ProjectLifecycleService.ts";

const failure = Schema.Union([ProjectLifecycleError, OrchestratorMcpFailure]);

export const ProjectLifecycleToolkit = Toolkit.make(
  Tool.make("loom_project_lifecycle_status", {
    description:
      "Show this thread's lane: a capped space for scratch files, build output and large temporary data, plus what it owns and releases when the thread settles. Put scratch in tmpPath, build output in buildPath and data worth keeping in dataPath instead of /tmp or the home folder. Serve on the lane's ports (LOOM_LANE_PORT in lane shells). Start servers and watchers with the helpers.run command so Loom stops them with the lane; add --detach (before the command) to keep one running in the background after your command returns. Label Docker containers and volumes loom.lane=<lane id> (LOOM_LANE_ID) so they are removed with it. Simulators made with xcrun simctl create or clone inside the checkout are deleted with it. Wrap heavy non-Xcode builds in helpers.slot to share the machine's build slots; xcodebuild already does.",
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
  Tool.make("loom_project_lifecycle_adopt", {
    description:
      "Hand a simulator (by UDID) or a running process (by pid) to this thread's lane, so Loom deletes or stops it when the lane is released. Use for things made outside lane-run and the xcrun shim.",
    parameters: Schema.Struct({
      kind: AdoptableLeaseKind,
      ref: Schema.String,
      label: Schema.optional(Schema.String),
    }),
    success: ProjectLifecycleLane,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Lane: adopt")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_lifecycle_release", {
    description:
      "Release one of this thread's lane leases now: stop the process and its children, remove the Docker container or volume, or delete the simulator.",
    parameters: Schema.Struct({ kind: LaneLeaseKind, ref: Schema.String }),
    success: ProjectLifecycleLane,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Lane: release")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_project_lifecycle_discard_unrecorded", {
    description:
      "Delete a folder under the lanes root that Loom has no lane record for, after detaching its disk image. Only folders Settings lists as unrecorded lanes qualify; a folder holding a registered checkout is refused. Use only when the user asks.",
    parameters: Schema.Struct({ path: Schema.String }),
    success: Schema.Void,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Lane: discard unrecorded folder")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_project_lifecycle_release_checkout", {
    description:
      "Remove a thread's worktree checkout once its work has landed on the default branch and the thread is idle, ending its idle provider sessions. Otherwise the checkout stays and the result's reason says why. The thread stays, and its next message restores the checkout. Use only when the user asks.",
    parameters: Schema.Struct({ threadId: ThreadId }),
    success: StorageCleanupReportEntry,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService, StorageCleanup.StorageCleanup],
  })
    .annotate(Tool.Title, "Lane: release checkout")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
);

const callerThread = Effect.gen(function* () {
  const invocation = yield* McpInvocationContext;
  if (invocation.thread === undefined)
    return yield* new ProjectLifecycleError({
      reason: "not-found",
      message: "Use lane tools from an agent running in a Loom project thread.",
    });
  return invocation.thread.threadId;
});

/** Runs `use` against the calling thread's lane, creating the lane if it does not exist yet. */
const onCallerLane = Effect.fn("ProjectLifecycle.onCallerLane")(function* <A, E>(
  use: (
    service: ProjectLifecycleService["Service"],
    laneId: string,
  ) => Effect.Effect<A, E | ProjectLifecycleError>,
) {
  const threadId = yield* callerThread;
  return yield* withForkRuntime(
    Effect.gen(function* () {
      const service = yield* ProjectLifecycleService;
      const lane = yield* service.ensureForThread(threadId);
      return yield* use(service, lane.id);
    }),
  );
});

/** The calling thread's existing lane; a read never creates one. */
const callerLaneView = Effect.fn("ProjectLifecycle.callerLaneView")(function* () {
  const threadId = yield* callerThread;
  return yield* withForkRuntime(
    ProjectLifecycleService.pipe(Effect.flatMap((service) => service.currentLaneView(threadId))),
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
        withRuntime(callerLaneView()),
      ),
      loom_project_lifecycle_free: McpToolAccess.actsAsCaller((input) =>
        withRuntime(onCallerLane((service, laneId) => service.free(laneId, input.scope))),
      ),
      loom_project_lifecycle_grow: McpToolAccess.actsAsCaller(() =>
        withRuntime(onCallerLane((service, laneId) => service.grow(laneId))),
      ),
      loom_project_lifecycle_adopt: McpToolAccess.actsAsCaller((input) =>
        withRuntime(
          onCallerLane((service, laneId) =>
            service.adoptLease(laneId, input.kind, input.ref, input.label),
          ),
        ),
      ),
      loom_project_lifecycle_release: McpToolAccess.actsAsCaller((input) =>
        withRuntime(
          onCallerLane((service, laneId) => service.releaseLease(laneId, input.kind, input.ref)),
        ),
      ),
      loom_project_lifecycle_discard_unrecorded: McpToolAccess.writes((input) =>
        withRuntime(
          withForkRuntime(
            ProjectLifecycleService.pipe(
              Effect.flatMap((service) => service.discardUnrecorded(input.path)),
            ),
          ),
        ),
      ),
      loom_project_lifecycle_release_checkout: McpToolAccess.writes((input) =>
        StorageCleanup.StorageCleanup.pipe(
          Effect.flatMap((cleanup) => cleanup.releaseCheckout(input.threadId)),
        ),
      ),
    };
  }),
);
