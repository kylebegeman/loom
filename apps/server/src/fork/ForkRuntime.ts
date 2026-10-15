import type { ProjectCheckoutManagement } from "../project/ProjectCheckoutManagement.ts";
import type { ComputerNaming } from "./computer-naming/ComputerNaming.ts";
import type { GitHubSetupFlow } from "../sourceControl/GitHubSetupFlow.ts";
import type { WorkspaceHandoffService } from "./workspace-handoff/WorkspaceHandoffService.ts";
import type { MiniOffloadService } from "./mini-offload/MiniOffloadService.ts";
import type { PcbPreviewService } from "./pcb-preview/PcbPreviewService.ts";
import type { ModelPreviewService } from "./model-preview-3d/ModelPreviewService.ts";
import type { ProjectLifecycleService } from "./project-lifecycle/ProjectLifecycleService.ts";
import type { AppleBuildService } from "./apple-build-tooling/AppleBuildService.ts";
import type { DeviceQaService } from "./device-qa/DeviceQaService.ts";
import type { CodeGraphService } from "./code-graph/CodeGraphService.ts";
import type { SwitchboardStatus } from "./switchboard/SwitchboardStatus.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Every service a packet adds to ForkLayer. Packets append `| TheirService`. */
export type ForkServices =
  | ProjectCheckoutManagement
  | ComputerNaming
  | GitHubSetupFlow
  | MiniOffloadService
  | ModelPreviewService
  | PcbPreviewService
  | ProjectLifecycleService
  | AppleBuildService
  | DeviceQaService
  | CodeGraphService
  | WorkspaceHandoffService
  | SwitchboardStatus;

/** ForkLayer publishes its services without adding requirements to upstream transports. */
export class ForkRuntime extends Context.Reference<Context.Context<ForkServices> | undefined>(
  "loom/ForkRuntime",
  { defaultValue: () => undefined },
) {}

/** The caller's context wins, keeping request resources in the request's scope. */
export const withForkRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, ForkServices>> =>
  Effect.flatMap(ForkRuntime, (context) =>
    context === undefined
      ? Effect.die(new Error("The Loom server runtime is not installed."))
      : Effect.updateContext(
          effect,
          (current) => Context.merge(context, current) as Context.Context<R>,
        ),
  );
