// fork: project-home: upstream deleted this file; it keeps the moved-folder failure message test.
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";

import { projectMutationFailureMessage } from "./ProjectMutation.ts";
import { ProjectOperationError } from "./ProjectService.ts";
import {
  WorkspaceRootNotDirectoryError,
  WorkspaceRootNotExistsError,
} from "../workspace/WorkspacePaths.ts";

const projectId = ProjectId.make("project:mutation-mapping");

it("explains invalid folder locations when a project is moved", () => {
  const workspaceRoot = "/work/renamed";
  const failure = (cause: unknown) =>
    new ProjectOperationError({
      operation: "normalize-workspace",
      projectId,
      workspaceRoot,
      cause,
    });
  assert.equal(
    projectMutationFailureMessage(
      failure(
        new WorkspaceRootNotExistsError({ workspaceRoot, normalizedWorkspaceRoot: workspaceRoot }),
      ),
    ),
    "Folder does not exist: /work/renamed. Choose an existing folder on this computer.",
  );
  assert.equal(
    projectMutationFailureMessage(
      failure(
        new WorkspaceRootNotDirectoryError({
          workspaceRoot,
          normalizedWorkspaceRoot: workspaceRoot,
        }),
      ),
    ),
    "This location is a file, not a folder: /work/renamed.",
  );
});
