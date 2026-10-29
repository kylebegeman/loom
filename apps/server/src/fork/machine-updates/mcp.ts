import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  UpdatePlanArm,
  UpdatePlanCancel,
  UpdatePlanError,
  UpdatePlanStatus,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as UpdatePlans from "./UpdatePlans.ts";

const failure = Schema.Union([UpdatePlanError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const UpdateToolkit = Toolkit.make(
  Tool.make("loom_updates_status", {
    description:
      "Read this computer's durable update plan and current version. Waiting plans survive closed windows and server restarts; waitingAgents counts work an update would interrupt. This does not arm or install an update.",
    parameters: Schema.Struct({}),
    success: UpdatePlanStatus,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_updates_arm", {
    description:
      "When the user asks to update this computer after agents finish, arm a durable plan for an exact targetVersion. It waits for idle agents and uses the existing updater without keeping a window or this turn open. Never poll or sleep in a shell to wait for it. Requires a full-access/default caller, like other environment maintenance. Use loom_updates_status to inspect and loom_updates_cancel to cancel a waiting plan.",
    parameters: UpdatePlanArm,
    success: UpdatePlanStatus,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_updates_cancel", {
    description:
      "Cancel this computer's armed or waiting update plan by the id returned from loom_updates_status. Leaves agents running. An install already handed off cannot be cancelled.",
    parameters: UpdatePlanCancel,
    success: UpdatePlanStatus,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
);
export const updateHandlers = McpToolAccess.toLayer(
  UpdateToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const run = <A, E>(effect: Effect.Effect<A, E, UpdatePlans.UpdatePlans>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_updates_status: McpToolAccess.reads(() =>
        run(Effect.flatMap(UpdatePlans.UpdatePlans, (service) => service.status)),
      ),
      loom_updates_arm: McpToolAccess.writesEnvironment((input) =>
        run(Effect.flatMap(UpdatePlans.UpdatePlans, (service) => service.arm(input.targetVersion))),
      ),
      loom_updates_cancel: McpToolAccess.writesEnvironment((input) =>
        run(Effect.flatMap(UpdatePlans.UpdatePlans, (service) => service.cancel(input.id))),
      ),
    };
  }),
);
