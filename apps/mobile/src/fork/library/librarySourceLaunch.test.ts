import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { makeThreadShellFixture } from "../../test-fixtures";
import {
  librarySourceLaunchParams,
  librarySourceProjectContext,
  sourceConversationSettings,
} from "./librarySourceLaunch";

const source = makeThreadShellFixture({
  id: ThreadId.make("source-thread"),
  environmentId: EnvironmentId.make("source-computer"),
  projectId: ProjectId.make("source-local-project"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  branch: null,
  worktreePath: null,
  runtimeMode: "approval-required",
  interactionMode: "plan",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "custom-model",
    options: [{ id: "reasoningEffort", value: "max" }],
  },
});
const project: LibraryProject = {
  title: "Project",
  brief: "",
  revision: 1,
  archived: false,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  id: "library-project",
  resources: ["app", "server", "docs"].map((id) => ({
    id,
    title: id,
    remoteUrl: null,
    relativePath: id,
    defaultBranch: null,
  })),
};
const binding = {
  projectId: project.id,
  environmentId: source.environmentId,
  workingCopyId: "source-copy",
  resourceIds: ["app"],
};

describe("new conversations from mobile source settings", () => {
  it("keeps the source computer, files, repository and complete model settings without history", () => {
    expect(librarySourceLaunchParams(source, binding, project)).toEqual({
      projectId: project.id,
      reuseEnvironmentId: source.environmentId,
      initialCopyId: binding.workingCopyId,
      initialResourceId: "app",
      sourceThreadId: source.id,
      launchSettings: {
        modelSelection: source.modelSelection,
        runtimeMode: source.runtimeMode,
        interactionMode: source.interactionMode,
      },
    });
  });

  it.each([
    { branch: "feature/source", worktreePath: null },
    { branch: "feature/source", worktreePath: "/worktrees/source-lane" },
    { branch: null, worktreePath: "/worktrees/source-lane" },
  ])("starts in the Library project's folder whatever checkout the source used: %j", (checkout) => {
    const thread = { ...source, ...checkout };
    expect(librarySourceLaunchParams(thread, binding, project)).toEqual(
      librarySourceLaunchParams(source, binding, project),
    );
    expect(sourceConversationSettings(thread)).toEqual({
      modelSelection: source.modelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: source.interactionMode,
      ...checkout,
    });
  });

  it("uses the Library form for whole projects and the legacy path for partial multi-repository scope", () => {
    expect(
      librarySourceLaunchParams(
        source,
        { ...binding, resourceIds: ["server", "app", "docs"] },
        project,
      ),
    ).toMatchObject({ projectId: project.id });
    for (const resourceIds of [null, []]) {
      const params = librarySourceLaunchParams(source, { ...binding, resourceIds }, project);
      expect(params).toMatchObject({ projectId: project.id });
      expect(params).not.toHaveProperty("initialResourceId");
    }
    expect(
      librarySourceLaunchParams(source, { ...binding, resourceIds: ["app", "server"] }, project),
    ).toBeNull();
    expect(
      librarySourceLaunchParams(source, { ...binding, resourceIds: ["removed"] }, project),
    ).toBeNull();
  });

  it("never retargets source defaults to a binding on another computer or project", () => {
    expect(
      librarySourceLaunchParams(
        source,
        { ...binding, environmentId: EnvironmentId.make("other") },
        project,
      ),
    ).toBeNull();
    expect(librarySourceLaunchParams(source, binding, { ...project, id: "other" })).toBeNull();
  });

  it("starts fresh history with the source launch settings and no new worktree strategy", () => {
    expect(sourceConversationSettings(source)).toEqual({
      modelSelection: source.modelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: source.interactionMode,
      branch: null,
      worktreePath: null,
    });
  });
});

const copy: LibraryWorkingCopy = {
  projectRevision: project.revision,
  rootPath: "/projects/source",
  ownership: "managed",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  id: "copy",
  projectId: project.id,
  environmentId: source.environmentId,
  rootLocalProjectId: ProjectId.make("root"),
  repositories: [
    {
      resourceId: "app",
      localProjectId: source.projectId,
      path: "/projects/source/app",
      branch: null,
      head: null,
    },
  ],
  state: "ready",
};

describe("source Library identity recovery", () => {
  it("recovers only explicit registered local project identities", () => {
    expect(librarySourceProjectContext(source, [copy])).toEqual(bindingFor(copy, ["app"]));
    expect(
      librarySourceProjectContext({ ...source, projectId: copy.rootLocalProjectId! }, [copy]),
    ).toEqual(bindingFor(copy, null));
    expect(librarySourceProjectContext(source, [{ ...copy, registered: false }])).toBeNull();
    expect(librarySourceProjectContext(source, [{ ...copy, state: "released" }])).toBeNull();
    expect(
      librarySourceProjectContext(source, [
        { ...copy, environmentId: EnvironmentId.make("other") },
      ]),
    ).toBeNull();
    expect(librarySourceProjectContext(source, [{ ...copy, repositories: [] }])).toBeNull();
  });

  it("does not guess between distinct Library projects or repository scopes", () => {
    expect(librarySourceProjectContext(source, [copy, { ...copy, projectId: "other" }])).toBeNull();
    expect(
      librarySourceProjectContext(source, [
        copy,
        {
          ...copy,
          repositories: [{ ...copy.repositories[0]!, resourceId: "server" }],
        },
      ]),
    ).toBeNull();
  });
});

function bindingFor(entry: LibraryWorkingCopy, resourceIds: readonly string[] | null) {
  return {
    projectId: entry.projectId,
    environmentId: entry.environmentId,
    workingCopyId: entry.id,
    resourceIds,
  };
}
