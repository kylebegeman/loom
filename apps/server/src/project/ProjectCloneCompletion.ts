// fork: project-preparation - Refresh both metadata caches after cloning into the saved folder.
import { CommandId, OrchestrationDispatchCommandError, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as ProjectCloneTracker from "./ProjectCloneTracker.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

/** Post-clone wiring refreshes the saved project's metadata without changing its folder. */
export const makeProjectCloneCompletion = Effect.gen(function* () {
  const repositoryIdentityResolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const projectEnrichment = yield* ProjectEnrichmentService.ProjectEnrichmentService;
  const projectService = yield* ProjectService.ProjectService;
  return (project: { readonly projectId: ProjectId; readonly workspaceRoot: string }) =>
    repositoryIdentityResolver.resolve(project.workspaceRoot, { refresh: true }).pipe(
      // Creation may have cached the empty folder. Updating the same root does not invalidate it.
      Effect.andThen(projectEnrichment.invalidate([project.workspaceRoot])),
      Effect.andThen(
        projectService.update({
          commandId: CommandId.make(`project-clone-done:${project.projectId}`),
          projectId: project.projectId,
        }),
      ),
      Effect.asVoid,
    );
});

/** Every clone transport registers and finishes projects the same way. */
export const makeProjectCloneHooks = Effect.fn("ProjectCloneCompletion.makeHooks")(function* (
  afterCloned: (workspaceRoot: string) => Effect.Effect<void> = () => Effect.void,
) {
  const projectService = yield* ProjectService.ProjectService;
  const completeProjectClone = yield* makeProjectCloneCompletion;
  return {
    createProject: (project) =>
      projectService
        .create({
          commandId: CommandId.make(`project-clone-create:${project.projectId}`),
          projectId: project.projectId,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
          createWorkspaceRootIfMissing: true,
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new OrchestrationDispatchCommandError({
                message: "Failed to create clone project.",
                cause,
              }),
          ),
        ),
    onCloned: (project) =>
      completeProjectClone(project).pipe(
        Effect.andThen(afterCloned(project.workspaceRoot)),
        Effect.ignoreCause({ log: true }),
      ),
  } satisfies ProjectCloneTracker.ProjectCloneHooks;
});
