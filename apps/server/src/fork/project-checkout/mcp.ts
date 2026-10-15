import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ProjectCheckoutRequest,
  ProjectCheckoutActionRequest,
  ProjectCheckoutReleaseResult,
  ProjectCheckoutAdoptRequest,
  ProjectCheckoutRetentionRequest,
  ProjectCheckoutPreview,
  ProjectCheckoutManagementError,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectCheckoutManagement from "../../project/ProjectCheckoutManagement.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";

const failure = Schema.Union([ProjectCheckoutManagementError, OrchestratorMcpFailure]);
export const ProjectCheckoutToolkit = Toolkit.make(
  Tool.make("loom_project_checkout_release", {
    description:
      "Release exactly one managed working copy after reviewing its current preview. Requires reviewToken and full access. It keeps the project, conversations, resources and recovery archive, preserves the storage policy, and never sweeps other projects. Active work, local files, unpublished changes or linked worktrees block removal; the result explains why.",
    parameters: ProjectCheckoutActionRequest,
    success: ProjectCheckoutReleaseResult,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true),
  Tool.make("loom_project_checkout_restore", {
    description:
      "Restore exactly one previously released managed working copy from its saved recovery archive. Requires its current preview reviewToken and full access. Retains the same project and conversation identities and does not change the future storage policy or run project setup.",
    parameters: ProjectCheckoutActionRequest,
    success: ProjectCheckoutPreview,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_checkout_preview", {
    description:
      "Review one registered project's primary checkout ownership, local file summary, and storage policy. Reads only, never restores files, scans folder sizes, or authenticates. The returned reviewToken is required for an explicitly reviewed adoption or policy change.",
    parameters: ProjectCheckoutRequest,
    success: ProjectCheckoutPreview,
    failure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_checkout_adopt", {
    description:
      "Adopt exactly one registered primary Git checkout after the user reviews its preview and chooses keep or release-on-settle. Requires the current reviewToken and full access. Adoption adds ownership metadata and preserves existing files and history. Release-on-settle permits later safe cleanup, including already settled eligible projects; it is never blanket adoption.",
    parameters: ProjectCheckoutAdoptRequest,
    success: ProjectCheckoutPreview,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_project_checkout_retention", {
    description:
      "Save one managed project's explicitly reviewed storage policy with its current reviewToken and full access. keep retains the primary checkout and restores an already released owned checkout without running setup. release-on-settle permits safe recovery-backed cleanup, including already settled eligible work. inherit follows this computer's default policy. Never deletes recovery archives or project history.",
    parameters: ProjectCheckoutRetentionRequest,
    success: ProjectCheckoutPreview,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
export const projectCheckoutHandlers = McpToolAccess.toLayer(
  ProjectCheckoutToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_project_checkout_release: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const callerContext = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(callerContext),
            Effect.mapError(
              (cause) =>
                new ProjectCheckoutManagementError({
                  projectId: input.projectId,
                  reason: "blocked",
                  cause,
                }),
            ),
          );
          return yield* onHost(
            Effect.flatMap(ProjectCheckoutManagement.ProjectCheckoutManagement, (service) =>
              service.release(input, authorize),
            ),
          );
        }),
      ),
      loom_project_checkout_restore: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const callerContext = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(callerContext),
            Effect.mapError(
              (cause) =>
                new ProjectCheckoutManagementError({
                  projectId: input.projectId,
                  reason: "blocked",
                  cause,
                }),
            ),
          );
          return yield* onHost(
            Effect.flatMap(ProjectCheckoutManagement.ProjectCheckoutManagement, (service) =>
              service.restore(input, authorize),
            ),
          );
        }),
      ),
      loom_project_checkout_preview: McpToolAccess.reads((input) =>
        onHost(
          Effect.flatMap(ProjectCheckoutManagement.ProjectCheckoutManagement, (service) =>
            service.preview(input),
          ),
        ),
      ),
      loom_project_checkout_adopt: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const callerContext = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(callerContext),
            Effect.mapError(
              (cause) =>
                new ProjectCheckoutManagementError({
                  projectId: input.projectId,
                  reason: "blocked",
                  cause,
                }),
            ),
          );
          return yield* onHost(
            Effect.flatMap(ProjectCheckoutManagement.ProjectCheckoutManagement, (service) =>
              service.adopt(input, authorize),
            ),
          );
        }),
      ),
      loom_project_checkout_retention: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const callerContext = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(callerContext),
            Effect.mapError(
              (cause) =>
                new ProjectCheckoutManagementError({
                  projectId: input.projectId,
                  reason: "blocked",
                  cause,
                }),
            ),
          );
          return yield* onHost(
            Effect.flatMap(ProjectCheckoutManagement.ProjectCheckoutManagement, (service) =>
              service.setRetention(input, authorize),
            ),
          );
        }),
      ),
    };
  }),
);
