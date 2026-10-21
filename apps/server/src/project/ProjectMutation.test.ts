import { assert, it } from "@effect/vitest";
import { CommandId, ProjectId, type Project } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { projectMutationFailureMessage, projectMutationOperation } from "./ProjectMutation.ts";
import { ProjectOperationError, type ProjectService } from "./ProjectService.ts";
import {
  WorkspaceRootNotDirectoryError,
  WorkspaceRootNotExistsError,
} from "../workspace/WorkspacePaths.ts";

const projectId = ProjectId.make("project:mutation-mapping");
const project = {
  id: projectId,
  title: "Mapping",
  workspaceRoot: "/work/mapping",
  repositoryIdentity: null,
  faviconPath: null,
  projectIcon: null,
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  scripts: [],
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
  deletedAt: null,
} satisfies Project;

it.effect("preserves every project mutation field", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<unknown>>([]);
    const projects: Pick<ProjectService["Service"], "create" | "delete" | "update"> = {
      create: (input) =>
        Ref.update(calls, (entries) => [...entries, input]).pipe(Effect.as(project)),
      update: (input) =>
        Ref.update(calls, (entries) => [...entries, input]).pipe(Effect.as(project)),
      delete: (input) =>
        Ref.update(calls, (entries) => [...entries, input]).pipe(Effect.as(project)),
    };

    yield* projectMutationOperation(projects, {
      type: "project.create",
      commandId: CommandId.make("command:create"),
      projectId,
      title: "Created",
      workspaceRoot: "/work/created",
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: null,
      scripts: [],
    });
    yield* projectMutationOperation(projects, {
      type: "project.update",
      commandId: CommandId.make("command:update"),
      projectId,
      title: "Updated",
      workspaceRoot: "/work/updated",
      defaultModelSelection: null,
      autoPull: false,
      projectIcon: null,
      faviconPath: null,
      defaultThreadEnvMode: null,
      scripts: [],
    });
    yield* projectMutationOperation(projects, {
      type: "project.delete",
      commandId: CommandId.make("command:delete"),
      projectId,
      force: true,
    });

    assert.deepEqual(yield* Ref.get(calls), [
      {
        commandId: "command:create",
        projectId,
        title: "Created",
        workspaceRoot: "/work/created",
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
        scripts: [],
      },
      {
        commandId: "command:update",
        projectId,
        title: "Updated",
        workspaceRoot: "/work/updated",
        defaultModelSelection: null,
        autoPull: false,
        projectIcon: null,
        faviconPath: null,
        defaultThreadEnvMode: null,
        scripts: [],
      },
      { commandId: "command:delete", projectId, force: true },
    ]);
  }),
);

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
