import { ProjectProfileError } from "@t3tools/contracts/fork";
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
);
export const projectProfilesHandlers = McpToolAccess.toLayer(
  ProjectProfilesToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return {
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
