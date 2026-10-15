import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ProjectResourceUpsertRequest,
  ProjectResourceRemoveRequest,
  ProjectResourcesRequest,
  ProjectResourcesSnapshot,
  ProjectResourcesError,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectResources from "../../project/ProjectResources.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";

const failure = Schema.Union([ProjectResourcesError, OrchestratorMcpFailure]);
export const ProjectResourcesToolkit = Toolkit.make(
  Tool.make("loom_project_resources_get", {
    description:
      "Read a project's saved repository and web resources on this computer. Resources remain available when its working copy is removed. This never clones, restores, scans files, or visits URLs.",
    parameters: ProjectResourcesRequest,
    success: ProjectResourcesSnapshot,
    failure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_resource_upsert", {
    description:
      "Add or edit one saved repository or web link for an existing project. Read the resources first and pass their revision as expectedRevision. A new resource needs a unique id. This updates metadata only and never clones or changes files. Requires full access.",
    parameters: ProjectResourceUpsertRequest,
    success: ProjectResourcesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_resource_remove", {
    description:
      "Remove one saved project resource by id with the current expectedRevision. This removes only the saved link, preserving working copies, repositories, and conversations. Requires full access.",
    parameters: ProjectResourceRemoveRequest,
    success: ProjectResourcesSnapshot,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
export const projectResourcesHandlers = McpToolAccess.toLayer(
  ProjectResourcesToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_project_resources_get: McpToolAccess.reads((input) =>
        onHost(Effect.flatMap(ProjectResources.ProjectResources, (service) => service.get(input))),
      ),
      loom_project_resource_upsert: McpToolAccess.writesEnvironment((input) =>
        onHost(
          Effect.flatMap(ProjectResources.ProjectResources, (service) => service.upsert(input)),
        ),
      ),
      loom_project_resource_remove: McpToolAccess.writesEnvironment((input) =>
        onHost(
          Effect.flatMap(ProjectResources.ProjectResources, (service) => service.remove(input)),
        ),
      ),
    };
  }),
);
