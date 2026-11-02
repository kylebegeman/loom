import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProjectId,
} from "@t3tools/contracts";
import { readCaller, resolveProjectId } from "../../mcp/threadAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectProfile, ProjectProfileUpdate, ProjectProfileError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { ProjectProfileService } from "./ProjectProfileService.ts";
export const ProjectProfilesToolkit = Toolkit.make(
  Tool.make("loom_project_profiles_get", {
    description:
      "Read private project notes, mapped commands and optional env status before running project commands. Env values are never returned.",
    parameters: Schema.Struct({ includeEnv: Schema.optionalKey(Schema.Boolean) }),
    success: Schema.String,
    failure: ProjectProfileError,
    dependencies: [McpInvocationContext],
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_profiles_read", {
    description:
      "Read this project's private preferences and Tools for agents policy. Omit projectId for this conversation's project. No environment secrets are returned.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      projectId: Schema.optionalKey(ProjectId),
    }),
    success: ProjectProfile,
    failure: Schema.Union([ProjectProfileError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_profiles_update", {
    description:
      "Update authorized private project preferences without opening Settings. Read loom_project_profiles_read first and pass expectedUpdatedAt. Patch only requested fields. For hardware/reach/sites, use always to enable and advertise a requested family, never to disable it, and auto for automatic availability. Changes apply immediately in this conversation; enabled tools can be called without restarting the session.",
    parameters: Schema.Struct({
      ...ProjectProfileUpdate.fields,
      environmentId: OrchestratorMcpEnvironmentTarget,
      projectId: Schema.optionalKey(ProjectId),
      expectedUpdatedAt: ProjectProfile.fields.updatedAt,
    }),
    success: ProjectProfile,
    failure: Schema.Union([ProjectProfileError, OrchestratorMcpFailure]),
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Destructive, false),
);
export const projectProfilesHandlers = McpToolAccess.toLayer(
  ProjectProfilesToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
      loom_project_profiles_read: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const projectId = yield* resolveProjectId(yield* readCaller(), input.projectId);
          return yield* withForkRuntime(
            Effect.flatMap(ProjectProfileService, (service) => service.get(projectId)),
          ).pipe(Effect.provideService(ForkRuntime, runtime));
        }),
      ),
      loom_project_profiles_update: McpToolAccess.writesEnvironment((input) =>
        Effect.gen(function* () {
          const projectId = yield* resolveProjectId(yield* readCaller(), input.projectId);
          return yield* withForkRuntime(
            Effect.flatMap(ProjectProfileService, (service) =>
              service.update({ ...input, projectId }),
            ),
          ).pipe(Effect.provideService(ForkRuntime, runtime));
        }),
      ),
      loom_project_profiles_get: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const invocation = yield* McpInvocationContext;
          if (!invocation.thread)
            return yield* new ProjectProfileError({ reason: "thread-not-found" });
          return yield* withForkRuntime(
            Effect.flatMap(ProjectProfileService, (service) =>
              service.forAgent(invocation.thread!.threadId, input.includeEnv ?? true),
            ),
          ).pipe(Effect.provideService(ForkRuntime, runtime));
        }),
      ),
    };
  }),
);
