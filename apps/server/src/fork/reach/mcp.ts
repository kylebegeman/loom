import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { ReachError, ReachStatus } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime } from "../ForkRuntime.ts";
import { installedReachService, type ReachService } from "./ReachService.ts";

const failure = Schema.Union([ReachError, OrchestratorMcpFailure]);

/** D10: an agent can see reach and take it down, but only a person turns it on. */
export const ReachToolkit = Toolkit.make(
  Tool.make("loom_reach_status", {
    description:
      "Read whether this computer is reachable from anywhere through its Library: off, provisioning, starting, connected, in error with a short reason, or removing, plus its public address, why reach cannot run here and any Loom Identity warnings. Includes no credentials or connector tokens.",
    success: ReachStatus,
    failure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_reach_off", {
    description:
      "Turn reach off on this computer. Its public address stops answering at once and is kept, so turning reach on again in Loom's settings brings the same address back. Requires full access.",
    success: ReachStatus,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_reach_remove", {
    description:
      "Remove this computer's reach address. Reach turns off here, then the Library deletes the address's tunnel and DNS record, finishing in the background and after a restart if needed. The Library keeps the hostname for this computer, so turning reach on again in Loom's settings brings the same address back. Requires full access.",
    success: ReachStatus,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
);

export const reachHandlers = McpToolAccess.toLayer(
  ReachToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onReach = <A, E>(use: (reach: ReachService["Service"]) => Effect.Effect<A, E>) =>
      Effect.flatMap(installedReachService, (reach) =>
        Option.isNone(reach)
          ? Effect.die(new Error("Reach is not installed on this computer."))
          : use(reach.value),
      ).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_reach_status: McpToolAccess.reads(() => onReach((reach) => reach.status)),
      loom_reach_off: McpToolAccess.writesEnvironment(() =>
        onReach((reach) => reach.setEnabled(false)),
      ),
      loom_reach_remove: McpToolAccess.writesEnvironment(() => onReach((reach) => reach.remove())),
    };
  }),
);
