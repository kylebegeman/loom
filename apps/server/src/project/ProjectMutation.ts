import { type ProjectMutation } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema"; // fork: project-home

// fork: project-home
import { type ProjectService, type ProjectServiceError } from "./ProjectService.ts";
import {
  WorkspaceRootNotDirectoryError,
  WorkspaceRootNotExistsError,
} from "../workspace/WorkspacePaths.ts";

type ProjectMutations = Pick<ProjectService["Service"], "create" | "delete" | "update">;
// fork: project-home
const isMissingWorkspaceRoot = Schema.is(WorkspaceRootNotExistsError);
const isFileWorkspaceRoot = Schema.is(WorkspaceRootNotDirectoryError);

export function projectMutationFailureMessage(error: ProjectServiceError): string {
  if (
    error._tag === "ProjectNotEmptyError" ||
    error._tag === "ProjectConflictError" ||
    // fork: file-placement
    error._tag === "ProjectLocationManagedError"
  )
    return error.message;
  if (error._tag === "ProjectOperationError" && error.operation === "normalize-workspace") {
    if (isMissingWorkspaceRoot(error.cause))
      return `Folder does not exist: ${error.cause.normalizedWorkspaceRoot}. Choose an existing folder on this computer.`;
    if (isFileWorkspaceRoot(error.cause))
      return `This location is a file, not a folder: ${error.cause.normalizedWorkspaceRoot}.`;
  }
  return "Failed to mutate project.";
}

export const projectMutationOperation = Effect.fn("projectMutationOperation")(function* (
  projects: ProjectMutations,
  mutation: ProjectMutation,
) {
  switch (mutation.type) {
    case "project.create":
      return yield* projects.create({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        title: mutation.title,
        workspaceRoot: mutation.workspaceRoot,
        ...(mutation.createWorkspaceRootIfMissing === undefined
          ? {}
          : { createWorkspaceRootIfMissing: mutation.createWorkspaceRootIfMissing }),
        ...(mutation.defaultModelSelection === undefined
          ? {}
          : { defaultModelSelection: mutation.defaultModelSelection }),
        ...(mutation.scripts === undefined ? {} : { scripts: mutation.scripts }),
      });

    case "project.update":
      return yield* projects.update({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        ...(mutation.title === undefined ? {} : { title: mutation.title }),
        ...(mutation.workspaceRoot === undefined ? {} : { workspaceRoot: mutation.workspaceRoot }),
        ...(mutation.defaultModelSelection === undefined
          ? {}
          : { defaultModelSelection: mutation.defaultModelSelection }),
        ...(mutation.autoPull === undefined ? {} : { autoPull: mutation.autoPull }),
        ...(mutation.projectIcon === undefined ? {} : { projectIcon: mutation.projectIcon }),
        ...(mutation.faviconPath === undefined ? {} : { faviconPath: mutation.faviconPath }),
        ...(mutation.defaultThreadEnvMode === undefined
          ? {}
          : { defaultThreadEnvMode: mutation.defaultThreadEnvMode }),
        ...(mutation.scripts === undefined ? {} : { scripts: mutation.scripts }),
      });

    case "project.delete":
      return yield* projects.delete({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        ...(mutation.force === undefined ? {} : { force: mutation.force }),
      });
  }
});
